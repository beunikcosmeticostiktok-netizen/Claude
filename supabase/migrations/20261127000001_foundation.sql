-- =====================================================================
-- Century Shalom — Sistema de gestão
-- Migração 0001: fundação (usuários, perfis, permissões, auditoria, configurações)
-- Permissões são aplicadas AQUI, no banco (RLS), não só na interface.
-- =====================================================================

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------- Tipos ----------
create type public.app_role as enum
  ('admin','gestor','comercial','producao','estoque','compras','financeiro');
create type public.customer_access as enum ('leitura','aprovador','financeiro');

-- ---------- Utilidades ----------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function app.digits(t text) returns text
language sql immutable as $$ select regexp_replace(coalesce(t,''), '\D', '', 'g') $$;

create or replace function app.valid_cpf(c text) returns boolean
language plpgsql immutable as $$
declare s int; r int; i int;
begin
  if c is null or c !~ '^\d{11}$' or c ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(c,i,1)::int * (11-i); end loop;
  r := (s*10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(c,10,1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(c,i,1)::int * (12-i); end loop;
  r := (s*10) % 11; if r = 10 then r := 0; end if;
  return r = substr(c,11,1)::int;
end $$;

create or replace function app.valid_cnpj(c text) returns boolean
language plpgsql immutable as $$
declare
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int; d1 int; d2 int;
begin
  if c is null or c !~ '^\d{14}$' or c ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(c,i,1)::int * w1[i]; end loop;
  r := s % 11; d1 := case when r < 2 then 0 else 11 - r end;
  if d1 <> substr(c,13,1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(c,i,1)::int * w2[i]; end loop;
  r := s % 11; d2 := case when r < 2 then 0 else 11 - r end;
  return d2 = substr(c,14,1)::int;
end $$;

create or replace function app.valid_tax_id(c text) returns boolean
language sql immutable as $$ select app.valid_cpf(c) or app.valid_cnpj(c) $$;

-- ---------- Perfis e papéis ----------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  is_seller   boolean not null default false,   -- aparece como vendedor (rastro de vendas/comissão)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function app.set_updated_at();

create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  primary key (user_id, role)
);

-- ---------- Funções de apoio às políticas (security definer, sem recursão) ----------
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

create or replace function app.has_any_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.active and ur.role = any (roles))
$$;

create or replace function app.has_role(r public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_any_role(r)
$$;

create or replace function app.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.active)
$$;

create or replace function app.require_any_role(variadic roles public.app_role[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_any_role(variadic roles) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------- Primeiro usuário vira administrador (bootstrap) ----------
-- IMPORTANTE: depois de criar o primeiro usuário, desative "Allow new users to sign up"
-- no Supabase (Authentication > Providers > Email). Os demais entram por convite.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  if not exists (select 1 from public.user_roles where role = 'admin')
     and not exists (select 1 from public.profiles where id <> new.id) then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------- Auditoria (somente inserção) ----------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_at_idx on public.audit_log (at desc);

create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_id text;
begin
  if tg_op = 'DELETE' then v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then v_new := to_jsonb(new);
  else v_old := to_jsonb(old); v_new := to_jsonb(new);
    if v_old = v_new then return null; end if;
  end if;
  v_id := coalesce((coalesce(v_new, v_old)) ->> 'id', (coalesce(v_new, v_old)) ->> 'user_id',
                   (coalesce(v_new, v_old)) ->> 'key');
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_old, v_new);
  return null;
end $$;

create or replace function app.audit_immutable() returns trigger
language plpgsql as $$
begin raise exception 'audit_log é somente inserção'; end $$;
create trigger trg_audit_immutable before update or delete on public.audit_log
  for each row execute function app.audit_immutable();

create trigger trg_audit_profiles   after insert or update or delete on public.profiles
  for each row execute function app.audit_row();
create trigger trg_audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function app.audit_row();

-- ---------- Configurações ----------
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create trigger trg_settings_updated before update on public.settings
  for each row execute function app.set_updated_at();
create trigger trg_audit_settings after insert or update or delete on public.settings
  for each row execute function app.audit_row();

insert into public.settings (key, value, description) values
  ('markup_minimo',            '1.5',  'Markup mínimo sobre o custo completo (preço >= custo x markup). Decidido pela empresa.'),
  ('sinal_pct',                '50',   'Percentual de sinal exigido em pedidos que exigem produção.'),
  ('loja_max_qty_por_pedido',  '300',  'Quantidade máxima por pedido na loja on-line; acima, consultar vendedor.'),
  ('devolucao_dias',           '7',    'Prazo de arrependimento da loja on-line (dias), contado da confirmação de recebimento.'),
  ('simples_aliquota_pct',     '0',    'Alíquota efetiva do Simples Nacional (%). INFORMAR COM O CONTADOR; zero até ser informada.'),
  ('lead_responsavel_id',      'null', 'Usuário que recebe novos leads. Vazio = primeiro administrador.');

create or replace function app.setting_num(p_key text) returns numeric
language sql stable security definer set search_path = '' as $$
  select nullif(value #>> '{}', 'null')::numeric from public.settings where key = p_key
$$;

-- ---------- RLS ----------
alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log  enable row level security;
alter table public.settings   enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_internal());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.has_any_role('admin','gestor'));

create policy audit_select on public.audit_log for select to authenticated
  using (app.has_any_role('admin','gestor'));

create policy settings_select on public.settings for select to authenticated
  using (app.is_internal());
create policy settings_update on public.settings for update to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));

-- Privilégios de coluna: o cliente da API só altera o que a regra permite
revoke all on public.profiles, public.user_roles, public.audit_log, public.settings from authenticated, anon;
grant select on public.profiles, public.user_roles, public.audit_log, public.settings to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
grant update (value, updated_by) on public.settings to authenticated;

-- ---------- Administração de usuários (somente administrador) ----------
create or replace function public.admin_grant_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin');
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'user_not_found';
  end if;
  insert into public.user_roles (user_id, role, granted_by) values (p_user, p_role, auth.uid())
  on conflict do nothing;
end $$;

create or replace function public.admin_revoke_role(p_user uuid, p_role public.app_role) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admins int;
begin
  perform app.require_any_role('admin');
  if p_role = 'admin' then
    select count(*) into v_admins from public.user_roles ur
      join public.profiles p on p.id = ur.user_id where ur.role = 'admin' and p.active;
    if v_admins <= 1 and exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
      raise exception 'last_admin';
    end if;
  end if;
  delete from public.user_roles where user_id = p_user and role = p_role;
end $$;

create or replace function public.admin_set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_admins int;
begin
  perform app.require_any_role('admin');
  if not p_active and exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
    select count(*) into v_admins from public.user_roles ur
      join public.profiles p on p.id = ur.user_id where ur.role = 'admin' and p.active;
    if v_admins <= 1 then raise exception 'last_admin'; end if;
  end if;
  update public.profiles set active = p_active where id = p_user;
end $$;

create or replace function public.admin_set_seller(p_user uuid, p_is_seller boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin');
  update public.profiles set is_seller = p_is_seller where id = p_user;
end $$;

-- Execução: apenas usuários autenticados (nunca anônimos)
revoke all on function public.admin_grant_role(uuid, public.app_role)  from public, anon;
revoke all on function public.admin_revoke_role(uuid, public.app_role) from public, anon;
revoke all on function public.admin_set_user_active(uuid, boolean)     from public, anon;
revoke all on function public.admin_set_seller(uuid, boolean)          from public, anon;
grant execute on function public.admin_grant_role(uuid, public.app_role)  to authenticated;
grant execute on function public.admin_revoke_role(uuid, public.app_role) to authenticated;
grant execute on function public.admin_set_user_active(uuid, boolean)     to authenticated;
grant execute on function public.admin_set_seller(uuid, boolean)          to authenticated;

revoke all on function app.is_active_user(), app.has_role(public.app_role), app.is_internal(),
  app.setting_num(text) from public, anon;
grant execute on function app.is_active_user(), app.has_role(public.app_role), app.is_internal(),
  app.setting_num(text) to authenticated, service_role;
revoke all on function app.has_any_role(public.app_role[]) from public, anon;
grant execute on function app.has_any_role(public.app_role[]) to authenticated, service_role;
revoke all on function app.require_any_role(public.app_role[]) from public, anon;
grant execute on function app.require_any_role(public.app_role[]) to authenticated, service_role;

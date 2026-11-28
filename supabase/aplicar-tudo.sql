-- =====================================================================
-- Century Shalom — instalação completa do banco (gerado automaticamente)
-- Cole TUDO no SQL Editor do Supabase e clique em Run. Se algum erro aparecer,
-- NADA é gravado (tudo roda em uma única transação): envie o texto do erro.
-- =====================================================================

-- ########## 20261127000001_foundation.sql ##########
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

-- ########## 20261127000002_crm.sql ##########
-- =====================================================================
-- Migração 0002: CRM (clientes, contatos, portal, funil, leads, oportunidades)
-- =====================================================================

-- ---------- Clientes ----------
create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  legal_name       text not null check (btrim(legal_name) <> ''),
  trade_name       text,
  tax_id           text,                         -- CPF ou CNPJ, somente dígitos
  segment          text,
  origin           text,
  owner_id         uuid references public.profiles(id),
  commercial_terms jsonb not null default '{}'::jsonb,
  internal_notes   text,                         -- NUNCA exposto ao portal
  active           boolean not null default true,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint customers_tax_id_valid check (tax_id is null or app.valid_tax_id(tax_id))
);
create unique index customers_tax_id_uk on public.customers (tax_id) where tax_id is not null;
create index customers_owner_idx on public.customers (owner_id);

create or replace function app.normalize_customer() returns trigger
language plpgsql as $$
begin new.tax_id := nullif(app.digits(new.tax_id), ''); return new; end $$;
create trigger trg_customers_norm before insert or update on public.customers
  for each row execute function app.normalize_customer();

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  name        text not null check (btrim(name) <> ''),
  role_title  text,
  phone       text,
  whatsapp    text,
  email       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index contacts_customer_idx on public.contacts (customer_id);

create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  kind        text not null check (kind in ('faturamento','entrega')),
  cep         text, street text, number text, complement text, district text,
  city        text, state char(2),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index addresses_customer_idx on public.addresses (customer_id);

-- Vínculo entre o login do portal e a empresa cliente (vários contatos por empresa)
create table public.customer_users (
  user_id     uuid not null references public.profiles(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contact_id  uuid references public.contacts(id),
  access      public.customer_access not null default 'leitura',
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (user_id, customer_id)
);

create or replace function app.my_customers() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select cu.customer_id from public.customer_users cu
  join public.profiles p on p.id = cu.user_id
  where cu.user_id = auth.uid() and cu.active and p.active
$$;

create or replace function app.customer_level(p_customer uuid) returns public.customer_access
language sql stable security definer set search_path = '' as $$
  select cu.access from public.customer_users cu
  join public.profiles p on p.id = cu.user_id
  where cu.user_id = auth.uid() and cu.customer_id = p_customer and cu.active and p.active
$$;

-- ---------- Funil ----------
create table public.pipeline_stages (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  position int  not null unique,
  kind     text not null check (kind in ('aberta','ganha','perdida')),
  active   boolean not null default true
);
insert into public.pipeline_stages (name, position, kind) values
  ('Novo contato', 1, 'aberta'),
  ('Qualificação', 2, 'aberta'),
  ('Levantamento da necessidade', 3, 'aberta'),
  ('Orçamento em elaboração', 4, 'aberta'),
  ('Orçamento enviado', 5, 'aberta'),
  ('Negociação', 6, 'aberta'),
  ('Ganho', 7, 'ganha'),
  ('Perdido', 8, 'perdida');

create table public.loss_reasons (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  active boolean not null default true
);
insert into public.loss_reasons (name) values ('Outro');  -- demais motivos: configurar no administrador

-- ---------- Leads (landing / loja / manual) ----------
create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  source           text not null check (source in ('landing','loja','whatsapp','manual')),
  interest_type    text not null check (interest_type in ('produto_existente','projeto_exclusivo')),
  name             text not null check (btrim(name) <> ''),
  company          text,
  tax_id           text,
  phone            text,
  phone_digits     text generated always as (app.digits(phone)) stored,
  email            text,
  product_interest text,
  message          text,
  consent_at       timestamptz,
  ip_hash          text,
  status           text not null default 'novo' check (status in ('novo','processado','anexado','spam')),
  customer_id      uuid references public.customers(id),
  opportunity_id   uuid,
  raw              jsonb not null default '{}'::jsonb,
  constraint leads_contact_required check (coalesce(btrim(phone),'') <> '' or coalesce(btrim(email),'') <> '')
);
create index leads_created_idx on public.leads (created_at desc);
create index leads_phone_idx on public.leads (phone_digits);
create index leads_ip_idx on public.leads (ip_hash, created_at);

-- ---------- Oportunidades ----------
create table public.opportunities (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete restrict,
  lead_id          uuid references public.leads(id),
  stage_id         uuid not null references public.pipeline_stages(id),
  owner_id         uuid references public.profiles(id),
  title            text not null,
  interest_type    text check (interest_type in ('produto_existente','projeto_exclusivo')),
  est_value        numeric(14,2),
  loss_reason_id   uuid references public.loss_reasons(id),
  loss_note        text,
  next_contact_at  timestamptz,
  closed_at        timestamptz,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index opportunities_customer_idx on public.opportunities (customer_id);
create index opportunities_stage_idx on public.opportunities (stage_id);
alter table public.leads add constraint leads_opportunity_fk
  foreign key (opportunity_id) references public.opportunities(id);

create or replace function app.opportunity_guard() returns trigger
language plpgsql as $$
declare v_kind text;
begin
  select kind into v_kind from public.pipeline_stages where id = new.stage_id;
  if v_kind = 'perdida' and new.loss_reason_id is null then
    raise exception 'loss_reason_required';
  end if;
  if v_kind in ('ganha','perdida') then new.closed_at := coalesce(new.closed_at, now());
  else new.closed_at := null; end if;
  return new;
end $$;
create trigger trg_opportunity_guard before insert or update on public.opportunities
  for each row execute function app.opportunity_guard();

create table public.activities (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid references public.opportunities(id) on delete restrict,
  customer_id    uuid references public.customers(id) on delete restrict,
  kind           text not null default 'tarefa' check (kind in ('tarefa','ligacao','whatsapp','email','reuniao','nota')),
  title          text not null,
  description    text,
  due_at         timestamptz,
  done_at        timestamptz,
  assignee_id    uuid references public.profiles(id),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint activities_has_target check (opportunity_id is not null or customer_id is not null)
);
create index activities_due_idx on public.activities (assignee_id, due_at) where done_at is null;

-- ---------- Notificações internas ----------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null,
  body       text,
  entity     text,
  entity_id  text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------- updated_at e auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['customers','contacts','addresses','opportunities','activities'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['customers','contacts','addresses','customer_users','pipeline_stages',
                           'loss_reasons','leads','opportunities','activities'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.customers       enable row level security;
alter table public.contacts        enable row level security;
alter table public.addresses       enable row level security;
alter table public.customer_users  enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.loss_reasons    enable row level security;
alter table public.leads           enable row level security;
alter table public.opportunities   enable row level security;
alter table public.activities      enable row level security;
alter table public.notifications   enable row level security;

-- Internos leem cadastros; admin e comercial escrevem. Cliente NÃO lê tabelas-base (só as visões do portal).
create policy customers_select on public.customers for select to authenticated using (app.is_internal());
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy customers_update on public.customers for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy contacts_select on public.contacts for select to authenticated using (app.is_internal());
create policy contacts_insert on public.contacts for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy contacts_update on public.contacts for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy addresses_select on public.addresses for select to authenticated using (app.is_internal());
create policy addresses_insert on public.addresses for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy addresses_update on public.addresses for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy cu_select on public.customer_users for select to authenticated
  using (user_id = auth.uid() or app.is_internal());
create policy cu_insert on public.customer_users for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy cu_update on public.customer_users for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy stages_select on public.pipeline_stages for select to authenticated using (app.is_internal());
create policy stages_write on public.pipeline_stages for all to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));
create policy loss_select on public.loss_reasons for select to authenticated using (app.is_internal());
create policy loss_write on public.loss_reasons for all to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));

create policy leads_select on public.leads for select to authenticated
  using (app.has_any_role('admin','gestor','comercial'));
create policy leads_insert on public.leads for insert to authenticated
  with check (source = 'manual' and app.has_any_role('admin','comercial'));
create policy leads_update on public.leads for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy opp_select on public.opportunities for select to authenticated
  using (app.has_any_role('admin','gestor','comercial'));
create policy opp_insert on public.opportunities for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy opp_update on public.opportunities for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy act_select on public.activities for select to authenticated
  using (app.has_any_role('admin','gestor','comercial'));
create policy act_insert on public.activities for insert to authenticated
  with check (app.has_any_role('admin','comercial'));
create policy act_update on public.activities for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));

create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Privilégios explícitos (sem DELETE: cadastros são inativados, nunca excluídos)
revoke all on public.customers, public.contacts, public.addresses, public.customer_users,
  public.pipeline_stages, public.loss_reasons, public.leads, public.opportunities,
  public.activities, public.notifications from anon, authenticated;
grant select, insert, update on public.customers, public.contacts, public.addresses,
  public.customer_users, public.leads, public.opportunities, public.activities to authenticated;
grant select, insert, update, delete on public.pipeline_stages, public.loss_reasons to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- Visão do portal: dados públicos da própria empresa ----------
create or replace view public.portal_customer as
  select c.id, c.legal_name, c.trade_name, c.tax_id
  from public.customers c
  where c.id in (select app.my_customers());
revoke all on public.portal_customer from anon;
grant select on public.portal_customer to authenticated;

-- ---------- Landing/loja → oportunidade ----------
create or replace function public.lead_rate_ok(p_ip_hash text, p_phone text, p_max int default 5)
returns boolean language sql stable security definer set search_path = '' as $$
  select (
    select count(*) from public.leads
    where created_at > now() - interval '1 hour'
      and ((p_ip_hash is not null and ip_hash = p_ip_hash)
           or (app.digits(p_phone) <> '' and phone_digits = app.digits(p_phone)))
  ) < p_max
$$;

create or replace function public.process_lead(p_lead uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  l public.leads%rowtype;
  v_customer uuid; v_contact uuid; v_opp uuid; v_owner uuid; v_stage uuid;
  v_digits text; v_tax text; v_status text; v_owner_txt text; v_title text;
begin
  if not (auth.role() = 'service_role' or app.has_any_role('admin','comercial')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'lead_not_found'; end if;
  if l.opportunity_id is not null then return l.opportunity_id; end if;   -- idempotente

  v_digits := app.digits(l.phone);
  v_tax := nullif(app.digits(l.tax_id), '');
  if v_tax is not null and not app.valid_tax_id(v_tax) then v_tax := null; end if;

  -- 1) cliente já existente? (CPF/CNPJ, telefone ou e-mail)
  if v_tax is not null then
    select id into v_customer from public.customers where tax_id = v_tax;
  end if;
  if v_customer is null then
    select ct.customer_id, ct.id into v_customer, v_contact from public.contacts ct
    where ct.active and (
      (v_digits <> '' and (app.digits(ct.phone) = v_digits or app.digits(ct.whatsapp) = v_digits))
      or (coalesce(l.email,'') <> '' and lower(ct.email) = lower(l.email)))
    order by ct.created_at limit 1;
  end if;

  -- 2) responsável pelo lead
  select nullif(value #>> '{}', 'null') into v_owner_txt from public.settings where key = 'lead_responsavel_id';
  if v_owner_txt is not null then
    select p.id into v_owner from public.profiles p where p.id = v_owner_txt::uuid and p.active;
  end if;
  if v_owner is null then
    select ur.user_id into v_owner from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.role = 'admin' and p.active order by ur.created_at limit 1;
  end if;

  -- 3) cria cliente/contato se necessário
  if v_customer is null then
    insert into public.customers (legal_name, tax_id, origin, owner_id, created_by)
    values (coalesce(nullif(btrim(l.company), ''), l.name), v_tax, l.source, v_owner, null)
    returning id into v_customer;
  end if;
  if v_contact is null then
    insert into public.contacts (customer_id, name, phone, whatsapp, email)
    values (v_customer, l.name, l.phone, l.phone, l.email) returning id into v_contact;
  end if;

  -- 4) oportunidade aberta existente? anexa; senão cria no primeiro estágio
  select o.id into v_opp from public.opportunities o
  join public.pipeline_stages s on s.id = o.stage_id
  where o.customer_id = v_customer and s.kind = 'aberta'
  order by o.created_at desc limit 1;

  if v_opp is not null then
    v_status := 'anexado';
  else
    select id into v_stage from public.pipeline_stages where kind = 'aberta' and active order by position limit 1;
    v_title := case l.interest_type when 'projeto_exclusivo' then 'Projeto exclusivo' else 'Produto de linha' end
               || coalesce(' — ' || nullif(l.product_interest, ''), '');
    insert into public.opportunities (customer_id, lead_id, stage_id, owner_id, title, interest_type, created_by)
    values (v_customer, l.id, v_stage, v_owner, v_title, l.interest_type, null)
    returning id into v_opp;
    v_status := 'processado';
  end if;

  insert into public.activities (opportunity_id, customer_id, kind, title, description, assignee_id, created_by)
  values (v_opp, v_customer, 'nota',
          case v_status when 'anexado' then 'Novo contato pelo site (cliente já em atendimento)' else 'Contato recebido pelo site' end,
          concat_ws(E'\n', 'Origem: ' || l.source, 'Interesse: ' || l.interest_type,
                    nullif('Produto: ' || coalesce(l.product_interest,''), 'Produto: '), l.message),
          v_owner, null);

  if v_owner is not null then
    insert into public.notifications (user_id, kind, title, body, entity, entity_id)
    values (v_owner, 'lead_novo', 'Novo lead: ' || l.name,
            case v_status when 'anexado' then 'Já existe oportunidade aberta para este cliente.' else 'Oportunidade criada em Novo contato.' end,
            'opportunities', v_opp::text);
  end if;

  update public.leads set customer_id = v_customer, opportunity_id = v_opp, status = v_status where id = l.id;
  return v_opp;
end $$;

revoke all on function public.lead_rate_ok(text, text, int) from public, anon, authenticated;
grant execute on function public.lead_rate_ok(text, text, int) to service_role;
revoke all on function public.process_lead(uuid) from public, anon;
grant execute on function public.process_lead(uuid) to authenticated, service_role;
revoke all on function app.my_customers(), app.customer_level(uuid) from public, anon;
grant execute on function app.my_customers(), app.customer_level(uuid) to authenticated, service_role;

-- ########## 20261127000003_catalog_costs.sql ##########
-- =====================================================================
-- Migração 0003: catálogo, 5 faixas de preço e custos (somente interno)
-- =====================================================================

create type public.item_type as enum
  ('produto_acabado','materia_prima','componente','embalagem_auxiliar','servico');

create table public.items (
  id             uuid primary key default gen_random_uuid(),
  type           public.item_type not null,
  sku            text not null unique check (btrim(sku) <> ''),
  name           text not null check (btrim(name) <> ''),
  description    text,
  category       text,                          -- ex.: pets, cabelo, embalagens, tampas
  uom            text not null default 'un',
  weight_g       numeric(12,3),
  dimensions     jsonb not null default '{}'::jsonb,
  capacity_ml    numeric(12,3),
  material       text,
  finish         text,
  min_qty        int not null default 1 check (min_qty >= 1),
  qty_multiple   int not null default 1 check (qty_multiple >= 1),
  lead_time_days int check (lead_time_days is null or lead_time_days >= 0),
  store_published boolean not null default false,  -- aparece na loja (estoque vem na Etapa 2)
  internal_notes text,
  active         boolean not null default true,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index items_category_idx on public.items (category);

create table public.item_variants (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete restrict,
  sku        text not null unique,
  color      text,
  finish     text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index item_variants_item_idx on public.item_variants (item_id);

-- ---------- 5 faixas de preço (decididas pela empresa) ----------
create table public.price_tier_defs (
  id      smallint primary key,
  ord     smallint not null unique,
  qty_min int not null check (qty_min >= 1),
  qty_max int check (qty_max is null or qty_max >= qty_min),
  label   text not null
);
insert into public.price_tier_defs (id, ord, qty_min, qty_max, label) values
  (1, 1,     1,   300, '1 a 300'),
  (2, 2,   301,  2000, '301 a 2.000'),
  (3, 3,  2001,  5000, '2.001 a 5.000'),
  (4, 4,  5001, 15999, '5.001 a 15.999'),
  (5, 5, 16000,  null, 'A partir de 16.000');

-- Faixas: exatamente 5, sem vãos nem sobreposição, última aberta.
create or replace function app.validate_price_tiers() returns trigger
language plpgsql as $$
declare r record; prev_max int; n int := 0; first boolean := true;
begin
  for r in select * from public.price_tier_defs order by ord loop
    n := n + 1;
    if first then
      if r.qty_min <> 1 then raise exception 'price_tiers: a primeira faixa deve começar em 1'; end if;
      first := false;
    else
      if prev_max is null or r.qty_min <> prev_max + 1 then
        raise exception 'price_tiers: vão ou sobreposição antes da faixa %', r.ord;
      end if;
    end if;
    prev_max := r.qty_max;
  end loop;
  if n <> 5 then raise exception 'price_tiers: são exatamente 5 faixas'; end if;
  if prev_max is not null then raise exception 'price_tiers: a última faixa deve ser aberta (sem máximo)'; end if;
  return null;
end $$;
create constraint trigger trg_price_tiers_valid after insert or update or delete on public.price_tier_defs
  deferrable initially deferred for each row execute function app.validate_price_tiers();

create table public.price_tiers (
  item_id    uuid not null references public.items(id) on delete restrict,
  tier_id    smallint not null references public.price_tier_defs(id),
  price      numeric(14,2) not null check (price >= 0),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (item_id, tier_id)
);

create or replace function public.item_price_for_qty(p_item uuid, p_qty int) returns numeric
language sql stable as $$
  select pt.price from public.price_tier_defs d
  join public.price_tiers pt on pt.tier_id = d.id and pt.item_id = p_item
  where p_qty >= d.qty_min and (d.qty_max is null or p_qty <= d.qty_max)
$$;

create or replace function public.tier_for_qty(p_qty int) returns smallint
language sql stable as $$
  select d.id from public.price_tier_defs d
  where p_qty >= d.qty_min and (d.qty_max is null or p_qty <= d.qty_max)
$$;

-- Troca atômica dos limites das faixas (só administrador)
create or replace function public.admin_set_price_tiers(p_tiers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  perform app.require_any_role('admin');
  for t in select * from jsonb_array_elements(p_tiers) loop
    update public.price_tier_defs
       set qty_min = (t ->> 'qty_min')::int,
           qty_max = nullif(t ->> 'qty_max', '')::int,
           label   = coalesce(t ->> 'label', label)
     where ord = (t ->> 'ord')::smallint;
  end loop;
end $$;

-- ---------- Custos (parâmetros versionados e ficha de custo) ----------
create table public.cost_parameter_sets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  valid_from   date not null default current_date,
  status       text not null default 'rascunho' check (status in ('rascunho','validado','arquivado')),
  notes        text,
  validated_by uuid references public.profiles(id),
  validated_at timestamptz,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.cost_parameters (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.cost_parameter_sets(id) on delete restrict,
  key         text not null,        -- ex.: custo_hora_maquina:INJ-01, custo_hora_mao_obra, despesas_fixas_mensais
  value       numeric(18,6) not null,
  unit        text,
  description text,
  unique (set_id, key)
);

create or replace function app.cost_parameters_lock() returns trigger
language plpgsql as $$
declare v_status text; v_set uuid;
begin
  v_set := coalesce(new.set_id, old.set_id);
  select status into v_status from public.cost_parameter_sets where id = v_set;
  if v_status <> 'rascunho' then raise exception 'set_locked: conjunto de parâmetros já validado'; end if;
  return coalesce(new, old);
end $$;
create trigger trg_cost_parameters_lock before insert or update or delete on public.cost_parameters
  for each row execute function app.cost_parameters_lock();

create or replace function app.cost_sets_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'rascunho' then raise exception 'set_locked'; end if;
    return old;
  end if;
  if old.status <> 'rascunho' and (new.name, new.valid_from, new.notes) is distinct from (old.name, old.valid_from, old.notes) then
    raise exception 'set_locked';
  end if;
  return new;
end $$;
create trigger trg_cost_sets_guard before update or delete on public.cost_parameter_sets
  for each row execute function app.cost_sets_guard();

create or replace function public.cost_set_validate(p_set uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  update public.cost_parameter_sets set status = 'validado', validated_by = auth.uid(), validated_at = now()
   where id = p_set and status = 'rascunho';
  if not found then raise exception 'set_not_draft'; end if;
end $$;

create or replace function public.cost_set_archive(p_set uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  update public.cost_parameter_sets set status = 'arquivado' where id = p_set and status = 'validado';
  if not found then raise exception 'set_not_validated'; end if;
end $$;

create table public.cost_sheets (
  id                     uuid primary key default gen_random_uuid(),
  item_id                uuid references public.items(id) on delete restrict,
  quote_item_id          uuid,                       -- FK criada na migração de orçamentos
  set_id                 uuid references public.cost_parameter_sets(id),
  version                int not null default 1,
  params_snapshot        jsonb not null default '{}'::jsonb,
  direct_cost            numeric(14,6) not null default 0,
  setup_cost             numeric(14,6) not null default 0,
  fixed_cost             numeric(14,6) not null default 0,
  full_cost              numeric(14,6) not null default 0,
  markup_min             numeric(8,4),
  min_price              numeric(14,6),
  tax_pct_used           numeric(8,4),
  commission_pct_used    numeric(8,4),
  est_result_after_tax   numeric(14,6),
  notes                  text,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  constraint cost_sheets_target check (item_id is not null or quote_item_id is not null)
);
create index cost_sheets_item_idx on public.cost_sheets (item_id);

create table public.cost_sheet_lines (
  id          uuid primary key default gen_random_uuid(),
  sheet_id    uuid not null references public.cost_sheets(id) on delete cascade,
  block       text not null check (block in ('materia_prima','processo','mao_de_obra','preparacao',
                                             'embalagem','terceirizado','despesa_fixa')),
  description text not null,
  quantity    numeric(18,6) not null default 1,
  unit_value  numeric(18,6) not null default 0,
  total       numeric(18,6) not null default 0,
  source      text,
  position    int not null default 0
);
create index cost_sheet_lines_sheet_idx on public.cost_sheet_lines (sheet_id);

-- ---------- updated_at e auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['items','item_variants','cost_parameter_sets'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['items','item_variants','price_tier_defs','price_tiers','cost_parameter_sets',
                           'cost_parameters','cost_sheets'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.items               enable row level security;
alter table public.item_variants       enable row level security;
alter table public.price_tier_defs     enable row level security;
alter table public.price_tiers         enable row level security;
alter table public.cost_parameter_sets enable row level security;
alter table public.cost_parameters     enable row level security;
alter table public.cost_sheets         enable row level security;
alter table public.cost_sheet_lines    enable row level security;

-- Catálogo e preços: internos leem; admin e gestor escrevem
create policy items_select on public.items for select to authenticated using (app.is_internal());
create policy items_write  on public.items for all to authenticated
  using (app.has_any_role('admin','gestor')) with check (app.has_any_role('admin','gestor'));
create policy variants_select on public.item_variants for select to authenticated using (app.is_internal());
create policy variants_write  on public.item_variants for all to authenticated
  using (app.has_any_role('admin','gestor')) with check (app.has_any_role('admin','gestor'));
create policy tierdefs_select on public.price_tier_defs for select to authenticated using (app.is_internal());
create policy tiers_select on public.price_tiers for select to authenticated using (app.is_internal());
create policy tiers_write  on public.price_tiers for all to authenticated
  using (app.has_any_role('admin','gestor')) with check (app.has_any_role('admin','gestor'));

-- CUSTOS: nunca visíveis ao cliente. Leitura: admin, gestor, comercial, financeiro (comercial: ver pendência de decisão).
create policy costsets_select on public.cost_parameter_sets for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy costsets_write on public.cost_parameter_sets for all to authenticated
  using (app.has_any_role('admin','gestor')) with check (app.has_any_role('admin','gestor'));
create policy costparams_select on public.cost_parameters for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy costparams_write on public.cost_parameters for all to authenticated
  using (app.has_any_role('admin','gestor')) with check (app.has_any_role('admin','gestor'));
create policy sheets_select on public.cost_sheets for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy sheets_write on public.cost_sheets for all to authenticated
  using (app.has_any_role('admin','gestor','comercial')) with check (app.has_any_role('admin','gestor','comercial'));
create policy sheetlines_select on public.cost_sheet_lines for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy sheetlines_write on public.cost_sheet_lines for all to authenticated
  using (app.has_any_role('admin','gestor','comercial')) with check (app.has_any_role('admin','gestor','comercial'));

revoke all on public.items, public.item_variants, public.price_tier_defs, public.price_tiers,
  public.cost_parameter_sets, public.cost_parameters, public.cost_sheets, public.cost_sheet_lines
  from anon, authenticated;
grant select, insert, update on public.items, public.item_variants to authenticated;   -- itens são inativados
grant select, insert, update, delete on public.price_tiers, public.cost_parameters,
  public.cost_sheets, public.cost_sheet_lines to authenticated;
grant select on public.price_tier_defs to authenticated;                                 -- limites só via função
grant select, insert, delete on public.cost_parameter_sets to authenticated;
grant update (name, valid_from, notes) on public.cost_parameter_sets to authenticated;   -- status só pelas funções

revoke all on function public.item_price_for_qty(uuid, int), public.tier_for_qty(int),
  public.admin_set_price_tiers(jsonb), public.cost_set_validate(uuid), public.cost_set_archive(uuid)
  from public, anon;
grant execute on function public.item_price_for_qty(uuid, int), public.tier_for_qty(int),
  public.admin_set_price_tiers(jsonb), public.cost_set_validate(uuid), public.cost_set_archive(uuid)
  to authenticated;

-- ########## 20261127000004_quotes_orders.sql ##########
-- =====================================================================
-- Migração 0004: orçamentos versionados, aprovação, pedidos e portal do cliente
-- Garantias no banco: versão enviada é imutável; um orçamento aprovado gera UM pedido;
-- cliente só enxerga a própria empresa, por visões que não contêm custos nem notas internas.
-- =====================================================================

create type public.quote_status as enum
  ('rascunho','aguardando_aprovacao','enviado','em_negociacao','aprovado','recusado','expirado','substituida');

-- ---------- Numeração (ORC-2026-0001, PED-2026-0001) ----------
create table public.counters (key text primary key, value bigint not null);
alter table public.counters enable row level security;     -- sem políticas: ninguém acessa direto

create or replace function app.next_number(p_prefix text) returns text
language plpgsql security definer set search_path = '' as $$
declare k text := p_prefix || '-' || to_char(now(), 'YYYY'); v bigint;
begin
  insert into public.counters (key, value) values (k, 1)
  on conflict (key) do update set value = public.counters.value + 1
  returning value into v;
  return k || '-' || lpad(v::text, 4, '0');
end $$;

-- ---------- Orçamentos ----------
create table public.quotes (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  customer_id    uuid not null references public.customers(id) on delete restrict,
  contact_id     uuid references public.contacts(id),
  opportunity_id uuid references public.opportunities(id),
  seller_id      uuid not null references public.profiles(id),   -- rastro do vendedor
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index quotes_customer_idx on public.quotes (customer_id);
create index quotes_seller_idx on public.quotes (seller_id);

create table public.quote_versions (
  id                     uuid primary key default gen_random_uuid(),
  quote_id               uuid not null references public.quotes(id) on delete restrict,
  version                int not null check (version >= 1),
  status                 public.quote_status not null default 'rascunho',
  valid_until            date,
  payment_terms          text,
  freight_mode           text not null default 'fob' check (freight_mode in ('fob','retirada')),
  carrier_name           text,
  lead_time_days         int check (lead_time_days is null or lead_time_days >= 0),
  deposit_required       boolean not null default true,
  deposit_pct            numeric(5,2) not null default 50 check (deposit_pct between 0 and 100),
  subtotal               numeric(14,2) not null default 0,
  discount_total         numeric(14,2) not null default 0,
  freight_value          numeric(14,2) not null default 0 check (freight_value >= 0),
  total                  numeric(14,2) not null default 0,
  notes_client           text,
  notes_internal         text,                       -- NUNCA exposto ao portal
  internal_approved      boolean not null default false,
  internal_approved_by   uuid references public.profiles(id),
  internal_approved_at   timestamptz,
  internal_approval_note text,
  snapshot               jsonb,                      -- retrato da versão enviada (PDF/portal)
  pdf_path               text,
  sent_at                timestamptz,
  approved_by            uuid references public.profiles(id),
  approved_at            timestamptz,
  approved_ip            text,
  approved_via           text check (approved_via in ('portal','interno')),
  approved_note          text,
  created_by             uuid references public.profiles(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (quote_id, version)
);
-- No máximo um rascunho/aguardando por orçamento
create unique index quote_versions_one_open on public.quote_versions (quote_id)
  where status in ('rascunho','aguardando_aprovacao');

create table public.quote_items (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references public.quote_versions(id) on delete restrict,
  item_id     uuid references public.items(id),                -- nulo = item exclusivo/sob projeto
  description text not null check (btrim(description) <> ''),
  specs       jsonb not null default '{}'::jsonb,
  qty         int not null check (qty > 0),
  tier_id     smallint references public.price_tier_defs(id),
  list_price  numeric(14,2) check (list_price is null or list_price >= 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  unit_cost   numeric(14,6),                                   -- custo COMPLETO unitário (interno)
  position    int not null default 0,
  line_total  numeric(14,2) generated always as (round(qty * unit_price, 2)) stored,
  markup      numeric(10,4) generated always as
              (case when unit_cost is not null and unit_cost > 0 then round(unit_price / unit_cost, 4) end) stored
);
create index quote_items_version_idx on public.quote_items (version_id);
alter table public.cost_sheets add constraint cost_sheets_quote_item_fk
  foreign key (quote_item_id) references public.quote_items(id) on delete restrict;

create table public.quote_change_requests (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.quote_versions(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  message      text not null check (btrim(message) <> ''),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz,
  answered_by  uuid references public.profiles(id)
);

-- ---------- Guardas de imutabilidade ----------
create or replace function app.quote_versions_guard() returns trigger
language plpgsql as $$
declare
  frozen_ok text[] := array['status','updated_at','approved_by','approved_at','approved_ip','approved_via',
    'approved_note','pdf_path','sent_at','snapshot','internal_approved','internal_approved_by',
    'internal_approved_at','internal_approval_note'];
  ignore_reset text[] := array['updated_at','internal_approved','internal_approved_by',
    'internal_approved_at','internal_approval_note','total','status'];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'rascunho' then raise exception 'version_locked'; end if;
    return old;
  end if;

  if new.status <> old.status and not ((old.status::text, new.status::text) in (
      ('rascunho','aguardando_aprovacao'), ('rascunho','enviado'),
      ('aguardando_aprovacao','rascunho'),
      ('enviado','em_negociacao'), ('enviado','aprovado'), ('enviado','recusado'),
      ('enviado','expirado'), ('enviado','substituida'),
      ('em_negociacao','aprovado'), ('em_negociacao','recusado'),
      ('em_negociacao','expirado'), ('em_negociacao','substituida'))) then
    raise exception 'invalid_transition % -> %', old.status, new.status;
  end if;

  if old.status <> 'rascunho' then
    -- versão congelada: só pode mudar status/aprovação/PDF
    if (to_jsonb(new) - frozen_ok) is distinct from (to_jsonb(old) - frozen_ok) then
      raise exception 'version_locked';
    end if;
  else
    new.total := new.subtotal + new.freight_value;
    -- qualquer alteração no rascunho invalida a aprovação interna anterior
    if new.status = 'rascunho' and (to_jsonb(new) - ignore_reset) is distinct from (to_jsonb(old) - ignore_reset)
       and new.internal_approved = old.internal_approved then
      new.internal_approved := false; new.internal_approved_by := null;
      new.internal_approved_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger trg_quote_versions_guard before update or delete on public.quote_versions
  for each row execute function app.quote_versions_guard();

create or replace function app.quote_items_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status public.quote_status;
begin
  select status into v_status from public.quote_versions where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'rascunho' then raise exception 'version_locked'; end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then raise exception 'version_locked'; end if;
  return coalesce(new, old);
end $$;
create trigger trg_quote_items_guard before insert or update or delete on public.quote_items
  for each row execute function app.quote_items_guard();

create or replace function app.quote_items_recalc() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.version_id, old.version_id);
begin
  update public.quote_versions qv set
    subtotal = coalesce((select sum(line_total) from public.quote_items where version_id = v_id), 0),
    discount_total = coalesce((select sum(round(qty * greatest(coalesce(list_price, unit_price) - unit_price, 0), 2))
                               from public.quote_items where version_id = v_id), 0),
    internal_approved = false, internal_approved_by = null, internal_approved_at = null
  where qv.id = v_id;
  return null;
end $$;
create trigger trg_quote_items_recalc after insert or update or delete on public.quote_items
  for each row execute function app.quote_items_recalc();

-- ---------- Pedidos ----------
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  quote_version_id uuid unique references public.quote_versions(id),   -- UM pedido por versão aprovada
  channel          text not null default 'orcamento' check (channel in ('orcamento','loja')),
  seller_id        uuid references public.profiles(id),
  status_commercial text not null default 'aprovado'
    check (status_commercial in ('aprovado','em_ajuste','cancelado')),
  status_financial text not null default 'sem_cobranca'
    check (status_financial in ('sem_cobranca','aguardando_sinal','sinal_pago','parcial','quitado','inadimplente')),
  status_production text not null default 'nao_liberado'
    check (status_production in ('nao_liberado','liberado','programado','em_producao','concluido','parcial')),
  status_logistics text not null default 'aguardando'
    check (status_logistics in ('aguardando','disponivel_separacao','separado','pronto_coleta',
                                'coleta_agendada','coletado_parcial','coletado')),
  deposit_required boolean not null default false,
  deposit_pct      numeric(5,2) not null default 0,
  total            numeric(14,2) not null default 0,
  deposit_amount   numeric(14,2) generated always as
                   (case when deposit_required then round(total * deposit_pct / 100, 2) else 0 end) stored,
  freight_mode     text check (freight_mode in ('fob','retirada')),
  carrier_name     text,
  carrier_contact  text,
  invoice_number   text,
  invoice_key      text check (invoice_key is null or invoice_key ~ '^\d{44}$'),
  invoiced_at      date,                       -- "faturado": base das metas de comissão
  received_at      timestamptz,                -- confirmação de recebimento (prazo de devolução)
  notes_internal   text,
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index orders_customer_idx on public.orders (customer_id);
create index orders_seller_invoiced_idx on public.orders (seller_id, invoiced_at);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete restrict,
  item_id     uuid references public.items(id),
  description text not null,
  specs       jsonb not null default '{}'::jsonb,
  qty         int not null check (qty > 0),
  unit_price  numeric(14,2) not null check (unit_price >= 0),
  qty_produced int not null default 0 check (qty_produced >= 0),
  qty_shipped  int not null default 0 check (qty_shipped >= 0),
  position    int not null default 0,
  line_total  numeric(14,2) generated always as (round(qty * unit_price, 2)) stored
);
create index order_items_order_idx on public.order_items (order_id);

-- Custo do pedido separado: produção/estoque leem itens do pedido sem enxergar custos
create table public.order_item_costs (
  order_item_id uuid primary key references public.order_items(id) on delete restrict,
  unit_cost     numeric(14,6)
);

create table public.order_events (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders(id) on delete restrict,
  at         timestamptz not null default now(),
  actor      uuid,
  kind       text not null,           -- status, release_exception, invoice, cancel, received, carrier, nota
  detail     jsonb not null default '{}'::jsonb,
  note       text
);
create index order_events_order_idx on public.order_events (order_id, at);

-- ---------- Criação de pedido a partir da versão aprovada (única, idempotente) ----------
create or replace function app.create_order_from_version(p_version uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions; q public.quotes; o uuid;
begin
  select * into v from public.quote_versions where id = p_version for update;
  if not found or v.status <> 'aprovado' then raise exception 'version_not_approved'; end if;
  select id into o from public.orders where quote_version_id = p_version;
  if o is not null then return o; end if;

  select * into q from public.quotes where id = v.quote_id;
  insert into public.orders (number, customer_id, quote_version_id, channel, seller_id, deposit_required,
                             deposit_pct, status_financial, total, freight_mode, carrier_name)
  values (app.next_number('PED'), q.customer_id, v.id, 'orcamento', q.seller_id, v.deposit_required,
          v.deposit_pct, case when v.deposit_required and v.deposit_pct > 0 then 'aguardando_sinal' else 'sem_cobranca' end,
          v.total, v.freight_mode, v.carrier_name)
  on conflict (quote_version_id) do nothing
  returning id into o;
  if o is null then select id into o from public.orders where quote_version_id = p_version; return o; end if;

  with ins as (
    insert into public.order_items (order_id, item_id, description, specs, qty, unit_price, position)
    select o, qi.item_id, qi.description, qi.specs, qi.qty, qi.unit_price, qi.position
    from public.quote_items qi where qi.version_id = p_version order by qi.position, qi.id
    returning id, position, description, qty, unit_price
  )
  insert into public.order_item_costs (order_item_id, unit_cost)
  select ins.id, (select qi.unit_cost from public.quote_items qi
                  where qi.version_id = p_version and qi.position = ins.position
                    and qi.description = ins.description and qi.qty = ins.qty and qi.unit_price = ins.unit_price
                  order by qi.id limit 1)
  from ins;

  insert into public.order_events (order_id, actor, kind, detail)
  values (o, auth.uid(), 'nota', jsonb_build_object('origem', 'orcamento', 'quote_version_id', p_version));
  return o;
end $$;

-- ---------- Fluxo do orçamento ----------
create or replace function app.version_needs_approval(p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  -- abaixo do markup mínimo (ou sem custo conhecido) exige aprovação do gestor
  select exists (
    select 1 from public.quote_items qi
    where qi.version_id = p_version
      and (qi.unit_cost is null
           or qi.unit_price < round(qi.unit_cost * coalesce(app.setting_num('markup_minimo'), 1.5), 2)))
$$;

create or replace function public.quote_create(p_customer uuid, p_contact uuid default null,
                                               p_opportunity uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_quote uuid;
begin
  perform app.require_any_role('admin','comercial');
  if not exists (select 1 from public.customers where id = p_customer and active) then
    raise exception 'customer_not_found';
  end if;
  if p_contact is not null and not exists (select 1 from public.contacts where id = p_contact and customer_id = p_customer) then
    raise exception 'contact_mismatch';
  end if;
  insert into public.quotes (number, customer_id, contact_id, opportunity_id, seller_id, created_by)
  values (app.next_number('ORC'), p_customer, p_contact, p_opportunity, auth.uid(), auth.uid())
  returning id into v_quote;
  insert into public.quote_versions (quote_id, version, deposit_pct, created_by)
  values (v_quote, 1, coalesce(app.setting_num('sinal_pct'), 50), auth.uid());
  return v_quote;
end $$;

create or replace function public.quote_new_version(p_quote uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare last public.quote_versions; v_new uuid;
begin
  perform app.require_any_role('admin','comercial');
  select * into last from public.quote_versions where quote_id = p_quote order by version desc limit 1 for update;
  if not found then raise exception 'quote_not_found'; end if;
  if last.status in ('rascunho','aguardando_aprovacao') then raise exception 'draft_exists'; end if;
  insert into public.quote_versions (quote_id, version, payment_terms, freight_mode, carrier_name, lead_time_days,
         deposit_required, deposit_pct, freight_value, notes_client, notes_internal, created_by)
  values (p_quote, last.version + 1, last.payment_terms, last.freight_mode, last.carrier_name, last.lead_time_days,
          last.deposit_required, last.deposit_pct, last.freight_value, last.notes_client, last.notes_internal, auth.uid())
  returning id into v_new;
  insert into public.quote_items (version_id, item_id, description, specs, qty, tier_id, list_price, unit_price, unit_cost, position)
  select v_new, item_id, description, specs, qty, tier_id, list_price, unit_price, unit_cost, position
  from public.quote_items where version_id = last.id;
  return v_new;
end $$;

create or replace function public.quote_request_internal_approval(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','comercial');
  if not exists (select 1 from public.quote_items where version_id = p_version) then raise exception 'no_items'; end if;
  if not app.version_needs_approval(p_version) then raise exception 'approval_not_required'; end if;
  update public.quote_versions set status = 'aguardando_aprovacao' where id = p_version and status = 'rascunho';
  if not found then raise exception 'not_draft'; end if;
end $$;

create or replace function public.quote_internal_approve(p_version uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  update public.quote_versions set status = 'rascunho', internal_approved = true,
         internal_approved_by = auth.uid(), internal_approved_at = now(), internal_approval_note = p_note
   where id = p_version and status = 'aguardando_aprovacao';
  if not found then raise exception 'not_waiting_approval'; end if;
end $$;

create or replace function public.quote_internal_reject(p_version uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update public.quote_versions set status = 'rascunho', internal_approved = false,
         internal_approval_note = p_note
   where id = p_version and status = 'aguardando_aprovacao';
  if not found then raise exception 'not_waiting_approval'; end if;
end $$;

create or replace function public.quote_send(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions; v_snapshot jsonb;
begin
  perform app.require_any_role('admin','gestor','comercial');
  select * into v from public.quote_versions where id = p_version for update;
  if not found then raise exception 'version_not_found'; end if;
  if v.status <> 'rascunho' then raise exception 'not_draft'; end if;
  if not exists (select 1 from public.quote_items where version_id = p_version) then raise exception 'no_items'; end if;
  if v.valid_until is null or v.valid_until < current_date then raise exception 'valid_until_required'; end if;
  if app.version_needs_approval(p_version) and not v.internal_approved then
    raise exception 'needs_internal_approval';
  end if;

  v_snapshot := jsonb_build_object(
    'version', jsonb_build_object('version', v.version, 'valid_until', v.valid_until,
      'payment_terms', v.payment_terms, 'freight_mode', v.freight_mode, 'carrier_name', v.carrier_name,
      'lead_time_days', v.lead_time_days, 'deposit_required', v.deposit_required, 'deposit_pct', v.deposit_pct,
      'subtotal', v.subtotal, 'discount_total', v.discount_total, 'freight_value', v.freight_value,
      'total', v.total, 'notes_client', v.notes_client),
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', description, 'specs', specs, 'qty', qty,
                         'unit_price', unit_price, 'line_total', line_total) order by position, id)
                       from public.quote_items where version_id = p_version), '[]'::jsonb));

  update public.quote_versions set status = 'enviado', sent_at = now(), snapshot = v_snapshot where id = p_version;
  update public.quote_versions set status = 'substituida'
   where quote_id = v.quote_id and id <> p_version and status in ('enviado','em_negociacao');
end $$;

create or replace function public.quote_mark_refused(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','comercial');
  update public.quote_versions set status = 'recusado' where id = p_version and status in ('enviado','em_negociacao');
  if not found then raise exception 'not_open'; end if;
end $$;

-- Aprovação fora do sistema (ex.: aceite por WhatsApp): registra quem lançou e exige justificativa
create or replace function public.quote_mark_approved_offline(p_version uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','comercial');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update public.quote_versions set status = 'aprovado', approved_by = auth.uid(), approved_at = now(),
         approved_via = 'interno', approved_note = p_note
   where id = p_version and status in ('enviado','em_negociacao');
  if not found then raise exception 'not_approvable'; end if;
  return app.create_order_from_version(p_version);
end $$;

create or replace function public.quote_convert_to_order(p_version uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','comercial');
  return app.create_order_from_version(p_version);
end $$;

create or replace function public.quote_expire_due() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (auth.role() = 'service_role' or app.has_any_role('admin','gestor')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.quote_versions set status = 'expirado'
   where status in ('enviado','em_negociacao') and valid_until < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Portal: ações do cliente (validam empresa, versão e nível de acesso) ----------
create or replace function public.portal_approve_quote(p_version uuid, p_ip text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions; v_customer uuid;
begin
  select * into v from public.quote_versions where id = p_version for update;
  if not found then raise exception 'not_found'; end if;
  select customer_id into v_customer from public.quotes where id = v.quote_id;
  if v_customer not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(v_customer) is distinct from 'aprovador' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v.status = 'aprovado' then                                  -- reenvio/duplo clique: devolve o mesmo pedido
    return app.create_order_from_version(p_version);
  end if;
  if v.status not in ('enviado','em_negociacao') then raise exception 'not_approvable'; end if;
  if v.valid_until is not null and v.valid_until < current_date then raise exception 'expired'; end if;
  update public.quote_versions set status = 'aprovado', approved_by = auth.uid(), approved_at = now(),
         approved_ip = p_ip, approved_via = 'portal' where id = p_version;
  return app.create_order_from_version(p_version);
end $$;

create or replace function public.portal_request_quote_change(p_version uuid, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions; v_customer uuid;
begin
  select * into v from public.quote_versions where id = p_version for update;
  if not found then raise exception 'not_found'; end if;
  select customer_id into v_customer from public.quotes where id = v.quote_id;
  if v_customer not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(v_customer) is distinct from 'aprovador' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v.status not in ('enviado','em_negociacao') then raise exception 'not_open'; end if;
  insert into public.quote_change_requests (version_id, requested_by, message) values (p_version, auth.uid(), p_message);
  if v.status = 'enviado' then
    update public.quote_versions set status = 'em_negociacao' where id = p_version;
  end if;
end $$;

create or replace function public.portal_set_carrier(p_order uuid, p_name text, p_contact text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.customer_id not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(o.customer_id) is distinct from 'aprovador' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if o.status_logistics in ('coleta_agendada','coletado_parcial','coletado') or o.status_commercial = 'cancelado' then
    raise exception 'order_locked';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name_required'; end if;
  update public.orders set carrier_name = p_name, carrier_contact = p_contact where id = p_order;
  insert into public.order_events (order_id, actor, kind, detail)
  values (p_order, auth.uid(), 'carrier', jsonb_build_object('carrier_name', p_name, 'by', 'cliente'));
end $$;

-- ---------- Pedido: liberação, status por eixo, nota fiscal, recebimento, cancelamento ----------
create or replace function public.order_release_checks(p_order uuid)
returns table (rule text, ok boolean, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; v_status public.quote_status;
begin
  perform app.require_any_role('admin','gestor','comercial','producao','estoque','financeiro');
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'order_not_found'; end if;
  if o.channel = 'orcamento' then
    select status into v_status from public.quote_versions where id = o.quote_version_id;
    rule := 'orcamento_aprovado'; ok := v_status = 'aprovado'; detail := 'Versão do orçamento aprovada'; return next;
    rule := 'sinal_recebido';
    ok := (not o.deposit_required) or o.status_financial in ('sinal_pago','quitado');
    detail := case when o.deposit_required then 'Sinal de ' || o.deposit_pct || '% (R$ ' || o.deposit_amount || ') validado pelo Financeiro'
                   else 'Sinal não exigido' end;
    return next;
  else
    rule := 'pagamento_integral'; ok := o.status_financial = 'quitado'; detail := 'Loja: pagamento integral confirmado'; return next;
  end if;
end $$;

create or replace function public.order_set_status(p_order uuid, p_axis text, p_value text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_allowed text[]; v_pending int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;

  case p_axis
    when 'commercial' then perform app.require_any_role('admin','gestor','comercial');
      v_allowed := array['aprovado','em_ajuste'];
    when 'financial' then perform app.require_any_role('admin','gestor','financeiro');
      v_allowed := array['sem_cobranca','aguardando_sinal','sinal_pago','parcial','quitado','inadimplente'];
    when 'production' then perform app.require_any_role('admin','gestor','producao');
      v_allowed := array['nao_liberado','liberado','programado','em_producao','concluido','parcial'];
    when 'logistics' then perform app.require_any_role('admin','gestor','estoque');
      v_allowed := array['aguardando','disponivel_separacao','separado','pronto_coleta',
                         'coleta_agendada','coletado_parcial','coletado'];
    else raise exception 'invalid_axis';
  end case;
  if not (p_value = any (v_allowed)) then raise exception 'invalid_value'; end if;

  -- Liberação para produção: todas as condições ou exceção justificada do gestor/administrador
  if p_axis = 'production' and p_value in ('liberado','programado','em_producao') then
    select count(*) into v_pending from public.order_release_checks(p_order) c where not c.ok;
    if v_pending > 0 then
      if coalesce(btrim(p_note), '') = '' or not app.has_any_role('admin','gestor') then
        raise exception 'release_blocked';
      end if;
      insert into public.order_events (order_id, actor, kind, detail, note)
      values (p_order, auth.uid(), 'release_exception',
              jsonb_build_object('pendencias', v_pending, 'para', p_value), p_note);
    end if;
  end if;

  -- Coleta só com nota fiscal anexada (e transportadora indicada para agendar)
  if p_axis = 'logistics' and p_value in ('coleta_agendada','coletado_parcial','coletado') then
    if coalesce(o.invoice_number, '') = '' then raise exception 'invoice_required'; end if;
    if p_value = 'coleta_agendada' and coalesce(o.carrier_name, '') = '' and o.freight_mode = 'fob' then
      raise exception 'carrier_required';
    end if;
  end if;

  case p_axis
    when 'commercial' then update public.orders set status_commercial = p_value where id = p_order;
    when 'financial' then update public.orders set status_financial = p_value where id = p_order;
    when 'production' then update public.orders set status_production = p_value where id = p_order;
    when 'logistics' then update public.orders set status_logistics = p_value where id = p_order;
  end case;
  insert into public.order_events (order_id, actor, kind, detail, note)
  values (p_order, auth.uid(), 'status', jsonb_build_object('axis', p_axis, 'value', p_value), p_note);
end $$;

create or replace function public.order_register_invoice(p_order uuid, p_number text, p_key text default null,
                                                         p_date date default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','financeiro');
  if coalesce(btrim(p_number), '') = '' then raise exception 'number_required'; end if;
  update public.orders set invoice_number = btrim(p_number), invoice_key = nullif(app.digits(p_key), ''),
         invoiced_at = coalesce(p_date, current_date)
   where id = p_order and status_commercial <> 'cancelado';
  if not found then raise exception 'order_not_found'; end if;
  insert into public.order_events (order_id, actor, kind, detail)
  values (p_order, auth.uid(), 'invoice', jsonb_build_object('number', p_number));
end $$;

create or replace function public.order_register_received(p_order uuid, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','estoque');
  update public.orders set received_at = coalesce(p_at, now()) where id = p_order;
  if not found then raise exception 'order_not_found'; end if;
  insert into public.order_events (order_id, actor, kind, detail)
  values (p_order, auth.uid(), 'received', jsonb_build_object('at', coalesce(p_at, now())));
end $$;

create or replace function public.order_cancel(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  perform app.require_any_role('admin','gestor');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_production in ('em_producao','concluido','parcial')
     or o.status_logistics in ('coleta_agendada','coletado_parcial','coletado') then
    raise exception 'order_in_progress';
  end if;
  update public.orders set status_commercial = 'cancelado', cancelled_at = now(), cancel_reason = p_reason
   where id = p_order;
  insert into public.order_events (order_id, actor, kind, detail, note)
  values (p_order, auth.uid(), 'cancel', '{}'::jsonb, p_reason);
end $$;

-- ---------- updated_at e auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['quotes','quote_versions','orders'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['quotes','quote_versions','quote_items','quote_change_requests',
                           'orders','order_items','order_item_costs'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.quotes                enable row level security;
alter table public.quote_versions        enable row level security;
alter table public.quote_items           enable row level security;
alter table public.quote_change_requests enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.order_item_costs      enable row level security;
alter table public.order_events          enable row level security;

create policy quotes_select on public.quotes for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy quotes_update on public.quotes for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));
create policy qv_select on public.quote_versions for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy qv_update on public.quote_versions for update to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));
create policy qi_select on public.quote_items for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy qi_write on public.quote_items for all to authenticated
  using (app.has_any_role('admin','comercial')) with check (app.has_any_role('admin','comercial'));
create policy qcr_select on public.quote_change_requests for select to authenticated
  using (app.has_any_role('admin','gestor','comercial'));

create policy orders_select on public.orders for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','producao','estoque','financeiro'));
create policy orders_update on public.orders for update to authenticated
  using (app.has_any_role('admin','gestor','comercial')) with check (app.has_any_role('admin','gestor','comercial'));
create policy oi_select on public.order_items for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','producao','estoque','financeiro'));
create policy oic_select on public.order_item_costs for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','financeiro'));
create policy oe_select on public.order_events for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','producao','estoque','financeiro'));

revoke all on public.counters, public.quotes, public.quote_versions, public.quote_items,
  public.quote_change_requests, public.orders, public.order_items, public.order_item_costs,
  public.order_events from anon, authenticated;
grant select on public.quotes, public.quote_versions, public.quote_change_requests, public.orders,
  public.order_items, public.order_item_costs, public.order_events to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;      -- só em rascunho (guarda)
grant update (contact_id, opportunity_id) on public.quotes to authenticated;
grant update (valid_until, payment_terms, freight_mode, carrier_name, lead_time_days, deposit_required,
              deposit_pct, freight_value, notes_client, notes_internal, pdf_path) on public.quote_versions to authenticated;
grant update (notes_internal, carrier_contact) on public.orders to authenticated;

-- ---------- Visões do portal: sem custos, sem notas internas, só a própria empresa ----------
create or replace view public.portal_quote_versions as
  select qv.id, qv.quote_id, q.number, q.customer_id, qv.version, qv.status, qv.valid_until, qv.payment_terms,
         qv.freight_mode, qv.carrier_name, qv.lead_time_days, qv.deposit_required, qv.deposit_pct,
         qv.subtotal, qv.discount_total, qv.freight_value, qv.total, qv.notes_client, qv.sent_at, qv.approved_at
  from public.quote_versions qv join public.quotes q on q.id = qv.quote_id
  where q.customer_id in (select app.my_customers())
    and qv.status not in ('rascunho','aguardando_aprovacao');

create or replace view public.portal_quote_items as
  select qi.id, qi.version_id, qi.description, qi.specs, qi.qty, qi.unit_price, qi.line_total, qi.position
  from public.quote_items qi
  join public.quote_versions qv on qv.id = qi.version_id
  join public.quotes q on q.id = qv.quote_id
  where q.customer_id in (select app.my_customers())
    and qv.status not in ('rascunho','aguardando_aprovacao');

create or replace view public.portal_orders as
  select o.id, o.number, o.customer_id, o.quote_version_id, o.channel, o.status_commercial, o.status_financial,
         o.status_production, o.status_logistics, o.total, o.deposit_required, o.deposit_pct, o.deposit_amount,
         o.freight_mode, o.carrier_name, o.invoice_number, o.invoiced_at, o.received_at, o.cancelled_at, o.created_at
  from public.orders o where o.customer_id in (select app.my_customers());

create or replace view public.portal_order_items as
  select oi.id, oi.order_id, oi.description, oi.specs, oi.qty, oi.unit_price, oi.line_total,
         oi.qty_produced, oi.qty_shipped, oi.position
  from public.order_items oi join public.orders o on o.id = oi.order_id
  where o.customer_id in (select app.my_customers());

revoke all on public.portal_quote_versions, public.portal_quote_items, public.portal_orders,
  public.portal_order_items from anon;
grant select on public.portal_quote_versions, public.portal_quote_items, public.portal_orders,
  public.portal_order_items to authenticated;

-- ---------- Execução das funções ----------
revoke all on function
  public.quote_create(uuid, uuid, uuid), public.quote_new_version(uuid),
  public.quote_request_internal_approval(uuid), public.quote_internal_approve(uuid, text),
  public.quote_internal_reject(uuid, text), public.quote_send(uuid), public.quote_mark_refused(uuid),
  public.quote_mark_approved_offline(uuid, text), public.quote_convert_to_order(uuid),
  public.quote_expire_due(), public.portal_approve_quote(uuid, text),
  public.portal_request_quote_change(uuid, text), public.portal_set_carrier(uuid, text, text),
  public.order_release_checks(uuid), public.order_set_status(uuid, text, text, text),
  public.order_register_invoice(uuid, text, text, date), public.order_register_received(uuid, timestamptz),
  public.order_cancel(uuid, text)
  from public, anon;
grant execute on function
  public.quote_create(uuid, uuid, uuid), public.quote_new_version(uuid),
  public.quote_request_internal_approval(uuid), public.quote_internal_approve(uuid, text),
  public.quote_internal_reject(uuid, text), public.quote_send(uuid), public.quote_mark_refused(uuid),
  public.quote_mark_approved_offline(uuid, text), public.quote_convert_to_order(uuid),
  public.quote_expire_due(), public.portal_approve_quote(uuid, text),
  public.portal_request_quote_change(uuid, text), public.portal_set_carrier(uuid, text, text),
  public.order_release_checks(uuid), public.order_set_status(uuid, text, text, text),
  public.order_register_invoice(uuid, text, text, date), public.order_register_received(uuid, timestamptz),
  public.order_cancel(uuid, text)
  to authenticated, service_role;
revoke all on function app.next_number(text), app.create_order_from_version(uuid),
  app.version_needs_approval(uuid) from public, anon, authenticated;
grant execute on function app.next_number(text), app.create_order_from_version(uuid),
  app.version_needs_approval(uuid) to service_role;

-- ########## 20261127000005_commissions.sql ##########
-- =====================================================================
-- Migração 0005: vendedores, metas mensais e faixas de comissão
-- Cadastro agora; cálculo de pagamento fica para a Etapa 3 (depende de recebimentos).
-- Regra decidida: meta mensal do dia 01 ao 31, somente pedidos FATURADOS (nota registrada).
-- =====================================================================

create table public.commission_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> ''),
  notes      text,
  active     boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4 faixas progressivas: % da meta atingida -> % de comissão (valores definidos pela empresa)
create table public.commission_tiers (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.commission_plans(id) on delete cascade,
  ord                smallint not null check (ord between 1 and 4),
  min_attainment_pct numeric(7,2) not null check (min_attainment_pct >= 0),
  commission_pct     numeric(5,2) not null check (commission_pct between 0 and 100),
  unique (plan_id, ord)
);

create or replace function app.validate_commission_tiers() returns trigger
language plpgsql as $$
declare v_plan uuid := coalesce(new.plan_id, old.plan_id); r record; n int := 0;
        prev_att numeric := -1; prev_pct numeric := -1;
begin
  if not exists (select 1 from public.commission_plans where id = v_plan) then return null; end if;
  for r in select * from public.commission_tiers where plan_id = v_plan order by ord loop
    n := n + 1;
    if r.ord <> n then raise exception 'commission_tiers: faixas devem ser 1,2,3,4 em sequência'; end if;
    if r.min_attainment_pct <= prev_att or r.commission_pct <= prev_pct then
      raise exception 'commission_tiers: faixas devem ser progressivas (meta e comissão crescentes)';
    end if;
    prev_att := r.min_attainment_pct; prev_pct := r.commission_pct;
  end loop;
  if n not in (0, 4) then raise exception 'commission_tiers: o plano precisa ter exatamente 4 faixas'; end if;
  return null;
end $$;
create constraint trigger trg_commission_tiers_valid after insert or update or delete on public.commission_tiers
  deferrable initially deferred for each row execute function app.validate_commission_tiers();

-- Troca atômica das 4 faixas de um plano (a validação roda ao final da transação)
create or replace function public.admin_set_commission_tiers(p_plan uuid, p_tiers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin');
  delete from public.commission_tiers where plan_id = p_plan;
  insert into public.commission_tiers (plan_id, ord, min_attainment_pct, commission_pct)
  select p_plan, (t ->> 'ord')::smallint, (t ->> 'min_attainment_pct')::numeric, (t ->> 'commission_pct')::numeric
  from jsonb_array_elements(p_tiers) t;
end $$;
revoke all on function public.admin_set_commission_tiers(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_commission_tiers(uuid, jsonb) to authenticated;

create table public.commission_targets (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.commission_plans(id) on delete restrict,
  seller_id     uuid not null references public.profiles(id) on delete restrict,
  month         date not null check (month = date_trunc('month', month)::date),   -- sempre dia 01
  target_amount numeric(14,2) not null check (target_amount > 0),
  created_at    timestamptz not null default now(),
  unique (plan_id, seller_id, month)
);

create or replace function app.commission_target_guard() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.profiles where id = new.seller_id and is_seller) then
    raise exception 'not_a_seller';
  end if;
  return new;
end $$;
create trigger trg_commission_target_guard before insert or update on public.commission_targets
  for each row execute function app.commission_target_guard();

create trigger trg_commission_plans_updated before update on public.commission_plans
  for each row execute function app.set_updated_at();
do $$
declare t text;
begin
  foreach t in array array['commission_plans','commission_tiers','commission_targets'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

alter table public.commission_plans   enable row level security;
alter table public.commission_tiers   enable row level security;
alter table public.commission_targets enable row level security;

create policy cplans_select on public.commission_plans for select to authenticated using (app.is_internal());
create policy cplans_write  on public.commission_plans for all to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));
create policy ctiers_select on public.commission_tiers for select to authenticated using (app.is_internal());
create policy ctiers_write  on public.commission_tiers for all to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));
create policy ctargets_select on public.commission_targets for select to authenticated
  using (app.has_any_role('admin','gestor','financeiro') or seller_id = auth.uid());
create policy ctargets_write on public.commission_targets for all to authenticated
  using (app.has_role('admin')) with check (app.has_role('admin'));

revoke all on public.commission_plans, public.commission_tiers, public.commission_targets from anon, authenticated;
grant select, insert, update, delete on public.commission_plans, public.commission_tiers,
  public.commission_targets to authenticated;

-- Progresso do vendedor: faturado do mês x meta, e a faixa de comissão alcançada.
-- (O valor da comissão a pagar depende de regras ainda em definição: Etapa 3.)
create or replace view public.seller_commission_progress as
  select t.id as target_id, t.plan_id, t.seller_id, t.month, t.target_amount,
         coalesce(s.invoiced_total, 0) as invoiced_total,
         coalesce(s.orders_count, 0)   as orders_count,
         round(coalesce(s.invoiced_total, 0) / t.target_amount * 100, 2) as attainment_pct,
         (select ct.commission_pct from public.commission_tiers ct
           where ct.plan_id = t.plan_id
             and ct.min_attainment_pct <= coalesce(s.invoiced_total, 0) / t.target_amount * 100
           order by ct.ord desc limit 1) as tier_commission_pct
  from public.commission_targets t
  left join lateral (
    select sum(o.total) as invoiced_total, count(*) as orders_count
    from public.orders o
    where o.seller_id = t.seller_id and o.invoiced_at is not null and o.status_commercial <> 'cancelado'
      and o.invoiced_at >= t.month and o.invoiced_at < (t.month + interval '1 month')::date
  ) s on true
  where app.has_any_role('admin','gestor','financeiro') or t.seller_id = auth.uid();

revoke all on public.seller_commission_progress from anon;
grant select on public.seller_commission_progress to authenticated;

-- ########## 20261127000006_stock_purchasing.sql ##########
-- =====================================================================
-- Migração 0006: estoque (livro-razão imutável), reservas, fornecedores e compras
-- Regras: saldo nunca é editado (só movimentos e estornos); entrada de compra só no recebimento,
-- uma vez por conferência (chave de idempotência); aprovar compra não é pagar (financeiro: Etapa 3).
-- =====================================================================

-- ---------- Locais e lotes ----------
create table public.stock_locations (
  id     uuid primary key default gen_random_uuid(),
  code   text not null unique,
  name   text not null,
  active boolean not null default true
);
insert into public.stock_locations (code, name) values ('PRINCIPAL', 'Almoxarifado principal');

create table public.lots (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete restrict,
  code       text not null check (btrim(code) <> ''),
  created_at timestamptz not null default now(),
  unique (item_id, code)
);

-- ---------- Livro-razão de estoque ----------
create table public.stock_movements (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  item_id     uuid not null references public.items(id) on delete restrict,
  location_id uuid not null references public.stock_locations(id) on delete restrict,
  lot_id      uuid references public.lots(id),
  qty         numeric(14,3) not null check (qty <> 0),          -- positivo entra, negativo sai
  kind        text not null check (kind in ('entrada','saida','ajuste','transferencia','recebimento','consumo','producao','estorno')),
  ref_type    text,
  ref_id      text,
  reversal_of bigint unique references public.stock_movements(id),
  note        text,
  actor       uuid default auth.uid()
);
create index stock_movements_item_idx on public.stock_movements (item_id, location_id);

create or replace function app.stock_movements_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bal numeric;
begin
  if tg_op <> 'INSERT' then raise exception 'stock_movements é somente inserção (use estorno)'; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.item_id::text || new.location_id::text, 0));
  select coalesce(sum(qty), 0) into v_bal from public.stock_movements
   where item_id = new.item_id and location_id = new.location_id and lot_id is not distinct from new.lot_id;
  if v_bal + new.qty < 0 then raise exception 'insufficient_stock'; end if;
  return new;
end $$;
create trigger trg_stock_movements_ins before insert on public.stock_movements
  for each row execute function app.stock_movements_guard();
create trigger trg_stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function app.stock_movements_guard();

create table public.stock_reservations (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  item_id       uuid not null references public.items(id) on delete restrict,
  qty           numeric(14,3) not null check (qty > 0),
  status        text not null default 'ativa' check (status in ('ativa','consumida','cancelada')),
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  released_at   timestamptz
);
create index stock_reservations_item_idx on public.stock_reservations (item_id) where status = 'ativa';

create or replace function app.item_available(p_item uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(qty) from public.stock_movements where item_id = p_item), 0)
       - coalesce((select sum(qty) from public.stock_reservations where item_id = p_item and status = 'ativa'), 0)
$$;

-- ---------- Funções de estoque ----------
create or replace function app.resolve_lot(p_item uuid, p_lot text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if coalesce(btrim(p_lot), '') = '' then return null; end if;
  insert into public.lots (item_id, code) values (p_item, btrim(p_lot)) on conflict (item_id, code) do nothing;
  select id into v from public.lots where item_id = p_item and code = btrim(p_lot);
  return v;
end $$;

create or replace function public.stock_move(p_item uuid, p_location uuid, p_qty numeric, p_kind text,
                                             p_lot text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_signed numeric;
begin
  perform app.require_any_role('admin','estoque');
  if p_kind not in ('entrada','saida','ajuste') then raise exception 'invalid_kind'; end if;
  if p_qty is null or p_qty = 0 then raise exception 'invalid_qty'; end if;
  if p_kind in ('entrada','saida') and p_qty < 0 then raise exception 'invalid_qty'; end if;
  if p_kind = 'ajuste' and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  v_signed := case p_kind when 'saida' then -p_qty else p_qty end;
  if v_signed < 0 and app.item_available(p_item) + v_signed < 0 then raise exception 'insufficient_available'; end if;
  insert into public.stock_movements (item_id, location_id, lot_id, qty, kind, ref_type, note)
  values (p_item, p_location, app.resolve_lot(p_item, p_lot), v_signed, p_kind, 'manual', p_note)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.stock_transfer(p_item uuid, p_from uuid, p_to uuid, p_qty numeric,
                                                 p_lot text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_group text := gen_random_uuid()::text; v_lot uuid;
begin
  perform app.require_any_role('admin','estoque');
  if p_qty is null or p_qty <= 0 or p_from = p_to then raise exception 'invalid_qty'; end if;
  v_lot := app.resolve_lot(p_item, p_lot);
  insert into public.stock_movements (item_id, location_id, lot_id, qty, kind, ref_type, ref_id) values
    (p_item, p_from, v_lot, -p_qty, 'transferencia', 'transferencia', v_group),
    (p_item, p_to,   v_lot,  p_qty, 'transferencia', 'transferencia', v_group);
  return v_group;
end $$;

create or replace function public.stock_reverse(p_movement bigint, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare m public.stock_movements; v_id bigint;
begin
  perform app.require_any_role('admin','gestor','estoque');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  select * into m from public.stock_movements where id = p_movement;
  if not found then raise exception 'movement_not_found'; end if;
  if m.reversal_of is not null or m.kind = 'estorno' then raise exception 'cannot_reverse_reversal'; end if;
  begin
    insert into public.stock_movements (item_id, location_id, lot_id, qty, kind, ref_type, ref_id, reversal_of, note)
    values (m.item_id, m.location_id, m.lot_id, -m.qty, 'estorno', 'estorno', m.id::text, m.id, p_note)
    returning id into v_id;
  exception when unique_violation then raise exception 'already_reversed';
  end;
  return v_id;
end $$;

create or replace function public.stock_reserve(p_order_item uuid, p_qty numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare oi public.order_items; o public.orders; v_id uuid; v_reserved numeric;
begin
  perform app.require_any_role('admin','estoque','comercial');
  if p_qty is null or p_qty <= 0 then raise exception 'invalid_qty'; end if;
  select * into oi from public.order_items where id = p_order_item;
  if not found or oi.item_id is null then raise exception 'item_not_stocked'; end if;
  select * into o from public.orders where id = oi.order_id;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  perform pg_advisory_xact_lock(hashtextextended(oi.item_id::text, 1));
  select coalesce(sum(qty), 0) into v_reserved from public.stock_reservations where order_item_id = p_order_item and status = 'ativa';
  if v_reserved + p_qty > oi.qty then raise exception 'exceeds_order'; end if;
  if app.item_available(oi.item_id) < p_qty then raise exception 'insufficient_available'; end if;
  insert into public.stock_reservations (order_item_id, item_id, qty) values (p_order_item, oi.item_id, p_qty) returning id into v_id;
  return v_id;
end $$;

create or replace function public.stock_release_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','estoque','comercial');
  update public.stock_reservations set status = 'cancelada', released_at = now() where id = p_reservation and status = 'ativa';
  if not found then raise exception 'not_active'; end if;
end $$;

-- ---------- Fornecedores ----------
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  legal_name     text not null check (btrim(legal_name) <> ''),
  trade_name     text,
  tax_id         text,
  contact_name   text,
  phone          text,
  email          text,
  payment_terms  text,
  internal_notes text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint suppliers_tax_id_valid check (tax_id is null or app.valid_tax_id(tax_id))
);
create unique index suppliers_tax_id_uk on public.suppliers (tax_id) where tax_id is not null;
create or replace function app.normalize_supplier() returns trigger language plpgsql as $$
begin new.tax_id := nullif(app.digits(new.tax_id), ''); return new; end $$;
create trigger trg_suppliers_norm before insert or update on public.suppliers for each row execute function app.normalize_supplier();

-- ---------- Pedidos de compra ----------
create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  supplier_id   uuid not null references public.suppliers(id) on delete restrict,
  status        text not null default 'rascunho'
                check (status in ('rascunho','aprovado','enviado','recebido_parcial','recebido','cancelado')),
  expected_date date,
  payment_terms text,
  notes         text,
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  cancel_reason text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  po_id        uuid not null references public.purchase_orders(id) on delete restrict,
  item_id      uuid not null references public.items(id) on delete restrict,
  description  text,
  qty          numeric(14,3) not null check (qty > 0),
  unit_cost    numeric(14,6) not null check (unit_cost >= 0),
  qty_received numeric(14,3) not null default 0 check (qty_received >= 0),
  position     int not null default 0,
  line_total   numeric(14,2) generated always as (round(qty * unit_cost, 2)) stored,
  constraint purchase_lines_received_le_qty check (qty_received <= qty)
);
create index purchase_lines_po_idx on public.purchase_lines (po_id);

create or replace function app.purchase_lines_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.purchase_orders where id = coalesce(new.po_id, old.po_id);
  if v_status <> 'rascunho' then
    -- fora do rascunho só o recebimento (função) altera quantidade recebida
    -- (colunas geradas ainda não existem em gatilho BEFORE: compara só as editáveis)
    if tg_op = 'UPDATE' and (new.po_id, new.item_id, new.description, new.qty, new.unit_cost, new.position)
       is not distinct from (old.po_id, old.item_id, old.description, old.qty, old.unit_cost, old.position) then return new; end if;
    raise exception 'po_locked';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_purchase_lines_guard before insert or update or delete on public.purchase_lines
  for each row execute function app.purchase_lines_guard();

create table public.receipts (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.purchase_orders(id) on delete restrict,
  location_id     uuid not null references public.stock_locations(id),
  document_number text,                       -- nota fiscal do fornecedor
  idempotency_key text not null unique,
  notes           text,
  received_by     uuid references public.profiles(id) default auth.uid(),
  received_at     timestamptz not null default now()
);
create table public.receipt_lines (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts(id) on delete restrict,
  line_id     uuid not null references public.purchase_lines(id),
  qty         numeric(14,3) not null check (qty > 0),
  lot_code    text,
  discrepancy_note text
);

create or replace function public.po_create(p_supplier uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_any_role('admin','compras');
  if not exists (select 1 from public.suppliers where id = p_supplier and active) then raise exception 'supplier_not_found'; end if;
  insert into public.purchase_orders (number, supplier_id) values (app.next_number('COMP'), p_supplier) returning id into v;
  return v;
end $$;

create or replace function public.po_approve(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  if not exists (select 1 from public.purchase_lines where po_id = p_po) then raise exception 'no_items'; end if;
  update public.purchase_orders set status = 'aprovado', approved_by = auth.uid(), approved_at = now() where id = p_po and status = 'rascunho';
  if not found then raise exception 'not_draft'; end if;
end $$;

create or replace function public.po_mark_sent(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','compras');
  update public.purchase_orders set status = 'enviado' where id = p_po and status = 'aprovado';
  if not found then raise exception 'not_approved'; end if;
end $$;

create or replace function public.po_cancel(p_po uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','compras');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.receipts where po_id = p_po) then raise exception 'has_receipts'; end if;
  update public.purchase_orders set status = 'cancelado', cancel_reason = p_reason
   where id = p_po and status in ('rascunho','aprovado','enviado');
  if not found then raise exception 'not_cancellable'; end if;
end $$;

-- Recebimento + conferência: gera a entrada em estoque, uma única vez por chave
create or replace function public.po_receive(p_po uuid, p_location uuid, p_doc text, p_lines jsonb, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_receipt uuid; l jsonb; pl public.purchase_lines; v_qty numeric; v_pending int;
begin
  perform app.require_any_role('admin','estoque','compras');
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  select id into v_receipt from public.receipts where idempotency_key = p_key;
  if v_receipt is not null then return v_receipt; end if;                       -- reenvio: mesmo recebimento

  select * into po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if po.status not in ('aprovado','enviado','recebido_parcial') then raise exception 'not_receivable'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no_items'; end if;

  insert into public.receipts (po_id, location_id, document_number, idempotency_key)
  values (p_po, p_location, nullif(btrim(p_doc), ''), p_key) returning id into v_receipt;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_qty := (l ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_qty'; end if;
    select * into pl from public.purchase_lines where id = (l ->> 'line_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'line_not_found'; end if;
    if pl.qty_received + v_qty > pl.qty then raise exception 'over_receipt'; end if;
    insert into public.receipt_lines (receipt_id, line_id, qty, lot_code, discrepancy_note)
    values (v_receipt, pl.id, v_qty, nullif(btrim(l ->> 'lot'), ''), nullif(btrim(l ->> 'note'), ''));
    update public.purchase_lines set qty_received = qty_received + v_qty where id = pl.id;
    insert into public.stock_movements (item_id, location_id, lot_id, qty, kind, ref_type, ref_id, note)
    values (pl.item_id, p_location, app.resolve_lot(pl.item_id, l ->> 'lot'), v_qty, 'recebimento', 'receipt', v_receipt::text,
            'Compra ' || po.number);
  end loop;

  select count(*) into v_pending from public.purchase_lines where po_id = p_po and qty_received < qty;
  update public.purchase_orders set status = case when v_pending = 0 then 'recebido' else 'recebido_parcial' end where id = p_po;
  return v_receipt;
end $$;

-- ---------- updated_at e auditoria ----------
create trigger trg_suppliers_updated before update on public.suppliers for each row execute function app.set_updated_at();
create trigger trg_po_updated before update on public.purchase_orders for each row execute function app.set_updated_at();
do $$
declare t text;
begin
  foreach t in array array['stock_locations','stock_reservations','suppliers','purchase_orders','purchase_lines','receipts','receipt_lines'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.stock_locations    enable row level security;
alter table public.lots               enable row level security;
alter table public.stock_movements    enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.suppliers          enable row level security;
alter table public.purchase_orders    enable row level security;
alter table public.purchase_lines     enable row level security;
alter table public.receipts           enable row level security;
alter table public.receipt_lines      enable row level security;

create policy loc_select on public.stock_locations for select to authenticated using (app.is_internal());
create policy loc_write  on public.stock_locations for all to authenticated
  using (app.has_any_role('admin','estoque')) with check (app.has_any_role('admin','estoque'));
create policy lots_select on public.lots for select to authenticated using (app.is_internal());
create policy mov_select on public.stock_movements for select to authenticated using (app.is_internal());
create policy res_select on public.stock_reservations for select to authenticated using (app.is_internal());

-- Fornecedores, custos de compra: nunca para produção/estoque/cliente
create policy sup_select on public.suppliers for select to authenticated
  using (app.has_any_role('admin','gestor','compras','financeiro'));
create policy sup_write on public.suppliers for all to authenticated
  using (app.has_any_role('admin','compras')) with check (app.has_any_role('admin','compras'));
create policy po_select on public.purchase_orders for select to authenticated
  using (app.has_any_role('admin','gestor','compras','financeiro'));
create policy po_update on public.purchase_orders for update to authenticated
  using (app.has_any_role('admin','compras')) with check (app.has_any_role('admin','compras'));
create policy pl_select on public.purchase_lines for select to authenticated
  using (app.has_any_role('admin','gestor','compras','financeiro'));
create policy pl_write on public.purchase_lines for all to authenticated
  using (app.has_any_role('admin','compras')) with check (app.has_any_role('admin','compras'));
create policy rc_select on public.receipts for select to authenticated
  using (app.has_any_role('admin','gestor','compras','financeiro','estoque'));
create policy rcl_select on public.receipt_lines for select to authenticated
  using (app.has_any_role('admin','gestor','compras','financeiro','estoque'));

revoke all on public.stock_locations, public.lots, public.stock_movements, public.stock_reservations,
  public.suppliers, public.purchase_orders, public.purchase_lines, public.receipts, public.receipt_lines
  from anon, authenticated;
grant select on public.lots, public.stock_movements, public.stock_reservations, public.receipts, public.receipt_lines to authenticated;
grant select, insert, update on public.stock_locations, public.suppliers to authenticated;
grant select on public.purchase_orders to authenticated;
grant update (expected_date, payment_terms, notes) on public.purchase_orders to authenticated;
grant select, insert, update, delete on public.purchase_lines to authenticated;

-- ---------- Visões (já filtradas por perfil) ----------
create or replace view public.stock_balances as
  select sm.item_id, sm.location_id, sm.lot_id, sum(sm.qty) as physical
  from public.stock_movements sm where app.is_internal()
  group by sm.item_id, sm.location_id, sm.lot_id having sum(sm.qty) <> 0;

create or replace view public.stock_position as
  select i.id as item_id, coalesce(p.physical, 0) as physical, coalesce(r.reserved, 0) as reserved,
         coalesce(p.physical, 0) - coalesce(r.reserved, 0) as available
  from public.items i
  left join (select item_id, sum(qty) as physical from public.stock_movements group by item_id) p on p.item_id = i.id
  left join (select item_id, sum(qty) as reserved from public.stock_reservations where status = 'ativa' group by item_id) r on r.item_id = i.id
  where app.is_internal() and (p.physical is not null or r.reserved is not null);

-- Estoque confere recebimentos SEM ver custo nem fornecedor
create or replace view public.receiving_lines as
  select pl.id as line_id, po.id as po_id, po.number, po.status, po.expected_date, pl.item_id, pl.description,
         pl.qty, pl.qty_received, pl.position
  from public.purchase_lines pl join public.purchase_orders po on po.id = pl.po_id
  where po.status in ('aprovado','enviado','recebido_parcial') and app.has_any_role('admin','estoque','compras','gestor');

revoke all on public.stock_balances, public.stock_position, public.receiving_lines from anon;
grant select on public.stock_balances, public.stock_position, public.receiving_lines to authenticated;

-- ---------- Execução ----------
revoke all on function
  public.stock_move(uuid, uuid, numeric, text, text, text), public.stock_transfer(uuid, uuid, uuid, numeric, text),
  public.stock_reverse(bigint, text), public.stock_reserve(uuid, numeric), public.stock_release_reservation(uuid),
  public.po_create(uuid), public.po_approve(uuid), public.po_mark_sent(uuid), public.po_cancel(uuid, text),
  public.po_receive(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function
  public.stock_move(uuid, uuid, numeric, text, text, text), public.stock_transfer(uuid, uuid, uuid, numeric, text),
  public.stock_reverse(bigint, text), public.stock_reserve(uuid, numeric), public.stock_release_reservation(uuid),
  public.po_create(uuid), public.po_approve(uuid), public.po_mark_sent(uuid), public.po_cancel(uuid, text),
  public.po_receive(uuid, uuid, text, jsonb, text) to authenticated;
revoke all on function app.item_available(uuid), app.resolve_lot(uuid, text) from public, anon, authenticated;
grant execute on function app.item_available(uuid), app.resolve_lot(uuid, text) to service_role;

-- ########## 20261127000007_production_shipping.sql ##########
-- =====================================================================
-- Migração 0007: máquinas, moldes, ordens de produção, apontamento, qualidade e expedição
-- Regras: OP só é liberada se o pedido estiver liberado; consumo e entrada de acabado passam pelo
-- livro-razão do estoque; acabado só entra após liberação de qualidade; coleta exige nota fiscal;
-- coleta parcial mostra saldo; "coletado" não é "entregue".
-- =====================================================================

insert into public.settings (key, value, description) values
  ('coleta_exige_quitacao', 'false', 'DECISÃO PENDENTE: se true, a coleta só sai com o pedido quitado. Loja on-line sempre exige pagamento integral.')
on conflict (key) do nothing;

-- ---------- Máquinas e moldes ----------
create table public.machines (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  kind       text not null check (kind in ('injecao','sopro')),
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.molds (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  ownership   text not null default 'empresa' check (ownership in ('empresa','cliente')),
  customer_id uuid references public.customers(id),
  cavities    int not null default 1 check (cavities >= 1),
  location    text,
  status      text not null default 'disponivel' check (status in ('disponivel','em_uso','manutencao','inativo')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint molds_owner_customer check (ownership = 'empresa' or customer_id is not null)
);
create table public.mold_items   (mold_id uuid not null references public.molds(id) on delete cascade,
                                  item_id uuid not null references public.items(id) on delete restrict, primary key (mold_id, item_id));
create table public.machine_molds(machine_id uuid not null references public.machines(id) on delete cascade,
                                  mold_id uuid not null references public.molds(id) on delete cascade, primary key (machine_id, mold_id));

-- ---------- Ordens de produção ----------
create table public.production_orders (
  id            uuid primary key default gen_random_uuid(),
  number        text not null unique,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  item_id       uuid not null references public.items(id) on delete restrict,
  qty_planned   numeric(14,3) not null check (qty_planned > 0),
  machine_id    uuid references public.machines(id),
  mold_id       uuid references public.molds(id),
  status        text not null default 'planejada'
                check (status in ('planejada','liberada','em_producao','pausada','concluida','cancelada')),
  planned_start date,
  notes         text,
  qty_produced  numeric(14,3) not null default 0,   -- total apontado
  qty_scrap     numeric(14,3) not null default 0,   -- refugo apontado na produção
  qty_inspected numeric(14,3) not null default 0,   -- inspecionado pela qualidade
  qty_released  numeric(14,3) not null default 0,   -- aprovado e já em estoque
  cancel_reason text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint po_quality_le_good check (qty_inspected <= qty_produced - qty_scrap),
  constraint po_released_le_inspected check (qty_released <= qty_inspected)
);
create index production_orders_oi_idx on public.production_orders (order_item_id);

create table public.production_reports (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.production_orders(id) on delete restrict,
  at              timestamptz not null default now(),
  qty_produced    numeric(14,3) not null check (qty_produced >= 0),
  qty_rejected    numeric(14,3) not null default 0 check (qty_rejected >= 0),
  qty_rework      numeric(14,3) not null default 0 check (qty_rework >= 0),
  downtime_min    int not null default 0 check (downtime_min >= 0),
  occurrence      text,
  lot_code        text,
  idempotency_key text not null unique,
  reported_by     uuid references public.profiles(id) default auth.uid(),
  constraint report_rejected_le_produced check (qty_rejected <= qty_produced)
);
create table public.production_consumption (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.production_reports(id) on delete restrict,
  item_id     uuid not null references public.items(id),
  location_id uuid not null references public.stock_locations(id),
  qty         numeric(14,3) not null check (qty > 0)
);
create table public.quality_inspections (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.production_orders(id) on delete restrict,
  at              timestamptz not null default now(),
  qty_inspected   numeric(14,3) not null check (qty_inspected > 0),
  qty_approved    numeric(14,3) not null check (qty_approved >= 0),
  lot_code        text,
  location_id     uuid not null references public.stock_locations(id),
  note            text,
  idempotency_key text not null unique,
  inspector       uuid references public.profiles(id) default auth.uid(),
  constraint qi_approved_le_inspected check (qty_approved <= qty_inspected)
);

-- ---------- Funções de produção ----------
create or replace function app.sync_order_production(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_all boolean; v_status text;
begin
  select bool_and(qty_produced >= qty) into v_all from public.order_items where order_id = p_order;
  select status_production into v_status from public.orders where id = p_order;
  if v_all and exists (select 1 from public.production_orders po join public.order_items oi on oi.id = po.order_item_id
                        where oi.order_id = p_order and po.status = 'concluida') then
    update public.orders set status_production = 'concluido' where id = p_order;
  elsif exists (select 1 from public.production_orders po join public.order_items oi on oi.id = po.order_item_id
                 where oi.order_id = p_order and po.status = 'concluida') and not exists (
                 select 1 from public.production_orders po join public.order_items oi on oi.id = po.order_item_id
                  where oi.order_id = p_order and po.status in ('liberada','em_producao','pausada')) then
    update public.orders set status_production = 'parcial' where id = p_order;
  elsif v_status in ('liberado','programado') and exists (
                 select 1 from public.production_orders po join public.order_items oi on oi.id = po.order_item_id
                  where oi.order_id = p_order and po.status in ('em_producao')) then
    update public.orders set status_production = 'em_producao' where id = p_order;
  end if;
end $$;

create or replace function public.production_create(p_order_item uuid, p_qty numeric, p_machine uuid default null,
                                                    p_mold uuid default null, p_start date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare oi public.order_items; o public.orders; v_planned numeric; v_id uuid; m public.molds;
begin
  perform app.require_any_role('admin','producao');
  if p_qty is null or p_qty <= 0 then raise exception 'invalid_qty'; end if;
  select * into oi from public.order_items where id = p_order_item;
  if not found or oi.item_id is null then raise exception 'item_not_producible'; end if;
  select * into o from public.orders where id = oi.order_id;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_order_item::text, 2));
  -- OP concluída com falta só conta o que foi aprovado: o saldo pode ser reposto em nova OP
  select coalesce(sum(case when status = 'concluida' then qty_released else qty_planned end), 0) into v_planned
    from public.production_orders where order_item_id = p_order_item and status <> 'cancelada';
  if v_planned + p_qty > oi.qty then raise exception 'exceeds_order'; end if;
  if p_mold is not null then
    select * into m from public.molds where id = p_mold;
    if not found or m.status in ('manutencao','inativo') then raise exception 'mold_unavailable'; end if;
    if exists (select 1 from public.machine_molds where mold_id = p_mold)
       and (p_machine is null or not exists (select 1 from public.machine_molds where mold_id = p_mold and machine_id = p_machine)) then
      raise exception 'mold_machine_incompatible';
    end if;
  end if;
  insert into public.production_orders (number, order_item_id, item_id, qty_planned, machine_id, mold_id, planned_start)
  values (app.next_number('OP'), p_order_item, oi.item_id, p_qty, p_machine, p_mold, p_start) returning id into v_id;
  return v_id;
end $$;

create or replace function public.production_release(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare po public.production_orders; o public.orders;
begin
  perform app.require_any_role('admin','gestor','producao');
  select * into po from public.production_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if po.status <> 'planejada' then raise exception 'not_planned'; end if;
  select o2.* into o from public.orders o2 join public.order_items oi on oi.order_id = o2.id where oi.id = po.order_item_id;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  if o.status_production not in ('liberado','programado','em_producao','parcial') then raise exception 'order_not_released'; end if;
  update public.production_orders set status = 'liberada' where id = p_po;
end $$;

create or replace function public.production_report(p_po uuid, p_produced numeric, p_rejected numeric, p_rework numeric,
  p_downtime int, p_occurrence text, p_lot text, p_location uuid, p_consumption jsonb, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare po public.production_orders; v_id uuid; c jsonb; v_qty numeric; v_order uuid;
begin
  perform app.require_any_role('admin','producao');
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  select id into v_id from public.production_reports where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  select * into po from public.production_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if po.status not in ('liberada','em_producao') then raise exception 'po_not_active'; end if;
  if coalesce(p_produced, 0) < 0 or coalesce(p_rejected, 0) > coalesce(p_produced, 0) then raise exception 'invalid_qty'; end if;

  insert into public.production_reports (po_id, qty_produced, qty_rejected, qty_rework, downtime_min, occurrence, lot_code, idempotency_key)
  values (p_po, coalesce(p_produced, 0), coalesce(p_rejected, 0), coalesce(p_rework, 0), coalesce(p_downtime, 0),
          nullif(btrim(p_occurrence), ''), nullif(btrim(p_lot), ''), p_key) returning id into v_id;

  if p_consumption is not null and jsonb_typeof(p_consumption) = 'array' then
    for c in select * from jsonb_array_elements(p_consumption) loop
      v_qty := (c ->> 'qty')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception 'invalid_qty'; end if;
      insert into public.production_consumption (report_id, item_id, location_id, qty)
      values (v_id, (c ->> 'item_id')::uuid, p_location, v_qty);
      insert into public.stock_movements (item_id, location_id, qty, kind, ref_type, ref_id, note)
      values ((c ->> 'item_id')::uuid, p_location, -v_qty, 'consumo', 'production_order', p_po::text, 'OP ' || po.number);
    end loop;
  end if;

  update public.production_orders set status = 'em_producao', qty_produced = qty_produced + coalesce(p_produced, 0),
         qty_scrap = qty_scrap + coalesce(p_rejected, 0) where id = p_po;
  select oi.order_id into v_order from public.order_items oi where oi.id = po.order_item_id;
  perform app.sync_order_production(v_order);
  return v_id;
end $$;

create or replace function public.quality_release(p_po uuid, p_inspected numeric, p_approved numeric, p_location uuid,
                                                  p_lot text, p_note text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare po public.production_orders; v_id uuid; v_rej numeric;
begin
  perform app.require_any_role('admin','gestor','producao');
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  select id into v_id from public.quality_inspections where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  select * into po from public.production_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if po.status not in ('em_producao','pausada','concluida') then raise exception 'po_not_active'; end if;
  if p_inspected is null or p_inspected <= 0 or p_approved is null or p_approved < 0 or p_approved > p_inspected then
    raise exception 'invalid_qty';
  end if;
  v_rej := p_inspected - p_approved;
  if v_rej > 0 and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  if po.qty_inspected + p_inspected > po.qty_produced - po.qty_scrap then raise exception 'exceeds_produced'; end if;

  insert into public.quality_inspections (po_id, qty_inspected, qty_approved, lot_code, location_id, note, idempotency_key)
  values (p_po, p_inspected, p_approved, nullif(btrim(p_lot), ''), p_location, nullif(btrim(p_note), ''), p_key) returning id into v_id;
  update public.production_orders set qty_inspected = qty_inspected + p_inspected, qty_released = qty_released + p_approved where id = p_po;
  if p_approved > 0 then
    insert into public.stock_movements (item_id, location_id, lot_id, qty, kind, ref_type, ref_id, note)
    values (po.item_id, p_location, app.resolve_lot(po.item_id, p_lot), p_approved, 'producao', 'production_order', p_po::text, 'OP ' || po.number || ' (qualidade)');
    update public.order_items set qty_produced = qty_produced + p_approved::int where id = po.order_item_id;
  end if;
  return v_id;
end $$;

create or replace function public.production_set_status(p_po uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare po public.production_orders; v_order uuid;
begin
  perform app.require_any_role('admin','gestor','producao');
  select * into po from public.production_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  select oi.order_id into v_order from public.order_items oi where oi.id = po.order_item_id;
  case p_action
    when 'pause' then
      if po.status <> 'em_producao' then raise exception 'invalid_transition'; end if;
      update public.production_orders set status = 'pausada' where id = p_po;
    when 'resume' then
      if po.status <> 'pausada' then raise exception 'invalid_transition'; end if;
      update public.production_orders set status = 'em_producao' where id = p_po;
    when 'conclude' then
      if po.status not in ('em_producao','pausada') then raise exception 'invalid_transition'; end if;
      if po.qty_released < po.qty_planned and coalesce(btrim(p_note), '') = '' then raise exception 'short_note_required'; end if;
      update public.production_orders set status = 'concluida', notes = coalesce(nullif(btrim(p_note), '') , notes) where id = p_po;
      perform app.sync_order_production(v_order);
    when 'cancel' then
      if po.status in ('concluida','cancelada') or po.qty_produced > 0 then raise exception 'invalid_transition'; end if;
      if coalesce(btrim(p_note), '') = '' then raise exception 'reason_required'; end if;
      update public.production_orders set status = 'cancelada', cancel_reason = p_note where id = p_po;
    else raise exception 'invalid_action';
  end case;
end $$;

-- ---------- Expedição ----------
create table public.shipments (
  id           uuid primary key default gen_random_uuid(),
  number       text not null unique,
  order_id     uuid not null references public.orders(id) on delete restrict,
  status       text not null default 'separado'
               check (status in ('separado','pronto_coleta','coleta_agendada','coletado','cancelado')),
  scheduled_at timestamptz,
  collected_at timestamptz,
  volumes      int check (volumes is null or volumes >= 0),
  weight_kg    numeric(10,3) check (weight_kg is null or weight_kg >= 0),
  tracking     text,
  notes        text,
  cancel_reason text,
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index shipments_order_idx on public.shipments (order_id);
create table public.shipment_items (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.shipments(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id),
  qty           int not null check (qty > 0)
);

create or replace function app.recompute_logistics(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_all boolean; v_any boolean; v_new text; v_cur text;
begin
  select bool_and(qty_shipped >= qty), bool_or(qty_shipped > 0) into v_all, v_any from public.order_items where order_id = p_order;
  select status_logistics into v_cur from public.orders where id = p_order;
  if v_any then v_new := case when v_all then 'coletado' else 'coletado_parcial' end;
  elsif exists (select 1 from public.shipments where order_id = p_order and status = 'coleta_agendada') then v_new := 'coleta_agendada';
  elsif exists (select 1 from public.shipments where order_id = p_order and status = 'pronto_coleta') then v_new := 'pronto_coleta';
  elsif exists (select 1 from public.shipments where order_id = p_order and status = 'separado') then v_new := 'separado';
  elsif v_cur in ('separado','pronto_coleta','coleta_agendada') then v_new := 'aguardando';
  else v_new := v_cur; end if;
  update public.orders set status_logistics = v_new where id = p_order;
end $$;

create or replace function app.shipment_payment_ok(o public.orders) returns boolean
language sql stable security definer set search_path = '' as $$
  -- loja on-line: sempre pagamento integral; demais pedidos: só se a empresa decidir exigir quitação
  select o.status_financial = 'quitado'
      or (o.channel <> 'loja'
          and coalesce((select value #>> '{}' from public.settings where key = 'coleta_exige_quitacao'), 'false') <> 'true')
$$;

create or replace function public.shipment_create(p_order uuid, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_id uuid; l jsonb; oi public.order_items; v_qty int; v_alloc int;
begin
  perform app.require_any_role('admin','estoque');
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  if not app.shipment_payment_ok(o) then raise exception 'payment_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no_items'; end if;
  insert into public.shipments (number, order_id) values (app.next_number('EXP'), p_order) returning id into v_id;
  for l in select * from jsonb_array_elements(p_items) loop
    v_qty := (l ->> 'qty')::int;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid_qty'; end if;
    select * into oi from public.order_items where id = (l ->> 'order_item_id')::uuid and order_id = p_order;
    if not found then raise exception 'item_not_found'; end if;
    select coalesce(sum(si.qty), 0) into v_alloc from public.shipment_items si join public.shipments s on s.id = si.shipment_id
     where si.order_item_id = oi.id and s.status in ('separado','pronto_coleta','coleta_agendada') and s.id <> v_id;
    if oi.qty_shipped + v_alloc + v_qty > oi.qty then raise exception 'exceeds_order'; end if;
    insert into public.shipment_items (shipment_id, order_item_id, qty) values (v_id, oi.id, v_qty);
  end loop;
  perform app.recompute_logistics(p_order);
  return v_id;
end $$;

create or replace function public.shipment_set_status(p_ship uuid, p_status text, p_scheduled timestamptz default null,
  p_volumes int default null, p_weight numeric default null, p_tracking text default null, p_location uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.shipments; o public.orders; si record; v_own numeric; v_loc uuid;
begin
  perform app.require_any_role('admin','estoque');
  select * into s from public.shipments where id = p_ship for update;
  if not found then raise exception 'shipment_not_found'; end if;
  select * into o from public.orders where id = s.order_id for update;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;

  if p_status = 'pronto_coleta' then
    if s.status <> 'separado' then raise exception 'invalid_transition'; end if;
    update public.shipments set status = 'pronto_coleta', volumes = coalesce(p_volumes, volumes), weight_kg = coalesce(p_weight, weight_kg) where id = p_ship;
  elsif p_status = 'coleta_agendada' then
    if s.status <> 'pronto_coleta' then raise exception 'invalid_transition'; end if;
    if coalesce(o.invoice_number, '') = '' then raise exception 'invoice_required'; end if;
    if o.freight_mode = 'fob' and coalesce(o.carrier_name, '') = '' then raise exception 'carrier_required'; end if;
    if p_scheduled is null then raise exception 'schedule_required'; end if;
    update public.shipments set status = 'coleta_agendada', scheduled_at = p_scheduled where id = p_ship;
  elsif p_status = 'coletado' then
    if s.status <> 'coleta_agendada' then raise exception 'invalid_transition'; end if;
    if coalesce(o.invoice_number, '') = '' then raise exception 'invoice_required'; end if;
    if not app.shipment_payment_ok(o) then raise exception 'payment_required'; end if;
    v_loc := coalesce(p_location, (select id from public.stock_locations where code = 'PRINCIPAL'));
    for si in select si2.order_item_id, si2.qty, oi.item_id from public.shipment_items si2
              join public.order_items oi on oi.id = si2.order_item_id where si2.shipment_id = p_ship loop
      if si.item_id is not null then
        perform pg_advisory_xact_lock(hashtextextended(si.item_id::text, 1));
        select coalesce(sum(qty), 0) into v_own from public.stock_reservations where order_item_id = si.order_item_id and status = 'ativa';
        if app.item_available(si.item_id) + least(v_own, si.qty) < si.qty then raise exception 'insufficient_available'; end if;
        insert into public.stock_movements (item_id, location_id, qty, kind, ref_type, ref_id, note)
        values (si.item_id, v_loc, -si.qty, 'saida', 'shipment', p_ship::text, 'Expedição ' || s.number);
        update public.stock_reservations set status = 'consumida', released_at = now()
         where order_item_id = si.order_item_id and status = 'ativa' and qty <= si.qty;
      end if;
      update public.order_items set qty_shipped = qty_shipped + si.qty where id = si.order_item_id;
    end loop;
    update public.shipments set status = 'coletado', collected_at = now(), tracking = coalesce(nullif(btrim(p_tracking), ''), tracking) where id = p_ship;
  else
    raise exception 'invalid_status';
  end if;
  perform app.recompute_logistics(s.order_id);
end $$;

create or replace function public.shipment_cancel(p_ship uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.shipments;
begin
  perform app.require_any_role('admin','gestor','estoque');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from public.shipments where id = p_ship for update;
  if not found then raise exception 'shipment_not_found'; end if;
  if s.status not in ('separado','pronto_coleta','coleta_agendada') then raise exception 'invalid_transition'; end if;
  update public.shipments set status = 'cancelado', cancel_reason = p_reason where id = p_ship;
  perform app.recompute_logistics(s.order_id);
end $$;

-- ---------- updated_at e auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['machines','molds','production_orders','shipments'] loop
    execute format('create trigger trg_%1$s_updated before update on public.%1$s for each row execute function app.set_updated_at()', t);
  end loop;
  foreach t in array array['machines','molds','mold_items','machine_molds','production_orders','production_reports',
                           'production_consumption','quality_inspections','shipments','shipment_items'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.machines               enable row level security;
alter table public.molds                  enable row level security;
alter table public.mold_items             enable row level security;
alter table public.machine_molds          enable row level security;
alter table public.production_orders      enable row level security;
alter table public.production_reports     enable row level security;
alter table public.production_consumption enable row level security;
alter table public.quality_inspections    enable row level security;
alter table public.shipments              enable row level security;
alter table public.shipment_items         enable row level security;

create policy mach_select on public.machines for select to authenticated using (app.is_internal());
create policy mach_write on public.machines for all to authenticated
  using (app.has_any_role('admin','producao')) with check (app.has_any_role('admin','producao'));
create policy mold_select on public.molds for select to authenticated using (app.is_internal());
create policy mold_write on public.molds for all to authenticated
  using (app.has_any_role('admin','producao')) with check (app.has_any_role('admin','producao'));
create policy moldi_select on public.mold_items for select to authenticated using (app.is_internal());
create policy moldi_write on public.mold_items for all to authenticated
  using (app.has_any_role('admin','producao')) with check (app.has_any_role('admin','producao'));
create policy machm_select on public.machine_molds for select to authenticated using (app.is_internal());
create policy machm_write on public.machine_molds for all to authenticated
  using (app.has_any_role('admin','producao')) with check (app.has_any_role('admin','producao'));
create policy po_prod_select on public.production_orders for select to authenticated using (app.is_internal());
create policy po_prod_update on public.production_orders for update to authenticated
  using (app.has_any_role('admin','producao')) with check (app.has_any_role('admin','producao'));
create policy rep_select on public.production_reports for select to authenticated using (app.is_internal());
create policy cons_select on public.production_consumption for select to authenticated using (app.is_internal());
create policy qi_select2 on public.quality_inspections for select to authenticated using (app.is_internal());
create policy ship_select on public.shipments for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','producao','estoque','financeiro'));
create policy ship_update on public.shipments for update to authenticated
  using (app.has_any_role('admin','estoque')) with check (app.has_any_role('admin','estoque'));
create policy shipi_select on public.shipment_items for select to authenticated
  using (app.has_any_role('admin','gestor','comercial','producao','estoque','financeiro'));

revoke all on public.machines, public.molds, public.mold_items, public.machine_molds, public.production_orders,
  public.production_reports, public.production_consumption, public.quality_inspections, public.shipments,
  public.shipment_items from anon, authenticated;
grant select, insert, update on public.machines, public.molds to authenticated;          -- inativa em vez de excluir
grant select, insert, delete on public.mold_items, public.machine_molds to authenticated;
grant select on public.production_orders, public.production_reports, public.production_consumption,
  public.quality_inspections, public.shipments, public.shipment_items to authenticated;
grant update (machine_id, mold_id, planned_start, notes) on public.production_orders to authenticated;
grant update (notes) on public.shipments to authenticated;

-- ---------- Portal: o cliente vê suas coletas (sem observações internas) ----------
create or replace view public.portal_shipments as
  select s.id, s.number, s.order_id, s.status, s.scheduled_at, s.collected_at, s.volumes, s.tracking
  from public.shipments s join public.orders o on o.id = s.order_id
  where o.customer_id in (select app.my_customers()) and s.status <> 'cancelado';
create or replace view public.portal_shipment_items as
  select si.id, si.shipment_id, oi.description, si.qty
  from public.shipment_items si join public.order_items oi on oi.id = si.order_item_id
  join public.shipments s on s.id = si.shipment_id join public.orders o on o.id = s.order_id
  where o.customer_id in (select app.my_customers()) and s.status <> 'cancelado';
revoke all on public.portal_shipments, public.portal_shipment_items from anon;
grant select on public.portal_shipments, public.portal_shipment_items to authenticated;

-- ---------- Execução ----------
revoke all on function
  public.production_create(uuid, numeric, uuid, uuid, date), public.production_release(uuid),
  public.production_report(uuid, numeric, numeric, numeric, int, text, text, uuid, jsonb, text),
  public.quality_release(uuid, numeric, numeric, uuid, text, text, text), public.production_set_status(uuid, text, text),
  public.shipment_create(uuid, jsonb), public.shipment_set_status(uuid, text, timestamptz, int, numeric, text, uuid),
  public.shipment_cancel(uuid, text) from public, anon;
grant execute on function
  public.production_create(uuid, numeric, uuid, uuid, date), public.production_release(uuid),
  public.production_report(uuid, numeric, numeric, numeric, int, text, text, uuid, jsonb, text),
  public.quality_release(uuid, numeric, numeric, uuid, text, text, text), public.production_set_status(uuid, text, text),
  public.shipment_create(uuid, jsonb), public.shipment_set_status(uuid, text, timestamptz, int, numeric, text, uuid),
  public.shipment_cancel(uuid, text) to authenticated;
revoke all on function app.sync_order_production(uuid), app.recompute_logistics(uuid),
  app.shipment_payment_ok(public.orders) from public, anon, authenticated;
grant execute on function app.sync_order_production(uuid), app.recompute_logistics(uuid),
  app.shipment_payment_ok(public.orders) to service_role;

-- ########## 20261127000008_finance.sql ##########
-- =====================================================================
-- Migração 0008: financeiro gerencial
-- Orçamento ≠ pedido ≠ título ≠ movimentação de caixa. Caixa é livro-razão imutável (estorno cria
-- lançamento oposto). Comprovante do cliente NÃO dá baixa: só o Financeiro valida. Transferência
-- entre contas não é receita nem despesa. Um título por origem/parcela (sem duplicidade).
-- =====================================================================

create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (btrim(name) <> ''),
  kind            text not null default 'banco' check (kind in ('banco','caixa')),
  opening_balance numeric(14,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table public.finance_categories (
  id     uuid primary key default gen_random_uuid(),
  name   text not null check (btrim(name) <> ''),
  kind   text not null check (kind in ('receita','despesa')),
  active boolean not null default true,
  unique (name, kind)
);
create table public.cost_centers (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique check (btrim(name) <> ''),
  active boolean not null default true
);

create table public.financial_titles (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('receber','pagar')),
  origin_type    text not null default 'manual' check (origin_type in ('order','receipt','manual')),
  origin_id      uuid,
  installment    int not null default 1 check (installment >= 1),
  description    text not null check (btrim(description) <> ''),
  amount         numeric(14,2) not null check (amount > 0),
  due_date       date not null,
  competence     date not null check (competence = date_trunc('month', competence)::date),
  category_id    uuid references public.finance_categories(id),
  cost_center_id uuid references public.cost_centers(id),
  customer_id    uuid references public.customers(id),
  supplier_id    uuid references public.suppliers(id),
  settled        numeric(14,2) not null default 0 check (settled >= 0),   -- principal quitado (inclui descontos)
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  status         text not null default 'aberto' check (status in ('aberto','parcial','pago','cancelado')),
  cancel_reason  text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint titles_settled_le_amount check (settled <= amount)
);
-- Um título por origem e parcela: impede lançar duas vezes a mesma compra/pedido
create unique index financial_titles_origin_uk on public.financial_titles (kind, origin_type, origin_id, installment)
  where origin_id is not null;
create index financial_titles_due_idx on public.financial_titles (due_date) where status in ('aberto','parcial');

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  title_id        uuid not null references public.financial_titles(id) on delete restrict,
  account_id      uuid not null references public.bank_accounts(id),
  paid_on         date not null,
  amount          numeric(14,2) not null default 0 check (amount >= 0),
  interest        numeric(14,2) not null default 0 check (interest >= 0),
  fine            numeric(14,2) not null default 0 check (fine >= 0),
  discount        numeric(14,2) not null default 0 check (discount >= 0),
  note            text,
  idempotency_key text not null unique,
  reversed        boolean not null default false,
  reversal_note   text,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint payments_nonzero check (amount + discount > 0)
);

create table public.cash_movements (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  movement_date date not null,
  account_id    uuid not null references public.bank_accounts(id),
  amount        numeric(14,2) not null check (amount <> 0),   -- positivo entra, negativo sai
  kind          text not null check (kind in ('recebimento','pagamento','juros','multa','transferencia','ajuste','estorno')),
  title_id      uuid references public.financial_titles(id),
  payment_id    uuid references public.payments(id),
  transfer_group uuid,
  reversal_of   bigint unique references public.cash_movements(id),
  note          text,
  actor         uuid default auth.uid()
);
create index cash_movements_account_idx on public.cash_movements (account_id, movement_date);
create or replace function app.cash_immutable() returns trigger language plpgsql as $$
begin raise exception 'cash_movements é somente inserção (use estorno)'; end $$;
create trigger trg_cash_immutable before update or delete on public.cash_movements
  for each row execute function app.cash_immutable();

create table public.payment_proofs (
  id            uuid primary key default gen_random_uuid(),
  title_id      uuid not null references public.financial_titles(id) on delete restrict,
  submitted_by  uuid references public.profiles(id) default auth.uid(),
  amount        numeric(14,2) not null check (amount > 0),
  paid_on       date not null,
  note          text,
  status        text not null default 'pendente' check (status in ('pendente','validado','recusado')),
  validated_by  uuid references public.profiles(id),
  validated_at  timestamptz,
  reject_reason text,
  payment_id    uuid references public.payments(id),
  created_at    timestamptz not null default now()
);

create table public.bank_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.bank_accounts(id),
  line_date        date not null,
  description      text not null,
  amount           numeric(14,2) not null check (amount <> 0),
  matched_movement bigint unique references public.cash_movements(id),
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now()
);

-- ---------- Sincronização de situação ----------
create or replace function app.sync_title(p_title uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.financial_titles set status = case when settled >= amount then 'pago' when settled > 0 then 'parcial' else 'aberto' end
   where id = p_title and status <> 'cancelado';
end $$;

create or replace function app.sync_order_financial(p_order uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_settled numeric; v_n int; v_open int; v_dep_paid boolean; v_new text;
begin
  select * into o from public.orders where id = p_order;
  select coalesce(sum(settled), 0), count(*), count(*) filter (where status <> 'pago') into v_settled, v_n, v_open
    from public.financial_titles where origin_type = 'order' and origin_id = p_order and kind = 'receber' and status <> 'cancelado';
  if v_n = 0 then return; end if;
  v_dep_paid := exists (select 1 from public.financial_titles where origin_type = 'order' and origin_id = p_order
                         and kind = 'receber' and installment = 1 and status = 'pago');
  v_new := case
    when v_open = 0 then 'quitado'
    when o.deposit_required and v_dep_paid then 'sinal_pago'
    when v_settled > 0 then 'parcial'
    when o.deposit_required then 'aguardando_sinal'
    else 'sem_cobranca' end;
  update public.orders set status_financial = v_new where id = p_order;
end $$;

-- ---------- Funções ----------
create or replace function public.title_pay(p_title uuid, p_account uuid, p_amount numeric, p_paid_on date,
  p_interest numeric default 0, p_fine numeric default 0, p_discount numeric default 0,
  p_note text default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.financial_titles; v_id uuid; v_sign int;
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  select id into v_id from public.payments where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  select * into t from public.financial_titles where id = p_title for update;
  if not found then raise exception 'title_not_found'; end if;
  if t.status in ('pago','cancelado') then raise exception 'title_closed'; end if;
  if not exists (select 1 from public.bank_accounts where id = p_account and active) then raise exception 'account_not_found'; end if;
  p_amount := coalesce(p_amount, 0); p_interest := coalesce(p_interest, 0); p_fine := coalesce(p_fine, 0); p_discount := coalesce(p_discount, 0);
  if p_amount < 0 or p_interest < 0 or p_fine < 0 or p_discount < 0 or p_amount + p_discount <= 0 then raise exception 'invalid_amount'; end if;
  if t.settled + p_amount + p_discount > t.amount then raise exception 'exceeds_balance'; end if;
  v_sign := case t.kind when 'receber' then 1 else -1 end;

  insert into public.payments (title_id, account_id, paid_on, amount, interest, fine, discount, note, idempotency_key)
  values (p_title, p_account, coalesce(p_paid_on, current_date), p_amount, p_interest, p_fine, p_discount, p_note, p_key) returning id into v_id;
  if p_amount > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id, note)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_amount, case t.kind when 'receber' then 'recebimento' else 'pagamento' end, p_title, v_id, p_note);
  end if;
  if p_interest > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_interest, 'juros', p_title, v_id);
  end if;
  if p_fine > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_fine, 'multa', p_title, v_id);
  end if;
  update public.financial_titles set settled = settled + p_amount + p_discount, discount_total = discount_total + p_discount where id = p_title;
  perform app.sync_title(p_title);
  if t.origin_type = 'order' then perform app.sync_order_financial(t.origin_id); end if;
  return v_id;
end $$;

create or replace function public.payment_reverse(p_payment uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.payments; t public.financial_titles; m record;
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  select * into p from public.payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found'; end if;
  if p.reversed then raise exception 'already_reversed'; end if;
  select * into t from public.financial_titles where id = p.title_id for update;
  for m in select * from public.cash_movements where payment_id = p_payment and reversal_of is null loop
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id, reversal_of, note)
    values (current_date, m.account_id, -m.amount, 'estorno', m.title_id, m.payment_id, m.id, p_note);
  end loop;
  update public.payments set reversed = true, reversal_note = p_note where id = p_payment;
  update public.financial_titles set settled = settled - (p.amount + p.discount), discount_total = discount_total - p.discount where id = p.title_id;
  perform app.sync_title(p.title_id);
  if t.origin_type = 'order' then perform app.sync_order_financial(t.origin_id); end if;
end $$;

create or replace function public.order_generate_receivables(p_order uuid, p_balance_due date default null) returns int
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_comp date := date_trunc('month', current_date)::date; v_n int := 0; v_bal numeric;
begin
  perform app.require_any_role('admin','financeiro');
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  if exists (select 1 from public.financial_titles where origin_type = 'order' and origin_id = p_order) then
    return (select count(*) from public.financial_titles where origin_type = 'order' and origin_id = p_order);   -- idempotente
  end if;
  if o.deposit_required and o.deposit_amount > 0 then
    insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence, customer_id)
    values ('receber', 'order', p_order, 1, 'Sinal do pedido ' || o.number, o.deposit_amount, current_date, v_comp, o.customer_id);
    v_n := 1;
    v_bal := o.total - o.deposit_amount;
    if v_bal > 0 then
      if p_balance_due is null then raise exception 'due_required'; end if;
      insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence, customer_id)
      values ('receber', 'order', p_order, 2, 'Saldo do pedido ' || o.number, v_bal, p_balance_due, v_comp, o.customer_id);
      v_n := 2;
    end if;
  else
    if o.total <= 0 then raise exception 'nothing_to_charge'; end if;
    insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence, customer_id)
    values ('receber', 'order', p_order, 1, 'Pedido ' || o.number, o.total, coalesce(p_balance_due, current_date), v_comp, o.customer_id);
    v_n := 1;
  end if;
  perform app.sync_order_financial(p_order);
  return v_n;
end $$;

create or replace function public.title_create_installments(p_kind text, p_description text, p_total numeric, p_first_due date,
  p_n int, p_category uuid default null, p_cost_center uuid default null, p_customer uuid default null, p_supplier uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare i int; v_each numeric; v_amt numeric; v_comp date;
begin
  perform app.require_any_role('admin','financeiro');
  if p_kind not in ('receber','pagar') or p_total is null or p_total <= 0 or p_n < 1 or p_n > 60 then raise exception 'invalid_amount'; end if;
  v_each := trunc(p_total / p_n, 2);
  for i in 1..p_n loop
    v_amt := case when i = p_n then p_total - v_each * (p_n - 1) else v_each end;
    v_comp := date_trunc('month', (p_first_due + ((i - 1) || ' month')::interval))::date;
    insert into public.financial_titles (kind, description, amount, due_date, competence, category_id, cost_center_id, customer_id, supplier_id, installment)
    values (p_kind, p_description || case when p_n > 1 then ' (' || i || '/' || p_n || ')' else '' end, v_amt,
            (p_first_due + ((i - 1) || ' month')::interval)::date, v_comp, p_category, p_cost_center, p_customer, p_supplier, 1);
  end loop;
  return p_n;
end $$;

create or replace function public.title_cancel(p_title uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.financial_titles;
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into t from public.financial_titles where id = p_title for update;
  if not found then raise exception 'title_not_found'; end if;
  if t.settled > 0 or exists (select 1 from public.payments where title_id = p_title and not reversed) then raise exception 'has_payments'; end if;
  update public.financial_titles set status = 'cancelado', cancel_reason = p_reason where id = p_title;
  if t.origin_type = 'order' then perform app.sync_order_financial(t.origin_id); end if;
end $$;

-- Compra recebida → conta a pagar (um título por recebimento)
create or replace function public.receipt_generate_payable(p_receipt uuid, p_due date, p_category uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.receipts; po public.purchase_orders; v_amount numeric; v_id uuid;
begin
  perform app.require_any_role('admin','financeiro');
  select * into r from public.receipts where id = p_receipt;
  if not found then raise exception 'receipt_not_found'; end if;
  select * into po from public.purchase_orders where id = r.po_id;
  select coalesce(sum(round(rl.qty * pl.unit_cost, 2)), 0) into v_amount
    from public.receipt_lines rl join public.purchase_lines pl on pl.id = rl.line_id where rl.receipt_id = p_receipt;
  if v_amount <= 0 then raise exception 'nothing_to_charge'; end if;
  insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence, category_id, supplier_id)
  values ('pagar', 'receipt', p_receipt, 1, 'Compra ' || po.number || coalesce(' · NF ' || r.document_number, ''), v_amount, p_due,
          date_trunc('month', r.received_at)::date, p_category, po.supplier_id)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.financial_titles where kind = 'pagar' and origin_type = 'receipt' and origin_id = p_receipt and installment = 1;
  end if;
  return v_id;
end $$;

create or replace function public.account_transfer(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid := gen_random_uuid();
begin
  perform app.require_any_role('admin','financeiro');
  if p_amount is null or p_amount <= 0 or p_from = p_to then raise exception 'invalid_amount'; end if;
  insert into public.cash_movements (movement_date, account_id, amount, kind, transfer_group, note) values
    (coalesce(p_date, current_date), p_from, -p_amount, 'transferencia', g, p_note),
    (coalesce(p_date, current_date), p_to,    p_amount, 'transferencia', g, p_note);
  return g;
end $$;

-- ---------- Comprovantes do cliente: só pendência; a baixa é do Financeiro ----------
create or replace function public.portal_submit_proof(p_title uuid, p_amount numeric, p_paid_on date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.financial_titles; v_id uuid;
begin
  select * into t from public.financial_titles where id = p_title and kind = 'receber' and origin_type = 'order';
  if not found or t.customer_id not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(t.customer_id) not in ('aprovador','financeiro') then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.status not in ('aberto','parcial') then raise exception 'title_closed'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > t.amount - t.settled then raise exception 'invalid_amount'; end if;
  insert into public.payment_proofs (title_id, amount, paid_on, note) values (p_title, p_amount, coalesce(p_paid_on, current_date), p_note) returning id into v_id;
  return v_id;
end $$;

create or replace function public.proof_validate(p_proof uuid, p_account uuid, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare pr public.payment_proofs; v_pay uuid;
begin
  perform app.require_any_role('admin','financeiro');
  select * into pr from public.payment_proofs where id = p_proof for update;
  if not found then raise exception 'proof_not_found'; end if;
  if pr.status <> 'pendente' then raise exception 'proof_closed'; end if;
  v_pay := public.title_pay(pr.title_id, p_account, pr.amount, pr.paid_on, 0, 0, 0, 'Comprovante do cliente validado', p_key);
  update public.payment_proofs set status = 'validado', validated_by = auth.uid(), validated_at = now(), payment_id = v_pay where id = p_proof;
  return v_pay;
end $$;

create or replace function public.proof_reject(p_proof uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update public.payment_proofs set status = 'recusado', validated_by = auth.uid(), validated_at = now(), reject_reason = p_reason
   where id = p_proof and status = 'pendente';
  if not found then raise exception 'proof_closed'; end if;
end $$;

-- ---------- Conciliação bancária manual ----------
create or replace function public.statement_add_line(p_account uuid, p_date date, p_description text, p_amount numeric) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_any_role('admin','financeiro');
  insert into public.bank_statement_lines (account_id, line_date, description, amount) values (p_account, p_date, p_description, p_amount) returning id into v;
  return v;
end $$;

create or replace function public.statement_match(p_line uuid, p_movement bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.bank_statement_lines; m public.cash_movements;
begin
  perform app.require_any_role('admin','financeiro');
  select * into l from public.bank_statement_lines where id = p_line for update;
  select * into m from public.cash_movements where id = p_movement;
  if l.id is null or m.id is null then raise exception 'not_found'; end if;
  if l.matched_movement is not null then raise exception 'already_matched'; end if;
  if m.account_id <> l.account_id or m.amount <> l.amount then raise exception 'mismatch'; end if;
  begin
    update public.bank_statement_lines set matched_movement = p_movement where id = p_line;
  exception when unique_violation then raise exception 'movement_already_matched';
  end;
end $$;

create or replace function public.statement_unmatch(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','financeiro');
  update public.bank_statement_lines set matched_movement = null where id = p_line;
end $$;

-- ---------- Relatório gerencial: caixa x competência (critério explícito) ----------
create or replace function public.finance_summary(p_from date, p_to date, p_regime text)
returns table (month date, receitas numeric, despesas numeric, resultado numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','financeiro');
  if p_regime = 'caixa' then
    -- regime de caixa: dinheiro que entrou/saiu em títulos (principal, juros, multa e estornos). Transferências ficam de fora.
    return query
      select date_trunc('month', cm.movement_date)::date,
             coalesce(sum(cm.amount) filter (where t.kind = 'receber'), 0),
             coalesce(-sum(cm.amount) filter (where t.kind = 'pagar'), 0),
             coalesce(sum(cm.amount), 0)
      from public.cash_movements cm join public.financial_titles t on t.id = cm.title_id
      where cm.movement_date between p_from and p_to
      group by 1 order by 1;
  elsif p_regime = 'competencia' then
    -- regime de competência: títulos (não cancelados) pelo mês de competência, pagos ou não.
    return query
      select t.competence,
             coalesce(sum(t.amount) filter (where t.kind = 'receber'), 0),
             coalesce(sum(t.amount) filter (where t.kind = 'pagar'), 0),
             coalesce(sum(case when t.kind = 'receber' then t.amount else -t.amount end), 0)
      from public.financial_titles t
      where t.status <> 'cancelado' and t.competence between date_trunc('month', p_from)::date and p_to
      group by 1 order by 1;
  else
    raise exception 'invalid_regime';
  end if;
end $$;

-- ---------- updated_at e auditoria ----------
create trigger trg_bank_accounts_updated before update on public.bank_accounts for each row execute function app.set_updated_at();
create trigger trg_titles_updated before update on public.financial_titles for each row execute function app.set_updated_at();
do $$
declare t text;
begin
  foreach t in array array['bank_accounts','finance_categories','cost_centers','financial_titles','payments','payment_proofs','bank_statement_lines'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.bank_accounts        enable row level security;
alter table public.finance_categories   enable row level security;
alter table public.cost_centers         enable row level security;
alter table public.financial_titles     enable row level security;
alter table public.payments             enable row level security;
alter table public.cash_movements       enable row level security;
alter table public.payment_proofs       enable row level security;
alter table public.bank_statement_lines enable row level security;

create policy ba_select on public.bank_accounts for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy ba_write  on public.bank_accounts for all to authenticated
  using (app.has_any_role('admin','financeiro')) with check (app.has_any_role('admin','financeiro'));
create policy fc_select on public.finance_categories for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy fc_write  on public.finance_categories for all to authenticated
  using (app.has_any_role('admin','financeiro')) with check (app.has_any_role('admin','financeiro'));
create policy cc_select on public.cost_centers for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy cc_write  on public.cost_centers for all to authenticated
  using (app.has_any_role('admin','financeiro')) with check (app.has_any_role('admin','financeiro'));
-- títulos: financeiro/gestor/admin tudo; comercial só a receber; compras só a pagar
create policy ft_select on public.financial_titles for select to authenticated using (
  app.has_any_role('admin','gestor','financeiro')
  or (kind = 'receber' and app.has_any_role('comercial'))
  or (kind = 'pagar' and app.has_any_role('compras')));
create policy pay_select on public.payments for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy cm_select on public.cash_movements for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy pp_select on public.payment_proofs for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy bsl_select on public.bank_statement_lines for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));

revoke all on public.bank_accounts, public.finance_categories, public.cost_centers, public.financial_titles, public.payments,
  public.cash_movements, public.payment_proofs, public.bank_statement_lines from anon, authenticated;
grant select, insert, update on public.bank_accounts, public.finance_categories, public.cost_centers to authenticated;
grant select on public.financial_titles, public.payments, public.cash_movements, public.payment_proofs, public.bank_statement_lines to authenticated;

-- ---------- Visões ----------
create or replace view public.account_balances as
  select a.id as account_id, a.name, a.kind, a.active, a.opening_balance,
         a.opening_balance + coalesce(sum(cm.amount), 0) as balance
  from public.bank_accounts a left join public.cash_movements cm on cm.account_id = a.id
  where app.has_any_role('admin','gestor','financeiro')
  group by a.id;

create or replace view public.titles_open as
  select t.*, t.amount - t.settled as balance, (t.due_date < current_date and t.status in ('aberto','parcial')) as overdue
  from public.financial_titles t
  where app.has_any_role('admin','gestor','financeiro')
     or (t.kind = 'receber' and app.has_any_role('comercial')) or (t.kind = 'pagar' and app.has_any_role('compras'));

-- Portal: cobranças do cliente (contatos aprovador/financeiro)
create or replace view public.portal_titles as
  select t.id, t.origin_id as order_id, t.description, t.amount, t.due_date, t.status, t.amount - t.settled as balance,
         (t.due_date < current_date and t.status in ('aberto','parcial')) as overdue
  from public.financial_titles t
  where t.kind = 'receber' and t.origin_type = 'order' and t.status <> 'cancelado'
    and t.customer_id in (select app.my_customers())
    and app.customer_level(t.customer_id) in ('aprovador','financeiro');

revoke all on public.account_balances, public.titles_open, public.portal_titles from anon;
grant select on public.account_balances, public.titles_open, public.portal_titles to authenticated;

-- ---------- Execução ----------
revoke all on function
  public.title_pay(uuid, uuid, numeric, date, numeric, numeric, numeric, text, text), public.payment_reverse(uuid, text),
  public.order_generate_receivables(uuid, date), public.title_create_installments(text, text, numeric, date, int, uuid, uuid, uuid, uuid),
  public.title_cancel(uuid, text), public.receipt_generate_payable(uuid, date, uuid), public.account_transfer(uuid, uuid, numeric, date, text),
  public.portal_submit_proof(uuid, numeric, date, text), public.proof_validate(uuid, uuid, text), public.proof_reject(uuid, text),
  public.statement_add_line(uuid, date, text, numeric), public.statement_match(uuid, bigint), public.statement_unmatch(uuid),
  public.finance_summary(date, date, text) from public, anon;
grant execute on function
  public.title_pay(uuid, uuid, numeric, date, numeric, numeric, numeric, text, text), public.payment_reverse(uuid, text),
  public.order_generate_receivables(uuid, date), public.title_create_installments(text, text, numeric, date, int, uuid, uuid, uuid, uuid),
  public.title_cancel(uuid, text), public.receipt_generate_payable(uuid, date, uuid), public.account_transfer(uuid, uuid, numeric, date, text),
  public.portal_submit_proof(uuid, numeric, date, text), public.proof_validate(uuid, uuid, text), public.proof_reject(uuid, text),
  public.statement_add_line(uuid, date, text, numeric), public.statement_match(uuid, bigint), public.statement_unmatch(uuid),
  public.finance_summary(date, date, text) to authenticated;
revoke all on function app.sync_title(uuid), app.sync_order_financial(uuid) from public, anon, authenticated;
grant execute on function app.sync_title(uuid), app.sync_order_financial(uuid) to service_role;

-- ########## 20261127000009_projects.sql ##########
-- =====================================================================
-- Migração 0009: projetos exclusivos
-- Briefing → Viabilidade → Proposta → Desenvolvimento → Amostra → Aprovação da amostra → Liberado.
-- A produção de item exclusivo só é liberada com o projeto liberado (versão técnica e amostra aprovadas);
-- a versão aprovada acompanha o pedido e a ordem de produção. Alterar a versão revoga a liberação.
-- Arquivos: por enquanto, links (Drive etc.); upload privado fica para quando o armazenamento estiver ligado.
-- =====================================================================

alter table public.items add column exclusive_customer_id uuid references public.customers(id);
alter table public.items add constraint items_exclusive_not_in_store check (exclusive_customer_id is null or not store_published);
alter table public.order_items add column project_version_id uuid;
alter table public.production_orders add column project_version_id uuid;

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  customer_id      uuid not null references public.customers(id) on delete restrict,
  opportunity_id   uuid references public.opportunities(id),
  title            text not null check (btrim(title) <> ''),
  briefing         text,
  requirements     text,
  stage            text not null default 'briefing' check (stage in
                   ('briefing','viabilidade','proposta','desenvolvimento','amostra','aprovacao_amostra','liberado','recusado','cancelado')),
  owner_id         uuid references public.profiles(id),
  due_date         date,
  mold_id          uuid references public.molds(id),
  item_id          uuid references public.items(id),
  feasible         boolean,
  feasibility_notes text,
  feasibility_by   uuid references public.profiles(id),
  feasibility_at   timestamptz,
  development_price numeric(14,2) check (development_price is null or development_price >= 0),
  mold_price       numeric(14,2) check (mold_price is null or mold_price >= 0),
  sample_price     numeric(14,2) check (sample_price is null or sample_price >= 0),
  charge_notes     text,
  released_version_id uuid,
  released_at      timestamptz,
  cancel_reason    text,
  created_by       uuid references public.profiles(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index projects_customer_idx on public.projects (customer_id);

create table public.project_costs (          -- custo interno: nunca vai ao portal nem à produção
  project_id uuid primary key references public.projects(id) on delete cascade,
  internal_cost_estimate numeric(14,2) check (internal_cost_estimate is null or internal_cost_estimate >= 0),
  notes      text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);

create table public.project_versions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete restrict,
  version       int not null check (version >= 1),
  requirements  text not null default '',
  specs         jsonb not null default '{}'::jsonb,
  status        text not null default 'rascunho' check (status in ('rascunho','enviada','aprovada','recusada','substituida')),
  sent_at       timestamptz,
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  approved_ip   text,
  approved_via  text check (approved_via in ('portal','interno')),
  approved_note text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (project_id, version)
);
create unique index project_versions_one_draft on public.project_versions (project_id) where status = 'rascunho';
alter table public.projects add constraint projects_released_version_fk foreign key (released_version_id) references public.project_versions(id);
alter table public.order_items add constraint order_items_project_version_fk foreign key (project_version_id) references public.project_versions(id);
alter table public.production_orders add constraint production_orders_project_version_fk foreign key (project_version_id) references public.project_versions(id);

create or replace function app.project_versions_guard() returns trigger language plpgsql as $$
declare ok_cols text[] := array['status','sent_at','approved_by','approved_at','approved_ip','approved_via','approved_note'];
begin
  if tg_op = 'DELETE' then raise exception 'version_locked'; end if;
  if old.status <> 'rascunho' and (to_jsonb(new) - ok_cols) is distinct from (to_jsonb(old) - ok_cols) then
    raise exception 'version_locked';
  end if;
  if new.status <> old.status and not ((old.status, new.status) in (('rascunho','enviada'),('enviada','aprovada'),
      ('enviada','recusada'),('enviada','substituida'),('aprovada','substituida'))) then
    raise exception 'invalid_transition';
  end if;
  return new;
end $$;
create trigger trg_project_versions_guard before update or delete on public.project_versions
  for each row execute function app.project_versions_guard();

create table public.project_files (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete restrict,
  version_no          int,
  kind                text not null default 'outro' check (kind in ('desenho','3d','especificacao','foto','amostra','outro')),
  title               text not null check (btrim(title) <> ''),
  url                 text not null check (url ~* '^https?://'),
  notes               text,
  visible_to_customer boolean not null default false,
  active              boolean not null default true,
  created_by          uuid references public.profiles(id) default auth.uid(),
  created_at          timestamptz not null default now()
);

create table public.project_samples (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete restrict,
  version_id    uuid not null references public.project_versions(id),
  number        int not null,
  status        text not null default 'em_producao' check (status in ('em_producao','enviada','aprovada','reprovada')),
  notes         text,
  sent_at       timestamptz,
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decided_via   text check (decided_via in ('portal','interno')),
  decision_note text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (project_id, number)
);

create table public.project_change_requests (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete restrict,
  version_id   uuid not null references public.project_versions(id),
  requested_by uuid not null references public.profiles(id) default auth.uid(),
  message      text not null check (btrim(message) <> ''),
  created_at   timestamptz not null default now()
);

create table public.project_events (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete restrict,
  at         timestamptz not null default now(),
  actor      uuid default auth.uid(),
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  note       text
);
create index project_events_idx on public.project_events (project_id, at);

create or replace function app.project_event(p_project uuid, p_kind text, p_detail jsonb default '{}'::jsonb, p_note text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.project_events (project_id, kind, detail, note) values (p_project, p_kind, coalesce(p_detail, '{}'::jsonb), p_note)
$$;

-- a ordem de produção herda a versão técnica aprovada do item do pedido
create or replace function app.production_orders_inherit_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.project_version_id is null then
    select project_version_id into new.project_version_id from public.order_items where id = new.order_item_id;
  end if;
  return new;
end $$;
create trigger trg_production_orders_version before insert on public.production_orders
  for each row execute function app.production_orders_inherit_version();

-- ---------- Funções do projeto ----------
create or replace function app.approved_version(p_project uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.project_versions where project_id = p_project and status = 'aprovada' order by version desc limit 1
$$;

create or replace function public.project_create(p_customer uuid, p_title text, p_briefing text default null, p_opportunity uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_any_role('admin','comercial');
  if not exists (select 1 from public.customers where id = p_customer and active) then raise exception 'customer_not_found'; end if;
  insert into public.projects (number, customer_id, opportunity_id, title, briefing, owner_id)
  values (app.next_number('PRJ'), p_customer, p_opportunity, p_title, nullif(btrim(p_briefing), ''), auth.uid()) returning id into v;
  perform app.project_event(v, 'criado');
  return v;
end $$;

create or replace function public.project_set_feasibility(p_project uuid, p_feasible boolean, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','producao');
  if coalesce(btrim(p_notes), '') = '' then raise exception 'note_required'; end if;
  update public.projects set feasible = p_feasible, feasibility_notes = p_notes, feasibility_by = auth.uid(), feasibility_at = now()
   where id = p_project and stage = 'viabilidade';
  if not found then raise exception 'wrong_stage'; end if;
  perform app.project_event(p_project, 'viabilidade', jsonb_build_object('viavel', p_feasible), p_notes);
end $$;

create or replace function public.project_advance(p_project uuid, p_to text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.projects; v_ver uuid; v_ok boolean := false;
begin
  perform app.require_any_role('admin','gestor','comercial','producao');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'project_not_found'; end if;
  v_ver := app.approved_version(p_project);

  if p.stage = 'briefing' and p_to = 'viabilidade' then
    if coalesce(btrim(p.briefing), '') = '' then raise exception 'briefing_required'; end if;
    v_ok := true;
  elsif p.stage = 'viabilidade' and p_to = 'proposta' then
    if p.feasible is distinct from true then raise exception 'not_feasible'; end if; v_ok := true;
  elsif p.stage = 'viabilidade' and p_to = 'recusado' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if; v_ok := true;
  elsif p.stage = 'proposta' and p_to = 'desenvolvimento' then
    if v_ver is null then raise exception 'version_not_approved'; end if; v_ok := true;
  elsif p.stage = 'desenvolvimento' and p_to = 'amostra' then
    if not exists (select 1 from public.project_samples where project_id = p_project and version_id = v_ver) then raise exception 'sample_required'; end if; v_ok := true;
  elsif p.stage = 'amostra' and p_to = 'aprovacao_amostra' then
    if not exists (select 1 from public.project_samples where project_id = p_project and version_id = v_ver and status = 'enviada') then raise exception 'sample_not_sent'; end if; v_ok := true;
  elsif p.stage = 'aprovacao_amostra' and p_to = 'liberado' then
    if v_ver is null or not exists (select 1 from public.project_samples where project_id = p_project and version_id = v_ver and status = 'aprovada') then
      raise exception 'sample_not_approved';
    end if;
    update public.projects set released_version_id = v_ver, released_at = now() where id = p_project; v_ok := true;
  elsif p.stage = 'aprovacao_amostra' and p_to = 'desenvolvimento' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if; v_ok := true;
  end if;
  if not v_ok then raise exception 'invalid_transition'; end if;
  update public.projects set stage = p_to where id = p_project;
  perform app.project_event(p_project, 'etapa', jsonb_build_object('de', p.stage, 'para', p_to), p_note);
end $$;

create or replace function public.project_cancel(p_project uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','comercial');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update public.projects set stage = 'cancelado', cancel_reason = p_reason, released_version_id = null, released_at = null
   where id = p_project and stage not in ('cancelado','recusado');
  if not found then raise exception 'invalid_transition'; end if;
  perform app.project_event(p_project, 'cancelado', '{}'::jsonb, p_reason);
end $$;

create or replace function public.project_version_create(p_project uuid, p_requirements text default null, p_specs jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.projects; last public.project_versions; v uuid;
begin
  perform app.require_any_role('admin','comercial','producao');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'project_not_found'; end if;
  if p.stage in ('cancelado','recusado') then raise exception 'invalid_transition'; end if;
  if exists (select 1 from public.project_versions where project_id = p_project and status = 'rascunho') then raise exception 'draft_exists'; end if;
  select * into last from public.project_versions where project_id = p_project order by version desc limit 1;
  insert into public.project_versions (project_id, version, requirements, specs)
  values (p_project, coalesce(last.version, 0) + 1, coalesce(p_requirements, last.requirements, ''), coalesce(p_specs, last.specs, '{}'::jsonb)) returning id into v;
  return v;
end $$;

create or replace function public.project_version_send(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare pv public.project_versions; p public.projects; v_had_approved boolean;
begin
  perform app.require_any_role('admin','comercial','producao');
  select * into pv from public.project_versions where id = p_version for update;
  if not found then raise exception 'version_not_found'; end if;
  if pv.status <> 'rascunho' then raise exception 'not_draft'; end if;
  if coalesce(btrim(pv.requirements), '') = '' then raise exception 'requirements_required'; end if;
  select * into p from public.projects where id = pv.project_id for update;
  if p.stage in ('briefing','viabilidade') then raise exception 'wrong_stage'; end if;
  v_had_approved := exists (select 1 from public.project_versions where project_id = pv.project_id and status = 'aprovada');
  update public.project_versions set status = 'substituida' where project_id = pv.project_id and status in ('enviada','aprovada') and id <> p_version;
  update public.project_versions set status = 'enviada', sent_at = now() where id = p_version;
  if v_had_approved and p.stage in ('desenvolvimento','amostra','aprovacao_amostra','liberado') then
    -- mudou o projeto técnico: aprovação, amostra e liberação anteriores deixam de valer
    update public.projects set stage = 'proposta', released_version_id = null, released_at = null where id = pv.project_id;
    perform app.project_event(pv.project_id, 'aprovacao_revogada', jsonb_build_object('nova_versao', pv.version), 'Nova versão técnica: exige nova aprovação e nova amostra');
  end if;
  perform app.project_event(pv.project_id, 'versao_enviada', jsonb_build_object('versao', pv.version));
end $$;

create or replace function public.portal_approve_project_version(p_version uuid, p_ip text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare pv public.project_versions; v_customer uuid;
begin
  select * into pv from public.project_versions where id = p_version for update;
  if not found then raise exception 'not_found'; end if;
  select customer_id into v_customer from public.projects where id = pv.project_id;
  if v_customer not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(v_customer) is distinct from 'aprovador' then raise exception 'forbidden' using errcode = '42501'; end if;
  if pv.status = 'aprovada' then return; end if;                       -- duplo clique
  if pv.status <> 'enviada' then raise exception 'not_approvable'; end if;
  update public.project_versions set status = 'aprovada', approved_by = auth.uid(), approved_at = now(), approved_ip = p_ip, approved_via = 'portal' where id = p_version;
  perform app.project_event(pv.project_id, 'versao_aprovada', jsonb_build_object('versao', pv.version, 'via', 'portal'));
end $$;

create or replace function public.project_version_approve_offline(p_version uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare pv public.project_versions;
begin
  perform app.require_any_role('admin','gestor','comercial');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  select * into pv from public.project_versions where id = p_version for update;
  if not found or pv.status <> 'enviada' then raise exception 'not_approvable'; end if;
  update public.project_versions set status = 'aprovada', approved_by = auth.uid(), approved_at = now(), approved_via = 'interno', approved_note = p_note where id = p_version;
  perform app.project_event(pv.project_id, 'versao_aprovada', jsonb_build_object('versao', pv.version, 'via', 'interno'), p_note);
end $$;

create or replace function public.portal_request_project_change(p_version uuid, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare pv public.project_versions; v_customer uuid;
begin
  select * into pv from public.project_versions where id = p_version;
  if not found then raise exception 'not_found'; end if;
  select customer_id into v_customer from public.projects where id = pv.project_id;
  if v_customer not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(v_customer) is distinct from 'aprovador' then raise exception 'forbidden' using errcode = '42501'; end if;
  if pv.status <> 'enviada' then raise exception 'not_open'; end if;
  insert into public.project_change_requests (project_id, version_id, requested_by, message) values (pv.project_id, p_version, auth.uid(), p_message);
  perform app.project_event(pv.project_id, 'alteracao_solicitada', jsonb_build_object('versao', pv.version), p_message);
end $$;

create or replace function public.project_file_add(p_project uuid, p_kind text, p_title text, p_url text, p_notes text default null,
                                                   p_visible boolean default false, p_version_no int default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_any_role('admin','comercial','producao');
  insert into public.project_files (project_id, version_no, kind, title, url, notes, visible_to_customer)
  values (p_project, p_version_no, coalesce(p_kind, 'outro'), p_title, p_url, p_notes, coalesce(p_visible, false)) returning id into v;
  perform app.project_event(p_project, 'arquivo', jsonb_build_object('titulo', p_title));
  return v;
end $$;

create or replace function public.project_sample_create(p_project uuid, p_notes text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.projects; v_ver uuid; v uuid;
begin
  perform app.require_any_role('admin','producao');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'project_not_found'; end if;
  if p.stage not in ('desenvolvimento','amostra','aprovacao_amostra') then raise exception 'wrong_stage'; end if;
  v_ver := app.approved_version(p_project);
  if v_ver is null then raise exception 'version_not_approved'; end if;
  insert into public.project_samples (project_id, version_id, number, notes)
  values (p_project, v_ver, coalesce((select max(number) from public.project_samples where project_id = p_project), 0) + 1, p_notes) returning id into v;
  perform app.project_event(p_project, 'amostra_criada');
  return v;
end $$;

create or replace function public.project_sample_send(p_sample uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.project_samples;
begin
  perform app.require_any_role('admin','producao');
  update public.project_samples set status = 'enviada', sent_at = now() where id = p_sample and status = 'em_producao' returning * into s;
  if not found then raise exception 'not_sendable'; end if;
  perform app.project_event(s.project_id, 'amostra_enviada', jsonb_build_object('numero', s.number));
end $$;

create or replace function public.portal_decide_sample(p_sample uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.project_samples; v_customer uuid;
begin
  select * into s from public.project_samples where id = p_sample for update;
  if not found then raise exception 'not_found'; end if;
  select customer_id into v_customer from public.projects where id = s.project_id;
  if v_customer not in (select app.my_customers()) then raise exception 'not_found'; end if;
  if app.customer_level(v_customer) is distinct from 'aprovador' then raise exception 'forbidden' using errcode = '42501'; end if;
  if s.status <> 'enviada' then raise exception 'not_open'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update public.project_samples set status = case when p_approve then 'aprovada' else 'reprovada' end, decided_by = auth.uid(),
         decided_at = now(), decided_via = 'portal', decision_note = p_note where id = p_sample;
  perform app.project_event(s.project_id, case when p_approve then 'amostra_aprovada' else 'amostra_reprovada' end, jsonb_build_object('numero', s.number, 'via', 'portal'), p_note);
end $$;

create or replace function public.project_sample_decide_internal(p_sample uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.project_samples;
begin
  perform app.require_any_role('admin','gestor','comercial');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update public.project_samples set status = case when p_approve then 'aprovada' else 'reprovada' end, decided_by = auth.uid(),
         decided_at = now(), decided_via = 'interno', decision_note = p_note where id = p_sample and status = 'enviada' returning * into s;
  if not found then raise exception 'not_open'; end if;
  perform app.project_event(s.project_id, case when p_approve then 'amostra_aprovada' else 'amostra_reprovada' end, jsonb_build_object('numero', s.number, 'via', 'interno'), p_note);
end $$;

create or replace function public.project_create_item(p_project uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare p public.projects; v uuid;
begin
  perform app.require_any_role('admin','gestor','comercial');
  select * into p from public.projects where id = p_project for update;
  if not found then raise exception 'project_not_found'; end if;
  if p.item_id is not null then return p.item_id; end if;                     -- idempotente
  insert into public.items (type, sku, name, description, exclusive_customer_id, store_published)
  values ('produto_acabado', 'EXC-' || p.number, p.title, 'Produto exclusivo do projeto ' || p.number, p.customer_id, false) returning id into v;
  update public.projects set item_id = v where id = p_project;
  perform app.project_event(p_project, 'item_criado', jsonb_build_object('sku', 'EXC-' || p.number));
  return v;
end $$;

-- ---------- Integração com pedido e produção ----------
create or replace function public.order_release_checks(p_order uuid)
returns table (rule text, ok boolean, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; v_status public.quote_status; r record;
begin
  perform app.require_any_role('admin','gestor','comercial','producao','estoque','financeiro');
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'order_not_found'; end if;
  if o.channel = 'orcamento' then
    select status into v_status from public.quote_versions where id = o.quote_version_id;
    rule := 'orcamento_aprovado'; ok := v_status = 'aprovado'; detail := 'Versão do orçamento aprovada'; return next;
    rule := 'sinal_recebido';
    ok := (not o.deposit_required) or o.status_financial in ('sinal_pago','quitado');
    detail := case when o.deposit_required then 'Sinal de ' || o.deposit_pct || '% (R$ ' || o.deposit_amount || ') validado pelo Financeiro'
                   else 'Sinal não exigido' end;
    return next;
  else
    rule := 'pagamento_integral'; ok := o.status_financial = 'quitado'; detail := 'Loja: pagamento integral confirmado'; return next;
  end if;
  for r in select distinct p.id, p.number, p.stage from public.order_items oi
           join public.items i on i.id = oi.item_id join public.projects p on p.item_id = i.id
           where oi.order_id = p_order and i.exclusive_customer_id is not null loop
    rule := 'aprovacao_tecnica'; ok := r.stage = 'liberado';
    detail := 'Projeto exclusivo ' || r.number || ' liberado (versão técnica e amostra aprovadas)'; return next;
  end loop;
end $$;

create or replace function public.production_release(p_po uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare po public.production_orders; o public.orders; v_stage text;
begin
  perform app.require_any_role('admin','gestor','producao');
  select * into po from public.production_orders where id = p_po for update;
  if not found then raise exception 'po_not_found'; end if;
  if po.status <> 'planejada' then raise exception 'not_planned'; end if;
  select o2.* into o from public.orders o2 join public.order_items oi on oi.order_id = o2.id where oi.id = po.order_item_id;
  if o.status_commercial = 'cancelado' then raise exception 'order_cancelled'; end if;
  if o.status_production not in ('liberado','programado','em_producao','parcial') then raise exception 'order_not_released'; end if;
  -- item exclusivo: só com o projeto liberado, e na versão que acompanha o pedido
  if exists (select 1 from public.items where id = po.item_id and exclusive_customer_id is not null) then
    select p.stage into v_stage from public.projects p where p.item_id = po.item_id;
    if v_stage is distinct from 'liberado' then raise exception 'project_not_released'; end if;
  end if;
  update public.production_orders set status = 'liberada' where id = p_po;
end $$;

create or replace function app.create_order_from_version(p_version uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions; q public.quotes; o uuid;
begin
  select * into v from public.quote_versions where id = p_version for update;
  if not found or v.status <> 'aprovado' then raise exception 'version_not_approved'; end if;
  select id into o from public.orders where quote_version_id = p_version;
  if o is not null then return o; end if;

  select * into q from public.quotes where id = v.quote_id;
  insert into public.orders (number, customer_id, quote_version_id, channel, seller_id, deposit_required,
                             deposit_pct, status_financial, total, freight_mode, carrier_name)
  values (app.next_number('PED'), q.customer_id, v.id, 'orcamento', q.seller_id, v.deposit_required,
          v.deposit_pct, case when v.deposit_required and v.deposit_pct > 0 then 'aguardando_sinal' else 'sem_cobranca' end,
          v.total, v.freight_mode, v.carrier_name)
  on conflict (quote_version_id) do nothing
  returning id into o;
  if o is null then select id into o from public.orders where quote_version_id = p_version; return o; end if;

  with ins as (
    insert into public.order_items (order_id, item_id, description, specs, qty, unit_price, position)
    select o, qi.item_id, qi.description, qi.specs, qi.qty, qi.unit_price, qi.position
    from public.quote_items qi where qi.version_id = p_version order by qi.position, qi.id
    returning id, position, description, qty, unit_price
  )
  insert into public.order_item_costs (order_item_id, unit_cost)
  select ins.id, (select qi.unit_cost from public.quote_items qi
                  where qi.version_id = p_version and qi.position = ins.position
                    and qi.description = ins.description and qi.qty = ins.qty and qi.unit_price = ins.unit_price
                  order by qi.id limit 1)
  from ins;

  -- item exclusivo: o pedido carrega a versão técnica aprovada do projeto liberado
  update public.order_items oi set project_version_id = p.released_version_id
    from public.projects p where oi.order_id = o and p.item_id = oi.item_id and p.released_version_id is not null;

  insert into public.order_events (order_id, actor, kind, detail)
  values (o, auth.uid(), 'nota', jsonb_build_object('origem', 'orcamento', 'quote_version_id', p_version));
  return o;
end $$;

-- ---------- updated_at e auditoria ----------
create trigger trg_projects_updated before update on public.projects for each row execute function app.set_updated_at();
do $$
declare t text;
begin
  foreach t in array array['projects','project_costs','project_versions','project_files','project_samples','project_change_requests'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$s for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- ---------- RLS ----------
alter table public.projects                enable row level security;
alter table public.project_costs           enable row level security;
alter table public.project_versions        enable row level security;
alter table public.project_files           enable row level security;
alter table public.project_samples         enable row level security;
alter table public.project_change_requests enable row level security;
alter table public.project_events          enable row level security;

create policy prj_select on public.projects for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));
create policy prj_update on public.projects for update to authenticated
  using (app.has_any_role('admin','comercial','producao')) with check (app.has_any_role('admin','comercial','producao'));
create policy prjc_select on public.project_costs for select to authenticated using (app.has_any_role('admin','gestor','comercial'));
create policy prjc_write on public.project_costs for all to authenticated
  using (app.has_any_role('admin','gestor','comercial')) with check (app.has_any_role('admin','gestor','comercial'));
create policy pver_select on public.project_versions for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));
create policy pfile_select on public.project_files for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));
create policy pfile_update on public.project_files for update to authenticated
  using (app.has_any_role('admin','comercial','producao')) with check (app.has_any_role('admin','comercial','producao'));
create policy psamp_select on public.project_samples for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));
create policy pcr_select on public.project_change_requests for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));
create policy pev_select on public.project_events for select to authenticated using (app.has_any_role('admin','gestor','comercial','producao'));

revoke all on public.projects, public.project_costs, public.project_versions, public.project_files, public.project_samples,
  public.project_change_requests, public.project_events from anon, authenticated;
grant select on public.projects, public.project_versions, public.project_samples, public.project_change_requests, public.project_events to authenticated;
grant select, insert, update on public.project_costs to authenticated;
grant select on public.project_files to authenticated;
grant update (active, visible_to_customer, notes) on public.project_files to authenticated;
grant update (title, briefing, requirements, due_date, owner_id, mold_id, development_price, mold_price, sample_price, charge_notes) on public.projects to authenticated;

-- ---------- Portal ----------
create or replace view public.portal_projects as
  select p.id, p.number, p.title, p.stage, p.due_date, p.development_price, p.mold_price, p.sample_price, p.charge_notes, p.released_at
  from public.projects p where p.customer_id in (select app.my_customers());
create or replace view public.portal_project_versions as
  select v.id, v.project_id, v.version, v.requirements, v.specs, v.status, v.sent_at, v.approved_at
  from public.project_versions v join public.projects p on p.id = v.project_id
  where p.customer_id in (select app.my_customers()) and v.status <> 'rascunho';
create or replace view public.portal_project_files as
  select f.id, f.project_id, f.version_no, f.kind, f.title, f.url, f.notes
  from public.project_files f join public.projects p on p.id = f.project_id
  where p.customer_id in (select app.my_customers()) and f.visible_to_customer and f.active;
create or replace view public.portal_project_samples as
  select s.id, s.project_id, s.number, s.status, s.notes, s.sent_at, s.decided_at, s.decision_note
  from public.project_samples s join public.projects p on p.id = s.project_id
  where p.customer_id in (select app.my_customers()) and s.status <> 'em_producao';
revoke all on public.portal_projects, public.portal_project_versions, public.portal_project_files, public.portal_project_samples from anon;
grant select on public.portal_projects, public.portal_project_versions, public.portal_project_files, public.portal_project_samples to authenticated;

-- ---------- Execução ----------
revoke all on function
  public.project_create(uuid, text, text, uuid), public.project_set_feasibility(uuid, boolean, text), public.project_advance(uuid, text, text),
  public.project_cancel(uuid, text), public.project_version_create(uuid, text, jsonb), public.project_version_send(uuid),
  public.portal_approve_project_version(uuid, text), public.project_version_approve_offline(uuid, text),
  public.portal_request_project_change(uuid, text), public.project_file_add(uuid, text, text, text, text, boolean, int),
  public.project_sample_create(uuid, text), public.project_sample_send(uuid), public.portal_decide_sample(uuid, boolean, text),
  public.project_sample_decide_internal(uuid, boolean, text), public.project_create_item(uuid) from public, anon;
grant execute on function
  public.project_create(uuid, text, text, uuid), public.project_set_feasibility(uuid, boolean, text), public.project_advance(uuid, text, text),
  public.project_cancel(uuid, text), public.project_version_create(uuid, text, jsonb), public.project_version_send(uuid),
  public.portal_approve_project_version(uuid, text), public.project_version_approve_offline(uuid, text),
  public.portal_request_project_change(uuid, text), public.project_file_add(uuid, text, text, text, text, boolean, int),
  public.project_sample_create(uuid, text), public.project_sample_send(uuid), public.portal_decide_sample(uuid, boolean, text),
  public.project_sample_decide_internal(uuid, boolean, text), public.project_create_item(uuid) to authenticated;
revoke all on function app.approved_version(uuid), app.project_event(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function app.approved_version(uuid), app.project_event(uuid, text, jsonb, text) to service_role;
revoke all on function public.order_release_checks(uuid), public.production_release(uuid) from public, anon;
grant execute on function public.order_release_checks(uuid), public.production_release(uuid) to authenticated, service_role;

-- ########## 20261127000010_backfill_profiles.sql ##########
-- =====================================================================
-- Migração 0010: cria o perfil interno de logins que já existiam no Supabase Auth
-- (criados antes das tabelas). Não concede nenhum papel: o administrador é definido
-- pela tela /setup (com a palavra secreta) ou por outro administrador.
-- =====================================================================
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ########## 20261127000011_store.sql ##########
-- =====================================================================
-- Migração 0011: loja on-line (compra sem login), pagamento, expiração e devolução
-- Decisões da empresa: vende só estoque físico produzido; preço = faixa 1 (1–300); até 300 peças por produto;
-- pagamento à vista (Pix/cartão); frete FOB indicado pelo cliente ou retirada; NF emitida manualmente;
-- arrependimento de 7 dias, reembolso só após a nota de devolução; pedido já reservado tem prioridade no estoque.
-- A compra é feita SEM login: tudo passa por funções que só o servidor (service_role) executa.
-- =====================================================================

alter table public.items add column image_url text check (image_url is null or image_url ~* '^https?://');

insert into public.settings (key, value, description) values
  ('loja_min_qty_por_pedido', '1',   'DECISÃO PENDENTE: quantidade mínima por produto em cada compra na loja.'),
  ('loja_reserva_horas',      '24',  'DECISÃO PENDENTE: horas que um pedido da loja espera o pagamento antes de ser cancelado (libera o estoque).'),
  ('loja_conta_recebimento',  'null','Conta (id) onde entram os recebimentos da loja. Se vazio, usa a única conta ativa, caso exista só uma.')
on conflict (key) do nothing;
update public.settings set description = 'Quantidade máxima POR PRODUTO em cada compra da loja; acima disso, consultar vendedor.' where key = 'loja_max_qty_por_pedido';

alter table public.orders add column public_token text unique;     -- link de acompanhamento do comprador (sem login)
alter table public.orders add column expires_at timestamptz;
alter table public.orders add column ip_hash text;
alter table public.orders add column shipping jsonb not null default '{}'::jsonb;

create table public.store_payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete restrict,
  provider    text not null default 'infinitepay',
  external_ref text,
  checkout_url text,
  amount      numeric(14,2),
  status      text not null default 'pendente' check (status in ('pendente','pago','conflito')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index store_payments_ref_uk on public.store_payments (provider, external_ref) where external_ref is not null;

create table public.store_returns (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders(id) on delete restrict,
  reason                text not null check (btrim(reason) <> ''),
  status                text not null default 'solicitada' check (status in ('solicitada','recebida','reembolsada','recusada')),
  requested_at          timestamptz not null default now(),
  return_invoice_number text,
  received_at           timestamptz,
  refund_title_id       uuid references public.financial_titles(id),
  note                  text,
  handled_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now()
);
create unique index store_returns_one_open on public.store_returns (order_id) where status in ('solicitada','recebida');

-- ---------- Disponibilidade: físico menos o que ainda falta entregar em pedidos abertos ----------
create or replace function app.store_available(p_item uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select greatest(0,
    coalesce((select sum(qty) from public.stock_movements where item_id = p_item), 0)
    - coalesce((select sum(oi.qty - oi.qty_shipped) from public.order_items oi join public.orders o on o.id = oi.order_id
                where oi.item_id = p_item and o.status_commercial <> 'cancelado' and oi.qty > oi.qty_shipped), 0))
$$;

-- ---------- title_pay também pode ser chamada pelo servidor (confirmação automática de pagamento) ----------
create or replace function public.title_pay(p_title uuid, p_account uuid, p_amount numeric, p_paid_on date,
  p_interest numeric default 0, p_fine numeric default 0, p_discount numeric default 0,
  p_note text default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t public.financial_titles; v_id uuid; v_sign int;
begin
  if auth.role() is distinct from 'service_role' then perform app.require_any_role('admin','financeiro'); end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  select id into v_id from public.payments where idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  select * into t from public.financial_titles where id = p_title for update;
  if not found then raise exception 'title_not_found'; end if;
  if t.status in ('pago','cancelado') then raise exception 'title_closed'; end if;
  if not exists (select 1 from public.bank_accounts where id = p_account and active) then raise exception 'account_not_found'; end if;
  p_amount := coalesce(p_amount, 0); p_interest := coalesce(p_interest, 0); p_fine := coalesce(p_fine, 0); p_discount := coalesce(p_discount, 0);
  if p_amount < 0 or p_interest < 0 or p_fine < 0 or p_discount < 0 or p_amount + p_discount <= 0 then raise exception 'invalid_amount'; end if;
  if t.settled + p_amount + p_discount > t.amount then raise exception 'exceeds_balance'; end if;
  v_sign := case t.kind when 'receber' then 1 else -1 end;

  insert into public.payments (title_id, account_id, paid_on, amount, interest, fine, discount, note, idempotency_key)
  values (p_title, p_account, coalesce(p_paid_on, current_date), p_amount, p_interest, p_fine, p_discount, p_note, p_key) returning id into v_id;
  if p_amount > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id, note)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_amount, case t.kind when 'receber' then 'recebimento' else 'pagamento' end, p_title, v_id, p_note);
  end if;
  if p_interest > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_interest, 'juros', p_title, v_id);
  end if;
  if p_fine > 0 then
    insert into public.cash_movements (movement_date, account_id, amount, kind, title_id, payment_id)
    values (coalesce(p_paid_on, current_date), p_account, v_sign * p_fine, 'multa', p_title, v_id);
  end if;
  update public.financial_titles set settled = settled + p_amount + p_discount, discount_total = discount_total + p_discount where id = p_title;
  perform app.sync_title(p_title);
  if t.origin_type = 'order' then perform app.sync_order_financial(t.origin_id); end if;
  return v_id;
end $$;

-- ---------- Funções da loja (somente servidor) ----------
create or replace function app.require_service() returns void
language plpgsql stable as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
end $$;

create or replace function public.store_expire_unpaid() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.role() is distinct from 'service_role' and not app.has_any_role('admin','gestor','financeiro') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  with exp as (
    update public.orders o set status_commercial = 'cancelado', cancelled_at = now(), cancel_reason = 'Pagamento não confirmado no prazo'
     where o.channel = 'loja' and o.status_commercial <> 'cancelado' and o.status_financial = 'aguardando_sinal'
       and o.expires_at is not null and o.expires_at < now()
       and not exists (select 1 from public.payments p join public.financial_titles t on t.id = p.title_id
                        where t.origin_type = 'order' and t.origin_id = o.id and not p.reversed)
    returning o.id)
  update public.financial_titles t set status = 'cancelado', cancel_reason = 'Pedido da loja expirou sem pagamento'
   where t.origin_type = 'order' and t.origin_id in (select id from exp) and t.status = 'aberto';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.store_catalog() returns table (item_id uuid, sku text, name text, description text, category text,
  material text, capacity_ml numeric, weight_g numeric, dimensions jsonb, image_url text, min_qty int, qty_multiple int, price numeric, available int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_service();
  return query
    select i.id, i.sku, i.name, i.description, i.category, i.material, i.capacity_ml, i.weight_g, i.dimensions, i.image_url,
           greatest(i.min_qty, coalesce(app.setting_num('loja_min_qty_por_pedido'), 1)::int), i.qty_multiple, pt.price,
           floor(app.store_available(i.id))::int
    from public.items i join public.price_tiers pt on pt.item_id = i.id and pt.tier_id = 1
    where i.store_published and i.active and i.exclusive_customer_id is null and i.type = 'produto_acabado'
    order by i.category nulls last, i.name;
end $$;

create or replace function public.store_create_order(p_buyer jsonb, p_items jsonb, p_ip_hash text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_max numeric := coalesce(app.setting_num('loja_max_qty_por_pedido'), 300);
  v_min numeric := coalesce(app.setting_num('loja_min_qty_por_pedido'), 1);
  v_hours numeric := coalesce(app.setting_num('loja_reserva_horas'), 24);
  b_name text := btrim(coalesce(p_buyer ->> 'name', ''));
  b_tax text := app.digits(p_buyer ->> 'tax_id');
  b_phone text := btrim(coalesce(p_buyer ->> 'phone', ''));
  b_email text := lower(btrim(coalesce(p_buyer ->> 'email', '')));
  b_mode text := coalesce(p_buyer ->> 'freight_mode', '');
  b_carrier text := btrim(coalesce(p_buyer ->> 'carrier_name', ''));
  v_customer uuid; v_contact uuid; v_order uuid; v_number text; v_token text; v_total numeric := 0;
  r record; it public.items; v_price numeric; v_qty int;
begin
  perform app.require_service();
  if p_ip_hash is not null and (select count(*) from public.orders where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  if length(b_name) < 2 then raise exception 'name_required'; end if;
  if not app.valid_tax_id(b_tax) then raise exception 'invalid_tax_id'; end if;
  if length(app.digits(b_phone)) < 10 and b_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'contact_required'; end if;
  if b_mode not in ('fob','retirada') then raise exception 'invalid_shipping'; end if;
  if b_mode = 'fob' and b_carrier = '' then raise exception 'carrier_required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 20 then raise exception 'no_items'; end if;

  -- agrupa linhas do mesmo produto e trava cada produto para não vender o mesmo estoque duas vezes
  for r in select (e ->> 'item_id')::uuid as item_id, sum((e ->> 'qty')::int) as qty
           from jsonb_array_elements(p_items) e group by 1 order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(r.item_id::text, 3));
    select * into it from public.items where id = r.item_id;
    if not found or not it.active or not it.store_published or it.exclusive_customer_id is not null or it.type <> 'produto_acabado' then
      raise exception 'item_unavailable';
    end if;
    v_qty := r.qty;
    if v_qty < 1 then raise exception 'invalid_qty'; end if;
    if v_qty < greatest(it.min_qty, v_min) then raise exception 'below_minimum'; end if;
    if v_qty % it.qty_multiple <> 0 then raise exception 'invalid_multiple'; end if;
    if v_qty > v_max then raise exception 'above_limit'; end if;
    select price into v_price from public.price_tiers where item_id = r.item_id and tier_id = 1;
    if v_price is null then raise exception 'no_price'; end if;
    if app.store_available(r.item_id) < v_qty then raise exception 'insufficient_stock'; end if;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  -- cliente: reaproveita por CPF/CNPJ, senão por telefone/e-mail
  select id into v_customer from public.customers where tax_id = b_tax;
  if v_customer is null then
    select ct.customer_id into v_customer from public.contacts ct where ct.active and (
      (length(app.digits(b_phone)) >= 10 and (app.digits(ct.phone) = app.digits(b_phone) or app.digits(ct.whatsapp) = app.digits(b_phone)))
      or (b_email <> '' and lower(ct.email) = b_email)) order by ct.created_at limit 1;
  end if;
  if v_customer is null then
    insert into public.customers (legal_name, tax_id, origin, created_by) values (b_name, b_tax, 'loja', null) returning id into v_customer;
  end if;
  select id into v_contact from public.contacts where customer_id = v_customer and active
     and ((b_email <> '' and lower(email) = b_email) or (length(app.digits(b_phone)) >= 10 and app.digits(phone) = app.digits(b_phone))) limit 1;
  if v_contact is null then
    insert into public.contacts (customer_id, name, phone, whatsapp, email) values (v_customer, b_name, nullif(b_phone, ''), nullif(b_phone, ''), nullif(b_email, ''));
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_number := app.next_number('PED');
  insert into public.orders (number, customer_id, channel, status_financial, deposit_required, deposit_pct, total, freight_mode, carrier_name,
                             public_token, expires_at, ip_hash, shipping)
  values (v_number, v_customer, 'loja', 'aguardando_sinal', true, 100, v_total, b_mode, nullif(b_carrier, ''), v_token,
          now() + (v_hours || ' hours')::interval, p_ip_hash,
          jsonb_build_object('buyer', b_name, 'phone', b_phone, 'email', b_email, 'note', left(coalesce(p_buyer ->> 'note', ''), 500)))
  returning id into v_order;

  for r in select (e ->> 'item_id')::uuid as item_id, sum((e ->> 'qty')::int) as qty
           from jsonb_array_elements(p_items) e group by 1 order by 1 loop
    select * into it from public.items where id = r.item_id;
    select price into v_price from public.price_tiers where item_id = r.item_id and tier_id = 1;
    insert into public.order_items (order_id, item_id, description, qty, unit_price, position)
    values (v_order, r.item_id, it.name || ' (' || it.sku || ')', r.qty::int, v_price, 0);
  end loop;

  insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence, customer_id)
  values ('receber', 'order', v_order, 1, 'Pedido ' || v_number || ' (loja)', v_total, current_date, date_trunc('month', current_date)::date, v_customer);
  insert into public.order_events (order_id, kind, detail) values (v_order, 'nota', jsonb_build_object('origem', 'loja'));
  return jsonb_build_object('order_id', v_order, 'number', v_number, 'token', v_token, 'total', v_total, 'expires_at', now() + (v_hours || ' hours')::interval);
end $$;

create or replace function public.store_set_checkout(p_order uuid, p_provider text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_service();
  insert into public.store_payments (order_id, provider, checkout_url) values (p_order, coalesce(p_provider, 'infinitepay'), p_url);
end $$;

create or replace function public.store_confirm_payment(p_order_number text, p_provider text, p_ref text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; t public.financial_titles; v_account uuid; v_txt text; v_n int;
begin
  perform app.require_service();
  if coalesce(btrim(p_ref), '') = '' then raise exception 'key_required'; end if;
  select * into o from public.orders where number = p_order_number and channel = 'loja' for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_financial = 'quitado' then return jsonb_build_object('ok', true, 'already', true); end if;
  if p_amount is null or p_amount < o.total then raise exception 'amount_mismatch'; end if;
  if o.status_commercial = 'cancelado' then
    -- pagou depois de o pedido expirar: não baixa nada; fica registrado como conflito para o Financeiro tratar
    insert into public.store_payments (order_id, provider, external_ref, amount, status) values (o.id, coalesce(p_provider, 'infinitepay'), p_ref, p_amount, 'conflito')
      on conflict do nothing;
    return jsonb_build_object('ok', false, 'reason', 'order_cancelled');
  end if;
  select nullif(value #>> '{}', 'null') into v_txt from public.settings where key = 'loja_conta_recebimento';
  if v_txt is not null then v_account := v_txt::uuid;
  else
    select count(*) into v_n from public.bank_accounts where active;
    if v_n = 1 then select id into v_account from public.bank_accounts where active; end if;
  end if;
  if v_account is null then raise exception 'account_required'; end if;
  select * into t from public.financial_titles where origin_type = 'order' and origin_id = o.id and kind = 'receber' and installment = 1 and status in ('aberto','parcial');
  if not found then raise exception 'title_not_found'; end if;
  perform public.title_pay(t.id, v_account, t.amount - t.settled, current_date, 0, 0, 0, 'Loja · ' || coalesce(p_provider, 'infinitepay') || ' ' || p_ref, 'loja:' || p_ref);
  insert into public.store_payments (order_id, provider, external_ref, amount, status) values (o.id, coalesce(p_provider, 'infinitepay'), p_ref, p_amount, 'pago')
    on conflict do nothing;
  update public.store_payments set status = 'pago', updated_at = now() where order_id = o.id and status = 'pendente';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.store_order_by_token(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v_cust text;
begin
  perform app.require_service();
  select * into o from public.orders where public_token = p_token and channel = 'loja';
  if not found then return null; end if;
  select legal_name into v_cust from public.customers where id = o.customer_id;
  return jsonb_build_object(
    'number', o.number, 'buyer', v_cust, 'total', o.total, 'created_at', o.created_at, 'expires_at', o.expires_at,
    'status_commercial', o.status_commercial, 'status_financial', o.status_financial, 'status_production', o.status_production,
    'status_logistics', o.status_logistics, 'freight_mode', o.freight_mode, 'carrier_name', o.carrier_name,
    'invoice_number', o.invoice_number, 'received_at', o.received_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('description', oi.description, 'qty', oi.qty, 'unit_price', oi.unit_price, 'line_total', oi.line_total, 'qty_shipped', oi.qty_shipped) order by oi.position, oi.id)
                       from public.order_items oi where oi.order_id = o.id), '[]'::jsonb),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object('number', s.number, 'status', s.status, 'scheduled_at', s.scheduled_at, 'collected_at', s.collected_at, 'tracking', s.tracking) order by s.created_at)
                           from public.shipments s where s.order_id = o.id and s.status <> 'cancelado'), '[]'::jsonb),
    'checkout_url', (select checkout_url from public.store_payments where order_id = o.id and checkout_url is not null order by created_at desc limit 1),
    'return', (select jsonb_build_object('status', r.status, 'requested_at', r.requested_at) from public.store_returns r where r.order_id = o.id order by r.requested_at desc limit 1),
    'return_deadline', case when o.received_at is not null then o.received_at + (coalesce(app.setting_num('devolucao_dias'), 7) || ' days')::interval end
  );
end $$;

create or replace function public.store_request_return(p_token text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare o public.orders; v uuid;
begin
  perform app.require_service();
  if coalesce(btrim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into o from public.orders where public_token = p_token and channel = 'loja' for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status_financial <> 'quitado' or o.received_at is null then raise exception 'not_received'; end if;
  if now() > o.received_at + (coalesce(app.setting_num('devolucao_dias'), 7) || ' days')::interval then raise exception 'return_window_closed'; end if;
  begin
    insert into public.store_returns (order_id, reason) values (o.id, p_reason) returning id into v;
  exception when unique_violation then raise exception 'already_requested';
  end;
  insert into public.order_events (order_id, kind, detail, note) values (o.id, 'nota', jsonb_build_object('devolucao', 'solicitada'), p_reason);
  return v;
end $$;

create or replace function public.store_return_receive(p_return uuid, p_invoice text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor','estoque','financeiro');
  if coalesce(btrim(p_invoice), '') = '' then raise exception 'invoice_required'; end if;
  update public.store_returns set status = 'recebida', return_invoice_number = btrim(p_invoice), received_at = now(), note = p_note, handled_by = auth.uid(), updated_at = now()
   where id = p_return and status = 'solicitada';
  if not found then raise exception 'invalid_transition'; end if;
end $$;

create or replace function public.store_return_refuse(p_return uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','gestor');
  if coalesce(btrim(p_note), '') = '' then raise exception 'note_required'; end if;
  update public.store_returns set status = 'recusada', note = p_note, handled_by = auth.uid(), updated_at = now()
   where id = p_return and status in ('solicitada','recebida');
  if not found then raise exception 'invalid_transition'; end if;
end $$;

-- Reembolso: só depois que a mercadoria voltou com a nota de devolução; cria a conta a pagar (o pagamento é feito no Financeiro)
create or replace function public.store_return_refund(p_return uuid, p_amount numeric default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.store_returns; o public.orders; v_amt numeric; v_title uuid;
begin
  perform app.require_any_role('admin','financeiro');
  select * into r from public.store_returns where id = p_return for update;
  if not found then raise exception 'return_not_found'; end if;
  if r.status <> 'recebida' or coalesce(r.return_invoice_number, '') = '' then raise exception 'invoice_required'; end if;
  select * into o from public.orders where id = r.order_id;
  v_amt := coalesce(p_amount, o.total);
  if v_amt <= 0 or v_amt > o.total then raise exception 'invalid_amount'; end if;
  insert into public.financial_titles (kind, origin_type, installment, description, amount, due_date, competence, customer_id)
  values ('pagar', 'manual', 1, 'Reembolso do pedido ' || o.number || ' (devolução, NF ' || r.return_invoice_number || ')', v_amt,
          coalesce(p_due, current_date), date_trunc('month', current_date)::date, o.customer_id) returning id into v_title;
  update public.store_returns set status = 'reembolsada', refund_title_id = v_title, handled_by = auth.uid(), updated_at = now() where id = p_return;
  return v_title;
end $$;

-- ---------- updated_at, auditoria, RLS ----------
create trigger trg_store_payments_updated before update on public.store_payments for each row execute function app.set_updated_at();
create trigger trg_store_returns_updated before update on public.store_returns for each row execute function app.set_updated_at();
create trigger trg_audit_store_payments after insert or update or delete on public.store_payments for each row execute function app.audit_row();
create trigger trg_audit_store_returns after insert or update or delete on public.store_returns for each row execute function app.audit_row();

alter table public.store_payments enable row level security;
alter table public.store_returns  enable row level security;
create policy sp_select on public.store_payments for select to authenticated using (app.has_any_role('admin','gestor','financeiro'));
create policy sr_select on public.store_returns for select to authenticated using (app.has_any_role('admin','gestor','comercial','financeiro','estoque'));
revoke all on public.store_payments, public.store_returns from anon, authenticated;
grant select on public.store_payments, public.store_returns to authenticated;

-- ---------- Execução ----------
revoke all on function public.store_catalog(), public.store_create_order(jsonb, jsonb, text), public.store_set_checkout(uuid, text, text),
  public.store_confirm_payment(text, text, text, numeric), public.store_order_by_token(text), public.store_request_return(text, text),
  public.store_expire_unpaid() from public, anon, authenticated;
grant execute on function public.store_catalog(), public.store_create_order(jsonb, jsonb, text), public.store_set_checkout(uuid, text, text),
  public.store_confirm_payment(text, text, text, numeric), public.store_order_by_token(text), public.store_request_return(text, text),
  public.store_expire_unpaid() to service_role;
grant execute on function public.store_expire_unpaid() to authenticated;   -- admin/gestor/financeiro (checado dentro)
revoke all on function public.store_return_receive(uuid, text, text), public.store_return_refuse(uuid, text),
  public.store_return_refund(uuid, numeric, date) from public, anon;
grant execute on function public.store_return_receive(uuid, text, text), public.store_return_refuse(uuid, text),
  public.store_return_refund(uuid, numeric, date) to authenticated;
revoke all on function app.store_available(uuid), app.require_service() from public, anon, authenticated;
grant execute on function app.store_available(uuid), app.require_service() to service_role;
revoke all on function public.title_pay(uuid, uuid, numeric, date, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.title_pay(uuid, uuid, numeric, date, numeric, numeric, numeric, text, text) to authenticated, service_role;

-- ########## 20261127000012_commission_statements.sql ##########
-- =====================================================================
-- Migração 0012: apuração e conta a pagar de comissões
-- Regras decididas: meta MENSAL por vendedor (dia 01 ao último), somente pedidos FATURADOS (nota registrada, não cancelados);
-- 4 faixas progressivas por % da meta atingida. O pagamento em si é feito no Financeiro (título a pagar, mesmo fluxo das demais contas).
-- DECISÃO PENDENTE: a base da comissão aqui é o valor faturado do mês (total dos pedidos). Se a empresa preferir
-- calcular sobre o valor RECEBIDO, a base muda numa nova migração; o fechamento já gravado não é recalculado.
-- =====================================================================

create table public.commission_statements (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references public.profiles(id),
  month           date not null check (month = date_trunc('month', month)::date),
  plan_id         uuid not null references public.commission_plans(id),
  target_amount   numeric(14,2) not null,
  invoiced_total  numeric(14,2) not null,
  attainment_pct  numeric(9,2) not null,
  tier_ord        smallint,
  commission_pct  numeric(5,2) not null default 0,
  amount          numeric(14,2) not null default 0,
  orders_count    int not null,
  status          text not null default 'calculada' check (status in ('calculada','aprovada','cancelada')),
  title_id        uuid references public.financial_titles(id),
  note            text,
  closed_by       uuid references public.profiles(id) default auth.uid(),
  closed_at       timestamptz not null default now(),
  approved_by     uuid references public.profiles(id),
  approved_at     timestamptz,
  updated_at      timestamptz not null default now()
);
create unique index commission_statements_open_uk on public.commission_statements (seller_id, month) where status <> 'cancelada';

create table public.commission_statement_orders (
  statement_id uuid not null references public.commission_statements(id) on delete cascade,
  order_id     uuid not null references public.orders(id),
  total        numeric(14,2) not null,
  primary key (statement_id, order_id)
);

-- Cálculo (sem gravar): usado para conferir antes de fechar
create or replace function public.commission_preview(p_seller uuid, p_month date) returns table (
  plan_id uuid, target_amount numeric, invoiced_total numeric, attainment_pct numeric, tier_ord smallint, commission_pct numeric, amount numeric, orders_count int)
language plpgsql stable security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date; t public.commission_targets; v_total numeric; v_n int; v_att numeric; v_tier public.commission_tiers;
begin
  perform app.require_any_role('admin','gestor','financeiro');
  select * into t from public.commission_targets ct where ct.seller_id = p_seller and ct.month = m order by ct.created_at desc limit 1;
  if not found then raise exception 'target_not_found'; end if;
  select coalesce(sum(o.total), 0), count(*) into v_total, v_n from public.orders o
   where o.seller_id = p_seller and o.status_commercial <> 'cancelado' and o.invoiced_at >= m and o.invoiced_at < (m + interval '1 month')::date;
  v_att := round(v_total / t.target_amount * 100, 2);
  select * into v_tier from public.commission_tiers tr where tr.plan_id = t.plan_id and tr.min_attainment_pct <= v_att order by tr.ord desc limit 1;
  return query select t.plan_id, t.target_amount, v_total, v_att, v_tier.ord, coalesce(v_tier.commission_pct, 0),
                      round(v_total * coalesce(v_tier.commission_pct, 0) / 100, 2), v_n;
end $$;

-- Fecha o mês do vendedor: grava a apuração e os pedidos que entraram
create or replace function public.commission_close(p_seller uuid, p_month date, p_note text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m date := date_trunc('month', p_month)::date; p record; v_id uuid;
begin
  perform app.require_any_role('admin','financeiro');
  if m >= date_trunc('month', current_date)::date then raise exception 'month_not_over'; end if;
  perform pg_advisory_xact_lock(hashtextextended('commission:' || p_seller || m, 5));
  if exists (select 1 from public.commission_statements where seller_id = p_seller and month = m and status <> 'cancelada') then raise exception 'already_closed'; end if;
  select * into p from public.commission_preview(p_seller, m) pv;
  insert into public.commission_statements (seller_id, month, plan_id, target_amount, invoiced_total, attainment_pct, tier_ord, commission_pct, amount, orders_count, note)
  values (p_seller, m, p.plan_id, p.target_amount, p.invoiced_total, p.attainment_pct, p.tier_ord, p.commission_pct, p.amount, p.orders_count, p_note) returning id into v_id;
  insert into public.commission_statement_orders (statement_id, order_id, total)
  select v_id, o.id, o.total from public.orders o
   where o.seller_id = p_seller and o.status_commercial <> 'cancelado' and o.invoiced_at >= m and o.invoiced_at < (m + interval '1 month')::date;
  return v_id;
end $$;

-- Aprova e lança a conta a pagar (uma vez só)
create or replace function public.commission_approve(p_statement uuid, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.commission_statements; v_title uuid; v_name text;
begin
  perform app.require_any_role('admin','financeiro');
  select * into s from public.commission_statements where id = p_statement for update;
  if not found then raise exception 'not_found'; end if;
  if s.status <> 'calculada' then raise exception 'invalid_transition'; end if;
  if s.amount <= 0 then raise exception 'nothing_to_pay'; end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = s.seller_id;
  insert into public.financial_titles (kind, origin_type, origin_id, installment, description, amount, due_date, competence)
  values ('pagar', 'manual', s.id, 1, 'Comissão ' || to_char(s.month, 'MM/YYYY') || ' — ' || v_name, s.amount,
          coalesce(p_due, current_date), date_trunc('month', current_date)::date) returning id into v_title;
  update public.commission_statements set status = 'aprovada', title_id = v_title, approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = s.id;
  return v_title;
end $$;

-- Cancela uma apuração (erro de lançamento): só se ainda não virou conta a pagar com pagamento
create or replace function public.commission_cancel(p_statement uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.commission_statements;
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_reason), '') = '' then raise exception 'note_required'; end if;
  select * into s from public.commission_statements where id = p_statement for update;
  if not found then raise exception 'not_found'; end if;
  if s.status = 'cancelada' then raise exception 'invalid_transition'; end if;
  if s.title_id is not null then
    if exists (select 1 from public.payments where title_id = s.title_id and not reversed) then raise exception 'has_payments'; end if;
    update public.financial_titles set status = 'cancelado', cancel_reason = 'Apuração de comissão cancelada: ' || p_reason where id = s.title_id and status = 'aberto';
  end if;
  update public.commission_statements set status = 'cancelada', note = coalesce(note || E'\n', '') || 'Cancelada: ' || p_reason, updated_at = now() where id = s.id;
end $$;

create trigger trg_commission_statements_updated before update on public.commission_statements for each row execute function app.set_updated_at();
create trigger trg_audit_commission_statements after insert or update or delete on public.commission_statements for each row execute function app.audit_row();

alter table public.commission_statements enable row level security;
alter table public.commission_statement_orders enable row level security;
create policy cst_select on public.commission_statements for select to authenticated using (app.has_any_role('admin','gestor','financeiro') or seller_id = auth.uid());
create policy cso_select on public.commission_statement_orders for select to authenticated
  using (exists (select 1 from public.commission_statements s where s.id = statement_id and (app.has_any_role('admin','gestor','financeiro') or s.seller_id = auth.uid())));
revoke all on public.commission_statements, public.commission_statement_orders from anon, authenticated;
grant select on public.commission_statements, public.commission_statement_orders to authenticated;

revoke all on function public.commission_preview(uuid, date), public.commission_close(uuid, date, text), public.commission_approve(uuid, date),
  public.commission_cancel(uuid, text) from public, anon;
grant execute on function public.commission_preview(uuid, date), public.commission_close(uuid, date, text), public.commission_approve(uuid, date),
  public.commission_cancel(uuid, text) to authenticated;

-- ########## registro das migrações (evita reaplicar pela integração do GitHub) ##########
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20261127000001', 'foundation'),
  ('20261127000002', 'crm'),
  ('20261127000003', 'catalog_costs'),
  ('20261127000004', 'quotes_orders'),
  ('20261127000005', 'commissions'),
  ('20261127000006', 'stock_purchasing'),
  ('20261127000007', 'production_shipping'),
  ('20261127000008', 'finance'),
  ('20261127000009', 'projects'),
  ('20261127000010', 'backfill_profiles'),
  ('20261127000011', 'store'),
  ('20261127000012', 'commission_statements')
on conflict (version) do nothing;

-- avisa a API do Supabase para reconhecer as tabelas novas
notify pgrst, 'reload schema';

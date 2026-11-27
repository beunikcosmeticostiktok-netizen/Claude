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

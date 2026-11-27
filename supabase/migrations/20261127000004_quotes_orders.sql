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

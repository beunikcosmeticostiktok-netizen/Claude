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

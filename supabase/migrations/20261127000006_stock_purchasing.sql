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

-- Century Shalom — atualização 0011 (loja on-line). Cole TUDO no SQL Editor do Supabase e clique em Run.
-- Roda em uma transação: se der erro, nada é gravado.
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261127000011','store') on conflict (version) do nothing;
notify pgrst, 'reload schema';

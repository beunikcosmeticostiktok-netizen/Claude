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

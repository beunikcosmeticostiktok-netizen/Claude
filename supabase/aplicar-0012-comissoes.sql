-- Century Shalom — atualização 0012 (comissões a pagar). Cole TUDO no SQL Editor do Supabase e clique em Run.
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261127000012','commission_statements') on conflict (version) do nothing;
notify pgrst, 'reload schema';

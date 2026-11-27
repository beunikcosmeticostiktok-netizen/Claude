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

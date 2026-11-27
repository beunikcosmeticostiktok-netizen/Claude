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

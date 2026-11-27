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

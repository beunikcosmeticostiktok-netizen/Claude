-- =====================================================================
-- Migração 0013: pagamento de contas a pagar (inclui comissões e reembolsos) em lote, com link do comprovante
-- Pagar um título isolado já existe (title_pay). Aqui: pagar vários de uma vez, na mesma conta e data, com tudo-ou-nada,
-- e anexar o comprovante do pagamento (link). Não há integração bancária: o pagamento é registrado depois de feito no banco.
-- =====================================================================

alter table public.payments add column proof_url text check (proof_url is null or proof_url ~* '^https?://');

create or replace function public.title_pay_batch(p_titles uuid[], p_account uuid, p_paid_on date, p_key text, p_proof_url text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_t uuid; v_title public.financial_titles; v_pay uuid; v_n int := 0; v_sum numeric := 0;
begin
  perform app.require_any_role('admin','financeiro');
  if coalesce(btrim(p_key), '') = '' then raise exception 'key_required'; end if;
  if p_titles is null or cardinality(p_titles) = 0 or cardinality(p_titles) > 50 then raise exception 'no_items'; end if;
  if p_paid_on > current_date then raise exception 'future_date'; end if;
  if (select count(distinct x) from unnest(p_titles) x) <> cardinality(p_titles) then raise exception 'duplicate_titles'; end if;
  foreach v_t in array p_titles loop
    select * into v_title from public.financial_titles where id = v_t;
    if not found then raise exception 'title_not_found'; end if;
    if v_title.kind <> 'pagar' then raise exception 'only_payables'; end if;
    v_pay := public.title_pay(v_t, p_account, v_title.amount - v_title.settled, coalesce(p_paid_on, current_date), 0, 0, 0, 'Pagamento em lote', 'batch:' || p_key || ':' || v_t);
    if p_proof_url is not null then update public.payments set proof_url = p_proof_url where id = v_pay; end if;
    v_n := v_n + 1; v_sum := v_sum + (v_title.amount - v_title.settled);
  end loop;
  return jsonb_build_object('paid', v_n, 'total', v_sum);
end $$;

create or replace function public.payment_set_proof(p_payment uuid, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_role('admin','financeiro');
  if p_url is not null and p_url !~* '^https?://' then raise exception 'invalid_url'; end if;
  update public.payments set proof_url = nullif(btrim(p_url), '') where id = p_payment;
  if not found then raise exception 'payment_not_found'; end if;
end $$;

revoke all on function public.title_pay_batch(uuid[], uuid, date, text, text), public.payment_set_proof(uuid, text) from public, anon;
grant execute on function public.title_pay_batch(uuid[], uuid, date, text, text), public.payment_set_proof(uuid, text) to authenticated;

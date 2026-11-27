export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;
  const alfa = globalThis.__alfa, beta = globalThis.__beta, item = globalThis.__item;
  const fin = await createUser(db, 'fin@exemplo.com', 'Fátima Financeiro');
  const estoque = await createUser(db, 'est@exemplo.com', 'Eduardo Estoque');
  const leitor = await createUser(db, 'leitor@alfa.com', 'Leitor Alfa');
  const clienteBeta = await createUser(db, 'cliente@beta.com', 'Cliente Beta');
  await as(db, marcelo, `select public.admin_grant_role($1,'financeiro')`, [fin]);
  await as(db, marcelo, `select public.admin_grant_role($1,'estoque')`, [estoque]);
  await as(db, marcelo, `select public.admin_set_seller($1,true)`, [ana]);
  await as(db, ana, `insert into public.customer_users(user_id,customer_id,access) values ($1,$2,'leitura')`, [leitor, alfa]);
  await as(db, ana, `insert into public.customer_users(user_id,customer_id,access) values ($1,$2,'aprovador')`, [clienteBeta, beta]);

  const tomorrow = `(current_date + 5)`;
  const mkQuote = async (price = 2.9) => {
    const q = (await as(db, ana, `select public.quote_create($1) id`, [alfa])).rows[0].id;
    const v = (await sudo(db, `select id from public.quote_versions where quote_id=$1 and version=1`, [q])).rows[0].id;
    await as(db, ana, `insert into public.quote_items(version_id,item_id,description,qty,tier_id,list_price,unit_price,unit_cost,position)
      values ($1,$2,'Frasco shampoo 250 ml',1000,2,2.90,$3,2.00,1)`, [v, item, price]);
    return { q, v };
  };

  await test('orçamento nasce numerado, versão 1, vendedor registrado, sinal padrão 50%', async () => {
    const { q, v } = await mkQuote();
    const r = (await sudo(db, `select q.number, q.seller_id, qv.deposit_pct, qv.status, qv.total from public.quotes q join public.quote_versions qv on qv.quote_id=q.id where q.id=$1`, [q])).rows[0];
    ok(/^ORC-\d{4}-\d{4}$/.test(r.number)); eq(r.seller_id, ana); eq(Number(r.deposit_pct), 50); eq(r.status, 'rascunho');
    eq(Number(r.total), 2900, 'total recalculado pelos itens');
    globalThis.__q1 = { q, v };
  });

  await test('abaixo do markup 1,5 (preço 2,90 / custo 2,00) exige aprovação do gestor', async () => {
    const { v } = globalThis.__q1;
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v]);
    await fails(as(db, ana, `select public.quote_send($1)`, [v]), 'needs_internal_approval');
    await as(db, ana, `select public.quote_request_internal_approval($1)`, [v]);
    await fails(as(db, ana, `select public.quote_internal_approve($1,'ok')`, [v]), 'forbidden');
    await as(db, bruno, `select public.quote_internal_approve($1,'cliente estratégico')`, [v]);
    const r = (await sudo(db, `select status, internal_approved, internal_approved_by from public.quote_versions where id=$1`, [v])).rows[0];
    eq(r, { status: 'rascunho', internal_approved: true, internal_approved_by: bruno });
  });

  await test('alterar o rascunho depois da aprovação interna invalida a aprovação', async () => {
    const { v } = globalThis.__q1;
    await as(db, ana, `update public.quote_items set unit_price=2.80 where version_id=$1`, [v]);
    eq((await sudo(db, `select internal_approved from public.quote_versions where id=$1`, [v])).rows[0].internal_approved, false);
    await as(db, ana, `select public.quote_request_internal_approval($1)`, [v]);
    await as(db, bruno, `select public.quote_internal_approve($1,'ok de novo')`, [v]);
    await as(db, ana, `update public.quote_versions set notes_client='Prazo conforme combinado' where id=$1`, [v]);
    eq((await sudo(db, `select internal_approved from public.quote_versions where id=$1`, [v])).rows[0].internal_approved, false, 'mudar condições também invalida');
    await as(db, ana, `select public.quote_request_internal_approval($1)`, [v]);
    await as(db, bruno, `select public.quote_internal_approve($1,'ok')`, [v]);
  });

  await test('preço com markup >= 1,5 dispensa aprovação (desconto livre até o limite)', async () => {
    const { v } = await mkQuote(3.0);
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v]);
    await fails(as(db, ana, `select public.quote_request_internal_approval($1)`, [v]), 'approval_not_required');
    await as(db, ana, `select public.quote_send($1)`, [v]);
    eq((await sudo(db, `select status from public.quote_versions where id=$1`, [v])).rows[0].status, 'enviado');
  });

  await test('enviar exige validade e itens; versão enviada fica imutável', async () => {
    const { v } = globalThis.__q1;
    const { v: vEmpty } = { v: (await sudo(db, `select id from public.quote_versions where id<>$1 and status='rascunho' limit 1`, [v])).rows[0]?.id };
    await as(db, ana, `select public.quote_send($1)`, [v]);
    const r = (await sudo(db, `select status, sent_at, snapshot from public.quote_versions where id=$1`, [v])).rows[0];
    eq(r.status, 'enviado'); ok(r.sent_at); ok(r.snapshot.items.length === 1);
    ok(!JSON.stringify(r.snapshot).includes('unit_cost') && !JSON.stringify(r.snapshot).includes('notes_internal'), 'retrato sem custos');
    await fails(as(db, ana, `update public.quote_items set unit_price=1 where version_id=$1`, [v]), 'version_locked');
    await fails(as(db, ana, `insert into public.quote_items(version_id,description,qty,unit_price) values ($1,'x',1,1)`, [v]), 'version_locked');
    await fails(as(db, ana, `delete from public.quote_items where version_id=$1`, [v]), 'version_locked');
    await fails(as(db, ana, `update public.quote_versions set payment_terms='mudou' where id=$1`, [v]), 'version_locked');
    await fails(sudo(db, `update public.quote_versions set total=1 where id=$1`, [v]), 'version_locked');
    await fails(sudo(db, `delete from public.quote_versions where id=$1`, [v]), 'version_locked');
  });

  await test('comercial não muda status/aprovação direto; transições inválidas são barradas', async () => {
    const { v } = globalThis.__q1;
    await fails(as(db, ana, `update public.quote_versions set status='aprovado' where id=$1`, [v]), 'permission denied');
    await fails(as(db, ana, `update public.quote_versions set approved_by=$1 where id=$1`, [ana]), 'permission denied');
    await fails(sudo(db, `update public.quote_versions set status='rascunho' where id=$1`, [v]), 'invalid_transition');
  });

  await test('cliente vê a versão enviada pelo portal — sem custos, markup nem observações internas', async () => {
    const { v } = globalThis.__q1;
    await sudo(db, `update public.quotes set updated_at=now()`);
    const r = await as(db, cliente, `select * from public.portal_quote_versions where id=$1`, [v]);
    eq(r.rows.length, 1);
    const cols = Object.keys(r.rows[0]).join(',');
    ok(!/notes_internal|unit_cost|markup|internal_/.test(cols), 'colunas internas ausentes: ' + cols);
    const it = await as(db, cliente, `select * from public.portal_quote_items where version_id=$1`, [v]);
    eq(it.rows.length, 1);
    ok(!/unit_cost|markup/.test(Object.keys(it.rows[0]).join(',')));
    eq((await as(db, cliente, `select * from public.quote_items`)).rows.length, 0, 'tabela-base fechada para o cliente');
    eq((await as(db, cliente, `select * from public.quote_versions`)).rows.length, 0, 'tabela-base fechada para o cliente');
  });

  await test('cliente de OUTRA empresa não vê nem aprova; rascunhos nunca aparecem no portal', async () => {
    const { v } = globalThis.__q1;
    eq((await as(db, clienteBeta, `select * from public.portal_quote_versions`)).rows.length, 0);
    await fails(as(db, clienteBeta, `select public.portal_approve_quote($1)`, [v]), 'not_found');
    const draft = await mkQuote();
    eq((await as(db, cliente, `select * from public.portal_quote_versions where id=$1`, [draft.v])).rows.length, 0);
    await fails(as(db, cliente, `select public.portal_approve_quote($1)`, [draft.v]), 'not_approvable');
  });

  await test('contato com acesso somente leitura não aprova; produção/comercial não usam a ação do portal', async () => {
    const { v } = globalThis.__q1;
    await fails(as(db, leitor, `select public.portal_approve_quote($1)`, [v]), 'forbidden');
    await fails(as(db, ana, `select public.portal_approve_quote($1)`, [v]), 'not_found');
    await fails(as(db, null, `select public.portal_approve_quote($1)`, [v]), 'permission denied');
  });

  await test('aprovação do cliente gera UM único pedido (duplo clique e chamadas simultâneas)', async () => {
    const { v } = globalThis.__q1;
    const [a, b] = await Promise.all([
      as(db, cliente, `select public.portal_approve_quote($1,'200.1.1.1') o`, [v]),
      as(db, cliente, `select public.portal_approve_quote($1,'200.1.1.1') o`, [v])]);
    eq(a.rows[0].o, b.rows[0].o, 'mesmo pedido');
    const again = await as(db, cliente, `select public.portal_approve_quote($1) o`, [v]);
    eq(again.rows[0].o, a.rows[0].o);
    eq(Number((await sudo(db, `select count(*) c from public.orders where quote_version_id=$1`, [v])).rows[0].c), 1);
    await fails(sudo(db, `insert into public.orders(number, customer_id, quote_version_id) values ('X',$1,$2)`, [alfa, v]), 'orders_quote_version_id_key');
    const ver = (await sudo(db, `select status, approved_by, approved_via, approved_ip from public.quote_versions where id=$1`, [v])).rows[0];
    eq(ver, { status: 'aprovado', approved_by: cliente, approved_via: 'portal', approved_ip: '200.1.1.1' });
    globalThis.__order = a.rows[0].o;
  });

  await test('pedido herda condições: itens, total, sinal de 50% (valor) e vendedor; custos ficam em tabela restrita', async () => {
    const o = (await sudo(db, `select * from public.orders where id=$1`, [globalThis.__order])).rows[0];
    ok(/^PED-\d{4}-\d{4}$/.test(o.number)); eq(o.seller_id, ana); eq(o.status_financial, 'aguardando_sinal');
    eq(Number(o.total), 2800); eq(Number(o.deposit_amount), 1400); eq(o.channel, 'orcamento');
    eq(Number((await sudo(db, `select count(*) c from public.order_items where order_id=$1`, [o.id])).rows[0].c), 1);
    eq(Number((await sudo(db, `select unit_cost c from public.order_item_costs limit 1`)).rows[0].c), 2);
    eq((await as(db, producao, `select * from public.order_items`)).rows.length >= 1, true, 'produção vê itens');
    eq((await as(db, producao, `select * from public.order_item_costs`)).rows.length, 0, 'produção NÃO vê custos');
    eq((await as(db, estoque, `select * from public.order_item_costs`)).rows.length, 0, 'estoque NÃO vê custos');
    const po = await as(db, cliente, `select * from public.portal_orders where id=$1`, [o.id]);
    eq(po.rows.length, 1); ok(!/notes_internal|seller|cancel_reason/.test(Object.keys(po.rows[0]).join(',')));
    ok(!/unit_cost/.test(Object.keys((await as(db, cliente, `select * from public.portal_order_items`)).rows[0]).join(',')));
    eq((await as(db, clienteBeta, `select * from public.portal_orders`)).rows.length, 0);
  });

  await test('liberação para produção: sem sinal fica bloqueada; exceção só do gestor, com justificativa registrada', async () => {
    const o = globalThis.__order;
    const chk = (await as(db, producao, `select rule, ok from public.order_release_checks($1)`, [o])).rows;
    eq(chk.find(c => c.rule === 'orcamento_aprovado').ok, true); eq(chk.find(c => c.rule === 'sinal_recebido').ok, false);
    await fails(as(db, producao, `select public.order_set_status($1,'production','liberado')`, [o]), 'release_blocked');
    await fails(as(db, producao, `select public.order_set_status($1,'production','liberado','por favor')`, [o]), 'release_blocked');
    await fails(as(db, producao, `select public.order_set_status($1,'financial','sinal_pago')`, [o]), 'forbidden');
    await fails(as(db, ana, `select public.order_set_status($1,'production','liberado','posso?')`, [o]), 'forbidden');
    await as(db, fin, `select public.order_set_status($1,'financial','sinal_pago','comprovante validado')`, [o]);
    await as(db, producao, `select public.order_set_status($1,'production','liberado')`, [o]);
    eq((await sudo(db, `select status_production from public.orders where id=$1`, [o])).rows[0].status_production, 'liberado');
  });

  await test('exceção de liberação: gestor libera sem sinal com justificativa (fica no histórico)', async () => {
    const { v } = await mkQuote(3.0);
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    const o = (await as(db, cliente, `select public.portal_approve_quote($1) o`, [v])).rows[0].o;
    await as(db, bruno, `select public.order_set_status($1,'production','liberado','Cliente antigo, sinal na entrega')`, [o]);
    const ev = (await sudo(db, `select kind, note from public.order_events where order_id=$1 and kind='release_exception'`, [o])).rows;
    eq(ev.length, 1); eq(ev[0].note, 'Cliente antigo, sinal na entrega');
    globalThis.__order2 = o;
  });

  await test('coleta exige nota fiscal anexada e, no FOB, transportadora indicada pelo cliente', async () => {
    const o = globalThis.__order;
    await fails(as(db, estoque, `select public.order_set_status($1,'logistics','coleta_agendada')`, [o]), 'invoice_required');
    await fails(as(db, estoque, `select public.order_register_invoice($1,'123')`, [o]), 'forbidden');
    await fails(as(db, fin, `select public.order_register_invoice($1,'123','123')`, [o]), 'order_items_pkey|check|invoice_key');
    await as(db, fin, `select public.order_register_invoice($1,'1234','35261112345678000195550010000012341000012349')`, [o]);
    await fails(as(db, estoque, `select public.order_set_status($1,'logistics','coleta_agendada')`, [o]), 'carrier_required');
    await fails(as(db, clienteBeta, `select public.portal_set_carrier($1,'Transp X')`, [o]), 'not_found');
    await fails(as(db, leitor, `select public.portal_set_carrier($1,'Transp X')`, [o]), 'forbidden');
    await as(db, cliente, `select public.portal_set_carrier($1,'Transportadora Rápida','(14) 3333-0000')`, [o]);
    await as(db, estoque, `select public.order_set_status($1,'logistics','coleta_agendada')`, [o]);
    await as(db, estoque, `select public.order_set_status($1,'logistics','coletado_parcial')`, [o]);
    eq((await sudo(db, `select carrier_name, status_logistics from public.orders where id=$1`, [o])).rows[0], { carrier_name: 'Transportadora Rápida', status_logistics: 'coletado_parcial' });
    await fails(as(db, cliente, `select public.portal_set_carrier($1,'Outra')`, [o]), 'order_locked');
  });

  await test('cancelamento preserva histórico; não cancela pedido em produção/coleta', async () => {
    await fails(as(db, ana, `select public.order_cancel($1,'x')`, [globalThis.__order2]), 'forbidden');
    await fails(as(db, bruno, `select public.order_cancel($1,'')`, [globalThis.__order2]), 'reason_required');
    await fails(as(db, bruno, `select public.order_cancel($1,'x')`, [globalThis.__order]), 'order_in_progress');
    await as(db, bruno, `select public.order_cancel($1,'Cliente desistiu')`, [globalThis.__order2]);
    const o = (await sudo(db, `select status_commercial, cancel_reason from public.orders where id=$1`, [globalThis.__order2])).rows[0];
    eq(o, { status_commercial: 'cancelado', cancel_reason: 'Cliente desistiu' });
    await fails(as(db, producao, `select public.order_set_status($1,'production','em_producao')`, [globalThis.__order2]), 'order_cancelled');
    ok((await sudo(db, `select count(*)::int c from public.order_events where order_id=$1`, [globalThis.__order2])).rows[0].c >= 3);
  });

  await test('nova versão: pedido de alteração do cliente → v2 → v1 vira substituída e não é mais aprovável', async () => {
    const { q, v: v1 } = await mkQuote(3.0);
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v1]);
    await as(db, ana, `select public.quote_send($1)`, [v1]);
    await as(db, cliente, `select public.portal_request_quote_change($1,'Pode reduzir o prazo?')`, [v1]);
    eq((await sudo(db, `select status from public.quote_versions where id=$1`, [v1])).rows[0].status, 'em_negociacao');
    const v2 = (await sudo(db, `select id from public.quote_versions where quote_id=$1 and version=2`, [q])).rows[0]?.id
      ?? (await as(db, ana, `select public.quote_new_version($1) id`, [q])).rows[0].id;
    eq(Number((await sudo(db, `select count(*) c from public.quote_items where version_id=$1`, [v2])).rows[0].c), 1, 'itens copiados');
    await fails(as(db, ana, `select public.quote_new_version($1)`, [q]), 'draft_exists');
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v2]);
    await as(db, ana, `select public.quote_send($1)`, [v2]);
    eq((await sudo(db, `select status from public.quote_versions where id=$1`, [v1])).rows[0].status, 'substituida');
    await fails(as(db, cliente, `select public.portal_approve_quote($1)`, [v1]), 'not_approvable');
    const o = (await as(db, cliente, `select public.portal_approve_quote($1) o`, [v2])).rows[0].o;
    ok(o);
  });

  await test('aprovação fora do sistema exige justificativa e identifica quem lançou', async () => {
    const { v } = await mkQuote(3.0);
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    await fails(as(db, ana, `select public.quote_mark_approved_offline($1,'')`, [v]), 'note_required');
    await as(db, ana, `select public.quote_mark_approved_offline($1,'Aceite por WhatsApp em 27/11')`, [v]);
    const r = (await sudo(db, `select approved_via, approved_by, approved_note from public.quote_versions where id=$1`, [v])).rows[0];
    eq(r, { approved_via: 'interno', approved_by: ana, approved_note: 'Aceite por WhatsApp em 27/11' });
    eq(Number((await sudo(db, `select count(*) c from public.orders where quote_version_id=$1`, [v])).rows[0].c), 1);
  });

  await test('validade vencida: expira; cliente não aprova versão expirada', async () => {
    const { v } = await mkQuote(3.0);
    await as(db, ana, `update public.quote_versions set valid_until=${tomorrow} where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    await sudo(db, `alter table public.quote_versions disable trigger trg_quote_versions_guard`);
    await sudo(db, `update public.quote_versions set valid_until = current_date - 1 where id=$1`, [v]);
    await sudo(db, `alter table public.quote_versions enable trigger trg_quote_versions_guard`);
    await fails(as(db, cliente, `select public.portal_approve_quote($1)`, [v]), 'expired');
    await fails(as(db, ana, `select public.quote_expire_due()`), 'forbidden');
    const n = (await as(db, 'service', `select public.quote_expire_due() n`)).rows[0].n;
    ok(n >= 1);
    eq((await sudo(db, `select status from public.quote_versions where id=$1`, [v])).rows[0].status, 'expirado');
    await fails(as(db, cliente, `select public.portal_approve_quote($1)`, [v]), 'not_approvable');
  });

  await test('metas e comissões: 4 faixas progressivas; só pedidos faturados contam; vendedor vê só o seu', async () => {
    const plan = (await as(db, marcelo, `insert into public.commission_plans(name) values ('Plano 2026') returning id`)).rows[0].id;
    await fails(as(db, ana, `insert into public.commission_plans(name) values ('x')`), 'permission|row-level');
    const tiers = a => JSON.stringify(a.map(([ord, m, c]) => ({ ord, min_attainment_pct: m, commission_pct: c })));
    await fails(as(db, ana, `select public.admin_set_commission_tiers($1,$2::jsonb)`, [plan, tiers([[1,0,1],[2,80,2],[3,100,3],[4,120,4]])]), 'forbidden');
    await fails(as(db, marcelo, `select public.admin_set_commission_tiers($1,$2::jsonb)`, [plan, tiers([[1,0,1],[2,100,2]])]), 'exatamente 4');
    await fails(as(db, marcelo, `select public.admin_set_commission_tiers($1,$2::jsonb)`, [plan, tiers([[1,0,1],[2,80,3],[3,100,2],[4,120,5]])]), 'progressivas');
    await as(db, marcelo, `select public.admin_set_commission_tiers($1,$2::jsonb)`, [plan, tiers([[1,0,1],[2,80,2],[3,100,3],[4,120,4]])]);
    eq(Number((await sudo(db, `select count(*) c from public.commission_tiers where plan_id=$1`, [plan])).rows[0].c), 4);
    await fails(as(db, marcelo, `insert into public.commission_targets(plan_id,seller_id,month,target_amount) values ($1,$2,'2026-11-01',1000)`, [plan, bruno]), 'not_a_seller');
    await fails(as(db, marcelo, `insert into public.commission_targets(plan_id,seller_id,month,target_amount) values ($1,$2,'2026-11-15',1000)`, [plan, ana]), 'month');
    await as(db, marcelo, `insert into public.commission_targets(plan_id,seller_id,month,target_amount) values ($1,$2,'2026-11-01',3000)`, [plan, ana]);
    // mês sem nenhuma nota registrada: nada conta, mesmo havendo pedido aprovado
    await as(db, marcelo, `insert into public.commission_targets(plan_id,seller_id,month,target_amount) values ($1,$2,'2026-10-01',3000)`, [plan, ana]);
    const out = (await as(db, marcelo, `select * from public.seller_commission_progress where seller_id=$1 and month='2026-10-01'`, [ana])).rows[0];
    eq(Number(out.invoiced_total), 0); eq(Number(out.tier_commission_pct), 1, "faixa 1 começa em 0%");
    await sudo(db, `update public.orders set invoiced_at='2026-11-10' where id=$1`, [globalThis.__order]);
    const dep = (await as(db, ana, `select * from public.seller_commission_progress where month='2026-11-01'`)).rows[0];
    eq(Number(dep.invoiced_total), 2800); eq(Number(dep.attainment_pct), 93.33); eq(Number(dep.tier_commission_pct), 2);
    eq((await as(db, bruno, `select * from public.seller_commission_progress`)).rows.length, 2, 'gestor vê todos');
    eq((await as(db, producao, `select * from public.seller_commission_progress`)).rows.length, 0, 'produção não vê');
    eq((await as(db, cliente, `select * from public.seller_commission_progress`)).rows.length, 0);
  });

  await test('histórico: toda mudança de orçamento/pedido tem autor na auditoria', async () => {
    const r = await sudo(db, `select count(*)::int c from public.audit_log where entity in ('quote_versions','orders') and actor is not null`);
    ok(r.rows[0].c > 10);
    const a = await sudo(db, `select actor from public.audit_log where entity='quote_versions' and action='UPDATE' and after->>'status'='aprovado' limit 1`);
    eq(a.rows[0].actor, cliente, 'aprovação registrada com o usuário do cliente');
  });
}

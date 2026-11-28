export default async function ({ db, as, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente } = globalThis.__u;
  const fin = (await sudo(db, `select user_id from public.user_roles where role='financeiro' limit 1`)).rows[0].user_id;
  const d = new Date(); const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const mon = prev.toISOString().slice(0, 10);
  const day = n => new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), n)).toISOString().slice(0, 10);
  const mkOrder = async (total, invoiced, status = 'aprovado') => (await sudo(db,
    `insert into public.orders(number, customer_id, channel, seller_id, total, invoiced_at, invoice_number) values (app.next_number('PED'),$1,'orcamento',$2,$3,$4,'NF1') returning id`,
    [globalThis.__alfa, ana, total, invoiced])).rows[0].id;
  let plan, stmt;

  await test('plano com 4 faixas e meta do mês do vendedor', async () => {
    plan = (await as(db, marcelo, `insert into public.commission_plans(name) values ('Plano comissão') returning id`)).rows[0].id;
    await as(db, marcelo, `select public.admin_set_commission_tiers($1,$2::jsonb)`, [plan, JSON.stringify([
      { ord: 1, min_attainment_pct: 0, commission_pct: 1 }, { ord: 2, min_attainment_pct: 80, commission_pct: 2 },
      { ord: 3, min_attainment_pct: 100, commission_pct: 3 }, { ord: 4, min_attainment_pct: 120, commission_pct: 4 }])]);
    await as(db, marcelo, `insert into public.commission_targets(plan_id, seller_id, month, target_amount) values ($1,$2,$3,10000)`, [plan, ana, mon]);
  });

  await test('prévia: só pedidos faturados no mês e não cancelados; faixa pela % da meta', async () => {
    await mkOrder(6000, day(2)); await mkOrder(3000, day(28));
    const cancel = await mkOrder(5000, day(10));
    await sudo(db, `update public.orders set status_commercial='cancelado' where id=$1`, [cancel]);
    const fora = await mkOrder(9000, day(1)); await sudo(db, `update public.orders set invoiced_at = $1::date - 1 where id=$2`, [mon, fora]);
    await sudo(db, `insert into public.orders(number, customer_id, channel, seller_id, total) values (app.next_number('PED'),$1,'orcamento',$2,7000)`, [globalThis.__alfa, ana]);   // não faturado
    const p = (await as(db, fin, `select * from public.commission_preview($1,$2)`, [ana, mon])).rows[0];
    eq([Number(p.invoiced_total), Number(p.attainment_pct), p.tier_ord, Number(p.commission_pct), Number(p.amount), p.orders_count], [9000, 90, 2, 2, 180, 2]);
  });

  await test('permissões: comercial e cliente não calculam nem fecham', async () => {
    await fails(as(db, ana, `select * from public.commission_preview($1,$2)`, [ana, mon]), 'forbidden');
    await fails(as(db, cliente, `select public.commission_close($1,$2)`, [ana, mon]), 'forbidden');
    await fails(as(db, bruno, `select public.commission_close($1,$2)`, [ana, mon]), 'forbidden');
  });

  await test('não fecha mês corrente nem vendedor sem meta; fecha uma vez só', async () => {
    const cur = new Date().toISOString().slice(0, 8) + '01';
    await fails(as(db, fin, `select public.commission_close($1,$2)`, [ana, cur]), 'month_not_over');
    await fails(as(db, fin, `select public.commission_close($1,$2)`, [bruno, mon]), 'target_not_found');
    stmt = (await as(db, fin, `select public.commission_close($1,$2) id`, [ana, mon])).rows[0].id;
    await fails(as(db, fin, `select public.commission_close($1,$2)`, [ana, mon]), 'already_closed');
    eq(Number((await sudo(db, `select count(*) c from public.commission_statement_orders where statement_id=$1`, [stmt])).rows[0].c), 2);
  });

  await test('apuração é um retrato: pedido novo depois não muda o valor fechado', async () => {
    await mkOrder(50000, day(15));
    eq(Number((await sudo(db, `select amount from public.commission_statements where id=$1`, [stmt])).rows[0].amount), 180);
  });

  await test('vendedor vê só a própria apuração; outro vendedor e cliente não veem', async () => {
    eq((await as(db, ana, `select id from public.commission_statements`)).rows.length, 1);
    eq((await as(db, cliente, `select id from public.commission_statements`)).rows.length, 0);
    await fails(as(db, null, `select id from public.commission_statements`), 'permission denied');
    await fails(as(db, ana, `update public.commission_statements set amount=999999`), 'permission denied');
  });

  await test('aprovação gera uma conta a pagar; segunda aprovação é recusada', async () => {
    await fails(as(db, ana, `select public.commission_approve($1)`, [stmt]), 'forbidden');
    const t = (await as(db, fin, `select public.commission_approve($1,current_date + 5) t`, [stmt])).rows[0].t;
    const r = (await sudo(db, `select kind, amount, status from public.financial_titles where id=$1`, [t])).rows[0];
    eq([r.kind, Number(r.amount), r.status], ['pagar', 180, 'aberto']);
    await fails(as(db, fin, `select public.commission_approve($1)`, [stmt]), 'invalid_transition');
  });

  await test('cancelar exige motivo, cancela o título em aberto e libera novo fechamento', async () => {
    await fails(as(db, fin, `select public.commission_cancel($1,' ')`, [stmt]), 'note_required');
    await as(db, fin, `select public.commission_cancel($1,'meta lançada errada')`, [stmt]);
    eq((await sudo(db, `select t.status from public.commission_statements s join public.financial_titles t on t.id=s.title_id where s.id=$1`, [stmt])).rows[0].status, 'cancelado');
    const again = (await as(db, fin, `select public.commission_close($1,$2) id`, [ana, mon])).rows[0].id;
    ok(again !== stmt);
    eq(Number((await sudo(db, `select amount from public.commission_statements where id=$1`, [again])).rows[0].amount), 2360, 'novo fechamento inclui o pedido de 50.000 (59.000 = 590% da meta, faixa 4 a 4%)');
  });
}

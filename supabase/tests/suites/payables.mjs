export default async function ({ db, as, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente } = globalThis.__u;
  const fin = (await sudo(db, `select user_id from public.user_roles where role='financeiro' limit 1`)).rows[0].user_id;
  const acc = (await sudo(db, `select id from public.bank_accounts where active order by name limit 1`)).rows[0].id;
  const mk = async (kind, amt, desc) => (await sudo(db, `insert into public.financial_titles(kind, description, amount, due_date, competence) values ($1,$2,$3,current_date,date_trunc('month',current_date)::date) returning id`, [kind, desc, amt])).rows[0].id;
  const T = [await mk('pagar', 100, 'Conta A'), await mk('pagar', 250.5, 'Conta B'), await mk('pagar', 80, 'Conta C')];
  const R = await mk('receber', 500, 'Receber X');
  const batch = (u, ids, key = 'k1', proof = null, date = null) => as(db, u, `select public.title_pay_batch($1::uuid[],$2,coalesce($3::date,current_date),$4,$5) r`, [ids, acc, date, key, proof]);
  const cash = async () => Number((await sudo(db, `select coalesce(sum(amount),0) s from public.cash_movements where account_id=$1`, [acc])).rows[0].s);

  await test('só administrador/financeiro paga em lote', async () => {
    for (const u of [ana, bruno, cliente, null]) await fails(batch(u, [T[0]]), 'forbidden|permission denied');
  });

  await test('lote paga o saldo de cada conta, grava o caixa e o comprovante', async () => {
    const before = await cash();
    const r = (await batch(fin, [T[0], T[1]], 'k1', 'https://exemplo.com/comp.pdf')).rows[0].r;
    eq([r.paid, Number(r.total)], [2, 350.5]);
    eq(await cash(), before - 350.5);
    eq(Number((await sudo(db, `select count(*) c from public.financial_titles where id = any($1) and status='pago'`, [[T[0], T[1]]])).rows[0].c), 2);
    eq(Number((await sudo(db, `select count(*) c from public.payments where proof_url='https://exemplo.com/comp.pdf'`)).rows[0].c), 2);
  });

  await test('repetir o mesmo lote (mesma chave, ex.: duplo clique) não paga de novo; chave nova em título já pago é recusada', async () => {
    const before = await cash();
    await batch(fin, [T[0], T[1]], 'k1');
    eq(await cash(), before, 'mesma chave: nada pago de novo');
    await fails(batch(fin, [T[0]], 'k1-outra'), 'title_closed');
    eq(await cash(), before);
  });

  await test('tudo ou nada: um título inválido desfaz o lote inteiro', async () => {
    const before = await cash();
    await fails(batch(fin, [T[2], R], 'k2'), 'only_payables');
    eq(await cash(), before);
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [T[2]])).rows[0].status, 'aberto');
  });

  await test('validações: data futura, duplicados, vazio, lista grande, link inválido', async () => {
    await fails(batch(fin, [T[2]], 'k3', null, new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)), 'future_date');
    await fails(batch(fin, [T[2], T[2]], 'k3'), 'duplicate_titles');
    await fails(batch(fin, [], 'k3'), 'no_items');
    await fails(batch(fin, [T[2]], ' '), 'key_required');
    await fails(batch(fin, [T[2]], 'k3', 'javascript:alert(1)'), 'payments_proof_url_check|violates check');
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [T[2]])).rows[0].status, 'aberto');
  });

  await test('comprovante pode ser anexado depois, só por financeiro, com link válido', async () => {
    await batch(fin, [T[2]], 'k4');
    const p = (await sudo(db, `select id from public.payments where title_id=$1`, [T[2]])).rows[0].id;
    await fails(as(db, ana, `select public.payment_set_proof($1,'https://x.com/a')`, [p]), 'forbidden');
    await fails(as(db, fin, `select public.payment_set_proof($1,'ftp://x')`, [p]), 'invalid_url');
    await as(db, fin, `select public.payment_set_proof($1,'https://x.com/a')`, [p]);
    eq((await sudo(db, `select proof_url from public.payments where id=$1`, [p])).rows[0].proof_url, 'https://x.com/a');
  });
}

export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;
  const alfa = globalThis.__alfa, beta = globalThis.__beta, item = globalThis.__item;
  const rid = async role => (await sudo(db, `select user_id from public.user_roles where role=$1 limit 1`, [role])).rows[0].user_id;
  const estoque = await rid('estoque'), compras = await rid('compras');
  const fin = await createUser(db, 'fin2@exemplo.com', 'Fabiana Financeira');
  await as(db, marcelo, `select public.admin_grant_role($1,'financeiro')`, [fin]);
  const leitor = (await sudo(db, `select id from auth.users where email='leitor@alfa.com'`)).rows[0].id;
  const clienteBeta = (await sudo(db, `select id from auth.users where email='cliente@beta.com'`)).rows[0].id;
  const num = async (sql, p = []) => Number((await (/account_balances/.test(sql) ? as(db, fin, sql, p) : sudo(db, sql, p))).rows[0].v);

  const mkOrder = async (qty, price = 3.0) => {
    const q = (await as(db, ana, `select public.quote_create($1) id`, [alfa])).rows[0].id;
    const v = (await sudo(db, `select id from public.quote_versions where quote_id=$1`, [q])).rows[0].id;
    await as(db, ana, `insert into public.quote_items(version_id,item_id,description,qty,unit_price,unit_cost,position) values ($1,$2,'Frasco',$3,$4,2.00,1)`, [v, item, qty, price]);
    await as(db, ana, `update public.quote_versions set valid_until=current_date+5 where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    return (await as(db, cliente, `select public.portal_approve_quote($1) o`, [v])).rows[0].o;
  };
  const key = (() => { let n = 0; return () => 'fk-' + (++n); })();
  const acc = {};

  await test('contas, categorias e centros de custo: só financeiro/admin; demais perfis não veem', async () => {
    acc.banco = (await as(db, fin, `insert into public.bank_accounts(name, opening_balance) values ('Banco principal', 1000) returning id`)).rows[0].id;
    acc.caixa = (await as(db, fin, `insert into public.bank_accounts(name, kind) values ('Caixa', 'caixa') returning id`)).rows[0].id;
    await as(db, fin, `insert into public.finance_categories(name,kind) values ('Vendas','receita')`);
    await as(db, fin, `insert into public.cost_centers(name) values ('Fábrica')`);
    await fails(as(db, ana, `insert into public.bank_accounts(name) values ('x')`), 'row-level security');
    for (const u of [ana, producao, estoque, cliente]) eq((await as(db, u, `select * from public.bank_accounts`)).rows.length, 0);
    eq((await as(db, bruno, `select * from public.bank_accounts`)).rows.length, 2, 'gestor consulta');
  });

  await test('cobrança do pedido: sinal 50% e saldo, uma única vez (sem duplicar títulos)', async () => {
    acc.o1 = await mkOrder(1000);
    await fails(as(db, ana, `select public.order_generate_receivables($1,current_date+30)`, [acc.o1]), 'forbidden');
    await fails(as(db, cliente, `select public.order_generate_receivables($1,current_date+30)`, [acc.o1]), 'forbidden');
    await fails(as(db, fin, `select public.order_generate_receivables($1)`, [acc.o1]), 'due_required');
    eq(await num(`select count(*) v from public.financial_titles where origin_id=$1`, [acc.o1]), 0, 'falha não deixa título pela metade');
    eq((await as(db, fin, `select public.order_generate_receivables($1,current_date+30) n`, [acc.o1])).rows[0].n, 2);
    eq((await as(db, fin, `select public.order_generate_receivables($1,current_date+30) n`, [acc.o1])).rows[0].n, 2, 'idempotente');
    const t = (await sudo(db, `select installment, amount, description from public.financial_titles where origin_id=$1 order by installment`, [acc.o1])).rows;
    eq(t.map(x => Number(x.amount)), [1500, 1500]); ok(t[0].description.startsWith('Sinal'));
    await fails(sudo(db, `insert into public.financial_titles(kind,origin_type,origin_id,installment,description,amount,due_date,competence) values ('receber','order',$1,1,'dup',10,current_date,date_trunc('month',current_date)::date)`, [acc.o1]), 'financial_titles_origin_uk');
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'aguardando_sinal');
  });

  await test('pagamento do sinal: caixa entra, título quita, pedido vira “sinal pago”; reenvio não duplica', async () => {
    const sinal = (await sudo(db, `select id from public.financial_titles where origin_id=$1 and installment=1`, [acc.o1])).rows[0].id;
    acc.sinal = sinal;
    await fails(as(db, ana, `select public.title_pay($1,$2,1500,current_date,0,0,0,null,'x')`, [sinal, acc.banco]), 'forbidden');
    const k = key();
    const p1 = (await as(db, fin, `select public.title_pay($1,$2,1500,current_date,0,0,0,'PIX',$3) id`, [sinal, acc.banco, k])).rows[0].id;
    const p2 = (await as(db, fin, `select public.title_pay($1,$2,1500,current_date,0,0,0,'PIX',$3) id`, [sinal, acc.banco, k])).rows[0].id;
    eq(p1, p2);
    eq(await num(`select balance v from public.account_balances where name='Banco principal'`), 2500);
    eq((await sudo(db, `select status, settled from public.financial_titles where id=$1`, [sinal])).rows[0].status, 'pago');
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'sinal_pago');
    await fails(as(db, fin, `select public.title_pay($1,$2,1,current_date,0,0,0,null,$3)`, [sinal, acc.banco, key()]), 'title_closed');
    acc.p1 = p1;
  });

  await test('pagamento parcial, desconto, juros e multa: caixa = principal + juros + multa; desconto não é caixa', async () => {
    const saldo = (await sudo(db, `select id from public.financial_titles where origin_id=$1 and installment=2`, [acc.o1])).rows[0].id;
    acc.saldo = saldo;
    await fails(as(db, fin, `select public.title_pay($1,$2,1600,current_date,0,0,0,null,$3)`, [saldo, acc.banco, key()]), 'exceeds_balance');
    await fails(as(db, fin, `select public.title_pay($1,$2,0,current_date,0,0,0,null,$3)`, [saldo, acc.banco, key()]), 'invalid_amount');
    await as(db, fin, `select public.title_pay($1,$2,500,current_date,0,0,0,'parcial',$3)`, [saldo, acc.banco, key()]);
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [saldo])).rows[0].status, 'parcial');
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'sinal_pago');
    acc.pLast = (await as(db, fin, `select public.title_pay($1,$2,990,current_date,20,5,10,'quitação com desconto',$3) id`, [saldo, acc.banco, key()])).rows[0].id;
    eq(await num(`select balance v from public.account_balances where name='Banco principal'`), 1000 + 1500 + 500 + 990 + 20 + 5);
    const t = (await sudo(db, `select status, settled, discount_total from public.financial_titles where id=$1`, [saldo])).rows[0];
    eq([t.status, Number(t.settled), Number(t.discount_total)], ['pago', 1500, 10]);
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'quitado');
  });

  await test('estorno de pagamento: lançamentos opostos, título reaberto, uma única vez, com justificativa', async () => {
    await fails(as(db, fin, `select public.payment_reverse($1,'')`, [acc.pLast]), 'note_required');
    await fails(as(db, ana, `select public.payment_reverse($1,'x')`, [acc.pLast]), 'forbidden');
    await as(db, fin, `select public.payment_reverse($1,'valor lançado errado')`, [acc.pLast]);
    await fails(as(db, fin, `select public.payment_reverse($1,'de novo')`, [acc.pLast]), 'already_reversed');
    eq(await num(`select balance v from public.account_balances where name='Banco principal'`), 3000);
    const t = (await sudo(db, `select status, settled, discount_total from public.financial_titles where id=$1`, [acc.saldo])).rows[0];
    eq([t.status, Number(t.settled), Number(t.discount_total)], ['parcial', 500, 0]);
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'sinal_pago', 'pedido deixa de estar quitado');
    await as(db, fin, `select public.title_pay($1,$2,1000,current_date,0,0,0,'repagamento',$3)`, [acc.saldo, acc.banco, key()]);
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [acc.o1])).rows[0].s, 'quitado');
  });

  await test('comprovante do cliente não dá baixa: fica pendente até o Financeiro validar (e só uma vez)', async () => {
    const o2 = await mkOrder(100); acc.o2 = o2;
    await as(db, fin, `select public.order_generate_receivables($1,current_date+30)`, [o2]);
    const sinal = (await sudo(db, `select id from public.financial_titles where origin_id=$1 and installment=1`, [o2])).rows[0].id;
    await fails(as(db, leitor, `select public.portal_submit_proof($1,150,current_date)`, [sinal]), 'not_found|forbidden');
    await fails(as(db, clienteBeta, `select public.portal_submit_proof($1,150,current_date)`, [sinal]), 'not_found');
    await fails(as(db, cliente, `select public.portal_submit_proof($1,999,current_date)`, [sinal]), 'invalid_amount');
    const pr = (await as(db, cliente, `select public.portal_submit_proof($1,150,current_date,'Pix enviado') id`, [sinal])).rows[0].id;
    eq((await sudo(db, `select status, settled from public.financial_titles where id=$1`, [sinal])).rows[0].status, 'aberto', 'sem baixa automática');
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [o2])).rows[0].s, 'aguardando_sinal');
    await fails(as(db, ana, `select public.proof_validate($1,$2,'pv0')`, [pr, acc.banco]), 'forbidden');
    await as(db, fin, `select public.proof_validate($1,$2,'pv1')`, [pr, acc.banco]);
    eq((await sudo(db, `select status_financial s from public.orders where id=$1`, [o2])).rows[0].s, 'sinal_pago');
    eq((await sudo(db, `select status from public.payment_proofs where id=$1`, [pr])).rows[0].status, 'validado');
    await fails(as(db, fin, `select public.proof_validate($1,$2,'pv2')`, [pr, acc.banco]), 'proof_closed');
    const saldo2 = (await sudo(db, `select id from public.financial_titles where origin_id=$1 and installment=2`, [o2])).rows[0].id;
    const pr2 = (await as(db, cliente, `select public.portal_submit_proof($1,100,current_date) id`, [saldo2])).rows[0].id;
    await fails(as(db, fin, `select public.proof_reject($1,'')`, [pr2]), 'reason_required');
    await as(db, fin, `select public.proof_reject($1,'valor não confere com o extrato')`, [pr2]);
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [saldo2])).rows[0].status, 'aberto');
  });

  await test('caixa é imutável; ninguém lança direto', async () => {
    await fails(sudo(db, `update public.cash_movements set amount=1`), 'somente inserção');
    await fails(sudo(db, `delete from public.cash_movements`), 'somente inserção');
    await fails(as(db, fin, `insert into public.cash_movements(movement_date,account_id,amount,kind) values (current_date,$1,10,'ajuste')`, [acc.banco]), 'permission denied');
    await fails(as(db, fin, `update public.financial_titles set settled=0`), 'permission denied');
  });

  await test('transferência entre contas move o saldo entre elas, sem alterar o total nem o resultado', async () => {
    const antesCaixa = (await as(db, fin, `select receitas, despesas from public.finance_summary(date_trunc('month', current_date)::date, current_date + 60, 'caixa')`)).rows[0];
    const total0 = await num(`select sum(balance) v from public.account_balances`);
    await as(db, fin, `select public.account_transfer($1,$2,200,current_date,'reforço de caixa')`, [acc.banco, acc.caixa]);
    eq(await num(`select balance v from public.account_balances where name='Caixa'`), 200);
    eq(await num(`select sum(balance) v from public.account_balances`), total0);
    const depois = (await as(db, fin, `select receitas, despesas from public.finance_summary(date_trunc('month', current_date)::date, current_date + 60, 'caixa')`)).rows[0];
    eq(depois, antesCaixa, 'transferência não é receita nem despesa');
    await fails(as(db, fin, `select public.account_transfer($1,$1,10,current_date)`, [acc.banco]), 'invalid_amount');
    await fails(as(db, ana, `select public.account_transfer($1,$2,10,current_date)`, [acc.banco, acc.caixa]), 'forbidden');
  });

  await test('compra recebida vira uma conta a pagar (uma por recebimento); pagamento sai do caixa', async () => {
    const r = (await sudo(db, `select id from public.receipts order by received_at limit 1`)).rows[0].id;
    const esperado = await num(`select sum(round(rl.qty*pl.unit_cost,2)) v from public.receipt_lines rl join public.purchase_lines pl on pl.id=rl.line_id where rl.receipt_id=$1`, [r]);
    await fails(as(db, estoque, `select public.receipt_generate_payable($1,current_date+15)`, [r]), 'forbidden');
    const a = (await as(db, fin, `select public.receipt_generate_payable($1,current_date+15) id`, [r])).rows[0].id;
    const b = (await as(db, fin, `select public.receipt_generate_payable($1,current_date+15) id`, [r])).rows[0].id;
    eq(a, b); eq(Number((await sudo(db, `select amount from public.financial_titles where id=$1`, [a])).rows[0].amount), esperado);
    eq(await num(`select count(*) v from public.financial_titles where origin_type='receipt' and origin_id=$1`, [r]), 1);
    const antes = await num(`select balance v from public.account_balances where name='Banco principal'`);
    await as(db, fin, `select public.title_pay($1,$2,100,current_date,0,0,0,'adiantamento ao fornecedor',$3)`, [a, acc.banco, key()]);
    eq(await num(`select balance v from public.account_balances where name='Banco principal'`), antes - 100);
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [a])).rows[0].status, 'parcial');
    acc.payable = a;
  });

  await test('visibilidade dos títulos: comercial só a receber; compras só a pagar; produção/estoque/cliente nada', async () => {
    const kinds = async u => [...new Set((await as(db, u, `select kind from public.financial_titles`)).rows.map(x => x.kind))].sort();
    eq(await kinds(ana), ['receber']); eq(await kinds(compras), ['pagar']); eq(await kinds(fin), ['pagar', 'receber']);
    for (const u of [producao, estoque, cliente]) eq((await as(db, u, `select * from public.financial_titles`)).rows.length, 0);
    eq((await as(db, ana, `select * from public.cash_movements`)).rows.length, 0, 'comercial não vê o caixa');
    eq((await as(db, compras, `select * from public.titles_open where kind='receber'`)).rows.length, 0);
  });

  await test('parcelamento: soma exata dos centavos, vencimentos mensais', async () => {
    await fails(as(db, ana, `select public.title_create_installments('pagar','Aluguel',100,current_date,3)`), 'forbidden');
    await as(db, fin, `select public.title_create_installments('pagar','Máquina nova',100,'2026-12-10',3)`);
    const t = (await sudo(db, `select amount, due_date::text d from public.financial_titles where description like 'Máquina nova%' order by due_date`)).rows;
    eq(t.map(x => Number(x.amount)), [33.33, 33.33, 33.34]); eq(t.map(x => x.d), ['2026-12-10', '2027-01-10', '2027-02-10']);
  });

  await test('cancelar título: só sem pagamentos e com motivo; pedido recalcula a situação', async () => {
    const t = (await sudo(db, `select id from public.financial_titles where description like 'Máquina nova (1/3)'`)).rows[0].id;
    await fails(as(db, fin, `select public.title_cancel($1,'')`, [t]), 'reason_required');
    await as(db, fin, `select public.title_cancel($1,'compra desfeita')`, [t]);
    eq((await sudo(db, `select status from public.financial_titles where id=$1`, [t])).rows[0].status, 'cancelado');
    await fails(as(db, fin, `select public.title_cancel($1,'x')`, [acc.sinal]), 'has_payments');
    await fails(as(db, fin, `select public.title_pay($1,$2,10,current_date,0,0,0,null,$3)`, [t, acc.banco, key()]), 'title_closed');
  });

  await test('relatório gerencial: caixa x competência, com critérios explícitos', async () => {
    const from = `date_trunc('month', current_date)::date`;
    const cx = (await as(db, fin, `select receitas, despesas from public.finance_summary(${from}, current_date + 400, 'caixa')`)).rows;
    const r = cx.reduce((s, x) => s + Number(x.receitas), 0), d = cx.reduce((s, x) => s + Number(x.despesas), 0);
    eq(r, 3000 + 150, 'receitas em caixa: pedido 1 (1500+500+1000) + sinal do pedido 2');
    eq(d, 100, 'despesas em caixa: adiantamento ao fornecedor');
    const cp = (await as(db, fin, `select receitas from public.finance_summary(${from}, current_date + 400, 'competencia')`)).rows;
    ok(cp.reduce((s, x) => s + Number(x.receitas), 0) >= 3000 + 300, 'competência inclui o que ainda não foi pago');
    await fails(as(db, fin, `select * from public.finance_summary(${from}, current_date, 'outro')`), 'invalid_regime');
    await fails(as(db, ana, `select * from public.finance_summary(${from}, current_date, 'caixa')`), 'forbidden');
  });

  await test('conciliação manual: casa extrato com lançamento de mesmo valor e conta, sem repetir', async () => {
    const mov = (await sudo(db, `select id from public.cash_movements where payment_id=$1 and kind='recebimento'`, [acc.p1])).rows[0].id;
    const l1 = (await as(db, fin, `select public.statement_add_line($1,current_date,'PIX recebido',1500) id`, [acc.banco])).rows[0].id;
    const l2 = (await as(db, fin, `select public.statement_add_line($1,current_date,'PIX recebido (duplicado)',1500) id`, [acc.banco])).rows[0].id;
    const l3 = (await as(db, fin, `select public.statement_add_line($1,current_date,'valor diferente',1499) id`, [acc.banco])).rows[0].id;
    await fails(as(db, fin, `select public.statement_match($1,$2)`, [l3, mov]), 'mismatch');
    await as(db, fin, `select public.statement_match($1,$2)`, [l1, mov]);
    await fails(as(db, fin, `select public.statement_match($1,$2)`, [l1, mov]), 'already_matched');
    await fails(as(db, fin, `select public.statement_match($1,$2)`, [l2, mov]), 'movement_already_matched');
    await as(db, fin, `select public.statement_unmatch($1)`, [l1]);
    await fails(as(db, ana, `select public.statement_add_line($1,current_date,'x',1)`, [acc.banco]), 'forbidden');
  });

  await test('portal: cliente (aprovador) vê as cobranças do pedido dele; leitor, outra empresa e anônimo não', async () => {
    const mine = (await as(db, cliente, `select * from public.portal_titles where order_id=$1`, [acc.o1])).rows;
    eq(mine.length, 2); ok(!Object.keys(mine[0]).some(k => /category|cost_center|created_by|supplier/.test(k)));
    eq((await as(db, leitor, `select * from public.portal_titles`)).rows.length, 0);
    eq((await as(db, clienteBeta, `select * from public.portal_titles`)).rows.length, 0);
    await fails(as(db, null, `select * from public.portal_titles`), 'permission denied');
    eq(mine.every(t => t.status === 'pago'), true);
  });
}

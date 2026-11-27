export default async function ({ db, as, sudo, createUser, test, ok, eq, fails }) {
  const { marcelo, ana, cliente } = globalThis.__u;
  const loc = (await sudo(db, `select id from public.stock_locations where code='PRINCIPAL'`)).rows[0].id;
  const mk = async (sku, qty, extra = '') => {
    const id = (await sudo(db, `insert into public.items(type, sku, name, store_published ${extra ? ',' + extra.split('=')[0] : ''}) values ('produto_acabado',$1,$2,true ${extra ? ',' + extra.split('=')[1] : ''}) returning id`, [sku, 'Loja ' + sku])).rows[0].id;
    await sudo(db, `insert into public.price_tiers(item_id, tier_id, price) values ($1,1,2.50)`, [id]);
    if (qty) await sudo(db, `insert into public.stock_movements(item_id, location_id, qty, kind) values ($1,$2,$3,'entrada')`, [id, loc, qty]);
    return id;
  };
  const A = await mk('LJ-A', 1000), B = await mk('LJ-B', 50), C = await mk('LJ-C', 500, 'min_qty=10');
  const unpub = await mk('LJ-U', 100); await sudo(db, `update public.items set store_published=false where id=$1`, [unpub]);
  const noprice = (await sudo(db, `insert into public.items(type, sku, name, store_published) values ('produto_acabado','LJ-NP','Sem preço',true) returning id`)).rows[0].id;
  const excl = await mk('LJ-X', 100); await sudo(db, `update public.items set store_published=false, exclusive_customer_id=$1 where id=$2`, [globalThis.__alfa, excl]);
  const buyer = (o = {}) => JSON.stringify({ name: 'Maria Compradora', tax_id: '529.982.247-25', phone: '(14) 99999-0000', email: 'm@ex.com', freight_mode: 'fob', carrier_name: 'Transp X', ...o });
  const items = (...l) => JSON.stringify(l.map(([item_id, qty]) => ({ item_id, qty })));
  const create = (b, i, ip = null) => as(db, 'service', `select public.store_create_order($1::jsonb,$2::jsonb,$3) r`, [b, i, ip]);
  const avail = async (i) => Number((await as(db, 'service', `select floor(app.store_available($1)) a`, [i])).rows[0].a);
  let o1;

  await test('funções da loja só executam pelo servidor (anônimo, comercial e cliente são barrados)', async () => {
    for (const u of [null, ana, cliente, marcelo])
      await fails(as(db, u, `select * from public.store_catalog()`), 'permission denied|forbidden');
    await fails(as(db, null, `select public.store_create_order('{}'::jsonb,'[]'::jsonb,null)`), 'permission denied');
    await fails(as(db, marcelo, `select public.store_confirm_payment('X','infinitepay','r',1)`), 'permission denied|forbidden');
  });

  await test('catálogo: só publicado, ativo, não exclusivo e com preço da faixa 1', async () => {
    const r = (await as(db, 'service', `select sku, price, available, min_qty from public.store_catalog()`)).rows.map(x => x.sku);
    ok(r.includes('LJ-A') && r.includes('LJ-B') && r.includes('LJ-C'));
    ok(!r.includes('LJ-U') && !r.includes('LJ-NP') && !r.includes('LJ-X'), 'não publicados/sem preço/exclusivos ficam fora');
    const c = (await as(db, 'service', `select min_qty, available, price from public.store_catalog() where sku='LJ-C'`)).rows[0];
    eq([c.min_qty, c.available, Number(c.price)], [10, 500, 2.5]);
  });

  await test('compra cria pedido da loja com preço do banco, título a receber, token e prazo', async () => {
    const r = (await create(buyer(), items([A, 100], [B, 10]))).rows[0].r;
    o1 = r;
    eq(Number(r.total), 275);
    ok(r.token.length >= 60);
    const o = (await sudo(db, `select channel, deposit_pct, status_financial, expires_at, total from public.orders where id=$1`, [r.order_id])).rows[0];
    eq([o.channel, Number(o.deposit_pct), o.status_financial], ['loja', 100, 'aguardando_sinal']);
    ok(o.expires_at > new Date());
    const t = (await sudo(db, `select kind, amount from public.financial_titles where origin_type='order' and origin_id=$1`, [r.order_id])).rows;
    eq([t.length, t[0].kind, Number(t[0].amount)], [1, 'receber', 275]);
  });

  await test('reserva: estoque disponível cai enquanto o pedido está aberto', async () => {
    eq(await avail(A), 900); eq(await avail(B), 40);
  });

  await test('validações: quantidade, estoque, itens indisponíveis, dados do comprador e frete', async () => {
    await fails(create(buyer(), items([A, 301])), 'above_limit');
    await fails(create(buyer(), items([C, 5])), 'below_minimum');
    await fails(create(buyer(), items([B, 41])), 'insufficient_stock');
    await fails(create(buyer(), items([unpub, 1])), 'item_unavailable');
    await fails(create(buyer(), items([excl, 1])), 'item_unavailable');
    await fails(create(buyer(), items([noprice, 1])), 'item_unavailable|no_price');
    await fails(create(buyer(), items([A, 0])), 'invalid_qty');
    await fails(create(buyer(), '[]'), 'no_items');
    await fails(create(buyer({ tax_id: '111.111.111-11' }), items([A, 1])), 'invalid_tax_id');
    await fails(create(buyer({ name: '' }), items([A, 1])), 'name_required');
    await fails(create(buyer({ phone: '', email: '' }), items([A, 1])), 'contact_required');
    await fails(create(buyer({ freight_mode: 'entrega' }), items([A, 1])), 'invalid_shipping');
    await fails(create(buyer({ carrier_name: '' }), items([A, 1])), 'carrier_required');
    eq(await avail(A), 900, 'nada reservado nas recusas');
  });

  await test('limite de 300 vale por produto (linhas repetidas somam); preço enviado pelo cliente é ignorado', async () => {
    await fails(create(buyer(), JSON.stringify([{ item_id: A, qty: 200, price: 0.01 }, { item_id: A, qty: 150 }])), 'above_limit');
    const r = (await create(buyer({ freight_mode: 'retirada', carrier_name: '' }), JSON.stringify([{ item_id: A, qty: 4, price: 0.01 }]))).rows[0].r;
    eq(Number(r.total), 10);
  });

  await test('mesmo CPF reaproveita o cliente (sem duplicar)', async () => {
    eq(Number((await sudo(db, `select count(*) c from public.customers where tax_id='52998224725'`)).rows[0].c), 1);
  });

  await test('limite de pedidos por IP por hora', async () => {
    for (let i = 0; i < 5; i++) await create(buyer(), items([A, 1]), 'iprl');
    await fails(create(buyer(), items([A, 1]), 'iprl'), 'rate_limited');
  });

  await test('acompanhamento por token mostra só o necessário; token inválido não retorna nada', async () => {
    const v = (await as(db, 'service', `select public.store_order_by_token($1) r`, [o1.token])).rows[0].r;
    eq(v.number, o1.number); eq(v.items.length, 2);
    for (const k of ['ip_hash', 'customer_id', 'id', 'cost']) ok(!(k in v), 'vazou ' + k);
    eq((await as(db, 'service', `select public.store_order_by_token('x') r`)).rows[0].r, null);
    await fails(as(db, null, `select public.store_order_by_token($1)`, [o1.token]), 'permission denied');
  });

  await test('pagamento: valor menor é recusado; confirmação baixa o título e é idempotente', async () => {
    await fails(as(db, 'service', `select public.store_confirm_payment($1,'infinitepay','R1',100)`, [o1.number]), 'amount_mismatch');
    await fails(as(db, 'service', `select public.store_confirm_payment($1,'infinitepay','R1',275)`, [o1.number]), 'account_required', 'duas contas ativas e nenhuma configurada');
    const acc = (await sudo(db, `select id from public.bank_accounts where active order by name limit 1`)).rows[0].id;
    await sudo(db, `update public.settings set value=to_jsonb($1::text) where key='loja_conta_recebimento'`, [acc]);
    await as(db, 'service', `select public.store_confirm_payment($1,'infinitepay','R1',275)`, [o1.number]);
    const again = (await as(db, 'service', `select public.store_confirm_payment($1,'infinitepay','R1',275) r`, [o1.number])).rows[0].r;
    eq(again.already, true);
    eq((await sudo(db, `select status_financial from public.orders where id=$1`, [o1.order_id])).rows[0].status_financial, 'quitado');
    eq(Number((await sudo(db, `select count(*) c from public.cash_movements where title_id in (select id from public.financial_titles where origin_id=$1)`, [o1.order_id])).rows[0].c), 1);
  });

  await test('pedido não pago expira, libera o estoque e pagamento tardio vira conflito (nada é baixado)', async () => {
    const r = (await create(buyer(), items([B, 40]))).rows[0].r;
    eq(await avail(B), 0);
    await fails(create(buyer(), items([B, 1])), 'insufficient_stock');
    await sudo(db, `update public.orders set expires_at = now() - interval '1 minute' where id=$1`, [r.order_id]);
    ok(Number((await as(db, 'service', `select public.store_expire_unpaid() n`)).rows[0].n) >= 1);
    eq((await sudo(db, `select status_commercial from public.orders where id=$1`, [r.order_id])).rows[0].status_commercial, 'cancelado');
    eq(await avail(B), 40);
    const late = (await as(db, 'service', `select public.store_confirm_payment($1,'infinitepay','R2',100) r`, [r.number])).rows[0].r;
    eq(late.ok, false);
    eq((await sudo(db, `select status from public.store_payments where external_ref='R2'`)).rows[0].status, 'conflito');
    eq(Number((await sudo(db, `select count(*) c from public.payments where title_id in (select id from public.financial_titles where origin_id=$1)`, [r.order_id])).rows[0].c), 0);
  });

  await test('pedido já pago não expira', async () => {
    await sudo(db, `update public.orders set expires_at = now() - interval '1 minute' where id=$1`, [o1.order_id]);
    await as(db, 'service', `select public.store_expire_unpaid()`);
    ok((await sudo(db, `select status_commercial from public.orders where id=$1`, [o1.order_id])).rows[0].status_commercial !== 'cancelado');
  });

  await test('devolução: só após recebimento, dentro do prazo e uma por pedido', async () => {
    await fails(as(db, 'service', `select public.store_request_return($1,'não gostei')`, [o1.token]), 'not_received');
    await sudo(db, `update public.orders set received_at = now() where id=$1`, [o1.order_id]);
    await fails(as(db, 'service', `select public.store_request_return($1,' ')`, [o1.token]), 'reason_required');
    const rid = (await as(db, 'service', `select public.store_request_return($1,'não gostei') r`, [o1.token])).rows[0].r;
    await fails(as(db, 'service', `select public.store_request_return($1,'de novo')`, [o1.token]), 'already_requested');
    globalThis.__ret = rid;
  });

  await test('reembolso só depois da nota de devolução e só pelo financeiro; gera conta a pagar uma vez', async () => {
    const fin = (await sudo(db, `select user_id from public.user_roles where role='financeiro' limit 1`)).rows[0]?.user_id;
    const rid = globalThis.__ret;
    await fails(as(db, marcelo, `select public.store_return_refund($1)`, [rid]), 'invoice_required');
    await fails(as(db, marcelo, `select public.store_return_receive($1,' ')`, [rid]), 'invoice_required');
    await fails(as(db, cliente, `select public.store_return_receive($1,'123')`, [rid]), 'forbidden|permission');
    await as(db, marcelo, `select public.store_return_receive($1,'NF-DEV-55','voltou ok')`, [rid]);
    if (fin) await fails(as(db, ana, `select public.store_return_refund($1)`, [rid]), 'forbidden');
    await fails(as(db, marcelo, `select public.store_return_refund($1, 99999)`, [rid]), 'invalid_amount');
    const t = (await as(db, marcelo, `select public.store_return_refund($1) t`, [rid])).rows[0].t;
    const row = (await sudo(db, `select kind, amount from public.financial_titles where id=$1`, [t])).rows[0];
    eq([row.kind, Number(row.amount)], ['pagar', 275]);
    await fails(as(db, marcelo, `select public.store_return_refund($1)`, [rid]), 'invoice_required');
  });

  await test('devolução fora do prazo é recusada', async () => {
    const r = (await create(buyer({ tax_id: '11.222.333/0001-81' }), items([A, 2]))).rows[0].r;
    await sudo(db, `update public.orders set received_at = now() - interval '8 days', status_financial='quitado' where id=$1`, [r.order_id]);
    await fails(as(db, 'service', `select public.store_request_return($1,'x')`, [r.token]), 'return_window_closed');
  });

  await test('tabelas da loja: cliente e anônimo não leem pagamentos/devoluções', async () => {
    eq((await as(db, cliente, `select * from public.store_payments`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.store_returns`)).rows.length, 0);
    await fails(as(db, null, `select * from public.store_payments`), 'permission denied');
  });
}

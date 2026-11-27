export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;
  const alfa = globalThis.__alfa, beta = globalThis.__beta, item = globalThis.__item;
  const fin = (await sudo(db, `select user_id from public.user_roles where role='financeiro' limit 1`)).rows[0].user_id;
  const estoque = (await sudo(db, `select user_id from public.user_roles where role='estoque' limit 1`)).rows[0].user_id;
  const loc = (await sudo(db, `select id from public.stock_locations where code='PRINCIPAL'`)).rows[0].id;
  const resina = (await sudo(db, `select id from public.items where sku='PEAD-NAT'`)).rows[0].id;
  const bal = async i => Number((await sudo(db, `select coalesce(sum(qty),0) b from public.stock_movements where item_id=$1`, [i])).rows[0].b);

  // helper: orçamento aprovado pelo cliente -> pedido (1.000 frascos a R$ 3,00)
  const mkOrder = async (qty = 1000) => {
    const q = (await as(db, ana, `select public.quote_create($1) id`, [alfa])).rows[0].id;
    const v = (await sudo(db, `select id from public.quote_versions where quote_id=$1`, [q])).rows[0].id;
    await as(db, ana, `insert into public.quote_items(version_id,item_id,description,qty,unit_price,unit_cost,position) values ($1,$2,'Frasco 250 ml',$3,3.00,2.00,1)`, [v, item, qty]);
    await as(db, ana, `update public.quote_versions set valid_until=current_date+5 where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    const o = (await as(db, cliente, `select public.portal_approve_quote($1) o`, [v])).rows[0].o;
    const oi = (await sudo(db, `select id from public.order_items where order_id=$1`, [o])).rows[0].id;
    return { o, oi };
  };
  const release = async o => {
    await as(db, fin, `select public.order_set_status($1,'financial','sinal_pago')`, [o]);
    await as(db, producao, `select public.order_set_status($1,'production','liberado')`, [o]);
  };

  const { o, oi } = await mkOrder();
  globalThis.__prodOrder = { o, oi };

  await test('máquinas e moldes: só produção/admin cadastram; molde do cliente exige o cliente dono', async () => {
    const m = (await as(db, producao, `insert into public.machines(code,name,kind) values ('INJ-01','Injetora 1','injecao') returning id`)).rows[0].id;
    await fails(as(db, ana, `insert into public.machines(code,name,kind) values ('X','x','injecao')`), 'row-level security');
    await fails(as(db, producao, `insert into public.machines(code,name,kind) values ('INJ-01','dup','injecao')`), 'machines_code_key');
    await fails(as(db, producao, `insert into public.molds(code,name,ownership) values ('M-X','x','cliente')`), 'molds_owner_customer');
    const mold = (await as(db, producao, `insert into public.molds(code,name,cavities) values ('M-001','Molde frasco 250',2) returning id`)).rows[0].id;
    const molde2 = (await as(db, producao, `insert into public.molds(code,name,ownership,customer_id,status) values ('M-CLI','Molde da Alfa','cliente',$1,'manutencao') returning id`, [alfa])).rows[0].id;
    await as(db, producao, `insert into public.mold_items(mold_id,item_id) values ($1,$2)`, [mold, item]);
    globalThis.__m = { m, mold, molde2 };
    eq((await as(db, cliente, `select * from public.molds`)).rows.length, 0, 'cliente não vê moldes');
  });

  await test('ordens de produção: parciais e várias por pedido, sem passar da quantidade pedida', async () => {
    const { m, mold, molde2 } = globalThis.__m;
    await fails(as(db, ana, `select public.production_create($1,100)`, [oi]), 'forbidden');
    await fails(as(db, producao, `select public.production_create($1,1001)`, [oi]), 'exceeds_order');
    await fails(as(db, producao, `select public.production_create($1,100,$2,$3)`, [oi, m, molde2]), 'mold_unavailable');
    const a = (await as(db, producao, `select public.production_create($1,600,$2,$3) id`, [oi, m, mold])).rows[0].id;
    await fails(as(db, producao, `select public.production_create($1,500)`, [oi]), 'exceeds_order');
    const b = (await as(db, producao, `select public.production_create($1,400) id`, [oi])).rows[0].id;
    ok(/^OP-\d{4}-\d{4}$/.test((await sudo(db, `select number from public.production_orders where id=$1`, [a])).rows[0].number));
    globalThis.__ops = { a, b };
  });

  await test('OP só é liberada com o pedido liberado (sinal etc.)', async () => {
    const { a } = globalThis.__ops;
    await fails(as(db, producao, `select public.production_release($1)`, [a]), 'order_not_released');
    await release(o);
    await fails(as(db, ana, `select public.production_release($1)`, [a]), 'forbidden');
    await as(db, producao, `select public.production_release($1)`, [a]);
    await as(db, producao, `select public.production_release($1)`, [globalThis.__ops.b]);
    await fails(as(db, producao, `select public.production_release($1)`, [a]), 'not_planned');
  });

  await test('apontamento consome matéria-prima do estoque e é idempotente', async () => {
    const { a } = globalThis.__ops;
    const antes = await bal(resina);
    await fails(as(db, estoque, `select public.production_report($1,100,0,0,0,null,null,$2,'[]'::jsonb,'r0')`, [a, loc]), 'forbidden');
    await fails(as(db, producao, `select public.production_report($1,100,200,0,0,null,null,$2,'[]'::jsonb,'r0')`, [a, loc]), 'invalid_qty');
    await fails(as(db, producao, `select public.production_report($1,100,0,0,0,null,null,$2,$3::jsonb,'r-bad')`, [a, loc, JSON.stringify([{ item_id: resina, qty: 999999 }])]), 'insufficient_stock');
    eq(await bal(resina), antes, 'falha não consome nada');
    eq(Number((await sudo(db, `select count(*) c from public.production_reports where idempotency_key='r-bad'`)).rows[0].c), 0, 'relatório também desfeito');
    const cons = JSON.stringify([{ item_id: resina, qty: 24 }]);
    const r1 = (await as(db, producao, `select public.production_report($1,500,20,5,15,'Troca de bico',null,$2,$3::jsonb,'r1') id`, [a, loc, cons])).rows[0].id;
    const r2 = (await as(db, producao, `select public.production_report($1,500,20,5,15,'Troca de bico',null,$2,$3::jsonb,'r1') id`, [a, loc, cons])).rows[0].id;
    eq(r1, r2); eq(await bal(resina), antes - 24, 'consumo uma única vez');
    const po = (await sudo(db, `select status, qty_produced, qty_scrap from public.production_orders where id=$1`, [a])).rows[0];
    eq([po.status, Number(po.qty_produced), Number(po.qty_scrap)], ['em_producao', 500, 20]);
    eq((await sudo(db, `select status_production from public.orders where id=$1`, [o])).rows[0].status_production, 'em_producao');
  });

  await test('qualidade: acabado só entra no estoque após a liberação; não aprova mais que o produzido', async () => {
    const { a } = globalThis.__ops;
    const antes = await bal(item);
    await fails(as(db, ana, `select public.quality_release($1,100,100,$2,null,null,'q0')`, [a, loc]), 'forbidden');
    await fails(as(db, producao, `select public.quality_release($1,481,481,$2,null,null,'q0')`, [a, loc]), 'exceeds_produced');   // produziu 500, refugou 20 -> 480 bons
    await fails(as(db, producao, `select public.quality_release($1,100,90,$2,null,null,'q0')`, [a, loc]), 'note_required');
    eq(await bal(item), antes, 'nada entrou antes da liberação');
    await as(db, producao, `select public.quality_release($1,300,290,$2,'LOTE-A','10 com rebarba','q1')`, [a, loc]);
    await as(db, producao, `select public.quality_release($1,300,290,$2,'LOTE-A','10 com rebarba','q1')`, [a, loc]);   // reenvio
    eq(await bal(item), antes + 290, 'entrada uma única vez, só dos aprovados');
    eq(Number((await sudo(db, `select qty_produced q from public.order_items where id=$1`, [oi])).rows[0].q), 290);
    await fails(as(db, producao, `select public.quality_release($1,181,181,$2,null,null,'q2')`, [a, loc]), 'exceeds_produced');   // 480-300=180 restantes
    await as(db, producao, `select public.quality_release($1,180,180,$2,'LOTE-A',null,'q3')`, [a, loc]);
    eq(await bal(item) - antes, 470);
  });

  await test('concluir OP com falta exige justificativa; pedido fica em produção parcial e depois concluído', async () => {
    const { a, b } = globalThis.__ops;
    await fails(as(db, producao, `select public.production_set_status($1,'conclude')`, [a]), 'short_note_required');
    await as(db, producao, `select public.production_set_status($1,'conclude','refugo acima do previsto; 130 a repor')`, [a]);
    eq((await sudo(db, `select status_production from public.orders where id=$1`, [o])).rows[0].status_production, 'em_producao', 'a outra OP ainda está ativa');
    await fails(as(db, producao, `select public.production_report($1,10,0,0,0,null,null,$2,null,'r-pos')`, [a, loc]), 'po_not_active');
    // segunda OP: produz tudo, aprova tudo
    await as(db, producao, `select public.production_report($1,400,0,0,0,null,null,$2,null,'r2')`, [b, loc]);
    await as(db, producao, `select public.quality_release($1,400,400,$2,'LOTE-B',null,'q4')`, [b, loc]);
    await as(db, producao, `select public.production_set_status($1,'conclude')`, [b]);
    eq((await sudo(db, `select status_production from public.orders where id=$1`, [o])).rows[0].status_production, 'parcial', 'ainda falta 130 do item (470+400 = 870 < 1000)');
    // nova OP para repor os 130
    await fails(as(db, producao, `select public.production_create($1,131)`, [oi]), 'exceeds_order');
    const c = (await as(db, producao, `select public.production_create($1,130) id`, [oi])).rows[0].id.toString();
    ok(c);
  });

  await test('pausar/retomar e cancelar OP sem apontamento', async () => {
    const x = await mkOrder(100);
    const op = (await as(db, producao, `select public.production_create($1,100) id`, [x.oi])).rows[0].id;
    await fails(as(db, producao, `select public.production_set_status($1,'cancel','')`, [op]), 'reason_required');
    await as(db, producao, `select public.production_set_status($1,'cancel','pedido cancelado pelo cliente')`, [op]);
    eq((await sudo(db, `select status from public.production_orders where id=$1`, [op])).rows[0].status, 'cancelada');
    await fails(as(db, producao, `select public.production_set_status($1,'pause')`, [globalThis.__ops.a]), 'invalid_transition');
  });

  // ---------------- Expedição ----------------
  await test('separação parcial: não passa da quantidade do pedido; pagamento não exigido por padrão no orçamento', async () => {
    await fails(as(db, producao, `select public.shipment_create($1,'[]'::jsonb)`, [o]), 'forbidden');
    await fails(as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [o, JSON.stringify([{ order_item_id: oi, qty: 1001 }])]), 'exceeds_order');
    const s1 = (await as(db, estoque, `select public.shipment_create($1,$2::jsonb) id`, [o, JSON.stringify([{ order_item_id: oi, qty: 400 }])])).rows[0].id;
    await fails(as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [o, JSON.stringify([{ order_item_id: oi, qty: 700 }])]), 'exceeds_order');   // 400 já separados
    eq((await sudo(db, `select status_logistics from public.orders where id=$1`, [o])).rows[0].status_logistics, 'separado');
    globalThis.__s1 = s1;
  });

  await test('coleta: exige nota fiscal, transportadora (FOB) e agenda; baixa o estoque só na coleta', async () => {
    const s1 = globalThis.__s1;
    await as(db, estoque, `select public.shipment_set_status($1,'pronto_coleta',null,3,120.5)`, [s1]);
    eq((await sudo(db, `select status_logistics from public.orders where id=$1`, [o])).rows[0].status_logistics, 'pronto_coleta');
    await fails(as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada',now() + interval '1 day')`, [s1]), 'invoice_required');
    await as(db, fin, `select public.order_register_invoice($1,'9001')`, [o]);
    await fails(as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada',now() + interval '1 day')`, [s1]), 'carrier_required');
    await as(db, cliente, `select public.portal_set_carrier($1,'Transportadora Rápida')`, [o]);
    await fails(as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada')`, [s1]), 'schedule_required');
    await as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada',now() + interval '1 day')`, [s1]);
    const antes = await bal(item);
    await as(db, estoque, `select public.shipment_set_status($1,'coletado',null,null,null,'BR123')`, [s1]);
    eq(await bal(item), antes - 400, 'baixa na coleta');
    eq(Number((await sudo(db, `select qty_shipped q from public.order_items where id=$1`, [oi])).rows[0].q), 400);
    eq((await sudo(db, `select status_logistics from public.orders where id=$1`, [o])).rows[0].status_logistics, 'coletado_parcial');
    await fails(as(db, estoque, `select public.shipment_set_status($1,'coletado')`, [s1]), 'invalid_transition');
  });

  await test('segunda coleta completa o pedido; saldo pendente e logística coerentes', async () => {
    const s2 = (await as(db, estoque, `select public.shipment_create($1,$2::jsonb) id`, [o, JSON.stringify([{ order_item_id: oi, qty: 600 }])])).rows[0].id;
    await fails(as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [o, JSON.stringify([{ order_item_id: oi, qty: 1 }])]), 'exceeds_order');
    await as(db, estoque, `select public.shipment_set_status($1,'pronto_coleta')`, [s2]);
    await as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada',now() + interval '2 day')`, [s2]);
    const antes = await bal(item);
    if (antes < 600) await sudo(db, `insert into public.stock_movements(item_id,location_id,qty,kind) values ($1,$2,$3,'entrada')`, [item, loc, 600 - antes + 10]);
    await as(db, estoque, `select public.shipment_set_status($1,'coletado')`, [s2]);
    eq((await sudo(db, `select status_logistics from public.orders where id=$1`, [o])).rows[0].status_logistics, 'coletado');
    eq(Number((await sudo(db, `select qty_shipped q from public.order_items where id=$1`, [oi])).rows[0].q), 1000);
  });

  await test('sem estoque suficiente a coleta não acontece (e nada é baixado pela metade)', async () => {
    const x = await mkOrder(100); await release(x.o);
    await as(db, fin, `select public.order_register_invoice($1,'9002')`, [x.o]);
    await as(db, cliente, `select public.portal_set_carrier($1,'Transp')`, [x.o]);
    const saved = (await sudo(db, `select location_id, lot_id, sum(qty) q from public.stock_movements where item_id=$1 group by 1,2 having sum(qty)<>0`, [item])).rows;
    for (const r of saved) await sudo(db, `insert into public.stock_movements(item_id,location_id,lot_id,qty,kind) values ($1,$2,$3,$4,'saida')`, [item, r.location_id, r.lot_id, -Number(r.q)]);   // zera o estoque
    eq(await bal(item), 0);
    const s = (await as(db, estoque, `select public.shipment_create($1,$2::jsonb) id`, [x.o, JSON.stringify([{ order_item_id: x.oi, qty: 100 }])])).rows[0].id;
    await as(db, estoque, `select public.shipment_set_status($1,'pronto_coleta')`, [s]);
    await as(db, estoque, `select public.shipment_set_status($1,'coleta_agendada',now() + interval '1 day')`, [s]);
    await fails(as(db, estoque, `select public.shipment_set_status($1,'coletado')`, [s]), 'insufficient_available');
    eq(Number((await sudo(db, `select qty_shipped q from public.order_items where id=$1`, [x.oi])).rows[0].q), 0);
    // cancelar a separação devolve o status logístico do pedido
    await fails(as(db, estoque, `select public.shipment_cancel($1,'')`, [s]), 'reason_required');
    await as(db, estoque, `select public.shipment_cancel($1,'sem estoque, reagendar')`, [s]);
    eq((await sudo(db, `select status_logistics from public.orders where id=$1`, [x.o])).rows[0].status_logistics, 'aguardando');
    for (const r of saved) await sudo(db, `insert into public.stock_movements(item_id,location_id,lot_id,qty,kind) values ($1,$2,$3,$4,'entrada')`, [item, r.location_id, r.lot_id, Number(r.q)]);
  });

  await test('pedido da loja só é separado com pagamento integral confirmado', async () => {
    const o2 = (await sudo(db, `insert into public.orders(number, customer_id, channel, total, status_financial) values ('PED-LOJA-1',$1,'loja',50,'aguardando_sinal') returning id`, [beta])).rows[0].id;
    const oi2 = (await sudo(db, `insert into public.order_items(order_id,item_id,description,qty,unit_price) values ($1,$2,'Frasco',10,5) returning id`, [o2, item])).rows[0].id;
    await fails(as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [o2, JSON.stringify([{ order_item_id: oi2, qty: 10 }])]), 'payment_required');
    await as(db, fin, `select public.order_set_status($1,'financial','quitado')`, [o2]);
    await as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [o2, JSON.stringify([{ order_item_id: oi2, qty: 10 }])]);
  });

  await test('regra de quitação na coleta é configurável (decisão pendente da empresa)', async () => {
    const x = await mkOrder(10);
    await as(db, marcelo, `update public.settings set value='true' where key='coleta_exige_quitacao'`);
    await fails(as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [x.o, JSON.stringify([{ order_item_id: x.oi, qty: 10 }])]), 'payment_required');
    await as(db, marcelo, `update public.settings set value='false' where key='coleta_exige_quitacao'`);
    await as(db, estoque, `select public.shipment_create($1,$2::jsonb)`, [x.o, JSON.stringify([{ order_item_id: x.oi, qty: 10 }])]);
  });

  await test('portal: cliente vê só as próprias coletas, sem observações internas', async () => {
    const mine = (await as(db, cliente, `select * from public.portal_shipments where order_id=$1`, [o])).rows;
    ok(mine.length >= 2); ok(!Object.keys(mine[0]).some(k => /notes|cancel_reason|created_by/.test(k)));
    eq((await as(db, cliente, `select * from public.portal_shipment_items where shipment_id=$1`, [mine[0].id])).rows.length >= 1, true);
    eq((await as(db, (await sudo(db, `select user_id from public.customer_users where customer_id=$1 limit 1`, [beta])).rows[0].user_id, `select * from public.portal_shipments where order_id=$1`, [o])).rows.length, 0);
    eq((await as(db, cliente, `select * from public.shipments`)).rows.length, 0, 'tabela-base fechada');
    eq((await as(db, cliente, `select * from public.production_orders`)).rows.length, 0);
  });
}

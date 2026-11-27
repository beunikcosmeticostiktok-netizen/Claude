export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;
  const compras = await createUser(db, 'compras@exemplo.com', 'Carlos Compras');
  const estoque2 = await createUser(db, 'est2@exemplo.com', 'Elisa Estoque');
  await as(db, marcelo, `select public.admin_grant_role($1,'compras')`, [compras]);
  await as(db, marcelo, `select public.admin_grant_role($1,'estoque')`, [estoque2]);
  const loc = (await sudo(db, `select id from public.stock_locations where code='PRINCIPAL'`)).rows[0].id;
  const item = globalThis.__item;                                   // frasco 250 ml
  const resina = (await as(db, marcelo, `insert into public.items(type, sku, name, uom) values ('materia_prima','PEAD-NAT','Resina PEAD natural','kg') returning id`)).rows[0].id;
  const bal = async (i = item) => Number((await sudo(db, `select coalesce(sum(qty),0) b from public.stock_movements where item_id=$1`, [i])).rows[0].b);

  await test('movimentação manual: só estoque/admin; entrada e saída respeitam o saldo', async () => {
    await fails(as(db, ana, `select public.stock_move($1,$2,100,'entrada')`, [item, loc]), 'forbidden');
    await fails(as(db, producao, `select public.stock_move($1,$2,100,'entrada')`, [item, loc]), 'forbidden');
    await as(db, estoque2, `select public.stock_move($1,$2,1000,'entrada',null,'saldo inicial')`, [item, loc]);
    eq(await bal(), 1000);
    await fails(as(db, estoque2, `select public.stock_move($1,$2,1500,'saida')`, [item, loc]), 'insufficient_available');
    await as(db, estoque2, `select public.stock_move($1,$2,200,'saida')`, [item, loc]);
    eq(await bal(), 800);
    await fails(as(db, estoque2, `select public.stock_move($1,$2,-5,'entrada')`, [item, loc]), 'invalid_qty');
  });

  await test('ajuste exige justificativa; saldo nunca fica negativo', async () => {
    await fails(as(db, estoque2, `select public.stock_move($1,$2,-10,'ajuste')`, [item, loc]), 'note_required');
    await as(db, estoque2, `select public.stock_move($1,$2,-10,'ajuste',null,'quebra no manuseio')`, [item, loc]);
    eq(await bal(), 790);
    await fails(sudo(db, `insert into public.stock_movements(item_id,location_id,qty,kind) values ($1,$2,-100000,'saida')`, [item, loc]), 'insufficient_stock');
  });

  await test('livro-razão é imutável: nem administrador edita ou apaga movimento', async () => {
    await fails(sudo(db, `update public.stock_movements set qty=1`), 'somente inserção');
    await fails(sudo(db, `delete from public.stock_movements`), 'somente inserção');
    await fails(as(db, marcelo, `delete from public.stock_movements`), 'permission denied');
    await fails(as(db, marcelo, `insert into public.stock_movements(item_id,location_id,qty,kind) values ($1,$2,5,'entrada')`, [item, loc]), 'permission denied');
  });

  await test('estorno cria movimento oposto, uma única vez, com justificativa', async () => {
    const m = (await as(db, estoque2, `select public.stock_move($1,$2,50,'entrada',null,'lançamento errado') id`, [item, loc])).rows[0].id;
    eq(await bal(), 840);
    await fails(as(db, estoque2, `select public.stock_reverse($1,'')`, [m]), 'note_required');
    await fails(as(db, ana, `select public.stock_reverse($1,'x')`, [m]), 'forbidden');
    const r = (await as(db, estoque2, `select public.stock_reverse($1,'era outro produto') id`, [m])).rows[0].id;
    eq(await bal(), 790);
    await fails(as(db, estoque2, `select public.stock_reverse($1,'de novo')`, [m]), 'already_reversed');
    await fails(as(db, estoque2, `select public.stock_reverse($1,'estorno do estorno')`, [r]), 'cannot_reverse_reversal');
    eq(String((await sudo(db, `select reversal_of from public.stock_movements where id=$1`, [r])).rows[0].reversal_of), String(m));
  });

  await test('transferência entre locais é atômica; lote é rastreado', async () => {
    const loc2 = (await as(db, estoque2, `insert into public.stock_locations(code,name) values ('EXPED','Expedição') returning id`)).rows[0].id;
    await as(db, estoque2, `select public.stock_move($1,$2,100,'entrada','L-001','lote de teste')`, [item, loc]);
    await as(db, estoque2, `select public.stock_transfer($1,$2,$3,40,'L-001')`, [item, loc, loc2]);
    const b = (await as(db, estoque2, `select location_id, physical from public.stock_balances where item_id=$1 and lot_id is not null order by physical`, [item])).rows;
    eq(b.map(x => Number(x.physical)), [40, 60]);
    await fails(as(db, estoque2, `select public.stock_transfer($1,$2,$3,9999,'L-001')`, [item, loc2, loc]), 'insufficient_stock');
    eq(await bal(), 890, 'transferência não altera o total');
    globalThis.__loc2 = loc2;
  });

  await test('reserva para pedido: reduz o disponível, não passa do pedido nem do estoque', async () => {
    const oi = (await sudo(db, `select oi.id, oi.qty from public.order_items oi join public.orders o on o.id=oi.order_id where oi.item_id is not null and o.status_commercial <> 'cancelado' order by o.created_at, oi.id limit 1`)).rows[0];
    ok(oi, 'precisa de item de pedido com produto do catálogo');
    const pos0 = Number((await as(db, ana, `select available from public.stock_position where item_id=$1`, [item])).rows[0].available);
    await fails(as(db, producao, `select public.stock_reserve($1,10)`, [oi.id]), 'forbidden');
    await as(db, ana, `select public.stock_reserve($1,300)`, [oi.id]);
    const pos1 = (await as(db, ana, `select physical, reserved, available from public.stock_position where item_id=$1`, [item])).rows[0];
    eq([Number(pos1.reserved), Number(pos1.available)], [300, pos0 - 300]);
    await fails(as(db, ana, `select public.stock_reserve($1,${oi.qty})`, [oi.id]), 'exceeds_order');
    await fails(as(db, estoque2, `select public.stock_move($1,$2,${pos0},'saida')`, [item, loc]), 'insufficient_available');   // reservado não sai
    const rid = (await sudo(db, `select id from public.stock_reservations where status='ativa' limit 1`)).rows[0].id;
    await as(db, ana, `select public.stock_release_reservation($1)`, [rid]);
    eq(Number((await as(db, ana, `select available from public.stock_position where item_id=$1`, [item])).rows[0].available), pos0);
    await fails(as(db, ana, `select public.stock_release_reservation($1)`, [rid]), 'not_active');
  });

  await test('fornecedor: só compras/admin cadastram; produção, estoque e cliente não leem', async () => {
    const s = (await as(db, compras, `insert into public.suppliers(legal_name, tax_id) values ('Resinas Brasil SA','11.222.333/0001-81') returning id, tax_id`)).rows[0];
    eq(s.tax_id, '11222333000181'); globalThis.__sup = s.id;
    await fails(as(db, compras, `insert into public.suppliers(legal_name, tax_id) values ('Dup','11222333000181')`), 'suppliers_tax_id_uk');
    await fails(as(db, compras, `insert into public.suppliers(legal_name, tax_id) values ('Inválido','11222333000199')`), 'suppliers_tax_id_valid');
    eq((await as(db, estoque2, `select * from public.suppliers`)).rows.length, 0);
    eq((await as(db, producao, `select * from public.suppliers`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.suppliers`)).rows.length, 0);
    await fails(as(db, ana, `insert into public.suppliers(legal_name) values ('x')`), 'row-level security');
  });

  await test('pedido de compra: rascunho → aprovação do gestor → envio; linhas travam após aprovar', async () => {
    const po = (await as(db, compras, `select public.po_create($1) id`, [globalThis.__sup])).rows[0].id;
    ok(/^COMP-\d{4}-\d{4}$/.test((await sudo(db, `select number from public.purchase_orders where id=$1`, [po])).rows[0].number));
    await fails(as(db, bruno, `select public.po_approve($1)`, [po]), 'no_items');
    await as(db, compras, `insert into public.purchase_lines(po_id,item_id,qty,unit_cost,position) values ($1,$2,500,12.5,1),($1,$3,1000,0.9,2)`, [po, resina, item]);
    await fails(as(db, compras, `select public.po_approve($1)`, [po]), 'forbidden');
    await fails(as(db, compras, `select public.po_mark_sent($1)`, [po]), 'not_approved');
    await as(db, bruno, `select public.po_approve($1)`, [po]);
    await fails(as(db, compras, `update public.purchase_lines set qty=1 where po_id=$1`, [po]), 'po_locked');
    await fails(as(db, compras, `insert into public.purchase_lines(po_id,item_id,qty,unit_cost) values ($1,$2,1,1)`, [po, resina]), 'po_locked');
    await as(db, compras, `select public.po_mark_sent($1)`, [po]);
    globalThis.__po = po;
  });

  await test('estoque confere o recebimento sem ver custo nem fornecedor', async () => {
    const po = globalThis.__po;
    eq((await as(db, estoque2, `select * from public.purchase_lines`)).rows.length, 0, 'sem acesso à tabela de custos');
    const v = (await as(db, estoque2, `select * from public.receiving_lines where po_id=$1 order by position`, [po])).rows;
    eq(v.length, 2); ok(!Object.keys(v[0]).some(k => /cost|supplier/.test(k)), 'visão sem custo/fornecedor');
    eq((await as(db, producao, `select * from public.receiving_lines`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.receiving_lines`)).rows.length, 0);
  });

  await test('recebimento parcial gera entrada em estoque; não passa da quantidade comprada', async () => {
    const po = globalThis.__po;
    const lines = (await as(db, estoque2, `select line_id, item_id from public.receiving_lines where po_id=$1 order by position`, [po])).rows;
    const antes = await bal(resina);
    await fails(as(db, producao, `select public.po_receive($1,$2,'NF1','[]'::jsonb,'k0')`, [po, loc]), 'forbidden');
    await fails(as(db, estoque2, `select public.po_receive($1,$2,'NF1',$3::jsonb,'k1')`, [po, loc, JSON.stringify([{ line_id: lines[0].line_id, qty: 600 }])]), 'over_receipt');
    eq(await bal(resina), antes, 'falha não deixa entrada parcial');
    await as(db, estoque2, `select public.po_receive($1,$2,'NF-123',$3::jsonb,'k2')`, [po, loc, JSON.stringify([{ line_id: lines[0].line_id, qty: 300, lot: 'RES-77' }])]);
    eq(await bal(resina), antes + 300);
    eq((await sudo(db, `select status from public.purchase_orders where id=$1`, [po])).rows[0].status, 'recebido_parcial');
    eq(Number((await sudo(db, `select qty_received q from public.purchase_lines where id=$1`, [lines[0].line_id])).rows[0].q), 300);
    globalThis.__lines = lines;
  });

  await test('reenvio do mesmo recebimento (mesma chave) não duplica a entrada', async () => {
    const po = globalThis.__po, lines = globalThis.__lines;
    const antes = await bal(resina);
    const payload = JSON.stringify([{ line_id: lines[0].line_id, qty: 300, lot: 'RES-77' }]);
    const a = (await as(db, estoque2, `select public.po_receive($1,$2,'NF-123',$3::jsonb,'k2') id`, [po, loc, payload])).rows[0].id;
    const b = (await as(db, estoque2, `select public.po_receive($1,$2,'NF-123',$3::jsonb,'k2') id`, [po, loc, payload])).rows[0].id;
    eq(a, b); eq(await bal(resina), antes, 'saldo igual');
    eq(Number((await sudo(db, `select count(*) c from public.receipts where idempotency_key='k2'`)).rows[0].c), 1);
  });

  await test('recebimento do restante conclui o pedido; compra recebida não cancela', async () => {
    const po = globalThis.__po, lines = globalThis.__lines;
    await fails(as(db, compras, `select public.po_cancel($1,'desistimos')`, [po]), 'has_receipts');
    await as(db, estoque2, `select public.po_receive($1,$2,'NF-124',$3::jsonb,'k3')`, [po, loc, JSON.stringify([
      { line_id: lines[0].line_id, qty: 200 }, { line_id: lines[1].line_id, qty: 1000, note: 'caixa amassada, conferido' }])]);
    eq((await sudo(db, `select status from public.purchase_orders where id=$1`, [po])).rows[0].status, 'recebido');
    await fails(as(db, estoque2, `select public.po_receive($1,$2,'NF-125',$3::jsonb,'k4')`, [po, loc, JSON.stringify([{ line_id: lines[0].line_id, qty: 1 }])]), 'not_receivable');
    eq(await bal(resina), 500);
    const note = (await sudo(db, `select discrepancy_note n from public.receipt_lines where discrepancy_note is not null`)).rows[0].n;
    eq(note, 'caixa amassada, conferido');
  });

  await test('cancelar compra sem recebimento exige motivo; produção/estoque/comercial não cancelam', async () => {
    const po = (await as(db, compras, `select public.po_create($1) id`, [globalThis.__sup])).rows[0].id;
    await fails(as(db, compras, `select public.po_cancel($1,'')`, [po]), 'reason_required');
    await fails(as(db, estoque2, `select public.po_cancel($1,'x')`, [po]), 'forbidden');
    await as(db, compras, `select public.po_cancel($1,'preço melhor em outro fornecedor')`, [po]);
    eq((await sudo(db, `select status from public.purchase_orders where id=$1`, [po])).rows[0].status, 'cancelado');
    await fails(as(db, estoque2, `select public.po_receive($1,$2,'x','[{}]'::jsonb,'k9')`, [po, loc]), 'not_receivable');
  });

  await test('estoque não é visível ao cliente do portal', async () => {
    eq((await as(db, cliente, `select * from public.stock_movements`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.stock_position`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.stock_balances`)).rows.length, 0);
  });
}

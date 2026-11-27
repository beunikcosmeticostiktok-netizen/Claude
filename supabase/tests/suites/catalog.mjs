export default async function ({ db, as, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;

  await test('administrador cadastra produto e os 5 preços por faixa; comercial só consulta', async () => {
    const it = (await as(db, marcelo, `insert into public.items(type, sku, name, category, material, weight_g)
      values ('produto_acabado','FRS-250','Frasco shampoo 250 ml','embalagens','PEAD',24) returning id`)).rows[0].id;
    globalThis.__item = it;
    for (const [t, p] of [[1, 3.2], [2, 2.9], [3, 2.6], [4, 2.4], [5, 2.1]])
      await as(db, marcelo, `insert into public.price_tiers(item_id, tier_id, price) values ($1,$2,$3)`, [it, t, p]);
    eq((await as(db, ana, `select count(*)::int c from public.price_tiers where item_id=$1`, [it])).rows[0].c, 5);
    await fails(as(db, ana, `insert into public.items(type, sku, name) values ('produto_acabado','X','x')`), 'row-level security');
    eq((await as(db, ana, `update public.price_tiers set price=0.01 where item_id=$1 returning item_id`, [it])).rows.length, 0, 'comercial não altera preço');
  });

  await test('preço escolhido pela quantidade: limites 300/301, 2.000/2.001, 5.000/5.001, 15.999/16.000', async () => {
    const it = globalThis.__item;
    const q = async n => Number((await as(db, ana, `select public.item_price_for_qty($1,$2) p`, [it, n])).rows[0].p);
    eq(await q(1), 3.2); eq(await q(300), 3.2); eq(await q(301), 2.9); eq(await q(2000), 2.9);
    eq(await q(2001), 2.6); eq(await q(5000), 2.6); eq(await q(5001), 2.4);
    eq(await q(15000), 2.4, 'mantém o preço da faixa “até 15 mil”'); eq(await q(15999), 2.4);
    eq(await q(16000), 2.1); eq(await q(1000000), 2.1);
  });

  await test('faixas: sem vão, sem sobreposição, exatamente 5; só o admin altera, de forma atômica', async () => {
    await fails(as(db, ana, `select public.admin_set_price_tiers('[]'::jsonb)`), 'forbidden');
    await fails(as(db, marcelo, `update public.price_tier_defs set qty_max=100 where ord=1`), 'permission denied');
    // cria vão (faixa 1 termina em 200, faixa 2 começa em 301)
    await fails(as(db, marcelo, `select public.admin_set_price_tiers('[{"ord":1,"qty_min":1,"qty_max":200}]'::jsonb)`), 'vão ou sobreposição');
    // troca válida: move o limite 1/2 para 500
    await as(db, marcelo, `select public.admin_set_price_tiers('[{"ord":1,"qty_min":1,"qty_max":500},{"ord":2,"qty_min":501,"qty_max":2000}]'::jsonb)`);
    eq(Number((await as(db, ana, `select public.item_price_for_qty($1,400) p`, [globalThis.__item])).rows[0].p), 3.2);
    await as(db, marcelo, `select public.admin_set_price_tiers('[{"ord":1,"qty_min":1,"qty_max":300},{"ord":2,"qty_min":301,"qty_max":2000}]'::jsonb)`);
  });

  await test('SKU único; preço não negativo', async () => {
    await fails(as(db, marcelo, `insert into public.items(type, sku, name) values ('produto_acabado','FRS-250','dup')`), 'items_sku_key');
    await fails(as(db, marcelo, `insert into public.price_tiers(item_id, tier_id, price) values ($1,1,-1)`, [globalThis.__item]), 'price_check|violates check');
  });

  await test('produção e cliente não alteram catálogo; cliente não lê itens nem preços', async () => {
    eq((await as(db, producao, `update public.items set name='x' returning id`)).rows.length, 0, 'produção não altera catálogo');
    eq((await as(db, cliente, `select id from public.items`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.price_tiers`)).rows.length, 0);
  });

  await test('custos: parâmetros em rascunho → validados e então imutáveis; cliente não vê nada', async () => {
    const set = (await as(db, bruno, `insert into public.cost_parameter_sets(name) values ('Padrão inicial') returning id`)).rows[0].id;
    await as(db, bruno, `insert into public.cost_parameters(set_id,key,value,unit) values ($1,'custo_hora_mao_obra',20,'R$/h')`, [set]);
    await fails(as(db, bruno, `update public.cost_parameter_sets set status='validado' where id=$1`, [set]), 'permission denied');
    await fails(as(db, ana, `select public.cost_set_validate($1)`, [set]), 'forbidden');
    await as(db, bruno, `select public.cost_set_validate($1)`, [set]);
    await fails(as(db, bruno, `update public.cost_parameters set value=99 where set_id=$1`, [set]), 'set_locked');
    await fails(as(db, bruno, `insert into public.cost_parameters(set_id,key,value) values ($1,'x',1)`, [set]), 'set_locked');
    await fails(as(db, bruno, `delete from public.cost_parameter_sets where id=$1`, [set]), 'set_locked');
    ok((await as(db, ana, `select * from public.cost_parameters`)).rows.length >= 1, 'comercial lê (decisão pendente)');
    eq((await as(db, cliente, `select * from public.cost_parameters`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.cost_sheets`)).rows.length, 0);
    eq((await as(db, producao, `select * from public.cost_parameters`)).rows.length, 0, 'produção não vê custos');
    globalThis.__set = set;
  });

  await test('ficha de custo exige alvo (item ou linha de orçamento) e guarda o resultado calculado', async () => {
    await fails(as(db, ana, `insert into public.cost_sheets(full_cost) values (1)`), 'cost_sheets_target');
    const s = (await as(db, ana, `insert into public.cost_sheets(item_id,set_id,direct_cost,full_cost,markup_min,min_price)
      values ($1,$2,1.5,2,1.5,3) returning id`, [globalThis.__item, globalThis.__set])).rows[0].id;
    await as(db, ana, `insert into public.cost_sheet_lines(sheet_id,block,description,quantity,unit_value,total) values ($1,'materia_prima','PEAD',0.024,10,0.24)`, [s]);
    await fails(as(db, ana, `insert into public.cost_sheet_lines(sheet_id,block,description) values ($1,'imposto','x')`, [s]), 'check');
  });
}

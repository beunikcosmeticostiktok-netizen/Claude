export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente } = globalThis.__u;
  const producao = await createUser(db, 'prod@exemplo.com', 'Paulo Produção');
  await as(db, marcelo, `select public.admin_grant_role($1,'producao')`, [producao]);
  globalThis.__u.producao = producao;

  await test('comercial cadastra cliente (CNPJ normalizado e validado); inválido é recusado', async () => {
    const r = await as(db, ana, `insert into public.customers(legal_name, tax_id) values ('Cosméticos Alfa Ltda','11.222.333/0001-81') returning id, tax_id`);
    eq(r.rows[0].tax_id, '11222333000181');
    globalThis.__alfa = r.rows[0].id;
    await fails(as(db, ana, `insert into public.customers(legal_name, tax_id) values ('X','11222333000182')`), 'customers_tax_id_valid');
    await fails(as(db, ana, `insert into public.customers(legal_name, tax_id) values ('Duplicada','11222333000181')`), 'customers_tax_id_uk');
  });

  await test('produção lê cadastros mas não escreve; anônimo e cliente não leem a tabela-base', async () => {
    ok((await as(db, producao, `select id from public.customers`)).rows.length >= 1);
    await fails(as(db, producao, `insert into public.customers(legal_name) values ('Nope')`), 'row-level security');
    eq((await as(db, cliente, `select id from public.customers`)).rows.length, 0);
    await fails(as(db, null, `select id from public.customers`), 'permission denied');
  });

  await test('cadastro usado não é excluído (sem DELETE) — só inativado', async () => {
    await fails(as(db, marcelo, `delete from public.customers where id=$1`, [globalThis.__alfa]), 'permission denied');
    await as(db, ana, `update public.customers set active=false where id=$1`, [globalThis.__alfa]);
    await as(db, ana, `update public.customers set active=true where id=$1`, [globalThis.__alfa]);
  });

  await test('vários contatos por empresa; login do cliente vê só a própria empresa (visão do portal)', async () => {
    const alfa = globalThis.__alfa;
    const beta = (await as(db, ana, `insert into public.customers(legal_name) values ('Pet Beta Ltda') returning id`)).rows[0].id;
    globalThis.__beta = beta;
    const c1 = (await as(db, ana, `insert into public.contacts(customer_id,name,email) values ($1,'Contato A','a@alfa.com') returning id`, [alfa])).rows[0].id;
    await as(db, ana, `insert into public.contacts(customer_id,name,email) values ($1,'Contato B','b@alfa.com')`, [alfa]);
    await as(db, ana, `insert into public.customer_users(user_id,customer_id,contact_id,access) values ($1,$2,$3,'aprovador')`, [cliente, alfa, c1]);
    const v = await as(db, cliente, `select id, legal_name from public.portal_customer`);
    eq(v.rows.length, 1); eq(v.rows[0].id, alfa);
    eq((await as(db, cliente, `select id from public.portal_customer where id=$1`, [beta])).rows.length, 0, 'não vê outra empresa');
  });

  await test('cliente não consegue se vincular a outra empresa nem alterar o próprio acesso', async () => {
    await fails(as(db, cliente, `insert into public.customer_users(user_id,customer_id,access) values ($1,$2,'aprovador')`, [cliente, globalThis.__beta]), 'row-level security');
    const r = await as(db, cliente, `update public.customer_users set access='financeiro' returning user_id`);
    eq(r.rows.length, 0);
  });

  await test('cliente inativo perde acesso imediatamente', async () => {
    await as(db, marcelo, `select public.admin_set_user_active($1,false)`, [cliente]);
    eq((await as(db, cliente, `select id from public.portal_customer`)).rows.length, 0);
    await as(db, marcelo, `select public.admin_set_user_active($1,true)`, [cliente]);
  });

  await test('landing → lead → oportunidade no primeiro estágio, com notificação ao administrador', async () => {
    const lead = (await as(db, 'service', `insert into public.leads(source, interest_type, name, company, phone, email, message, ip_hash)
      values ('landing','projeto_exclusivo','Carla Souza','Shampoos Gama','(14) 99999-1111','carla@gama.com','Quero um frasco exclusivo','ip1') returning id`)).rows[0].id;
    const opp = (await as(db, 'service', `select public.process_lead($1) as id`, [lead])).rows[0].id;
    const o = (await sudo(db, `select o.title, o.owner_id, s.name as stage from public.opportunities o join public.pipeline_stages s on s.id=o.stage_id where o.id=$1`, [opp])).rows[0];
    eq(o.stage, 'Novo contato'); eq(o.owner_id, marcelo); ok(o.title.startsWith('Projeto exclusivo'));
    const n = (await sudo(db, `select user_id, kind from public.notifications where entity_id=$1`, [opp])).rows[0];
    eq(n, { user_id: marcelo, kind: 'lead_novo' });
    eq((await sudo(db, `select status from public.leads where id=$1`, [lead])).rows[0].status, 'processado');
    globalThis.__lead = { lead, opp };
  });

  await test('process_lead é idempotente e reenvio do mesmo contato anexa à oportunidade aberta (sem duplicar)', async () => {
    const { lead, opp } = globalThis.__lead;
    eq((await as(db, 'service', `select public.process_lead($1) as id`, [lead])).rows[0].id, opp);
    const lead2 = (await as(db, 'service', `insert into public.leads(source, interest_type, name, phone, message)
      values ('landing','produto_existente','Carla S.','14 99999 1111','de novo') returning id`)).rows[0].id;
    const opp2 = (await as(db, 'service', `select public.process_lead($1) as id`, [lead2])).rows[0].id;
    eq(opp2, opp, 'mesma oportunidade');
    eq((await sudo(db, `select status from public.leads where id=$1`, [lead2])).rows[0].status, 'anexado');
    eq(Number((await sudo(db, `select count(*) c from public.customers where legal_name='Shampoos Gama'`)).rows[0].c), 1);
    eq(Number((await sudo(db, `select count(*) c from public.opportunities where customer_id=(select customer_id from public.leads where id=$1)`, [lead])).rows[0].c), 1);
  });

  await test('cliente do portal não lê leads e não processa leads; anônimo não insere lead', async () => {
    eq((await as(db, cliente, `select id from public.leads`)).rows.length, 0);
    await fails(as(db, cliente, `select public.process_lead($1)`, [globalThis.__lead.lead]), 'forbidden');
    await fails(as(db, null, `insert into public.leads(source, interest_type, name, phone) values ('landing','produto_existente','x','1')`), 'permission denied');
  });

  await test('limite de envios por hora (anti-spam) por IP e por telefone', async () => {
    for (let i = 0; i < 5; i++) await as(db, 'service', `insert into public.leads(source, interest_type, name, phone, ip_hash) values ('landing','produto_existente','S','(11) 98888-000${i}','spamip')`);
    eq((await as(db, 'service', `select public.lead_rate_ok('spamip', null) ok`)).rows[0].ok, false);
    eq((await as(db, 'service', `select public.lead_rate_ok('outroip', '11988880001') ok`)).rows[0].ok, true);
    await fails(as(db, ana, `select public.lead_rate_ok('x','1')`), 'permission denied');
  });

  await test('oportunidade perdida exige motivo; ganho registra fechamento; reabrir limpa fechamento', async () => {
    const { opp } = globalThis.__lead;
    const perdido = (await sudo(db, `select id from public.pipeline_stages where kind='perdida'`)).rows[0].id;
    const ganho = (await sudo(db, `select id from public.pipeline_stages where kind='ganha'`)).rows[0].id;
    const novo = (await sudo(db, `select id from public.pipeline_stages where position=1`)).rows[0].id;
    await fails(as(db, ana, `update public.opportunities set stage_id=$1 where id=$2`, [perdido, opp]), 'loss_reason_required');
    const motivo = (await sudo(db, `select id from public.loss_reasons limit 1`)).rows[0].id;
    await as(db, ana, `update public.opportunities set stage_id=$1, loss_reason_id=$2 where id=$3`, [perdido, motivo, opp]);
    ok((await sudo(db, `select closed_at from public.opportunities where id=$1`, [opp])).rows[0].closed_at);
    await as(db, ana, `update public.opportunities set stage_id=$1 where id=$2`, [novo, opp]);
    eq((await sudo(db, `select closed_at from public.opportunities where id=$1`, [opp])).rows[0].closed_at, null);
    await as(db, ana, `update public.opportunities set stage_id=$1 where id=$2`, [ganho, opp]);
    await as(db, ana, `update public.opportunities set stage_id=$1 where id=$2`, [novo, opp]);
  });

  await test('funil é configurável só pelo administrador', async () => {
    await fails(as(db, ana, `insert into public.pipeline_stages(name, position, kind) values ('X', 99, 'aberta')`), 'permission denied|row-level');
    await as(db, marcelo, `insert into public.pipeline_stages(name, position, kind) values ('Etapa extra', 99, 'aberta')`);
    await as(db, marcelo, `delete from public.pipeline_stages where position=99`);
  });

  await test('contato registrado à mão pelo comercial vira oportunidade e liga ao cliente existente (sem duplicar)', async () => {
    const lead = (await as(db, ana, `insert into public.leads(source, interest_type, name, company, phone, message, consent_at)
      values ('manual','produto_existente','Rita Alves','Cosméticos Alfa Ltda','(14) 98888-7777','[Origem: WhatsApp] quer tampas', now()) returning id`)).rows[0].id;
    const opp = (await as(db, ana, `select public.process_lead($1) id`, [lead])).rows[0].id;
    ok(opp);
    const l = (await sudo(db, `select source, status, customer_id from public.leads where id=$1`, [lead])).rows[0];
    eq(l.source, 'manual'); ok(['processado','anexado'].includes(l.status));
    // mesmo telefone de novo → anexa, não cria outro cliente
    const lead2 = (await as(db, ana, `insert into public.leads(source, interest_type, name, phone, consent_at) values ('manual','produto_existente','Rita','14 98888 7777', now()) returning id`)).rows[0].id;
    const opp2 = (await as(db, ana, `select public.process_lead($1) id`, [lead2])).rows[0].id;
    eq(opp2, opp);
    await fails(as(db, producao, `insert into public.leads(source, interest_type, name, phone) values ('manual','produto_existente','x','1')`), 'row-level security');
    await fails(as(db, ana, `insert into public.leads(source, interest_type, name, phone) values ('landing','produto_existente','x','1')`), 'row-level security');
  });
}

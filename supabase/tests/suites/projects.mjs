export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const { marcelo, ana, bruno, cliente, producao } = globalThis.__u;
  const alfa = globalThis.__alfa;
  const rid = async role => (await sudo(db, `select user_id from public.user_roles where role=$1 limit 1`, [role])).rows[0].user_id;
  const fin = await rid('financeiro');
  const leitor = (await sudo(db, `select id from auth.users where email='leitor@alfa.com'`)).rows[0].id;
  const clienteBeta = (await sudo(db, `select id from auth.users where email='cliente@beta.com'`)).rows[0].id;
  const stage = async id => (await sudo(db, `select stage from public.projects where id=$1`, [id])).rows[0].stage;
  const events = async (id, kind) => Number((await sudo(db, `select count(*) c from public.project_events where project_id=$1 and kind=$2`, [id, kind])).rows[0].c);

  // projeto até a etapa "proposta", com versão técnica enviada
  const toProposal = async (title = 'Frasco exclusivo') => {
    const p = (await as(db, ana, `select public.project_create($1,$2,'Frasco 300 ml com tampa flip, cor azul') id`, [alfa, title])).rows[0].id;
    await as(db, ana, `select public.project_advance($1,'viabilidade')`, [p]);
    await as(db, producao, `select public.project_set_feasibility($1,true,'Viável no molde de 2 cavidades')`, [p]);
    await as(db, ana, `select public.project_advance($1,'proposta')`, [p]);
    const v = (await as(db, ana, `select public.project_version_create($1,'Frasco PEAD 300 ml, parede 1,2 mm, tampa flip',null) id`, [p])).rows[0].id;
    await as(db, ana, `select public.project_version_send($1)`, [v]);
    return { p, v };
  };
  const mkOrderFor = async (itemId, qty = 100) => {
    const q = (await as(db, ana, `select public.quote_create($1) id`, [alfa])).rows[0].id;
    const v = (await sudo(db, `select id from public.quote_versions where quote_id=$1`, [q])).rows[0].id;
    await as(db, ana, `insert into public.quote_items(version_id,item_id,description,qty,unit_price,unit_cost,position) values ($1,$2,'Frasco exclusivo',$3,10,5,1)`, [v, itemId, qty]);
    await as(db, ana, `update public.quote_versions set valid_until=current_date+5 where id=$1`, [v]);
    await as(db, ana, `select public.quote_send($1)`, [v]);
    const o = (await as(db, cliente, `select public.portal_approve_quote($1) o`, [v])).rows[0].o;
    return { o, oi: (await sudo(db, `select id from public.order_items where order_id=$1`, [o])).rows[0].id };
  };

  await test('projeto nasce em briefing, numerado; só comercial/admin criam; cliente não vê a tabela', async () => {
    await fails(as(db, producao, `select public.project_create($1,'X')`, [alfa]), 'forbidden');
    const p = (await as(db, ana, `select public.project_create($1,'Escova pet exclusiva') id`, [alfa])).rows[0].id;
    ok(/^PRJ-\d{4}-\d{4}$/.test((await sudo(db, `select number from public.projects where id=$1`, [p])).rows[0].number));
    eq(await stage(p), 'briefing'); eq((await as(db, cliente, `select * from public.projects`)).rows.length, 0);
    globalThis.__pEscova = p;
  });

  await test('etapas têm exigências: briefing, viabilidade (com parecer), recusa com motivo; não pula etapa', async () => {
    const p = globalThis.__pEscova;
    await fails(as(db, ana, `select public.project_advance($1,'viabilidade')`, [p]), 'briefing_required');
    await as(db, ana, `update public.projects set briefing='Escova de banho para cães, cabo ergonômico' where id=$1`, [p]);
    await fails(as(db, producao, `select public.project_set_feasibility($1,true,'ok')`, [p]), 'wrong_stage');
    await as(db, ana, `select public.project_advance($1,'viabilidade')`, [p]);
    await fails(as(db, ana, `select public.project_set_feasibility($1,true,'ok')`, [p]), 'forbidden');
    await fails(as(db, producao, `select public.project_set_feasibility($1,true,'')`, [p]), 'note_required');
    await fails(as(db, ana, `select public.project_advance($1,'proposta')`, [p]), 'not_feasible');
    await as(db, producao, `select public.project_set_feasibility($1,false,'Exige molde acima da capacidade das injetoras')`, [p]);
    await fails(as(db, ana, `select public.project_advance($1,'proposta')`, [p]), 'not_feasible');
    await fails(as(db, ana, `select public.project_advance($1,'recusado')`, [p]), 'note_required');
    await as(db, ana, `select public.project_advance($1,'recusado','Inviável hoje; reavaliar com molde terceirizado')`, [p]);
    eq(await stage(p), 'recusado');
    await fails(as(db, ana, `select public.project_advance($1,'liberado')`, [p]), 'invalid_transition');
  });

  const P = await toProposal();
  await test('versão técnica: não envia sem requisitos nem antes da viabilidade; versão enviada é imutável', async () => {
    const early = (await as(db, ana, `select public.project_create($1,'Cedo') id`, [alfa])).rows[0].id;
    const ve = (await as(db, ana, `select public.project_version_create($1,'algo',null) id`, [early])).rows[0].id;
    await fails(as(db, ana, `select public.project_version_send($1)`, [ve]), 'wrong_stage');
    await fails(as(db, ana, `select public.project_version_create($1,'outra',null)`, [early]), 'draft_exists');
    await fails(sudo(db, `update public.project_versions set requirements='mudou' where id=$1`, [P.v]), 'version_locked');
    await fails(sudo(db, `delete from public.project_versions where id=$1`, [P.v]), 'version_locked');
    eq((await sudo(db, `select status from public.project_versions where id=$1`, [P.v])).rows[0].status, 'enviada');
  });

  await test('cliente aprova a versão: só o aprovador da própria empresa; duplo clique não duplica; libera “desenvolvimento”', async () => {
    await fails(as(db, ana, `select public.portal_approve_project_version($1)`, [P.v]), 'not_found');
    await fails(as(db, clienteBeta, `select public.portal_approve_project_version($1)`, [P.v]), 'not_found');
    await fails(as(db, leitor, `select public.portal_approve_project_version($1)`, [P.v]), 'forbidden');
    await fails(as(db, ana, `select public.project_advance($1,'desenvolvimento')`, [P.p]), 'version_not_approved');
    await as(db, cliente, `select public.portal_approve_project_version($1,'200.1.1.9')`, [P.v]);
    await as(db, cliente, `select public.portal_approve_project_version($1,'200.1.1.9')`, [P.v]);
    eq(await events(P.p, 'versao_aprovada'), 1);
    const v = (await sudo(db, `select status, approved_by, approved_via, approved_ip from public.project_versions where id=$1`, [P.v])).rows[0];
    eq(v, { status: 'aprovada', approved_by: cliente, approved_via: 'portal', approved_ip: '200.1.1.9' });
    await as(db, ana, `select public.project_advance($1,'desenvolvimento')`, [P.p]);
  });

  await test('amostra: criada pela produção, enviada, reprovada com motivo → volta ao desenvolvimento → nova amostra aprovada → liberado', async () => {
    await fails(as(db, ana, `select public.project_advance($1,'amostra')`, [P.p]), 'sample_required');
    await fails(as(db, ana, `select public.project_sample_create($1)`, [P.p]), 'forbidden');
    const s1 = (await as(db, producao, `select public.project_sample_create($1,'1ª amostra, molde protótipo') id`, [P.p])).rows[0].id;
    await as(db, ana, `select public.project_advance($1,'amostra')`, [P.p]);
    await fails(as(db, ana, `select public.project_advance($1,'aprovacao_amostra')`, [P.p]), 'sample_not_sent');
    await as(db, producao, `select public.project_sample_send($1)`, [s1]);
    await as(db, ana, `select public.project_advance($1,'aprovacao_amostra')`, [P.p]);
    await fails(as(db, ana, `select public.project_advance($1,'liberado')`, [P.p]), 'sample_not_approved');
    await fails(as(db, cliente, `select public.portal_decide_sample($1,false,'')`, [s1]), 'note_required');
    await fails(as(db, leitor, `select public.portal_decide_sample($1,true)`, [s1]), 'forbidden');
    await as(db, cliente, `select public.portal_decide_sample($1,false,'Tampa folgada')`, [s1]);
    await fails(as(db, ana, `select public.project_advance($1,'liberado')`, [P.p]), 'sample_not_approved');
    await fails(as(db, ana, `select public.project_advance($1,'desenvolvimento')`, [P.p]), 'note_required');
    await as(db, ana, `select public.project_advance($1,'desenvolvimento','Ajustar folga da tampa')`, [P.p]);
    const s2 = (await as(db, producao, `select public.project_sample_create($1,'2ª amostra') id`, [P.p])).rows[0].id;
    await as(db, producao, `select public.project_sample_send($1)`, [s2]);
    await as(db, ana, `select public.project_advance($1,'amostra')`, [P.p]);
    await as(db, ana, `select public.project_advance($1,'aprovacao_amostra')`, [P.p]);
    await fails(as(db, producao, `select public.project_sample_decide_internal($1,true,'ok')`, [s2]), 'forbidden');
    await as(db, cliente, `select public.portal_decide_sample($1,true,null)`, [s2]);
    await as(db, ana, `select public.project_advance($1,'liberado')`, [P.p]);
    const pr = (await sudo(db, `select stage, released_version_id, released_at from public.projects where id=$1`, [P.p])).rows[0];
    eq(pr.stage, 'liberado'); eq(pr.released_version_id, P.v); ok(pr.released_at);
  });

  await test('item exclusivo do catálogo: criado uma vez, nunca vai para a loja', async () => {
    await fails(as(db, producao, `select public.project_create_item($1)`, [P.p]), 'forbidden');
    const i1 = (await as(db, ana, `select public.project_create_item($1) id`, [P.p])).rows[0].id;
    const i2 = (await as(db, ana, `select public.project_create_item($1) id`, [P.p])).rows[0].id;
    eq(i1, i2);
    const it = (await sudo(db, `select sku, exclusive_customer_id, store_published from public.items where id=$1`, [i1])).rows[0];
    ok(it.sku.startsWith('EXC-PRJ-')); eq(it.exclusive_customer_id, alfa); eq(it.store_published, false);
    await fails(sudo(db, `update public.items set store_published=true where id=$1`, [i1]), 'items_exclusive_not_in_store');
    P.item = i1;
  });

  await test('pedido de item exclusivo: sem projeto liberado a produção não é liberada (nem com exceção no pedido)', async () => {
    const p2 = (await as(db, ana, `select public.project_create($1,'Em andamento','briefing') id`, [alfa])).rows[0].id;
    const it2 = (await as(db, ana, `select public.project_create_item($1) id`, [p2])).rows[0].id;
    const { o, oi } = await mkOrderFor(it2);
    const chk = (await as(db, producao, `select rule, ok from public.order_release_checks($1)`, [o])).rows;
    eq(chk.find(c => c.rule === 'aprovacao_tecnica').ok, false);
    await fails(as(db, producao, `select public.order_set_status($1,'production','liberado')`, [o]), 'release_blocked');
    await as(db, bruno, `select public.order_set_status($1,'production','liberado','Cliente pediu andamento, projeto em desenvolvimento')`, [o]);
    const op = (await as(db, producao, `select public.production_create($1,50) id`, [oi])).rows[0].id;
    await fails(as(db, producao, `select public.production_release($1)`, [op]), 'project_not_released');
    eq(Number((await sudo(db, `select count(*) c from public.order_items where id=$1 and project_version_id is not null`, [oi])).rows[0].c), 0);
  });

  await test('pedido de projeto liberado carrega a versão técnica aprovada até a ordem de produção', async () => {
    const { o, oi } = await mkOrderFor(P.item);
    eq((await sudo(db, `select project_version_id v from public.order_items where id=$1`, [oi])).rows[0].v, P.v);
    const chk = (await as(db, producao, `select rule, ok from public.order_release_checks($1)`, [o])).rows;
    eq(chk.find(c => c.rule === 'aprovacao_tecnica').ok, true);
    await as(db, fin, `select public.order_set_status($1,'financial','sinal_pago')`, [o]);
    await as(db, producao, `select public.order_set_status($1,'production','liberado')`, [o]);
    const op = (await as(db, producao, `select public.production_create($1,50) id`, [oi])).rows[0].id;
    eq((await sudo(db, `select project_version_id v from public.production_orders where id=$1`, [op])).rows[0].v, P.v);
    await as(db, producao, `select public.production_release($1)`, [op]);
    P.o = o; P.oi = oi;
  });

  await test('alterar o projeto técnico revoga a liberação: exige nova aprovação e nova amostra', async () => {
    const v2 = (await as(db, ana, `select public.project_version_create($1,'Parede 1,5 mm (reforçada)',null) id`, [P.p])).rows[0].id;
    await as(db, ana, `select public.project_version_send($1)`, [v2]);
    const pr = (await sudo(db, `select stage, released_version_id from public.projects where id=$1`, [P.p])).rows[0];
    eq([pr.stage, pr.released_version_id], ['proposta', null]);
    eq((await sudo(db, `select status from public.project_versions where id=$1`, [P.v])).rows[0].status, 'substituida');
    eq(await events(P.p, 'aprovacao_revogada'), 1);
    const op2 = (await as(db, producao, `select public.production_create($1,50) id`, [P.oi])).rows[0].id;
    await fails(as(db, producao, `select public.production_release($1)`, [op2]), 'project_not_released');
    await fails(as(db, cliente, `select public.portal_approve_project_version($1)`, [P.v]), 'not_approvable');
    await as(db, cliente, `select public.portal_approve_project_version($1)`, [v2]);
    await fails(as(db, ana, `select public.project_advance($1,'liberado')`, [P.p]), 'invalid_transition');
  });

  await test('cliente pede alteração da proposta; nova versão substitui a antiga', async () => {
    const X = await toProposal('Pote de máscara');
    await fails(as(db, leitor, `select public.portal_request_project_change($1,'x')`, [X.v]), 'forbidden');
    await fails(as(db, clienteBeta, `select public.portal_request_project_change($1,'x')`, [X.v]), 'not_found');
    await as(db, cliente, `select public.portal_request_project_change($1,'Podemos trocar a cor para branco?')`, [X.v]);
    eq(await events(X.p, 'alteracao_solicitada'), 1);
    await as(db, ana, `select public.project_version_approve_offline($1,'')`, [X.v]).catch(() => {});
    const v2 = (await as(db, ana, `select public.project_version_create($1,'Pote 250 g, cor branca',null) id`, [X.p])).rows[0].id;
    await as(db, ana, `select public.project_version_send($1)`, [v2]);
    await fails(as(db, cliente, `select public.portal_approve_project_version($1)`, [X.v]), 'not_approvable');
    await fails(as(db, ana, `select public.project_version_approve_offline($1,'')`, [v2]), 'note_required');
    await as(db, ana, `select public.project_version_approve_offline($1,'Aprovado por e-mail em 27/11')`, [v2]);
    eq((await sudo(db, `select approved_via from public.project_versions where id=$1`, [v2])).rows[0].approved_via, 'interno');
  });

  await test('portal mostra só o que é do cliente: sem custo interno, sem parecer de viabilidade, arquivos só os liberados', async () => {
    await as(db, ana, `select public.project_file_add($1,'desenho','Desenho técnico v1','https://drive.exemplo.com/desenho',null,true,1)`, [P.p]);
    await as(db, ana, `select public.project_file_add($1,'3d','Modelo 3D interno','https://drive.exemplo.com/3d',null,false,1)`, [P.p]);
    await fails(as(db, ana, `select public.project_file_add($1,'desenho','ruim','ftp://x',null,true,1)`, [P.p]), 'project_files_url_check');
    await as(db, ana, `insert into public.project_costs(project_id, internal_cost_estimate) values ($1, 8000)`, [P.p]);
    const prj = (await as(db, cliente, `select * from public.portal_projects`)).rows;
    ok(prj.length >= 2); ok(!Object.keys(prj[0]).some(k => /feasib|internal|owner|cost/.test(k)), 'colunas internas ausentes');
    const files = (await as(db, cliente, `select title from public.portal_project_files where project_id=$1`, [P.p])).rows;
    eq(files.map(f => f.title), ['Desenho técnico v1']);
    eq((await as(db, clienteBeta, `select * from public.portal_projects`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.project_costs`)).rows.length, 0);
    eq((await as(db, producao, `select * from public.project_costs`)).rows.length, 0, 'produção não vê custo');
    eq((await as(db, ana, `select * from public.project_costs`)).rows.length, 1);
    const vers = (await as(db, cliente, `select status from public.portal_project_versions where project_id=$1`, [P.p])).rows;
    ok(vers.every(v => v.status !== 'rascunho'));
  });

  await test('cancelar projeto exige motivo e remove a liberação; eventos registram o histórico', async () => {
    const X = await toProposal('Tampa especial');
    await fails(as(db, ana, `select public.project_cancel($1,'')`, [X.p]), 'reason_required');
    await fails(as(db, producao, `select public.project_cancel($1,'x')`, [X.p]), 'forbidden');
    await as(db, ana, `select public.project_cancel($1,'Cliente desistiu do projeto')`, [X.p]);
    eq(await stage(X.p), 'cancelado');
    await fails(as(db, ana, `select public.project_version_create($1,'x',null)`, [X.p]), 'invalid_transition');
    ok(await events(P.p, 'etapa') >= 6);
    eq((await as(db, cliente, `select * from public.project_events`)).rows.length, 0);
  });
}

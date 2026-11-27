export default async function ({ db, as, createUser, sudo, test, ok, eq, fails }) {
  const marcelo = await createUser(db, 'admin@exemplo.com', 'Admin Demo');   // 1º usuário => admin
  const ana     = await createUser(db, 'ana@exemplo.com', 'Ana Comercial');
  const bruno   = await createUser(db, 'bruno@exemplo.com', 'Bruno Gestor');
  const cliente = await createUser(db, 'cliente@empresa.com', 'Contato Cliente');
  globalThis.__u = { marcelo, ana, bruno, cliente };

  await test('primeiro usuário vira administrador; os demais não', async () => {
    const r = await sudo(db, `select user_id, role from public.user_roles order by created_at`);
    eq(r.rows.length, 1); eq(r.rows[0].user_id, marcelo); eq(r.rows[0].role, 'admin');
  });

  await test('perfil é criado automaticamente com e-mail e nome', async () => {
    const r = await sudo(db, `select email, full_name, active from public.profiles where id=$1`, [ana]);
    eq(r.rows[0], { email: 'ana@exemplo.com', full_name: 'Ana Comercial', active: true });
  });

  await test('anônimo não lê nada', async () => {
    await fails(as(db, null, `select * from public.profiles`), 'permission denied');
    await fails(as(db, null, `select * from public.settings`), 'permission denied');
  });

  await test('somente administrador concede papéis', async () => {
    await fails(as(db, ana, `select public.admin_grant_role($1,'gestor')`, [bruno]), 'forbidden');
    await as(db, marcelo, `select public.admin_grant_role($1,'gestor')`, [bruno]);
    await as(db, marcelo, `select public.admin_grant_role($1,'comercial')`, [ana]);
    const r = await sudo(db, `select role from public.user_roles where user_id=$1`, [bruno]);
    eq(r.rows.map(x => x.role), ['gestor']);
  });

  await test('ninguém altera papéis direto na tabela (nem o admin)', async () => {
    await fails(as(db, marcelo, `insert into public.user_roles(user_id, role) values ($1,'admin')`, [cliente]), 'permission denied');
    await fails(as(db, ana, `delete from public.user_roles`), 'permission denied');
  });

  await test('não é possível remover ou desativar o último administrador', async () => {
    await fails(as(db, marcelo, `select public.admin_revoke_role($1,'admin')`, [marcelo]), 'last_admin');
    await fails(as(db, marcelo, `select public.admin_set_user_active($1,false)`, [marcelo]), 'last_admin');
  });

  await test('usuário comum edita só nome/telefone do próprio perfil; não vira vendedor nem ativa', async () => {
    await as(db, ana, `update public.profiles set full_name='Ana C.' where id=$1`, [ana]);
    await fails(as(db, ana, `update public.profiles set is_seller=true where id=$1`, [ana]), 'permission denied');
    await fails(as(db, ana, `update public.profiles set active=false where id=$1`, [ana]), 'permission denied');
    const r = await as(db, ana, `update public.profiles set full_name='Hack' where id=$1 returning id`, [bruno]);
    eq(r.rows.length, 0, 'não pode alterar perfil de outro');
  });

  await test('cliente do portal não enxerga perfis, papéis, configurações nem auditoria', async () => {
    eq((await as(db, cliente, `select id from public.profiles`)).rows.length, 1, 'só o próprio perfil');
    eq((await as(db, cliente, `select * from public.settings`)).rows.length, 0);
    eq((await as(db, cliente, `select * from public.audit_log`)).rows.length, 0);
  });

  await test('configurações: todos os internos leem, só admin altera', async () => {
    ok((await as(db, ana, `select * from public.settings`)).rows.length >= 6);
    eq((await as(db, ana, `update public.settings set value='1.2' where key='markup_minimo' returning key`)).rows.length, 0);
    await as(db, marcelo, `update public.settings set value='1.5' where key='markup_minimo'`);
    const r = await sudo(db, `select app.setting_num('markup_minimo') as v`);
    eq(Number(r.rows[0].v), 1.5);
  });

  await test('auditoria registra quem concedeu o papel e é imutável', async () => {
    const r = await as(db, marcelo, `select actor, action, entity from public.audit_log where entity='user_roles' order by id desc limit 1`);
    eq(r.rows[0].entity, 'user_roles');
    await fails(sudo(db, `update public.audit_log set action='x'`), 'somente inserção');
    await fails(sudo(db, `delete from public.audit_log`), 'somente inserção');
    await fails(as(db, marcelo, `delete from public.audit_log`), 'permission denied');
  });

  await test('validação de CPF e CNPJ', async () => {
    const r = await sudo(db, `select app.valid_cpf('52998224725') a, app.valid_cpf('11111111111') b,
      app.valid_cnpj('11222333000181') c, app.valid_cnpj('11222333000182') d,
      app.valid_tax_id('52998224726') e`);
    eq(r.rows[0], { a: true, b: false, c: true, d: false, e: false });
  });
}

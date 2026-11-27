import { readFileSync } from 'node:fs';
export default async function ({ db, sudo, createUser, test, ok, eq }) {
  await test('logins criados antes das tabelas ganham perfil na migração 0010, sem receber papel algum', async () => {
    await sudo(db, `alter table auth.users disable trigger on_auth_user_created`);
    const id = (await sudo(db, `insert into auth.users(email, raw_user_meta_data) values ('antigo@exemplo.com','{"full_name":"Usuário Antigo"}') returning id`)).rows[0].id;
    eq((await sudo(db, `select count(*) c from public.profiles where id=$1`, [id])).rows[0].c, 0, 'sem perfil antes');
    await sudo(db, readFileSync(new URL('../../migrations/20261127000010_backfill_profiles.sql', import.meta.url), 'utf8'));
    const p = (await sudo(db, `select email, full_name, active from public.profiles where id=$1`, [id])).rows[0];
    eq(p, { email: 'antigo@exemplo.com', full_name: 'Usuário Antigo', active: true });
    eq(Number((await sudo(db, `select count(*) c from public.user_roles where user_id=$1`, [id])).rows[0].c), 0, 'nenhum papel concedido');
    await sudo(db, readFileSync(new URL('../../migrations/20261127000010_backfill_profiles.sql', import.meta.url), 'utf8'));   // idempotente
    eq(Number((await sudo(db, `select count(*) c from public.profiles where id=$1`, [id])).rows[0].c), 1);
    await sudo(db, `alter table auth.users enable trigger on_auth_user_created`);
  });
}

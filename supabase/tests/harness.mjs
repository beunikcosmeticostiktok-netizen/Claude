// Ambiente de teste: reproduz o essencial do Supabase (papéis, auth.uid, privilégios padrão)
// em um PostgreSQL local (PGlite) e aplica as migrações reais, em ordem.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await db.exec(readFileSync(join(migrationsDir, f), 'utf8')); }
    catch (e) { throw new Error(`Falha na migração ${f}: ${e.message}`); }
  }
  return { db, files };
}

// Executa SQL como um usuário autenticado (RLS valendo). userId=null => anônimo.
export async function as(db, userId, sql, params = []) {
  return db.transaction(async tx => {
    if (userId === 'service') {
      await tx.query(`set local role service_role`);
      await tx.query(`select set_config('request.jwt.claim.role','service_role',true)`);
    } else if (userId) {
      await tx.query(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId]);
      await tx.query(`select set_config('request.jwt.claim.role','authenticated',true)`);
    } else {
      await tx.query(`set local role anon`);
    }
    return tx.query(sql, params);
  });
}

export async function createUser(db, email, name = '') {
  const r = await db.query(
    `insert into auth.users(email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [email, JSON.stringify({ full_name: name })]);
  return r.rows[0].id;
}

// Como superusuário (configuração de cenário de teste)
export const sudo = (db, sql, params = []) => db.query(sql, params);

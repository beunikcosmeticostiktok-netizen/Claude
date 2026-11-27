'use server';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';

const tokenOk = (t: string) => { const e = process.env.SETUP_TOKEN; return Boolean(e) && t === e; };

/** Cria o PRIMEIRO administrador. Exige SETUP_TOKEN e só funciona enquanto não existir nenhum usuário. */
export async function createFirstAdmin(formData: FormData) {
  if (!tokenOk(String(formData.get('token') ?? ''))) redirect('/setup?erro=token');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  if (!email.includes('@') || password.length < 10 || !name) redirect('/setup?erro=dados');

  const admin = createAdminClient();
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) redirect('/login');

  const { error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  });
  if (error) redirect('/setup?erro=falha');
  redirect('/login?criado=1');
}

/**
 * Recupera o acesso quando já existe login mas nenhum administrador (ex.: usuário criado antes das tabelas).
 * Exige SETUP_TOKEN e só funciona enquanto NÃO houver nenhum administrador.
 */
export async function recoverAdmin(formData: FormData) {
  if (!tokenOk(String(formData.get('token') ?? ''))) redirect('/setup?erro=token');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email.includes('@')) redirect('/setup?erro=dados');

  const admin = createAdminClient();
  const { count } = await admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
  if ((count ?? 0) > 0) redirect('/login');

  let userId: string | null = null;
  let fullName = '';
  const { data: prof } = await admin.from('profiles').select('id, full_name').eq('email', email).maybeSingle();
  if (prof) { userId = prof.id; fullName = prof.full_name ?? ''; }
  else {
    for (let page = 1; page <= 10 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      const u = data?.users.find((x) => x.email?.toLowerCase() === email);
      if (u) { userId = u.id; fullName = String(u.user_metadata?.full_name ?? ''); }
      if (!data || data.users.length < 200) break;
    }
  }
  if (!userId) redirect('/setup?erro=usuario');

  const up = await admin.from('profiles').upsert({ id: userId, email, full_name: fullName, active: true }, { onConflict: 'id' });
  if (up.error) redirect('/setup?erro=falha');
  const role = await admin.from('user_roles').insert({ user_id: userId, role: 'admin' });
  if (role.error && role.error.code !== '23505') redirect('/setup?erro=falha');
  redirect('/login?recuperado=1');
}

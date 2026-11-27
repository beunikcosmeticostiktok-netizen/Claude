'use server';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';

/** Cria o PRIMEIRO administrador. Exige SETUP_TOKEN e só funciona enquanto não existir nenhum usuário. */
export async function createFirstAdmin(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const expected = process.env.SETUP_TOKEN;
  if (!expected || token !== expected) redirect('/setup?erro=token');

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

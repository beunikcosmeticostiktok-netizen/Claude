'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ALL_ROLES, type Role } from '@/lib/roles';
import { createAdminClient } from '@/lib/supabase/server';

function back(q: string): never { redirect('/usuarios?' + q); }
const pickRoles = (fd: FormData) => fd.getAll('roles').map(String).filter((r): r is Role => (ALL_ROLES as string[]).includes(r));

export async function createUser(fd: FormData) {
  const { supabase } = await requireRole(['admin']);
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const name = String(fd.get('name') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  if (!email.includes('@') || !name || password.length < 10) back('erro=dados');

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name, must_change_password: true },
  });
  if (error || !data.user) back('erro=' + (/already|registered/i.test(error?.message ?? '') ? 'email_existente' : 'falha'));
  const id = data!.user.id;
  for (const role of pickRoles(fd)) await supabase.rpc('admin_grant_role', { p_user: id, p_role: role });
  if (fd.get('seller') === 'on') await supabase.rpc('admin_set_seller', { p_user: id, p_is_seller: true });
  revalidatePath('/usuarios');
  back('ok=criado');
}

export async function saveUser(fd: FormData) {
  const { supabase } = await requireRole(['admin']);
  const id = String(fd.get('id'));
  const wanted = pickRoles(fd);
  const { data: current } = await supabase.from('user_roles').select('role').eq('user_id', id);
  const have = (current ?? []).map((r) => r.role as Role);
  for (const role of wanted.filter((r) => !have.includes(r)))
    await supabase.rpc('admin_grant_role', { p_user: id, p_role: role });
  for (const role of have.filter((r) => !wanted.includes(r))) {
    const { error } = await supabase.rpc('admin_revoke_role', { p_user: id, p_role: role });
    if (error?.message.includes('last_admin')) back('erro=ultimo_admin');
  }
  await supabase.rpc('admin_set_seller', { p_user: id, p_is_seller: fd.get('seller') === 'on' });
  revalidatePath('/usuarios');
  back('ok=salvo');
}

export async function setActive(fd: FormData) {
  const { supabase } = await requireRole(['admin']);
  const id = String(fd.get('id'));
  const active = fd.get('active') === '1';
  const { error } = await supabase.rpc('admin_set_user_active', { p_user: id, p_active: active });
  if (error?.message.includes('last_admin')) back('erro=ultimo_admin');
  if (error) back('erro=falha');
  // também bloqueia o login no serviço de autenticação
  await createAdminClient().auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
  revalidatePath('/usuarios');
  back('ok=salvo');
}

export async function resetPassword(fd: FormData) {
  await requireRole(['admin']);
  const id = String(fd.get('id'));
  const password = String(fd.get('password') ?? '');
  if (password.length < 10) back('erro=senha_curta');
  const { error } = await createAdminClient().auth.admin.updateUserById(id, {
    password, user_metadata: { must_change_password: true },
  });
  if (error) back('erro=falha');
  back('ok=senha');
}

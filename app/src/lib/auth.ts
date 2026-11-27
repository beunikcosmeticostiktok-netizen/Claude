import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/roles';

export async function getSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, active, is_seller').eq('id', user.id).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', user.id),
  ]);
  const roles = (roleRows ?? []).map((r) => r.role as Role);
  const { data: links } = await supabase.from('customer_users').select('customer_id, access').eq('user_id', user.id).eq('active', true);
  return { supabase, user, profile, roles, portal: (links ?? []) as { customer_id: string; access: string }[] };
}

/** Garante, no servidor, que quem chama é administrador (a checagem real também existe no banco). */
export async function requireRole(allowed: Role[]) {
  const s = await getSession();
  if (!s.profile?.active || !s.roles.some((r) => allowed.includes(r))) redirect('/');
  return s;
}

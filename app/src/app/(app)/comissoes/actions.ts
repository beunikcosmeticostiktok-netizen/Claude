'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession, requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
function done(error: { message: string } | null, ok: string): never {
  revalidatePath('/comissoes');
  redirect('/comissoes?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=' + ok));
}

export async function createPlan(fd: FormData) {
  const { supabase } = await requireRole(['admin']);
  const name = str(fd, 'name');
  if (!name) redirect('/comissoes?erro=name_required');
  const { data, error } = await supabase.from('commission_plans').insert({ name }).select('id').single();
  if (error || !data) done(error, 'plano');
  const tiers = [1, 2, 3, 4].map((i) => ({ ord: i, min_attainment_pct: parseMoney(fd.get(`att${i}`)), commission_pct: parseMoney(fd.get(`pct${i}`)) }));
  if (tiers.some((t) => t.min_attainment_pct == null || t.commission_pct == null || Number.isNaN(t.min_attainment_pct) || Number.isNaN(t.commission_pct))) {
    await supabase.from('commission_plans').delete().eq('id', data!.id);
    redirect('/comissoes?erro=invalid_amount');
  }
  const { error: e2 } = await supabase.rpc('admin_set_commission_tiers', { p_plan: data!.id, p_tiers: tiers });
  if (e2) { await supabase.from('commission_plans').delete().eq('id', data!.id); redirect('/comissoes?erro=invalid_tiers'); }
  done(null, 'plano');
}

export async function setTarget(fd: FormData) {
  const { supabase } = await requireRole(['admin']);
  const amount = parseMoney(fd.get('amount'));
  const month = str(fd, 'month') + '-01';
  if (amount == null || Number.isNaN(amount) || amount <= 0 || !/^\d{4}-\d{2}-01$/.test(month)) redirect('/comissoes?erro=invalid_amount');
  const { error } = await supabase.from('commission_targets').insert({ plan_id: str(fd, 'plan_id'), seller_id: str(fd, 'seller_id'), month, target_amount: amount });
  done(error, 'meta');
}

export async function closeMonth(fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('commission_close', { p_seller: str(fd, 'seller_id'), p_month: str(fd, 'month') + '-01', p_note: str(fd, 'note') || null });
  done(error, 'fechada');
}
export async function approve(fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('commission_approve', { p_statement: str(fd, 'id'), p_due: str(fd, 'due') || null });
  done(error, 'aprovada');
}
export async function cancelStatement(fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('commission_cancel', { p_statement: str(fd, 'id'), p_reason: str(fd, 'reason') });
  done(error, 'cancelada');
}

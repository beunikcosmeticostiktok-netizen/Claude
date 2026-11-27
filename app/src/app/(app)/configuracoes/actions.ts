'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';

export async function saveSettings(fd: FormData) {
  const { supabase, user } = await requireRole(['admin']);
  const { data: rows } = await supabase.from('settings').select('key, value');
  let failed = 0;
  for (const r of rows ?? []) {
    const raw = fd.get('s:' + r.key);
    let next: unknown;
    if (typeof r.value === 'boolean') next = fd.get('s:' + r.key) === 'on';
    else if (raw == null) continue;
    else if (r.key === 'lead_responsavel_id' || r.key === 'loja_conta_recebimento') next = String(raw).trim() || null;
    else { const n = parseMoney(raw); if (n == null || Number.isNaN(n) || n < 0) { failed++; continue; } next = n; }
    if (JSON.stringify(next) === JSON.stringify(r.value)) continue;
    const { error } = await supabase.from('settings').update({ value: next, updated_by: user.id }).eq('key', r.key);
    if (error) failed++;
  }
  revalidatePath('/configuracoes');
  redirect('/configuracoes?' + (failed ? 'erro=invalid_amount' : 'ok=1'));
}

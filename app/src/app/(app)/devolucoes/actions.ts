'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
function done(error: { message: string } | null, ok: string): never {
  revalidatePath('/devolucoes');
  redirect('/devolucoes?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=' + ok));
}
// As permissões reais ficam nas funções do banco (estoque/financeiro/gestor/admin).
export async function receiveReturn(fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('store_return_receive', { p_return: str(fd, 'id'), p_invoice: str(fd, 'invoice'), p_note: str(fd, 'note') || null });
  done(error, 'recebida');
}
export async function refuseReturn(fd: FormData) {
  const { supabase } = await getSession();
  const { error } = await supabase.rpc('store_return_refuse', { p_return: str(fd, 'id'), p_note: str(fd, 'note') });
  done(error, 'recusada');
}
export async function refundReturn(fd: FormData) {
  const { supabase } = await getSession();
  const amount = parseMoney(fd.get('amount'));
  if (Number.isNaN(amount)) redirect('/devolucoes?erro=invalid_amount');
  const { error } = await supabase.rpc('store_return_refund', { p_return: str(fd, 'id'), p_amount: amount, p_due: str(fd, 'due') || null });
  done(error, 'reembolso');
}

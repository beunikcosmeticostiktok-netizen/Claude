'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const text = (fd: FormData, k: string) => str(fd, k).trim() || null;
function back(id: string, q: string): never { redirect(`/pedidos/${id}?${q}`); }
const ROLES = ['admin', 'gestor', 'comercial', 'producao', 'estoque', 'financeiro'] as const;

export async function setStatus(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const id = str(fd, 'order_id');
  const { error } = await supabase.rpc('order_set_status', { p_order: id, p_axis: str(fd, 'axis'), p_value: str(fd, 'value'), p_note: text(fd, 'note') });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/pedidos/${id}`);
  back(id, 'ok=status');
}

export async function registerInvoice(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'financeiro']);
  const id = str(fd, 'order_id');
  const key = str(fd, 'key').replace(/\D/g, '');
  if (key && key.length !== 44) back(id, 'erro=invoice_key');
  const date = text(fd, 'date');
  const { error } = await supabase.rpc('order_register_invoice', { p_order: id, p_number: str(fd, 'number'), p_key: key || null, p_date: date });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/pedidos/${id}`);
  back(id, 'ok=nota');
}

export async function registerReceived(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'estoque']);
  const id = str(fd, 'order_id');
  const when = text(fd, 'date');
  const { error } = await supabase.rpc('order_register_received', { p_order: id, p_at: when ? new Date(when + 'T12:00:00-03:00').toISOString() : null });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/pedidos/${id}`);
  back(id, 'ok=recebido');
}

export async function cancelOrder(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor']);
  const id = str(fd, 'order_id');
  const { error } = await supabase.rpc('order_cancel', { p_order: id, p_reason: str(fd, 'reason') });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/pedidos/${id}`);
  back(id, 'ok=cancelado');
}

export async function saveOrderNotes(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  const id = str(fd, 'order_id');
  await supabase.from('orders').update({ notes_internal: text(fd, 'notes_internal'), carrier_contact: text(fd, 'carrier_contact') }).eq('id', id);
  back(id, 'ok=notas');
}

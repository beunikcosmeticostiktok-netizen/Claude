'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { onlyDigits, parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const text = (fd: FormData, k: string) => str(fd, k).trim() || null;
function back(id: string, q: string): never { redirect(`/compras/${id}?${q}`); }

export async function createSupplier(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'compras']);
  const name = text(fd, 'legal_name');
  if (!name) redirect('/compras/fornecedores?erro=falha');
  const { error } = await supabase.from('suppliers').insert({
    legal_name: name, trade_name: text(fd, 'trade_name'), tax_id: onlyDigits(str(fd, 'tax_id')) || null,
    contact_name: text(fd, 'contact_name'), phone: text(fd, 'phone'), email: text(fd, 'email'), payment_terms: text(fd, 'payment_terms'),
  });
  revalidatePath('/compras/fornecedores');
  redirect('/compras/fornecedores?' + (error ? 'erro=' + dbErrorKey(error.message.replace('suppliers_tax_id_uk', 'suppliers_tax_id_uk')) : 'ok=criado'));
}

export async function createPO(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'compras']);
  const { data, error } = await supabase.rpc('po_create', { p_supplier: str(fd, 'supplier_id') });
  if (error || !data) redirect('/compras/novo?erro=' + dbErrorKey(error?.message));
  redirect(`/compras/${data}`);
}

export async function addLine(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'compras']);
  const po = str(fd, 'po_id');
  const qty = parseMoney(fd.get('qty')); const cost = parseMoney(fd.get('unit_cost'));
  if (qty == null || Number.isNaN(qty) || qty <= 0 || cost == null || Number.isNaN(cost)) back(po, 'erro=invalid_qty');
  const { data: last } = await supabase.from('purchase_lines').select('position').eq('po_id', po).order('position', { ascending: false }).limit(1);
  const { error } = await supabase.from('purchase_lines').insert({ po_id: po, item_id: str(fd, 'item_id'), qty, unit_cost: cost, position: (last?.[0]?.position ?? 0) + 1 });
  if (error) back(po, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/compras/${po}`);
  back(po, 'ok=linha');
}

export async function removeLine(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'compras']);
  const po = str(fd, 'po_id');
  const { error } = await supabase.from('purchase_lines').delete().eq('id', str(fd, 'id'));
  if (error) back(po, 'erro=' + dbErrorKey(error.message));
  back(po, 'ok=linha');
}

export async function saveHeader(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'compras']);
  const po = str(fd, 'po_id');
  await supabase.from('purchase_orders').update({ expected_date: text(fd, 'expected_date'), payment_terms: text(fd, 'payment_terms'), notes: text(fd, 'notes') }).eq('id', po);
  back(po, 'ok=salvo');
}

const FN: Record<string, { fn: string; roles: ('admin' | 'gestor' | 'compras')[]; args: (fd: FormData) => Record<string, unknown> }> = {
  approve: { fn: 'po_approve', roles: ['admin', 'gestor'], args: (fd) => ({ p_po: str(fd, 'po_id') }) },
  send: { fn: 'po_mark_sent', roles: ['admin', 'compras'], args: (fd) => ({ p_po: str(fd, 'po_id') }) },
  cancel: { fn: 'po_cancel', roles: ['admin', 'gestor', 'compras'], args: (fd) => ({ p_po: str(fd, 'po_id'), p_reason: str(fd, 'reason') }) },
};
export async function poAction(fd: FormData) {
  const def = FN[str(fd, 'action')]; const po = str(fd, 'po_id');
  if (!def) back(po, 'erro=falha');
  const { supabase } = await requireRole(def.roles);
  const { error } = await supabase.rpc(def.fn, def.args(fd));
  if (error) back(po, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/compras/${po}`);
  back(po, 'ok=' + str(fd, 'action'));
}

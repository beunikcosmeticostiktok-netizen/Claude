'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const num = (fd: FormData, k: string, d = 0) => { const v = parseMoney(fd.get(k)); return v == null ? d : v; };
function back(id: string, q: string): never { redirect(`/producao/${id}?${q}`); }

export async function createPO(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  const qty = parseMoney(fd.get('qty'));
  if (qty == null || Number.isNaN(qty) || qty <= 0) redirect('/producao/nova?erro=invalid_qty');
  const { data, error } = await supabase.rpc('production_create', {
    p_order_item: str(fd, 'order_item_id'), p_qty: qty, p_machine: str(fd, 'machine_id') || null,
    p_mold: str(fd, 'mold_id') || null, p_start: str(fd, 'start') || null,
  });
  if (error || !data) redirect('/producao/nova?erro=' + dbErrorKey(error?.message));
  redirect(`/producao/${data}?ok=criada`);
}

export async function poStatus(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'producao']);
  const id = str(fd, 'po_id'); const action = str(fd, 'action');
  const { error } = action === 'release'
    ? await supabase.rpc('production_release', { p_po: id })
    : await supabase.rpc('production_set_status', { p_po: id, p_action: action, p_note: str(fd, 'note').trim() || null });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/producao/${id}`);
  back(id, 'ok=' + action);
}

export async function report(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  const id = str(fd, 'po_id');
  const consumption: { item_id: string; qty: number }[] = [];
  for (let i = 1; i <= 3; i++) {
    const item = str(fd, `cons_item_${i}`); const q = parseMoney(fd.get(`cons_qty_${i}`));
    if (item && q != null && !Number.isNaN(q) && q > 0) consumption.push({ item_id: item, qty: q });
  }
  const produced = num(fd, 'produced'), rejected = num(fd, 'rejected');
  if (Number.isNaN(produced) || Number.isNaN(rejected)) back(id, 'erro=invalid_qty');
  const { error } = await supabase.rpc('production_report', {
    p_po: id, p_produced: produced, p_rejected: rejected, p_rework: num(fd, 'rework'), p_downtime: Math.round(num(fd, 'downtime')),
    p_occurrence: str(fd, 'occurrence'), p_lot: str(fd, 'lot'), p_location: str(fd, 'location_id'), p_consumption: consumption, p_key: str(fd, 'key'),
  });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/producao/${id}`);
  back(id, 'ok=apontado');
}

export async function quality(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'producao']);
  const id = str(fd, 'po_id');
  const insp = parseMoney(fd.get('inspected')), appr = parseMoney(fd.get('approved'));
  if (insp == null || appr == null || Number.isNaN(insp) || Number.isNaN(appr)) back(id, 'erro=invalid_qty');
  const { error } = await supabase.rpc('quality_release', {
    p_po: id, p_inspected: insp, p_approved: appr, p_location: str(fd, 'location_id'), p_lot: str(fd, 'lot'), p_note: str(fd, 'note'), p_key: str(fd, 'key'),
  });
  if (error) back(id, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/producao/${id}`);
  back(id, 'ok=qualidade');
}

export async function saveMachine(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  const { error } = await supabase.from('machines').insert({ code: str(fd, 'code').trim().toUpperCase(), name: str(fd, 'name').trim(), kind: str(fd, 'kind') === 'sopro' ? 'sopro' : 'injecao' });
  revalidatePath('/producao/recursos');
  redirect('/producao/recursos?' + (error ? 'erro=falha' : 'ok=maquina'));
}

export async function saveMold(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  const own = str(fd, 'ownership') === 'cliente' ? 'cliente' : 'empresa';
  const { error } = await supabase.from('molds').insert({
    code: str(fd, 'code').trim().toUpperCase(), name: str(fd, 'name').trim(), ownership: own, customer_id: own === 'cliente' ? (str(fd, 'customer_id') || null) : null,
    cavities: Math.max(1, Math.round(num(fd, 'cavities', 1))), location: str(fd, 'location').trim() || null,
  });
  revalidatePath('/producao/recursos');
  redirect('/producao/recursos?' + (error ? 'erro=' + (error.message.includes('owner_customer') ? 'cliente' : 'falha') : 'ok=molde'));
}

export async function setMoldStatus(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  await supabase.from('molds').update({ status: str(fd, 'status') }).eq('id', str(fd, 'id'));
  revalidatePath('/producao/recursos');
  redirect('/producao/recursos?ok=molde');
}

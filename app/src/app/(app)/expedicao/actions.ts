'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
function back(id: string, q: string): never { redirect(`/expedicao/${id}?${q}`); }

export async function createShipment(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'estoque']);
  const order = str(fd, 'order_id');
  const items: { order_item_id: string; qty: number }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('qty_')) continue;
    const q = parseMoney(v);
    if (q == null || q === 0) continue;
    if (Number.isNaN(q) || q < 0 || !Number.isInteger(q)) redirect(`/expedicao/nova?order=${order}&erro=invalid_qty`);
    items.push({ order_item_id: k.slice(4), qty: q });
  }
  if (!items.length) redirect(`/expedicao/nova?order=${order}&erro=no_items`);
  const { data, error } = await supabase.rpc('shipment_create', { p_order: order, p_items: items });
  if (error || !data) redirect(`/expedicao/nova?order=${order}&erro=${dbErrorKey(error?.message)}`);
  redirect(`/expedicao/${data}?ok=criada`);
}

export async function shipAction(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'estoque']);
  const id = str(fd, 'id'); const action = str(fd, 'action');
  let res;
  if (action === 'cancel') res = await supabase.rpc('shipment_cancel', { p_ship: id, p_reason: str(fd, 'reason') });
  else {
    const when = str(fd, 'scheduled');
    const vol = parseMoney(fd.get('volumes')); const kg = parseMoney(fd.get('weight'));
    res = await supabase.rpc('shipment_set_status', {
      p_ship: id, p_status: action,
      p_scheduled: when ? new Date(when + ':00-03:00').toISOString() : null,
      p_volumes: vol == null || Number.isNaN(vol) ? null : Math.round(vol), p_weight: kg == null || Number.isNaN(kg) ? null : kg,
      p_tracking: str(fd, 'tracking').trim() || null, p_location: null,
    });
  }
  if (res.error) back(id, 'erro=' + dbErrorKey(res.error.message));
  revalidatePath(`/expedicao/${id}`);
  back(id, 'ok=' + action);
}

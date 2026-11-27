'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

export async function receive(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'estoque', 'compras']);
  const lines: { line_id: string; qty: number; lot?: string; note?: string }[] = [];
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith('qty_')) continue;
    const qty = parseMoney(v);
    if (qty == null || qty === 0) continue;
    if (Number.isNaN(qty) || qty < 0) redirect('/recebimentos?erro=invalid_qty');
    const id = k.slice(4);
    lines.push({ line_id: id, qty, lot: String(fd.get('lot_' + id) ?? ''), note: String(fd.get('note_' + id) ?? '') });
  }
  if (!lines.length) redirect('/recebimentos?erro=no_items');
  const { error } = await supabase.rpc('po_receive', {
    p_po: String(fd.get('po_id')), p_location: String(fd.get('location_id')), p_doc: String(fd.get('doc') ?? ''),
    p_lines: lines, p_key: String(fd.get('key') ?? ''),
  });
  revalidatePath('/recebimentos');
  redirect('/recebimentos?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=1'));
}

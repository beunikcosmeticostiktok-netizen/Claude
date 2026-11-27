'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const done = (error: { message: string } | null, ok: string): never => {
  revalidatePath('/estoque');
  redirect('/estoque?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=' + ok));
};

export async function moveStock(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'estoque']);
  const qty = parseMoney(fd.get('qty'));
  if (qty == null || Number.isNaN(qty)) redirect('/estoque?erro=invalid_qty');
  const { error } = await supabase.rpc('stock_move', {
    p_item: str(fd, 'item_id'), p_location: str(fd, 'location_id'), p_qty: qty, p_kind: str(fd, 'kind'),
    p_lot: str(fd, 'lot').trim() || null, p_note: str(fd, 'note').trim() || null,
  });
  done(error, 'movido');
}

export async function transferStock(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'estoque']);
  const qty = parseMoney(fd.get('qty'));
  if (qty == null || Number.isNaN(qty)) redirect('/estoque?erro=invalid_qty');
  const { error } = await supabase.rpc('stock_transfer', {
    p_item: str(fd, 'item_id'), p_from: str(fd, 'from'), p_to: str(fd, 'to'), p_qty: qty, p_lot: str(fd, 'lot').trim() || null,
  });
  done(error, 'transferido');
}

export async function reverseMovement(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'estoque']);
  const { error } = await supabase.rpc('stock_reverse', { p_movement: Number(str(fd, 'id')), p_note: str(fd, 'note') });
  done(error, 'estornado');
}

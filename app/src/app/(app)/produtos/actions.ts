'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim() || null;
const num = (fd: FormData, k: string) => { const v = parseMoney(fd.get(k)); return v; };

export async function saveItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor']);
  const id = text(fd, 'id');
  const back = (erro: string): never => redirect(id ? `/produtos/${id}?erro=${erro}` : `/produtos/novo?erro=${erro}`);

  const sku = text(fd, 'sku')?.toUpperCase();
  const name = text(fd, 'name');
  if (!sku || !name) back('dados');

  const numbers = ['weight_g', 'capacity_ml', 'comprimento_mm', 'largura_mm', 'altura_mm'].map((k) => [k, num(fd, k)] as const);
  if (numbers.some(([, v]) => v !== null && Number.isNaN(v))) back('numero');
  const n = Object.fromEntries(numbers);
  const intOr = (k: string, d: number | null) => { const v = parseMoney(fd.get(k)); return v == null || Number.isNaN(v) ? d : Math.round(v); };

  const tiers = [1, 2, 3, 4, 5].map((t) => [t, parseMoney(fd.get(`price_${t}`))] as const);
  if (tiers.some(([, v]) => v !== null && (Number.isNaN(v!) || v! < 0))) back('preco');

  const row = {
    type: String(fd.get('type') ?? 'produto_acabado'), sku, name, description: text(fd, 'description'),
    category: text(fd, 'category'), uom: text(fd, 'uom') ?? 'un', weight_g: n.weight_g, capacity_ml: n.capacity_ml,
    dimensions: { comprimento_mm: n.comprimento_mm, largura_mm: n.largura_mm, altura_mm: n.altura_mm },
    material: text(fd, 'material'), finish: text(fd, 'finish'),
    min_qty: intOr('min_qty', 1) ?? 1, qty_multiple: intOr('qty_multiple', 1) ?? 1,
    lead_time_days: intOr('lead_time_days', null), store_published: fd.get('store_published') === 'on',
    active: fd.get('active') === 'on', internal_notes: text(fd, 'internal_notes'),
  };

  let itemId = id;
  if (id) {
    const { error } = await supabase.from('items').update(row).eq('id', id);
    if (error) back(error.message.includes('items_sku_key') ? 'sku' : 'falha');
  } else {
    const { data, error } = await supabase.from('items').insert(row).select('id').single();
    if (error || !data) back(error?.message.includes('items_sku_key') ? 'sku' : 'falha');
    itemId = data!.id;
  }

  const toSave = tiers.filter(([, v]) => v !== null).map(([t, v]) => ({ item_id: itemId, tier_id: t, price: v }));
  const toClear = tiers.filter(([, v]) => v === null).map(([t]) => t);
  if (toSave.length) {
    const { error } = await supabase.from('price_tiers').upsert(toSave, { onConflict: 'item_id,tier_id' });
    if (error) back('preco');
  }
  if (toClear.length) await supabase.from('price_tiers').delete().eq('item_id', itemId!).in('tier_id', toClear);

  revalidatePath('/produtos');
  redirect('/produtos?ok=salvo');
}

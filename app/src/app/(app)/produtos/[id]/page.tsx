import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { ITEM_ERRORS, type Tier } from '@/lib/items';
import { ItemForm } from '../ItemForm';

export default async function EditarProduto({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  const { erro } = await searchParams;
  const { supabase } = await requireRole(['admin', 'gestor']);
  const [{ data: item }, { data: tiers }, { data: prices }] = await Promise.all([
    supabase.from('items').select('*').eq('id', id).maybeSingle(),
    supabase.from('price_tier_defs').select('id, ord, qty_min, qty_max, label').order('ord'),
    supabase.from('price_tiers').select('tier_id, price').eq('item_id', id),
  ]);
  if (!item) notFound();
  const map: Record<number, number> = {};
  (prices ?? []).forEach((p) => { map[p.tier_id] = Number(p.price); });
  return (
    <>
      <div className="top"><h1>{item.name}</h1><Link className="btn line" href="/produtos">Voltar</Link></div>
      {erro && <div className="alert err">{ITEM_ERRORS[erro] ?? ITEM_ERRORS.falha}</div>}
      <ItemForm item={item} tiers={(tiers ?? []) as Tier[]} prices={map} />
    </>
  );
}

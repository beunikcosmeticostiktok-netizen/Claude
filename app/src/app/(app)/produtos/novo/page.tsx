import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { ITEM_ERRORS, type Tier } from '@/lib/items';
import { ItemForm } from '../ItemForm';

export default async function NovoProduto({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const { supabase } = await requireRole(['admin', 'gestor']);
  const { data: tiers } = await supabase.from('price_tier_defs').select('id, ord, qty_min, qty_max, label').order('ord');
  return (
    <>
      <div className="top"><h1>Novo produto</h1><Link className="btn line" href="/produtos">Voltar</Link></div>
      {erro && <div className="alert err">{ITEM_ERRORS[erro] ?? ITEM_ERRORS.falha}</div>}
      <ItemForm tiers={(tiers ?? []) as Tier[]} prices={{}} />
    </>
  );
}

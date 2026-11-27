import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl } from '@/lib/format';
import { itemTypeLabel } from '@/lib/items';

export const dynamic = 'force-dynamic';
const PAGE = 20;

export default async function Produtos({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const page = Math.max(1, Number(sp.p) || 1);
  const q = (sp.q ?? '').replace(/[,()%*]/g, ' ').trim();

  let query = supabase.from('items')
    .select('id, sku, name, category, type, active, store_published, price_tiers(tier_id, price)', { count: 'exact' })
    .order('name').range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.or(`sku.ilike.%${q}%,name.ilike.%${q}%,category.ilike.%${q}%`);
  const { data, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const canWrite = roles.includes('admin') || roles.includes('gestor');
  const link = (p: number) => `/produtos?${new URLSearchParams({ ...(q ? { q } : {}), p: String(p) })}`;
  const price = (rows: { tier_id: number; price: number }[] | null, t: number) => rows?.find((r) => r.tier_id === t)?.price;

  return (
    <>
      <div className="top"><h1>Produtos</h1>{canWrite && <Link className="btn" href="/produtos/novo">Novo produto</Link>}</div>
      {sp.ok === 'salvo' && <div className="alert ok">Produto salvo.</div>}
      <form className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input name="q" defaultValue={q} placeholder="Buscar por código, nome ou categoria" />
        <button className="btn line" type="submit">Buscar</button>
      </form>
      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Produto</th><th>Tipo</th><th>Até 300</th><th>Acima de 16 mil</th><th>Situação</th></tr></thead>
          <tbody>
            {(data ?? []).map((i) => {
              const p1 = price(i.price_tiers, 1), p5 = price(i.price_tiers, 5);
              return (
                <tr key={i.id}>
                  <td>
                    {canWrite ? <Link href={`/produtos/${i.id}`}><b>{i.name}</b></Link> : <b>{i.name}</b>}
                    <div className="muted small">{i.sku}{i.category ? ` · ${i.category}` : ''}</div>
                  </td>
                  <td>{itemTypeLabel(i.type)}</td>
                  <td>{p1 != null ? brl(p1) : '—'}</td>
                  <td>{p5 != null ? brl(p5) : '—'}</td>
                  <td>
                    <span className={`badge ${i.active ? 'on' : 'off'}`}>{i.active ? 'Ativo' : 'Inativo'}</span>
                    {i.store_published && <span className="badge acc">Na loja</span>}
                  </td>
                </tr>
              );
            })}
            {!data?.length && <tr><td colSpan={5} className="muted">Nenhum produto cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        {page > 1 && <Link className="btn line sm" href={link(page - 1)}>← Anterior</Link>}
        <span className="muted small">Página {page} de {pages} · {count ?? 0} produto(s)</span>
        {page < pages && <Link className="btn line sm" href={link(page + 1)}>Próxima →</Link>}
      </div>
    </>
  );
}

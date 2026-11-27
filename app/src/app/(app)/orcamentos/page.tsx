import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { QUOTE_STATUS, quoteBadge } from '@/lib/labels';

export const dynamic = 'force-dynamic';
const PAGE = 20;

export default async function Orcamentos({ searchParams }: { searchParams: Promise<{ q?: string; p?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const page = Math.max(1, Number(sp.p) || 1);
  const q = (sp.q ?? '').replace(/[,()%*]/g, ' ').trim();
  let query = supabase.from('quotes').select('id, number, customer_id, seller_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.ilike('number', `%${q}%`);
  const { data, count } = await query;
  const ids = (data ?? []).map((x) => x.id);
  const [{ data: vers }, { data: custs }, { data: sellers }] = await Promise.all([
    ids.length ? supabase.from('quote_versions').select('quote_id, version, status, total, valid_until').in('quote_id', ids) : { data: [] },
    ids.length ? supabase.from('customers').select('id, legal_name').in('id', [...new Set((data ?? []).map((x) => x.customer_id))]) : { data: [] },
    ids.length ? supabase.from('profiles').select('id, full_name').in('id', [...new Set((data ?? []).map((x) => x.seller_id))]) : { data: [] },
  ]);
  const last = (id: string) => (vers ?? []).filter((v) => v.quote_id === id).sort((a, b) => b.version - a.version)[0];
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const canWrite = roles.includes('admin') || roles.includes('comercial');
  const link = (p: number) => `/orcamentos?${new URLSearchParams({ ...(q ? { q } : {}), p: String(p) })}`;

  return (
    <>
      <div className="top"><h1>Orçamentos</h1>{canWrite && <Link className="btn" href="/orcamentos/novo">Novo orçamento</Link>}</div>
      <form className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input name="q" defaultValue={q} placeholder="Buscar pelo número (ex.: ORC-2026-0001)" />
        <button className="btn line" type="submit">Buscar</button>
      </form>
      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Número</th><th>Cliente</th><th>Vendedor</th><th>Situação</th><th className="right">Total</th><th>Validade</th></tr></thead>
          <tbody>
            {(data ?? []).map((x) => { const v = last(x.id); return (
              <tr key={x.id}>
                <td><Link href={`/orcamentos/${x.id}`}><b>{x.number}</b></Link>{v && <span className="muted small"> v{v.version}</span>}</td>
                <td>{custs?.find((c) => c.id === x.customer_id)?.legal_name}</td>
                <td>{sellers?.find((s) => s.id === x.seller_id)?.full_name}</td>
                <td>{v && <span className={`badge ${quoteBadge(v.status)}`}>{QUOTE_STATUS[v.status]}</span>}</td>
                <td className="right">{v ? brl(v.total) : '—'}</td>
                <td>{v?.valid_until ? dataBR(v.valid_until + 'T12:00:00') : '—'}</td>
              </tr>); })}
            {!data?.length && <tr><td colSpan={6} className="muted">Nenhum orçamento.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        {page > 1 && <Link className="btn line sm" href={link(page - 1)}>← Anterior</Link>}
        <span className="muted small">Página {page} de {pages} · {count ?? 0} orçamento(s)</span>
        {page < pages && <Link className="btn line sm" href={link(page + 1)}>Próxima →</Link>}
      </div>
    </>
  );
}

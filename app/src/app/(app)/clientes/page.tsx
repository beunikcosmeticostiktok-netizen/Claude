import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { dataBR, formatTaxId } from '@/lib/format';

export const dynamic = 'force-dynamic';
const PAGE = 20;

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const page = Math.max(1, Number(sp.p) || 1);
  const q = (sp.q ?? '').replace(/[,()%*]/g, ' ').trim();

  let query = supabase.from('customers')
    .select('id, legal_name, trade_name, tax_id, segment, active, created_at', { count: 'exact' })
    .order('legal_name').range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.or(`legal_name.ilike.%${q}%,trade_name.ilike.%${q}%,tax_id.ilike.%${q.replace(/\D/g, '') || '___'}%`);
  const { data, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const canWrite = roles.includes('admin') || roles.includes('comercial');
  const link = (p: number) => `/clientes?${new URLSearchParams({ ...(q ? { q } : {}), p: String(p) })}`;

  return (
    <>
      <div className="top">
        <h1>Clientes</h1>
        {canWrite && <Link className="btn" href="/clientes/novo">Novo cliente</Link>}
      </div>
      {sp.ok === 'criado' && <div className="alert ok">Cliente cadastrado.</div>}
      <form className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        <input name="q" defaultValue={q} placeholder="Buscar por nome, fantasia ou CPF/CNPJ" />
        <button className="btn line" type="submit">Buscar</button>
      </form>
      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Empresa</th><th>CNPJ/CPF</th><th>Segmento</th><th>Situação</th><th>Desde</th></tr></thead>
          <tbody>
            {(data ?? []).map((c) => (
              <tr key={c.id}>
                <td><b>{c.legal_name}</b>{c.trade_name && <div className="muted small">{c.trade_name}</div>}</td>
                <td>{formatTaxId(c.tax_id) || '—'}</td>
                <td>{c.segment ?? '—'}</td>
                <td><span className={`badge ${c.active ? 'on' : 'off'}`}>{c.active ? 'Ativo' : 'Inativo'}</span></td>
                <td>{dataBR(c.created_at)}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={5} className="muted">Nenhum cliente encontrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        {page > 1 && <Link className="btn line sm" href={link(page - 1)}>← Anterior</Link>}
        <span className="muted small">Página {page} de {pages} · {count ?? 0} cliente(s)</span>
        {page < pages && <Link className="btn line sm" href={link(page + 1)}>Próxima →</Link>}
      </div>
    </>
  );
}

import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { axisValue } from '@/lib/labels';

export const dynamic = 'force-dynamic';
const PAGE = 20;

export default async function Pedidos({ searchParams }: { searchParams: Promise<{ q?: string; p?: string; f?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await getSession();
  const page = Math.max(1, Number(sp.p) || 1);
  const q = (sp.q ?? '').replace(/[,()%*]/g, ' ').trim();
  let query = supabase.from('orders')
    .select('id, number, customer_id, total, channel, status_commercial, status_financial, status_production, status_logistics, invoice_number, created_at', { count: 'exact' })
    .order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.ilike('number', `%${q}%`);
  if (sp.f === 'liberar') query = query.eq('status_production', 'nao_liberado').neq('status_commercial', 'cancelado');
  if (sp.f === 'producao') query = query.in('status_production', ['liberado', 'programado', 'em_producao', 'parcial']);
  if (sp.f === 'coleta') query = query.in('status_logistics', ['pronto_coleta', 'coleta_agendada', 'coletado_parcial']);
  const { data, count } = await query;
  const cids = [...new Set((data ?? []).map((o) => o.customer_id))];
  const { data: custs } = cids.length ? await supabase.from('customers').select('id, legal_name').in('id', cids) : { data: [] };
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (p: number) => `/pedidos?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.f ? { f: sp.f } : {}), p: String(p) })}`;
  const tabs = [['', 'Todos'], ['liberar', 'Aguardando liberação'], ['producao', 'Em produção'], ['coleta', 'Para coleta']];

  return (
    <>
      <div className="top"><h1>Pedidos</h1></div>
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={k ? `/pedidos?f=${k}` : '/pedidos'} className={(sp.f ?? '') === k ? 'on' : undefined}>{l}</Link>)}</div>
      <form className="card" style={{ marginBottom: 16, display: 'flex', gap: 10 }}>
        {sp.f && <input type="hidden" name="f" value={sp.f} />}
        <input name="q" defaultValue={q} placeholder="Buscar pelo número (ex.: PED-2026-0001)" />
        <button className="btn line" type="submit">Buscar</button>
      </form>
      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Financeiro</th><th>Produção</th><th>Logística</th><th className="right">Total</th></tr></thead>
          <tbody>
            {(data ?? []).map((o) => (
              <tr key={o.id}>
                <td><Link href={`/pedidos/${o.id}`}><b>{o.number}</b></Link><div className="muted small">{dataBR(o.created_at)}{o.channel === 'loja' ? ' · loja' : ''}</div></td>
                <td>{custs?.find((c) => c.id === o.customer_id)?.legal_name}</td>
                <td><span className="badge">{axisValue('financial', o.status_financial)}</span></td>
                <td>{o.status_commercial === 'cancelado' ? <span className="badge off">Cancelado</span> : <span className="badge">{axisValue('production', o.status_production)}</span>}</td>
                <td><span className="badge">{axisValue('logistics', o.status_logistics)}</span>{!o.invoice_number && <div className="muted small">sem nota</div>}</td>
                <td className="right">{brl(o.total)}</td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={6} className="muted">Nenhum pedido.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
        {page > 1 && <Link className="btn line sm" href={link(page - 1)}>← Anterior</Link>}
        <span className="muted small">Página {page} de {pages} · {count ?? 0} pedido(s)</span>
        {page < pages && <Link className="btn line sm" href={link(page + 1)}>Próxima →</Link>}
      </div>
    </>
  );
}

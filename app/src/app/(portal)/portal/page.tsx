import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { axisValue } from '@/lib/labels';

export default async function PortalInicio() {
  const { supabase, profile } = await getSession();
  const [{ data: cust }, { data: pend }, { data: orders }] = await Promise.all([
    supabase.from('portal_customer').select('legal_name').limit(1),
    supabase.from('portal_quote_versions').select('id, number, version, total, valid_until').in('status', ['enviado', 'em_negociacao']).order('sent_at', { ascending: false }),
    supabase.from('portal_orders').select('id, number, total, status_production, status_logistics, status_commercial').neq('status_commercial', 'cancelado').neq('status_logistics', 'coletado').order('created_at', { ascending: false }).limit(10),
  ]);
  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <>
      <h1>Olá{first ? `, ${first}` : ''}</h1>
      <p className="muted" style={{ marginBottom: 18 }}>{cust?.[0]?.legal_name}</p>
      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Orçamentos aguardando sua decisão</h2>
        {(pend ?? []).map((q) => (
          <p key={q.id} style={{ margin: '10px 0' }}>
            <Link href={`/portal/orcamentos/${q.id}`}><b>{q.number}</b> (v{q.version})</Link> · {brl(q.total)}
            {q.valid_until && <span className="muted small"> · válido até {dataBR(q.valid_until + 'T12:00:00')}</span>}
          </p>
        ))}
        {!pend?.length && <p className="muted small" style={{ marginTop: 8 }}>Nenhum orçamento pendente.</p>}
      </div>
      <div className="card">
        <h2>Pedidos em andamento</h2>
        {(orders ?? []).map((o) => (
          <p key={o.id} style={{ margin: '10px 0' }}>
            <Link href={`/portal/pedidos/${o.id}`}><b>{o.number}</b></Link> · {brl(o.total)} ·
            <span className="badge">{axisValue('production', o.status_production)}</span><span className="badge">{axisValue('logistics', o.status_logistics)}</span>
          </p>
        ))}
        {!orders?.length && <p className="muted small" style={{ marginTop: 8 }}>Nenhum pedido em andamento.</p>}
      </div>
    </>
  );
}

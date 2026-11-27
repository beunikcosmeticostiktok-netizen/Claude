import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { SHIPMENT_STATUS as SH } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function Expedicao() {
  const { supabase, roles } = await getSession();
  const [{ data: ships }, { data: orders }] = await Promise.all([
    supabase.from('shipments').select('id, number, order_id, status, scheduled_at, collected_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('orders').select('id, number, customer_id, invoice_number, carrier_name').neq('status_commercial', 'cancelado').neq('status_logistics', 'coletado').order('created_at', { ascending: false }).limit(100),
  ]);
  const oids = [...new Set([...(ships ?? []).map((s) => s.order_id), ...(orders ?? []).map((o) => o.id)])];
  const [{ data: ois }, { data: sis }, { data: all }, { data: custs }] = await Promise.all([
    oids.length ? supabase.from('order_items').select('id, order_id, qty, qty_shipped').in('order_id', oids) : { data: [] },
    supabase.from('shipment_items').select('order_item_id, qty, shipment_id'),
    oids.length ? supabase.from('orders').select('id, number, customer_id').in('id', oids) : { data: [] },
    supabase.from('customers').select('id, legal_name'),
  ]);
  const activeIds = new Set((ships ?? []).filter((s) => ['separado', 'pronto_coleta', 'coleta_agendada'].includes(s.status)).map((s) => s.id));
  const pend = (orderId: string) => (ois ?? []).filter((i) => i.order_id === orderId).reduce((s, i) =>
    s + Math.max(0, i.qty - i.qty_shipped - (sis ?? []).filter((x) => x.order_item_id === i.id && activeIds.has(x.shipment_id)).reduce((a, x) => a + x.qty, 0)), 0);
  const toShip = (orders ?? []).map((o) => ({ ...o, pend: pend(o.id) })).filter((o) => o.pend > 0);
  const canWrite = roles.includes('admin') || roles.includes('estoque');
  const cname = (cid: string) => custs?.find((c) => c.id === cid)?.legal_name;

  return (
    <>
      <div className="top"><h1>Expedição</h1></div>
      <div className="card scroll"><h2>Pedidos com saldo a separar</h2>
        <table className="table"><thead><tr><th>Pedido</th><th>Cliente</th><th className="right">Saldo (peças)</th><th>Nota fiscal</th><th>Transportadora</th><th></th></tr></thead><tbody>
          {toShip.map((o) => (
            <tr key={o.id}><td><Link href={`/pedidos/${o.id}`}><b>{o.number}</b></Link></td><td>{cname(o.customer_id)}</td><td className="right">{o.pend}</td>
              <td>{o.invoice_number ?? <span className="badge off">sem nota</span>}</td><td>{o.carrier_name ?? <span className="badge off">não indicada</span>}</td>
              <td>{canWrite && <Link className="btn sm" href={`/expedicao/nova?order=${o.id}`}>Separar</Link>}</td></tr>))}
          {!toShip.length && <tr><td colSpan={6} className="muted">Nada pendente de separação.</td></tr>}
        </tbody></table></div>
      <div className="card scroll" style={{ marginTop: 16 }}><h2>Separações e coletas</h2>
        <table className="table"><thead><tr><th>Número</th><th>Pedido</th><th>Cliente</th><th>Situação</th><th>Coleta</th></tr></thead><tbody>
          {(ships ?? []).map((s) => { const o = all?.find((x) => x.id === s.order_id); return (
            <tr key={s.id}><td><Link href={`/expedicao/${s.id}`}><b>{s.number}</b></Link></td><td>{o?.number}</td><td>{o && cname(o.customer_id)}</td>
              <td><span className={`badge ${s.status === 'coletado' ? 'on' : s.status === 'cancelado' ? 'off' : 'acc'}`}>{SH[s.status]}</span></td>
              <td>{s.collected_at ? dataBR(s.collected_at) : s.scheduled_at ? `agendada ${dataBR(s.scheduled_at)}` : '—'}</td></tr>); })}
          {!ships?.length && <tr><td colSpan={5} className="muted">Nenhuma separação.</td></tr>}
        </tbody></table></div>
    </>
  );
}

import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { axisValue } from '@/lib/labels';

export default async function PortalPedidos() {
  const { supabase } = await getSession();
  const { data } = await supabase.from('portal_orders').select('id, number, total, status_commercial, status_production, status_logistics, created_at').order('created_at', { ascending: false });
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>Pedidos</h1>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Pedido</th><th>Data</th><th>Produção</th><th>Logística</th><th className="right">Total</th></tr></thead>
        <tbody>
          {(data ?? []).map((o) => (
            <tr key={o.id}>
              <td><Link href={`/portal/pedidos/${o.id}`}><b>{o.number}</b></Link></td><td>{dataBR(o.created_at)}</td>
              <td>{o.status_commercial === 'cancelado' ? <span className="badge off">Cancelado</span> : <span className="badge">{axisValue('production', o.status_production)}</span>}</td>
              <td><span className="badge">{axisValue('logistics', o.status_logistics)}</span></td><td className="right">{brl(o.total)}</td>
            </tr>
          ))}
          {!data?.length && <tr><td colSpan={5} className="muted">Nenhum pedido.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

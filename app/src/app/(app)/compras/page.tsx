import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', enviado: 'Enviado ao fornecedor', recebido_parcial: 'Recebido parcialmente', recebido: 'Recebido', cancelado: 'Cancelado' };

export default async function Compras() {
  const { supabase, roles } = await getSession();
  const { data: pos } = await supabase.from('purchase_orders').select('id, number, supplier_id, status, expected_date, created_at').order('created_at', { ascending: false }).limit(100);
  const ids = (pos ?? []).map((p) => p.id);
  const [{ data: lines }, { data: sups }] = await Promise.all([
    ids.length ? supabase.from('purchase_lines').select('po_id, line_total').in('po_id', ids) : { data: [] },
    supabase.from('suppliers').select('id, legal_name, trade_name'),
  ]);
  const total = (id: string) => (lines ?? []).filter((l) => l.po_id === id).reduce((s, l) => s + Number(l.line_total), 0);
  const canWrite = roles.includes('admin') || roles.includes('compras');
  return (
    <>
      <div className="top"><h1>Compras</h1><div className="inline">
        <Link className="btn line" href="/compras/fornecedores">Fornecedores</Link>
        {canWrite && <Link className="btn" href="/compras/novo">Novo pedido de compra</Link>}</div></div>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Pedido</th><th>Fornecedor</th><th>Situação</th><th>Previsão</th><th className="right">Total</th></tr></thead>
        <tbody>
          {(pos ?? []).map((p) => (
            <tr key={p.id}>
              <td><Link href={`/compras/${p.id}`}><b>{p.number}</b></Link></td>
              <td>{sups?.find((s) => s.id === p.supplier_id)?.legal_name}</td>
              <td><span className={`badge ${p.status === 'recebido' ? 'on' : p.status === 'cancelado' ? 'off' : ''}`}>{ST[p.status]}</span></td>
              <td>{p.expected_date ? dataBR(p.expected_date + 'T12:00:00') : '—'}</td><td className="right">{brl(total(p.id))}</td>
            </tr>
          ))}
          {!pos?.length && <tr><td colSpan={5} className="muted">Nenhum pedido de compra.</td></tr>}
        </tbody>
      </table></div>
      <p className="muted small" style={{ marginTop: 10 }}>Aprovar uma compra não significa que ela foi paga: o pagamento é controlado no financeiro.</p>
    </>
  );
}

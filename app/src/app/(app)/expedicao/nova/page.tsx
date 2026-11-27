import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { createShipment } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NovaSeparacao({ searchParams }: { searchParams: Promise<{ order?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'estoque']);
  const { data: o } = await supabase.from('orders').select('id, number, invoice_number, carrier_name, freight_mode, status_financial, channel').eq('id', sp.order ?? '').maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: sis }, { data: ships }] = await Promise.all([
    supabase.from('order_items').select('id, description, qty, qty_produced, qty_shipped, item_id').eq('order_id', o.id).order('position'),
    supabase.from('shipment_items').select('order_item_id, qty, shipment_id'),
    supabase.from('shipments').select('id, status').eq('order_id', o.id),
  ]);
  const active = new Set((ships ?? []).filter((s) => ['separado', 'pronto_coleta', 'coleta_agendada'].includes(s.status)).map((s) => s.id));
  const alloc = (id: string) => (sis ?? []).filter((x) => x.order_item_id === id && active.has(x.shipment_id)).reduce((a, x) => a + x.qty, 0);
  return (
    <>
      <div className="top"><h1>Separar — {o.number}</h1><Link className="btn line" href="/expedicao">Voltar</Link></div>
      {sp.erro && <div className="alert err">{sp.erro === 'no_items' ? 'Informe a quantidade de pelo menos um item.' : dbErrorText(sp.erro)}</div>}
      {o.channel === 'loja' && o.status_financial !== 'quitado' && <div className="alert warn">Pedido da loja: só pode ser separado com pagamento integral confirmado.</div>}
      <form action={createShipment} className="card stack">
        <input type="hidden" name="order_id" value={o.id} />
        <table className="table"><thead><tr><th>Item</th><th className="right">Pedido</th><th className="right">Produzido</th><th className="right">Coletado</th><th className="right">Já separado</th><th>Separar agora</th></tr></thead><tbody>
          {(items ?? []).map((i) => (
            <tr key={i.id}><td>{i.description}</td><td className="right">{i.qty}</td><td className="right">{i.qty_produced}</td><td className="right">{i.qty_shipped}</td><td className="right">{alloc(i.id)}</td>
              <td><input name={`qty_${i.id}`} inputMode="numeric" placeholder="0" style={{ width: 100 }} /></td></tr>))}
        </tbody></table>
        <p className="muted small">A coleta só pode ser agendada com a nota fiscal registrada{o.freight_mode === 'fob' ? ' e a transportadora indicada pelo cliente' : ''}. O estoque só baixa quando a coleta é confirmada.</p>
        <div><button className="btn" type="submit">Criar separação</button></div>
      </form>
    </>
  );
}

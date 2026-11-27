import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { dbErrorText, SHIPMENT_STATUS as SH } from '@/lib/labels';
import { shipAction } from '../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { criada: 'Separação criada.', pronto_coleta: 'Marcada como pronta para coleta.', coleta_agendada: 'Coleta agendada.', coletado: 'Coleta confirmada: estoque baixado.', cancel: 'Separação cancelada.' };

export default async function ExpedicaoDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: s } = await supabase.from('shipments').select('*').eq('id', id).maybeSingle();
  if (!s) notFound();
  const [{ data: o }, { data: sis }] = await Promise.all([
    supabase.from('orders').select('id, number, invoice_number, carrier_name, carrier_contact, freight_mode').eq('id', s.order_id).single(),
    supabase.from('shipment_items').select('qty, order_item_id').eq('shipment_id', id),
  ]);
  const { data: ois } = await supabase.from('order_items').select('id, description, qty, qty_shipped').in('id', (sis ?? []).map((x) => x.order_item_id));
  const can = roles.includes('admin') || roles.includes('estoque');
  const hid = <><input type="hidden" name="id" value={s.id} /></>;
  return (
    <>
      <div className="top"><div><h1>{s.number} <span className={`badge ${s.status === 'coletado' ? 'on' : s.status === 'cancelado' ? 'off' : 'acc'}`}>{SH[s.status]}</span></h1>
        <span className="muted">Pedido <Link href={`/pedidos/${o?.id}`}><b>{o?.number}</b></Link></span></div><Link className="btn line" href="/expedicao">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok]}</div>}
      <div className="card scroll"><table className="table"><thead><tr><th>Item</th><th className="right">Nesta separação</th><th className="right">Pedido</th><th className="right">Já coletado</th></tr></thead><tbody>
        {(sis ?? []).map((x) => { const i = ois?.find((y) => y.id === x.order_item_id); return <tr key={x.order_item_id}><td>{i?.description}</td><td className="right">{x.qty}</td><td className="right">{i?.qty}</td><td className="right">{i?.qty_shipped}</td></tr>; })}
      </tbody></table>
        <div className="kv" style={{ marginTop: 14 }}>
          <div><small>Nota fiscal</small><b>{o?.invoice_number ?? 'Não registrada'}</b></div>
          <div><small>Transportadora (cliente)</small><b>{o?.carrier_name ?? 'Não indicada'}</b></div>
          <div><small>Volumes / peso</small><b>{s.volumes ?? '—'} / {s.weight_kg ?? '—'} kg</b></div>
          <div><small>Coleta</small><b>{s.collected_at ? dataBR(s.collected_at) : s.scheduled_at ? `agendada para ${dataBR(s.scheduled_at)}` : '—'}</b></div>
          <div><small>Rastreio</small><b>{s.tracking ?? '—'}</b></div></div>
        <p className="muted small" style={{ marginTop: 10 }}>“Coletado” significa que a carga saiu da fábrica, e não que o cliente recebeu. A confirmação de recebimento é registrada no pedido.</p></div>
      {can && s.status !== 'coletado' && s.status !== 'cancelado' && (
        <div className="card" style={{ marginTop: 16 }}><h2>Ações</h2>
          <div className="inline" style={{ marginTop: 12, alignItems: 'flex-start' }}>
            {s.status === 'separado' && <form action={shipAction} className="inline">{hid}<input type="hidden" name="action" value="pronto_coleta" /><input name="volumes" placeholder="Volumes" inputMode="numeric" style={{ width: 90 }} /><input name="weight" placeholder="Peso (kg)" inputMode="decimal" style={{ width: 100 }} /><button className="btn" type="submit">Pronto para coleta</button></form>}
            {s.status === 'pronto_coleta' && <form action={shipAction} className="inline">{hid}<input type="hidden" name="action" value="coleta_agendada" /><input name="scheduled" type="datetime-local" required /><button className="btn" type="submit">Agendar coleta</button></form>}
            {s.status === 'coleta_agendada' && <form action={shipAction} className="inline">{hid}<input type="hidden" name="action" value="coletado" /><input name="tracking" placeholder="Rastreio (opcional)" /><button className="btn" type="submit">Confirmar coleta</button></form>}
            <form action={shipAction} className="inline">{hid}<input type="hidden" name="action" value="cancel" /><input name="reason" placeholder="Motivo do cancelamento" required /><button className="btn danger" type="submit">Cancelar</button></form>
          </div></div>
      )}
    </>
  );
}

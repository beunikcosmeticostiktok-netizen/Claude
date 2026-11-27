import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { axisValue, dbErrorText } from '@/lib/labels';
import { buildTimeline } from '@/lib/timeline';
import { setCarrier } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function PortalPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, portal } = await getSession();
  const { data: o } = await supabase.from('portal_orders').select('*').eq('id', id).maybeSingle();
  if (!o) notFound();
  const { data: items } = await supabase.from('portal_order_items').select('*').eq('order_id', id).order('position');
  const access = portal.find((p) => p.customer_id === o.customer_id)?.access;
  const steps = buildTimeline(o);
  const cancelled = o.status_commercial === 'cancelado';
  const locked = ['coleta_agendada', 'coletado_parcial', 'coletado'].includes(o.status_logistics);
  const waitingDeposit = o.deposit_required && o.status_financial === 'aguardando_sinal';

  return (
    <>
      <div className="top"><h1>{o.number} {cancelled && <span className="badge off">Cancelado</span>}</h1><Link className="btn line" href="/portal/pedidos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok === 'aprovado' && <div className="alert ok">Orçamento aprovado e pedido gerado. Obrigado!</div>}
      {sp.ok === 'transportadora' && <div className="alert ok">Transportadora registrada.</div>}
      {waitingDeposit && !cancelled && (
        <div className="alert warn"><b>Sinal pendente:</b> {brl(o.deposit_amount)} ({o.deposit_pct}% do pedido). A produção é liberada após a confirmação do pagamento pela nossa equipe financeira. Se ainda não recebeu os dados de pagamento, fale com seu vendedor.</div>
      )}

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h2>Andamento</h2>
          <ul className="timeline">{steps.map((s) => <li key={s.label} className={s.done ? 'done' : undefined}>{s.label}</li>)}</ul>
          <p className="muted small">As etapas refletem os registros reais da nossa equipe. Datas de produção e coleta são previsões até a confirmação.</p>
        </div>
        <div className="card">
          <h2>Informações</h2>
          <div className="kv" style={{ marginTop: 10 }}>
            <div><small>Total</small><b>{brl(o.total)}</b></div>
            <div><small>Financeiro</small><b>{axisValue('financial', o.status_financial)}</b></div>
            <div><small>Frete</small><b>{o.freight_mode === 'fob' ? 'FOB' : o.freight_mode === 'retirada' ? 'Retirada' : '—'}</b></div>
            <div><small>Nota fiscal</small><b>{o.invoice_number ? `${o.invoice_number}${o.invoiced_at ? ' · ' + dataBR(o.invoiced_at + 'T12:00:00') : ''}` : 'Ainda não emitida'}</b></div>
            <div><small>Transportadora</small><b>{o.carrier_name ?? 'Ainda não indicada'}</b></div>
          </div>
          {o.freight_mode === 'fob' && !cancelled && access === 'aprovador' && !locked && (
            <form action={setCarrier} className="stack" style={{ marginTop: 16 }}>
              <input type="hidden" name="order_id" value={o.id} />
              <label>Transportadora ou responsável pela retirada<input name="name" required defaultValue={o.carrier_name ?? ''} /></label>
              <label>Contato (telefone ou e-mail)<input name="contact" /></label>
              <div><button className="btn line sm" type="submit">Informar transportadora</button></div>
            </form>
          )}
        </div>
      </div>

      <div className="card scroll" style={{ marginTop: 16 }}>
        <h2>Itens</h2>
        <table className="table">
          <thead><tr><th>Descrição</th><th className="right">Qtd</th><th className="right">Produzido</th><th className="right">Coletado</th><th className="right">Saldo a coletar</th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id}><td>{i.description}</td><td className="right">{i.qty}</td><td className="right">{i.qty_produced}</td><td className="right">{i.qty_shipped}</td><td className="right">{i.qty - i.qty_shipped}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText, QUOTE_STATUS, quoteBadge } from '@/lib/labels';
import { approveQuote, requestChange } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function PortalOrcamento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, portal } = await getSession();
  const { data: v } = await supabase.from('portal_quote_versions').select('*').eq('id', id).maybeSingle();
  if (!v) notFound();
  const [{ data: items }, { data: order }] = await Promise.all([
    supabase.from('portal_quote_items').select('*').eq('version_id', id).order('position'),
    supabase.from('portal_orders').select('id, number').eq('quote_version_id', id).maybeSingle(),
  ]);
  const access = portal.find((p) => p.customer_id === v.customer_id)?.access;
  const open = v.status === 'enviado' || v.status === 'em_negociacao';
  const canDecide = open && access === 'aprovador';

  return (
    <>
      <div className="top"><h1>{v.number} <span className="muted" style={{ fontSize: '1rem' }}>v{v.version}</span> <span className={`badge ${quoteBadge(v.status)}`}>{QUOTE_STATUS[v.status]}</span></h1>
        <Link className="btn line" href="/portal/orcamentos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok === 'alteracao' && <div className="alert ok">Recebemos seu pedido de alteração. Nossa equipe responderá com uma nova versão.</div>}
      {order && <div className="alert ok">Orçamento aprovado. Acompanhe o pedido <Link href={`/portal/pedidos/${order.id}`}><b>{order.number}</b></Link>.</div>}
      {v.status === 'substituida' && <div className="alert warn">Esta versão foi substituída por uma mais recente.</div>}
      {v.status === 'expirado' && <div className="alert warn">O prazo de validade terminou. Peça uma nova versão ao seu vendedor.</div>}

      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Descrição</th><th className="right">Qtd</th><th className="right">Preço unit.</th><th className="right">Total</th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => <tr key={i.id}><td>{i.description}</td><td className="right">{i.qty}</td><td className="right">{brl(i.unit_price)}</td><td className="right">{brl(i.line_total)}</td></tr>)}
            <tr><td colSpan={3} className="right muted">Frete</td><td className="right">{brl(v.freight_value)}</td></tr>
            <tr><td colSpan={3} className="right"><b>Total</b></td><td className="right"><b>{brl(v.total)}</b></td></tr>
          </tbody>
        </table>
        <div className="kv" style={{ marginTop: 14 }}>
          <div><small>Validade</small><b>{v.valid_until ? dataBR(v.valid_until + 'T12:00:00') : '—'}</b></div>
          <div><small>Prazo estimado</small><b>{v.lead_time_days != null ? `${v.lead_time_days} dias` : 'A combinar'}</b></div>
          <div><small>Frete</small><b>{v.freight_mode === 'fob' ? 'FOB (você indica o transporte)' : 'Retirada na fábrica'}</b></div>
          <div><small>Sinal para iniciar a produção</small><b>{v.deposit_required ? `${v.deposit_pct}% (${brl(Number(v.total) * Number(v.deposit_pct) / 100)})` : 'Não exigido'}</b></div>
          <div><small>Pagamento</small><b>{v.payment_terms ?? 'A combinar'}</b></div>
        </div>
        {v.notes_client && <p style={{ marginTop: 14 }}><b>Observações:</b> {v.notes_client}</p>}
      </div>

      {canDecide && (
        <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
          <form action={approveQuote} className="card stack">
            <h2>Aprovar este orçamento</h2><input type="hidden" name="version_id" value={v.id} />
            <p className="muted small">Ao aprovar, você confirma a versão {v.version} nas condições acima. O pedido será gerado e a equipe entrará em contato sobre o sinal.</p>
            <div><button className="btn" type="submit">Aprovar versão {v.version}</button></div>
          </form>
          <form action={requestChange} className="card stack">
            <h2>Solicitar alteração</h2><input type="hidden" name="version_id" value={v.id} />
            <label>O que você gostaria de mudar?<textarea name="message" rows={3} required /></label>
            <div><button className="btn line" type="submit">Enviar pedido de alteração</button></div>
          </form>
        </div>
      )}
      {open && access && access !== 'aprovador' && <div className="alert warn" style={{ marginTop: 16 }}>Seu acesso é somente para consulta. Peça a um contato aprovador da sua empresa para decidir.</div>}
    </>
  );
}

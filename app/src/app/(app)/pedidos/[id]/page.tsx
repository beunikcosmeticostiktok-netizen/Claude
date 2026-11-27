import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { AXES, type Axis, axisValue, dbErrorText } from '@/lib/labels';
import type { Role } from '@/lib/roles';
import { cancelOrder, registerInvoice, registerReceived, saveOrderNotes, setStatus } from '../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { status: 'Situação atualizada.', nota: 'Nota fiscal registrada.', recebido: 'Recebimento registrado.', cancelado: 'Pedido cancelado.', notas: 'Observações salvas.' };
const AXIS_ROLES: Record<Axis, Role[]> = {
  commercial: ['admin', 'gestor', 'comercial'], financial: ['admin', 'gestor', 'financeiro'],
  production: ['admin', 'gestor', 'producao'], logistics: ['admin', 'gestor', 'estoque'],
};
const FIELD: Record<Axis, string> = { commercial: 'status_commercial', financial: 'status_financial', production: 'status_production', logistics: 'status_logistics' };
const EVENT: Record<string, string> = { status: 'Situação', release_exception: 'Exceção de liberação', invoice: 'Nota fiscal', cancel: 'Cancelamento', received: 'Recebimento', carrier: 'Transportadora', nota: 'Registro' };

export default async function PedidoDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: o } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (!o) notFound();
  const [{ data: items }, { data: costs }, { data: events }, { data: checks }, { data: cust }, { data: seller }, { data: qv }] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', id).order('position'),
    supabase.from('order_item_costs').select('order_item_id, unit_cost'),
    supabase.from('order_events').select('at, kind, detail, note, actor').eq('order_id', id).order('at', { ascending: false }),
    supabase.rpc('order_release_checks', { p_order: id }),
    supabase.from('customers').select('id, legal_name').eq('id', o.customer_id).single(),
    o.seller_id ? supabase.from('profiles').select('full_name').eq('id', o.seller_id).single() : Promise.resolve({ data: null }),
    o.quote_version_id ? supabase.from('quote_versions').select('id, quote_id, version').eq('id', o.quote_version_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const cost = (itemId: string) => costs?.find((c) => c.order_item_id === itemId)?.unit_cost;
  const seeCost = (costs ?? []).length > 0;
  const totalCost = (items ?? []).reduce((s, i) => s + (cost(i.id) != null ? Number(cost(i.id)) * i.qty : 0), 0);
  const cancelled = o.status_commercial === 'cancelado';
  const mayAxis = (a: Axis) => roles.some((r) => AXIS_ROLES[a].includes(r));
  const hid = <input type="hidden" name="order_id" value={o.id} />;
  const pending = (checks ?? []).filter((c: { ok: boolean }) => !c.ok).length;

  return (
    <>
      <div className="top">
        <div>
          <h1>{o.number} {cancelled && <span className="badge off">Cancelado</span>}</h1>
          <span className="muted"><Link href={`/clientes/${o.customer_id}`}><b>{cust?.legal_name}</b></Link>{seller?.full_name ? ` · Vendedor: ${seller.full_name}` : ''}
            {qv && <> · <Link href={`/orcamentos/${qv.quote_id}?v=${qv.id}`}>orçamento v{qv.version}</Link></>}</span>
        </div>
        <Link className="btn line" href="/pedidos">Voltar</Link>
      </div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}

      <div className="cards">
        {(Object.keys(AXES) as Axis[]).map((a) => (
          <div key={a} className="card">
            <small className="muted">{AXES[a].label}</small>
            <div style={{ margin: '6px 0 10px' }}><b>{axisValue(a, o[FIELD[a]])}</b></div>
            {mayAxis(a) && !cancelled && (
              <form action={setStatus} className="stack">
                {hid}<input type="hidden" name="axis" value={a} />
                <select name="value" defaultValue={o[FIELD[a]]}>{Object.entries(AXES[a].values).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {a === 'production' && <input name="note" placeholder="Justificativa (exceção de liberação)" />}
                <button className="btn line sm" type="submit">Atualizar</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {o.status_production === 'nao_liberado' && !cancelled && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Condições para liberar a produção</h2>
          <ul style={{ margin: '10px 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {(checks ?? []).map((c: { rule: string; ok: boolean; detail: string }) => (
              <li key={c.rule} className="small" style={{ padding: '4px 0' }}>{c.ok ? '✅' : '⏳'} {c.detail}</li>
            ))}
          </ul>
          {pending > 0 && <p className="muted small" style={{ marginTop: 8 }}>Enquanto houver pendência, só gestor ou administrador libera, com justificativa registrada.</p>}
        </div>
      )}

      <div className="card scroll">
        <h2>Itens</h2>
        <table className="table">
          <thead><tr><th>Descrição</th><th>Qtd</th><th>Produzido</th><th>Coletado</th><th>Preço unit.</th>{seeCost && <th>Custo unit.</th>}<th className="right">Total</th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id}><td>{i.description}</td><td>{i.qty}</td><td>{i.qty_produced}</td><td>{i.qty_shipped}</td><td>{brl(i.unit_price)}</td>
                {seeCost && <td>{cost(i.id) != null ? brl(cost(i.id)) : '—'}</td>}<td className="right">{brl(i.line_total)}</td></tr>
            ))}
            <tr><td colSpan={seeCost ? 6 : 5} className="right"><b>Total do pedido</b></td><td className="right"><b>{brl(o.total)}</b></td></tr>
            {seeCost && totalCost > 0 && <tr><td colSpan={6} className="right muted">Resultado bruto sobre o custo completo</td><td className="right">{brl(Number(o.total) - Number(o.freight_value ?? 0) - totalCost)}</td></tr>}
          </tbody>
        </table>
        <div className="kv" style={{ marginTop: 14 }}>
          <div><small>Sinal</small><b>{o.deposit_required ? `${o.deposit_pct}% = ${brl(o.deposit_amount)}` : 'Não exigido'}</b></div>
          <div><small>Frete</small><b>{o.freight_mode === 'fob' ? 'FOB' : o.freight_mode === 'retirada' ? 'Retirada' : '—'}</b></div>
          <div><small>Transportadora (indicada pelo cliente)</small><b>{o.carrier_name ?? 'Ainda não indicada'}</b></div>
          <div><small>Nota fiscal</small><b>{o.invoice_number ? `${o.invoice_number}${o.invoiced_at ? ' · ' + dataBR(o.invoiced_at + 'T12:00:00') : ''}` : 'Não registrada'}</b></div>
          <div><small>Recebido pelo cliente</small><b>{o.received_at ? dataBR(o.received_at) : '—'}</b></div>
        </div>
      </div>

      {!cancelled && (
        <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
          {roles.some((r) => ['admin', 'gestor', 'financeiro'].includes(r)) && (
            <form action={registerInvoice} className="card stack">
              <h2>Registrar nota fiscal</h2>{hid}
              <p className="muted small">A nota é emitida fora do sistema. A coleta só é liberada depois deste registro.</p>
              <div className="grid2"><label>Número<input name="number" required defaultValue={o.invoice_number ?? ''} /></label><label>Data de emissão<input name="date" type="date" /></label></div>
              <label>Chave de acesso (44 números, opcional)<input name="key" inputMode="numeric" defaultValue={o.invoice_key ?? ''} /></label>
              <div><button className="btn sm" type="submit">Salvar nota</button></div>
            </form>
          )}
          {roles.some((r) => ['admin', 'gestor', 'estoque'].includes(r)) && (
            <form action={registerReceived} className="card stack">
              <h2>Confirmar recebimento pelo cliente</h2>{hid}
              <p className="muted small">Marca a data de recebimento (base do prazo de devolução da loja).</p>
              <label>Data<input name="date" type="date" /></label>
              <div><button className="btn line sm" type="submit">Registrar recebimento</button></div>
            </form>
          )}
          {roles.some((r) => ['admin', 'gestor', 'comercial'].includes(r)) && (
            <form action={saveOrderNotes} className="card stack">
              <h2>Observações internas</h2>{hid}
              <label>Contato da transportadora<input name="carrier_contact" defaultValue={o.carrier_contact ?? ''} /></label>
              <label>Observações<textarea name="notes_internal" rows={3} defaultValue={o.notes_internal ?? ''} /></label>
              <div><button className="btn line sm" type="submit">Salvar</button></div>
            </form>
          )}
          {roles.some((r) => ['admin', 'gestor'].includes(r)) && (
            <form action={cancelOrder} className="card stack">
              <h2>Cancelar pedido</h2>{hid}
              <label>Motivo<input name="reason" required /></label>
              <div><button className="btn danger sm" type="submit">Cancelar pedido</button></div>
            </form>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Histórico</h2>
        {(events ?? []).map((e, i) => (
          <p key={i} className="small" style={{ margin: '8px 0' }}>
            <b>{dataBR(e.at)}</b> · <span className="badge">{EVENT[e.kind] ?? e.kind}</span>
            {e.kind === 'status' && e.detail?.axis ? ` ${AXES[e.detail.axis as Axis]?.label}: ${axisValue(e.detail.axis, e.detail.value)}` : ''}
            {e.note ? ` — ${e.note}` : ''}
          </p>
        ))}
      </div>
    </>
  );
}

import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { receiveReturn, refuseReturn, refundReturn } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { solicitada: 'Solicitada', recebida: 'Mercadoria recebida', reembolsada: 'Reembolso lançado', recusada: 'Recusada' };

export default async function Devolucoes({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const [{ data: rets }, { data: conf }] = await Promise.all([
    supabase.from('store_returns').select('id, status, reason, requested_at, return_invoice_number, note, orders(number, total, customers(legal_name))').order('requested_at', { ascending: false }).limit(100),
    supabase.from('store_payments').select('id, external_ref, amount, created_at, orders(number, total)').eq('status', 'conflito').order('created_at', { ascending: false }),
  ]);
  const canRefund = roles.includes('admin') || roles.includes('financeiro');
  type R = { number: string; total: number; customers: { legal_name: string } | null };
  const ord = (o: unknown) => (Array.isArray(o) ? o[0] : o) as R | null;
  return (
    <>
      <div className="top"><h1>Loja: devoluções e pagamentos em conflito</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}{sp.ok && <div className="alert ok">Feito.</div>}
      {!!conf?.length && (
        <div className="card"><h2>Pagamentos recebidos após o pedido expirar</h2>
          <p className="small muted">O cliente pagou depois de o pedido ser cancelado. Nada foi baixado: reative o pedido com o comprador ou devolva o valor.</p>
          <table className="table"><tbody>{conf.map((c) => { const o = ord(c.orders); return (
            <tr key={c.id}><td>{o?.number}</td><td>{dataBR(c.created_at)}</td><td>ref. {c.external_ref}</td><td className="right">{brl(c.amount)}</td></tr>); })}</tbody></table></div>
      )}
      {(rets ?? []).map((r) => { const o = ord(r.orders); return (
        <div className="card" key={r.id} style={{ marginBottom: 10 }}>
          <b>Pedido {o?.number}</b> · {o?.customers && (Array.isArray(o.customers) ? o.customers[0] : o.customers)?.legal_name} · {brl(o?.total)} · <span className="badge">{ST[r.status]}</span>
          <p className="small">Solicitada em {dataBR(r.requested_at)}: {r.reason}</p>
          {r.return_invoice_number && <p className="small">NF de devolução: {r.return_invoice_number}</p>}
          {r.status === 'solicitada' && (
            <form action={receiveReturn} className="inline"><input type="hidden" name="id" value={r.id} />
              <input name="invoice" placeholder="Nº da NF de devolução" required /><input name="note" placeholder="Observação" />
              <button className="btn sm" type="submit">Mercadoria recebida</button></form>)}
          {r.status === 'recebida' && canRefund && (
            <form action={refundReturn} className="inline"><input type="hidden" name="id" value={r.id} />
              <input name="amount" placeholder={`Valor (padrão ${brl(o?.total)})`} inputMode="decimal" /><input name="due" type="date" />
              <button className="btn sm" type="submit">Lançar reembolso (conta a pagar)</button></form>)}
          {['solicitada', 'recebida'].includes(r.status) && (
            <form action={refuseReturn} className="inline" style={{ marginTop: 6 }}><input type="hidden" name="id" value={r.id} />
              <input name="note" placeholder="Motivo da recusa" required /><button className="btn line sm" type="submit">Recusar</button></form>)}
        </div>); })}
      {!rets?.length && <p className="muted">Nenhuma devolução.</p>}
    </>
  );
}

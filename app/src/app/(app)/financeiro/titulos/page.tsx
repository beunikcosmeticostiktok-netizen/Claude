import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { cancelTitle, createInstallments, generatePayable, generateReceivables, payTitle, reversePayment } from '../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { pago: 'Pagamento registrado.', estornado: 'Pagamento estornado.', cancelado: 'Título cancelado.', criado: 'Títulos criados.', cobranca: 'Cobrança gerada.', pagar: 'Conta a pagar gerada.' };
const ST: Record<string, string> = { aberto: 'Aberto', parcial: 'Parcial', pago: 'Pago', cancelado: 'Cancelado' };

export default async function Titulos({ searchParams }: { searchParams: Promise<{ kind?: string; f?: string; erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canWrite = roles.includes('admin') || roles.includes('financeiro');
  const kind = sp.kind === 'pagar' ? 'pagar' : 'receber';
  let q = supabase.from('titles_open').select('*').eq('kind', kind).order('due_date').limit(200);
  if (sp.f === 'vencidos') q = q.eq('overdue', true); else if (sp.f === 'pagos') q = q.eq('status', 'pago'); else q = q.in('status', ['aberto', 'parcial']);
  const [{ data: titles }, { data: accounts }, { data: pays }, { data: orders }, { data: receipts }, { data: cats }, { data: ccs }, { data: custs }, { data: sups }] = await Promise.all([
    q, supabase.from('bank_accounts').select('id, name').eq('active', true).order('name'),
    supabase.from('payments').select('id, title_id, paid_on, amount, interest, fine, discount, reversed').order('created_at', { ascending: false }).limit(300),
    supabase.from('orders').select('id, number, customer_id, total').neq('status_commercial', 'cancelado').order('created_at', { ascending: false }).limit(100),
    supabase.from('receipts').select('id, po_id, document_number, received_at').order('received_at', { ascending: false }).limit(100),
    supabase.from('finance_categories').select('id, name, kind').eq('active', true), supabase.from('cost_centers').select('id, name').eq('active', true),
    supabase.from('customers').select('id, legal_name').eq('active', true).order('legal_name').limit(500), supabase.from('suppliers').select('id, legal_name').eq('active', true).order('legal_name'),
  ]);
  const { data: withTitles } = await supabase.from('financial_titles').select('origin_type, origin_id').in('origin_type', ['order', 'receipt']);
  const has = (t: string, id: string) => (withTitles ?? []).some((x) => x.origin_type === t && x.origin_id === id);
  const ordersFree = (orders ?? []).filter((o) => !has('order', o.id));
  const receiptsFree = (receipts ?? []).filter((r) => !has('receipt', r.id));
  const tab = (k: string, l: string) => <Link href={`/financeiro/titulos?kind=${k}`} className={kind === k ? 'on' : undefined}>{l}</Link>;
  const flt = (f: string, l: string) => <Link href={`/financeiro/titulos?kind=${kind}${f ? `&f=${f}` : ''}`} className={(sp.f ?? '') === f ? 'on' : undefined}>{l}</Link>;
  const accSel = <select name="account_id">{(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>;

  return (
    <>
      <div className="top"><h1>Contas a {kind}</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}
      <div className="tabs">{tab('receber', 'A receber')}{tab('pagar', 'A pagar')}<span style={{ width: 16 }} />{flt('', 'Em aberto')}{flt('vencidos', 'Vencidos')}{flt('pagos', 'Pagos')}</div>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Título</th><th>Vencimento</th><th>Situação</th><th className="right">Valor</th><th className="right">Saldo</th><th></th></tr></thead>
        <tbody>
          {(titles ?? []).map((t) => (
            <tr key={t.id}>
              <td><b>{t.description}</b><div className="muted small">competência {dataBR(t.competence + 'T12:00:00').slice(3)}{Number(t.discount_total) > 0 ? ` · desconto ${brl(t.discount_total)}` : ''}</div></td>
              <td>{dataBR(t.due_date + 'T12:00:00')} {t.overdue && <span className="badge off">vencido</span>}</td>
              <td><span className={`badge ${t.status === 'pago' ? 'on' : t.status === 'cancelado' ? 'off' : ''}`}>{ST[t.status]}</span></td>
              <td className="right">{brl(t.amount)}</td><td className="right"><b>{brl(t.balance)}</b></td>
              <td>{canWrite && (
                <details><summary className="btn line sm" style={{ listStyle: 'none', display: 'inline-flex' }}>Ações</summary>
                  <div className="stack" style={{ marginTop: 10, minWidth: 280 }}>
                    {['aberto', 'parcial'].includes(t.status) && (
                      <form action={payTitle} className="stack"><input type="hidden" name="title_id" value={t.id} /><input type="hidden" name="key" value={randomUUID()} /><input type="hidden" name="back" value={`/financeiro/titulos?kind=${kind}`} />
                        <label>Conta{accSel}</label>
                        <div className="grid2"><label>Valor principal<input name="amount" inputMode="decimal" defaultValue={String(t.balance).replace('.', ',')} /></label><label>Data<input name="paid_on" type="date" /></label></div>
                        <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}><label>Juros<input name="interest" inputMode="decimal" /></label><label>Multa<input name="fine" inputMode="decimal" /></label><label>Desconto<input name="discount" inputMode="decimal" /></label></div>
                        <label>Observação<input name="note" /></label><button className="btn sm" type="submit">{kind === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento'}</button></form>)}
                    {(pays ?? []).filter((p) => p.title_id === t.id && !p.reversed).map((p) => (
                      <form key={p.id} action={reversePayment} className="inline"><input type="hidden" name="payment_id" value={p.id} />
                        <span className="small">{dataBR(p.paid_on + 'T12:00:00')} · {brl(p.amount)}</span><input name="note" placeholder="Motivo do estorno" required style={{ width: 150 }} /><button className="btn danger sm" type="submit">Estornar</button></form>))}
                    {t.status !== 'pago' && t.status !== 'cancelado' && Number(t.settled) === 0 && (
                      <form action={cancelTitle} className="inline"><input type="hidden" name="title_id" value={t.id} /><input name="reason" placeholder="Motivo do cancelamento" required /><button className="btn danger sm" type="submit">Cancelar título</button></form>)}
                  </div></details>)}</td>
            </tr>
          ))}
          {!titles?.length && <tr><td colSpan={6} className="muted">Nenhum título neste filtro.</td></tr>}
        </tbody></table></div>

      {canWrite && (
        <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
          <div className="card stack"><h2>Gerar cobrança de pedido</h2>
            <p className="muted small">Cria o sinal e o saldo do pedido, uma única vez. Pedidos sem cobrança:</p>
            {ordersFree.map((o) => (
              <form key={o.id} action={generateReceivables} className="inline"><input type="hidden" name="order_id" value={o.id} />
                <span className="small" style={{ minWidth: 200 }}><b>{o.number}</b> · {custs?.find((c) => c.id === o.customer_id)?.legal_name} · {brl(o.total)}</span>
                <input name="due" type="date" title="Vencimento do saldo" /><button className="btn sm" type="submit">Gerar</button></form>))}
            {!ordersFree.length && <p className="muted small">Todos os pedidos já têm cobrança.</p>}</div>
          <div className="card stack"><h2>Gerar conta a pagar de recebimento</h2>
            <p className="muted small">Um título por recebimento de compra. Recebimentos sem conta a pagar:</p>
            {receiptsFree.map((r) => (
              <form key={r.id} action={generatePayable} className="inline"><input type="hidden" name="receipt_id" value={r.id} />
                <span className="small" style={{ minWidth: 200 }}>NF {r.document_number ?? '—'} · {dataBR(r.received_at)}</span>
                <input name="due" type="date" required /><button className="btn sm" type="submit">Gerar</button></form>))}
            {!receiptsFree.length && <p className="muted small">Nenhum recebimento pendente.</p>}</div>
        </div>
      )}
      {canWrite && (
        <form action={createInstallments} className="card stack" style={{ marginTop: 16 }}>
          <h2>Novo lançamento parcelado</h2>
          <div className="grid2"><label>Tipo<select name="kind" defaultValue={kind}><option value="receber">A receber</option><option value="pagar">A pagar</option></select></label><label>Descrição<input name="description" required /></label></div>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}><label>Valor total<input name="total" inputMode="decimal" required /></label><label>Parcelas<input name="n" inputMode="numeric" defaultValue="1" /></label><label>1º vencimento<input name="first_due" type="date" required /></label></div>
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            <label>Categoria<select name="category_id" defaultValue=""><option value="">—</option>{(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Centro de custo<select name="cost_center_id" defaultValue=""><option value="">—</option>{(ccs ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Cliente<select name="customer_id" defaultValue=""><option value="">—</option>{(custs ?? []).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
            <label>Fornecedor<select name="supplier_id" defaultValue=""><option value="">—</option>{(sups ?? []).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label></div>
          <div><button className="btn" type="submit">Criar títulos</button></div>
        </form>
      )}
    </>
  );
}

import { randomUUID } from 'node:crypto';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { payBatch, setProof } from '../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { lote: 'Pagamentos registrados.', comprovante: 'Comprovante salvo.' };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function Pagamentos({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canWrite = roles.includes('admin') || roles.includes('financeiro');
  const today = new Date(); const d7 = new Date(today.getTime() + 7 * 864e5), d30 = new Date(today.getTime() + 30 * 864e5);
  const [{ data: titles }, { data: accounts }, { data: balances }, { data: pays }] = await Promise.all([
    supabase.from('titles_open').select('id, description, due_date, balance, overdue, supplier_id').eq('kind', 'pagar').in('status', ['aberto', 'parcial']).order('due_date').limit(300),
    supabase.from('bank_accounts').select('id, name').eq('active', true).order('name'),
    supabase.from('account_balances').select('account_id, name, balance'),
    supabase.from('payments').select('id, paid_on, amount, proof_url, reversed, financial_titles(description, kind)').eq('reversed', false).order('created_at', { ascending: false }).limit(40),
  ]);
  const list = titles ?? [];
  const sum = (a: { balance: number | string }[]) => a.reduce((s, t) => s + Number(t.balance), 0);
  const groups: [string, typeof list][] = [
    ['Vencidas', list.filter((t) => t.overdue)],
    ['Vencem hoje', list.filter((t) => !t.overdue && t.due_date === iso(today))],
    ['Próximos 7 dias', list.filter((t) => t.due_date > iso(today) && t.due_date <= iso(d7))],
    ['Próximos 30 dias', list.filter((t) => t.due_date > iso(d7) && t.due_date <= iso(d30))],
    ['Depois', list.filter((t) => t.due_date > iso(d30))],
  ];
  const cash = (balances ?? []).reduce((s, b) => s + Number(b.balance), 0);
  const pagas = (pays ?? []).filter((p) => { const t = Array.isArray(p.financial_titles) ? p.financial_titles[0] : p.financial_titles; return t?.kind === 'pagar'; });

  return (
    <>
      <div className="top"><h1>Pagamentos</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}{sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}
      <p className="muted small">Contas a pagar de todas as origens (fornecedores, comissões, reembolsos da loja, despesas). Marque as contas, escolha a conta de saída e a data em que o pagamento foi feito no banco. O sistema só registra: ele não movimenta dinheiro no banco.</p>
      <div className="card"><b>Total a pagar: {brl(sum(list))}</b> · vencido: <b>{brl(sum(groups[0][1]))}</b> · saldo atual em caixa e bancos: <b>{brl(cash)}</b>
        {cash < sum(list) && <span className="badge off" style={{ marginLeft: 8 }}>saldo menor que o total a pagar</span>}</div>

      <form action={payBatch} className="stack" style={{ marginTop: 12 }}>
        <input type="hidden" name="key" value={randomUUID()} />
        {groups.map(([label, rows]) => !!rows.length && (
          <div className="card" key={label}><h2>{label} · {brl(sum(rows))}</h2>
            <table className="table"><tbody>{rows.map((t) => (
              <tr key={t.id}>{canWrite && <td style={{ width: 28 }}><input type="checkbox" name="title" value={t.id} style={{ width: 'auto' }} /></td>}
                <td><b>{t.description}</b></td><td>{dataBR(t.due_date + 'T12:00:00')}</td><td className="right"><b>{brl(t.balance)}</b></td></tr>))}</tbody></table></div>))}
        {!list.length && <div className="card muted">Nenhuma conta a pagar em aberto.</div>}
        {canWrite && !!list.length && (
          <div className="card stack"><h2>Pagar as contas marcadas (saldo total de cada uma)</h2>
            <div className="grid2" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
              <label>Conta de saída<select name="account_id" required>{(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label>Data do pagamento<input type="date" name="paid_on" defaultValue={iso(today)} max={iso(today)} /></label>
              <label>Link do comprovante (opcional)<input type="url" name="proof_url" placeholder="https://…" /></label></div>
            <div><button className="btn" type="submit">Registrar pagamento das marcadas</button></div>
            <p className="muted small">Tudo ou nada: se uma das contas não puder ser paga, nenhuma é registrada. Pagamento parcial, juros, multa e desconto: use Contas a receber e a pagar.</p></div>)}
      </form>

      <div className="card" style={{ marginTop: 12 }}><h2>Últimos pagamentos</h2>
        <table className="table"><tbody>{pagas.map((p) => { const t = Array.isArray(p.financial_titles) ? p.financial_titles[0] : p.financial_titles; return (
          <tr key={p.id}><td>{dataBR(p.paid_on + 'T12:00:00')}</td><td>{t?.description}</td><td className="right">{brl(p.amount)}</td>
            <td>{p.proof_url ? <a href={p.proof_url} target="_blank" rel="noreferrer noopener">comprovante</a> : <span className="muted small">sem comprovante</span>}
              {canWrite && <form action={setProof} className="inline"><input type="hidden" name="payment_id" value={p.id} /><input type="url" name="proof_url" placeholder="link do comprovante" defaultValue={p.proof_url ?? ''} /><button className="btn line sm" type="submit">Salvar</button></form>}</td></tr>); })}
          {!pagas.length && <tr><td className="muted">Nenhum pagamento ainda.</td></tr>}</tbody></table></div>
    </>
  );
}

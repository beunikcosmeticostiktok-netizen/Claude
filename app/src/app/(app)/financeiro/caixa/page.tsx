import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { addStatementLine, matchLine, transfer } from '../actions';

export const dynamic = 'force-dynamic';
const KIND: Record<string, string> = { recebimento: 'Recebimento', pagamento: 'Pagamento', juros: 'Juros', multa: 'Multa', transferencia: 'Transferência', ajuste: 'Ajuste', estorno: 'Estorno' };

export default async function Caixa({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; conta?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canWrite = roles.includes('admin') || roles.includes('financeiro');
  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from('account_balances').select('account_id, name, balance').eq('active', true).order('name'),
    supabase.from('bank_statement_lines').select('id, account_id, line_date, description, amount, matched_movement').order('line_date', { ascending: false }).limit(60),
  ]);
  const conta = sp.conta ?? accounts?.[0]?.account_id;
  const { data: movs } = conta ? await supabase.from('cash_movements').select('id, movement_date, amount, kind, note, title_id').eq('account_id', conta).order('id', { ascending: false }).limit(80) : { data: [] };
  const matched = new Set((lines ?? []).map((l) => Number(l.matched_movement)).filter(Boolean));
  const acc = (id: string) => accounts?.find((a) => a.account_id === id)?.name;

  return (
    <>
      <div className="top"><h1>Caixa e conciliação</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">Feito.</div>}
      <div className="tabs">{(accounts ?? []).map((a) => <a key={a.account_id} href={`/financeiro/caixa?conta=${a.account_id}`} className={a.account_id === conta ? 'on' : undefined}>{a.name} · {brl(a.balance)}</a>)}</div>
      <div className="card scroll"><h2>Lançamentos</h2>
        <table className="table"><thead><tr><th>Data</th><th>Tipo</th><th>Observação</th><th className="right">Valor</th><th>Extrato</th></tr></thead><tbody>
          {(movs ?? []).map((m) => (
            <tr key={m.id}><td>{dataBR(m.movement_date + 'T12:00:00')}</td><td><span className="badge">{KIND[m.kind]}</span></td><td className="small">{m.note ?? ''}</td>
              <td className="right" style={{ color: Number(m.amount) < 0 ? 'var(--err)' : 'var(--ok)' }}>{brl(m.amount)}</td><td>{matched.has(Number(m.id)) ? <span className="badge on">conciliado</span> : ''}</td></tr>))}
          {!movs?.length && <tr><td colSpan={5} className="muted">Sem lançamentos.</td></tr>}
        </tbody></table>
        <p className="muted small">O caixa não é editado: erros são corrigidos por estorno do pagamento no título. Transferências entre contas não entram em receita nem despesa.</p></div>

      {canWrite && (
        <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
          <form action={transfer} className="card stack"><h2>Transferência entre contas</h2>
            <div className="grid2"><label>De<select name="from">{(accounts ?? []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</select></label>
              <label>Para<select name="to">{(accounts ?? []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</select></label></div>
            <div className="grid2"><label>Valor<input name="amount" inputMode="decimal" required /></label><label>Data<input name="date" type="date" /></label></div>
            <label>Observação<input name="note" /></label><div><button className="btn sm" type="submit">Transferir</button></div></form>
          <form action={addStatementLine} className="card stack"><h2>Linha do extrato bancário</h2>
            <label>Conta<select name="account_id" defaultValue={conta}>{(accounts ?? []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</select></label>
            <div className="grid2"><label>Data<input name="date" type="date" required /></label><label>Valor (− para saída)<input name="amount" inputMode="decimal" required /></label></div>
            <label>Descrição<input name="description" required /></label><div><button className="btn sm" type="submit">Adicionar</button></div></form>
        </div>
      )}
      <div className="card scroll" style={{ marginTop: 16 }}><h2>Conciliação manual</h2>
        <table className="table"><thead><tr><th>Extrato</th><th className="right">Valor</th><th>Situação / lançamento</th></tr></thead><tbody>
          {(lines ?? []).map((l) => (
            <tr key={l.id}><td><b>{l.description}</b><div className="muted small">{acc(l.account_id)} · {dataBR(l.line_date + 'T12:00:00')}</div></td><td className="right">{brl(l.amount)}</td>
              <td>{l.matched_movement ? <form action={matchLine} className="inline"><span className="badge on">conciliado #{l.matched_movement}</span><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="unmatch" value="1" />{canWrite && <button className="btn line sm" type="submit">Desfazer</button>}</form>
                : canWrite ? <form action={matchLine} className="inline"><input type="hidden" name="line_id" value={l.id} />
                  <select name="movement_id" required defaultValue=""><option value="" disabled>Escolha o lançamento…</option>
                    {(movs ?? []).filter((m) => l.account_id === conta && Number(m.amount) === Number(l.amount) && !matched.has(Number(m.id))).map((m) => <option key={m.id} value={m.id}>#{m.id} · {dataBR(m.movement_date + 'T12:00:00')} · {brl(m.amount)}</option>)}</select>
                  <button className="btn line sm" type="submit">Conciliar</button></form> : '—'}</td></tr>))}
          {!lines?.length && <tr><td colSpan={3} className="muted">Nenhuma linha de extrato.</td></tr>}
        </tbody></table>
        <p className="muted small">Para conciliar, selecione a conta da linha na faixa de contas acima (a lista mostra os lançamentos de mesmo valor ainda não conciliados).</p></div>
    </>
  );
}

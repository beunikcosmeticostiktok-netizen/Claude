import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { rejectProof, validateProof } from './actions';

export const dynamic = 'force-dynamic';

export default async function Financeiro({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canWrite = roles.includes('admin') || roles.includes('financeiro');
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [{ data: accounts }, { data: open }, { data: proofs }] = await Promise.all([
    supabase.from('account_balances').select('account_id, name, balance, kind').eq('active', true).order('name'),
    supabase.from('titles_open').select('id, kind, description, balance, due_date, overdue, status').in('status', ['aberto', 'parcial']).order('due_date').limit(500),
    supabase.from('payment_proofs').select('id, title_id, amount, paid_on, note, created_at').eq('status', 'pendente').order('created_at'),
  ]);
  const sum = (rows: { balance: number | string }[]) => rows.reduce((s, r) => s + Number(r.balance), 0);
  const rec = (open ?? []).filter((t) => t.kind === 'receber'), pag = (open ?? []).filter((t) => t.kind === 'pagar');
  const venc = rec.filter((t) => t.overdue), prox = (rows: typeof rec) => rows.filter((t) => !t.overdue && t.due_date <= in7);
  const { data: tt } = (proofs ?? []).length ? await supabase.from('financial_titles').select('id, description').in('id', (proofs ?? []).map((p) => p.title_id)) : { data: [] };

  return (
    <>
      <div className="top"><h1>Financeiro</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{sp.ok === 'validado' ? 'Comprovante validado: pagamento registrado.' : 'Comprovante recusado.'}</div>}
      <div className="cards">
        {(accounts ?? []).map((a) => <div key={a.account_id} className="card stat"><b>{brl(a.balance)}</b><span>{a.name}</span></div>)}
        <div className="card stat"><b>{brl(sum(rec))}</b><span>a receber em aberto ({rec.length})</span></div>
        <div className="card stat" style={venc.length ? { borderColor: 'var(--err)' } : undefined}><b>{brl(sum(venc))}</b><span>a receber vencido ({venc.length})</span></div>
        <div className="card stat"><b>{brl(sum(pag))}</b><span>a pagar em aberto ({pag.length})</span></div>
      </div>

      <div className="card">
        <h2>Comprovantes enviados por clientes ({proofs?.length ?? 0})</h2>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>O comprovante não dá baixa sozinho: confira no extrato e valide para registrar o recebimento.</p>
        {(proofs ?? []).map((p) => (
          <div key={p.id} className="inline" style={{ margin: '12px 0', alignItems: 'flex-start' }}>
            <span className="small" style={{ minWidth: 260 }}><b>{tt?.find((t) => t.id === p.title_id)?.description}</b><br />{brl(p.amount)} · pago em {dataBR(p.paid_on + 'T12:00:00')}{p.note ? ` · ${p.note}` : ''}</span>
            {canWrite && (<>
              <form action={validateProof} className="inline"><input type="hidden" name="proof_id" value={p.id} /><input type="hidden" name="key" value={randomUUID()} />
                <select name="account_id">{(accounts ?? []).map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}</select><button className="btn sm" type="submit">Validar e dar baixa</button></form>
              <form action={rejectProof} className="inline"><input type="hidden" name="proof_id" value={p.id} /><input name="reason" placeholder="Motivo da recusa" required /><button className="btn danger sm" type="submit">Recusar</button></form>
            </>)}
          </div>
        ))}
        {!proofs?.length && <p className="muted small">Nenhum comprovante pendente.</p>}
      </div>

      <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="card"><h2>A receber: próximos 7 dias e vencidos</h2>
          {[...venc, ...prox(rec)].slice(0, 12).map((t) => <p key={t.id} className="small" style={{ margin: '8px 0' }}>{t.overdue && <span className="badge off">vencido</span>} {t.description} · <b>{brl(t.balance)}</b> · {dataBR(t.due_date + 'T12:00:00')}</p>)}
          {![...venc, ...prox(rec)].length && <p className="muted small">Nada vencendo.</p>}</div>
        <div className="card"><h2>A pagar: próximos 7 dias e vencidos</h2>
          {[...pag.filter((t) => t.overdue), ...prox(pag)].slice(0, 12).map((t) => <p key={t.id} className="small" style={{ margin: '8px 0' }}>{t.overdue && <span className="badge off">vencido</span>} {t.description} · <b>{brl(t.balance)}</b> · {dataBR(t.due_date + 'T12:00:00')}</p>)}
          {![...pag.filter((t) => t.overdue), ...prox(pag)].length && <p className="muted small">Nada vencendo.</p>}</div>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>Hoje: {dataBR(today + 'T12:00:00')}. Pedido aprovado, compra aprovada e orçamento enviado não são receita nem despesa: só viram valores financeiros quando há um título.</p>
      <p className="small" style={{ marginTop: 6 }}><Link href="/financeiro/titulos"><b>Gerar cobranças e contas a pagar →</b></Link></p>
    </>
  );
}

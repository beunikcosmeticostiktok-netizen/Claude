import { getSession } from '@/lib/auth';
import { brl } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { approve, cancelStatement, closeMonth, createPlan, setTarget } from './actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { calculada: 'Calculada', aprovada: 'Aprovada (conta a pagar)', cancelada: 'Cancelada' };
const mlabel = (d: string) => `${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function Comissoes({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; vendedor?: string; mes?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const admin = roles.includes('admin'), fin = admin || roles.includes('financeiro'), mgr = fin || roles.includes('gestor');
  const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1);
  const defMonth = prev.toISOString().slice(0, 7);

  const [{ data: stmts }, { data: plans }, { data: sellers }, { data: targets }] = await Promise.all([
    supabase.from('commission_statements').select('id, seller_id, month, target_amount, invoiced_total, attainment_pct, commission_pct, amount, orders_count, status, title_id, note, profiles:seller_id(full_name, email)').order('month', { ascending: false }).limit(100),
    mgr ? supabase.from('commission_plans').select('id, name, active, commission_tiers(ord, min_attainment_pct, commission_pct)').order('name') : Promise.resolve({ data: [] }),
    mgr ? supabase.from('profiles').select('id, full_name, email').eq('is_seller', true).eq('active', true).order('full_name') : Promise.resolve({ data: [] }),
    mgr ? supabase.from('commission_targets').select('id, month, target_amount, seller_id, plan_id').order('month', { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
  ]);
  type P = { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  const nm = (p: P) => { const x = Array.isArray(p) ? p[0] : p; return x?.full_name || x?.email || ''; };
  const sellerName = (id: string) => { const s = (sellers ?? []).find((x) => x.id === id); return s?.full_name || s?.email || id.slice(0, 8); };

  type Prev = { invoiced_total: number; attainment_pct: number; commission_pct: number; amount: number; orders_count: number; target_amount: number };
  let preview = null as Prev | null;
  let previewErr = '';
  if (mgr && sp.vendedor && sp.mes) {
    const { data, error } = await supabase.rpc('commission_preview', { p_seller: sp.vendedor, p_month: sp.mes + '-01' });
    if (error) previewErr = error.message.includes('target_not_found') ? 'Este vendedor não tem meta cadastrada nesse mês.' : 'Não foi possível calcular.';
    else preview = (data as Prev[] | null)?.[0] ?? null;
  }

  return (
    <>
      <div className="top"><h1>Comissões</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro) || (sp.erro === 'invalid_tiers' ? 'As 4 faixas precisam ter meta e comissão crescentes.' : 'Não foi possível concluir.')}</div>}
      {sp.ok && <div className="alert ok">Feito.</div>}
      <p className="muted small">Regra: meta mensal por vendedor; contam só pedidos <b>faturados</b> (nota registrada) e não cancelados no mês. A comissão é o percentual da faixa atingida sobre o valor faturado
        (<i>base a confirmar com a empresa: faturado ou recebido</i>). Aprovada a apuração, nasce uma conta a pagar no Financeiro.</p>

      {mgr && (
        <div className="card"><h2>Calcular e fechar o mês</h2>
          <form method="get" className="inline">
            <select name="vendedor" defaultValue={sp.vendedor ?? ''} required><option value="">Vendedor…</option>{(sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}</select>
            <input type="month" name="mes" defaultValue={sp.mes ?? defMonth} required /><button className="btn line sm" type="submit">Calcular</button></form>
          {previewErr && <p className="alert err">{previewErr}</p>}
          {preview && (
            <div style={{ marginTop: 10 }}>
              <p>Meta {brl(preview.target_amount)} · faturado <b>{brl(preview.invoiced_total)}</b> ({preview.orders_count} pedidos) · {Number(preview.attainment_pct).toLocaleString('pt-BR')}% da meta · faixa {Number(preview.commission_pct)}% → <b>{brl(preview.amount)}</b></p>
              {fin && (
                <form action={closeMonth} className="inline"><input type="hidden" name="seller_id" value={sp.vendedor} /><input type="hidden" name="month" value={sp.mes} />
                  <input name="note" placeholder="Observação (opcional)" /><button className="btn sm" type="submit">Fechar mês (gravar apuração)</button></form>)}
              <p className="muted small">Só é possível fechar meses já encerrados. Depois de fechada, a apuração não muda.</p>
            </div>)}
        </div>)}

      <div className="card" style={{ marginTop: 12 }}><h2>Apurações</h2>
        <table className="table"><thead><tr><th>Mês</th><th>Vendedor</th><th className="right">Faturado</th><th className="right">% da meta</th><th className="right">Comissão</th><th>Situação</th><th /></tr></thead>
          <tbody>{(stmts ?? []).map((s) => (
            <tr key={s.id}><td>{mlabel(s.month)}</td><td>{nm(s.profiles as P)}</td><td className="right">{brl(s.invoiced_total)}</td>
              <td className="right">{Number(s.attainment_pct).toLocaleString('pt-BR')}%</td><td className="right"><b>{brl(s.amount)}</b> <span className="muted small">({Number(s.commission_pct)}%)</span></td>
              <td><span className="badge">{ST[s.status]}</span></td>
              <td>{fin && s.status === 'calculada' && Number(s.amount) > 0 && (
                <form action={approve} className="inline"><input type="hidden" name="id" value={s.id} /><input type="date" name="due" title="Vencimento" /><button className="btn sm" type="submit">Aprovar</button></form>)}
                {fin && s.status !== 'cancelada' && (
                  <form action={cancelStatement} className="inline"><input type="hidden" name="id" value={s.id} /><input name="reason" placeholder="Motivo" required /><button className="btn line sm" type="submit">Cancelar</button></form>)}</td></tr>))}
            {!stmts?.length && <tr><td colSpan={7} className="muted">Nenhuma apuração.</td></tr>}</tbody></table>
        {fin && <p className="muted small">Depois de aprovada, o pagamento é feito em Financeiro → Títulos (contas a pagar).</p>}
      </div>

      {mgr && (
        <div className="grid2" style={{ alignItems: 'start', marginTop: 12 }}>
          <div className="card"><h2>Planos de comissão</h2>
            {(plans ?? []).map((p) => (
              <p key={p.id}><b>{p.name}</b><br /><span className="small muted">{[...(p.commission_tiers ?? [])].sort((a, b) => a.ord - b.ord).map((t) => `a partir de ${Number(t.min_attainment_pct)}% da meta: ${Number(t.commission_pct)}%`).join(' · ')}</span></p>))}
            {!plans?.length && <p className="muted">Nenhum plano. Cadastre as 4 faixas.</p>}
            {admin && (
              <form action={createPlan} className="stack"><label>Nome do plano<input name="name" required /></label>
                {[1, 2, 3, 4].map((i) => <div className="grid2" key={i}><label>Faixa {i}: a partir de (% da meta)<input name={`att${i}`} inputMode="decimal" required /></label><label>Comissão (%)<input name={`pct${i}`} inputMode="decimal" required /></label></div>)}
                <div><button className="btn sm" type="submit">Criar plano</button></div></form>)}
          </div>
          <div className="card"><h2>Metas mensais</h2>
            <table className="table"><tbody>{(targets ?? []).map((t) => <tr key={t.id}><td>{mlabel(t.month)}</td><td>{sellerName(t.seller_id)}</td><td className="right">{brl(t.target_amount)}</td></tr>)}
              {!targets?.length && <tr><td className="muted">Nenhuma meta.</td></tr>}</tbody></table>
            {admin && (
              <form action={setTarget} className="stack" style={{ marginTop: 10 }}>
                <label>Vendedor<select name="seller_id" required>{(sellers ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}</select></label>
                <label>Plano<select name="plan_id" required>{(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <div className="grid2"><label>Mês<input type="month" name="month" defaultValue={defMonth} required /></label><label>Meta (R$)<input name="amount" inputMode="decimal" required /></label></div>
                <div><button className="btn sm" type="submit">Salvar meta</button></div></form>)}
          </div>
        </div>)}
    </>
  );
}

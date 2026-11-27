import { getSession } from '@/lib/auth';
import { brl } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ de?: string; ate?: string; regime?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await getSession();
  const now = new Date();
  const de = sp.de ?? new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
  const ate = sp.ate ?? new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const regime = sp.regime === 'competencia' ? 'competencia' : 'caixa';
  const { data, error } = await supabase.rpc('finance_summary', { p_from: de, p_to: ate, p_regime: regime });
  const rows = (data ?? []) as { month: string; receitas: number; despesas: number; resultado: number }[];
  const tot = rows.reduce((a, r) => ({ r: a.r + Number(r.receitas), d: a.d + Number(r.despesas) }), { r: 0, d: 0 });
  return (
    <>
      <div className="top"><h1>Relatórios</h1></div>
      <form className="card inline" style={{ marginBottom: 16 }}>
        <label>De<input name="de" type="date" defaultValue={de} /></label><label>Até<input name="ate" type="date" defaultValue={ate} /></label>
        <label>Critério<select name="regime" defaultValue={regime}><option value="caixa">Regime de caixa</option><option value="competencia">Regime de competência</option></select></label>
        <button className="btn" type="submit" style={{ alignSelf: 'flex-end' }}>Atualizar</button>
      </form>
      {error && <div className="alert err">{dbErrorText('forbidden')}</div>}
      <div className="alert warn">
        {regime === 'caixa'
          ? <><b>Regime de caixa:</b> dinheiro que realmente entrou e saiu em títulos (principal, juros, multas e estornos). Orçamentos, pedidos e compras aprovadas não entram. Transferências entre contas ficam de fora.</>
          : <><b>Regime de competência:</b> títulos (não cancelados) agrupados pelo mês de competência, pagos ou não.</>}
      </div>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Mês</th><th className="right">Receitas</th><th className="right">Despesas</th><th className="right">Resultado</th></tr></thead>
        <tbody>
          {rows.map((r) => <tr key={r.month}><td>{new Date(r.month + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</td><td className="right">{brl(r.receitas)}</td><td className="right">{brl(r.despesas)}</td><td className="right"><b>{brl(r.resultado)}</b></td></tr>)}
          <tr><td><b>Total</b></td><td className="right"><b>{brl(tot.r)}</b></td><td className="right"><b>{brl(tot.d)}</b></td><td className="right"><b>{brl(tot.r - tot.d)}</b></td></tr>
          {!rows.length && <tr><td colSpan={4} className="muted">Sem dados no período.</td></tr>}
        </tbody></table>
        <p className="muted small">Imposto do Simples, comissões e rateio de despesas fixas ainda não são lançados automaticamente: o resultado acima é financeiro, não contábil.</p></div>
    </>
  );
}

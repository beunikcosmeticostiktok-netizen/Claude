import { getSession } from '@/lib/auth';
import { brl } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { saveCadastro } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Contas({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canWrite = roles.includes('admin') || roles.includes('financeiro');
  const [{ data: acc }, { data: cats }, { data: ccs }] = await Promise.all([
    supabase.from('account_balances').select('account_id, name, kind, opening_balance, balance').order('name'),
    supabase.from('finance_categories').select('id, name, kind').order('kind').order('name'), supabase.from('cost_centers').select('id, name').order('name'),
  ]);
  return (
    <>
      <div className="top"><h1>Contas, categorias e centros de custo</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}{sp.ok && <div className="alert ok">Salvo.</div>}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card"><h2>Contas bancárias e caixas</h2>
          <table className="table"><tbody>{(acc ?? []).map((a) => <tr key={a.account_id}><td><b>{a.name}</b><div className="muted small">{a.kind === 'caixa' ? 'Caixa' : 'Banco'} · saldo inicial {brl(a.opening_balance)}</div></td><td className="right"><b>{brl(a.balance)}</b></td></tr>)}
            {!acc?.length && <tr><td className="muted">Nenhuma conta.</td></tr>}</tbody></table>
          {canWrite && <form action={saveCadastro} className="stack" style={{ marginTop: 12 }}><input type="hidden" name="what" value="conta" />
            <div className="grid2"><label>Nome<input name="name" required /></label><label>Tipo<select name="type"><option value="banco">Banco</option><option value="caixa">Caixa</option></select></label></div>
            <label>Saldo inicial (R$)<input name="opening" inputMode="decimal" defaultValue="0" /></label><div><button className="btn sm" type="submit">Adicionar conta</button></div></form>}</div>
        <div className="stack">
          <div className="card"><h2>Categorias</h2>
            <p className="small">{(cats ?? []).map((c) => <span key={c.id} className={`badge ${c.kind === 'receita' ? 'on' : ''}`}>{c.name}</span>)}{!cats?.length && <span className="muted">Nenhuma categoria (defina as da empresa).</span>}</p>
            {canWrite && <form action={saveCadastro} className="inline" style={{ marginTop: 10 }}><input type="hidden" name="what" value="categoria" /><input name="name" placeholder="Nome" required />
              <select name="type"><option value="receita">Receita</option><option value="despesa">Despesa</option></select><button className="btn sm" type="submit">Adicionar</button></form>}</div>
          <div className="card"><h2>Centros de custo</h2>
            <p className="small">{(ccs ?? []).map((c) => <span key={c.id} className="badge">{c.name}</span>)}{!ccs?.length && <span className="muted">Nenhum centro de custo.</span>}</p>
            {canWrite && <form action={saveCadastro} className="inline" style={{ marginTop: 10 }}><input type="hidden" name="what" value="centro" /><input name="name" placeholder="Nome" required /><button className="btn sm" type="submit">Adicionar</button></form>}</div>
        </div>
      </div>
    </>
  );
}

import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { saveMachine, saveMold, setMoldStatus } from '../actions';

export const dynamic = 'force-dynamic';
const MS: Record<string, string> = { disponivel: 'Disponível', em_uso: 'Em uso', manutencao: 'Em manutenção', inativo: 'Inativo' };

export default async function Recursos({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const [{ data: machines }, { data: molds }, { data: custs }] = await Promise.all([
    supabase.from('machines').select('*').order('code'), supabase.from('molds').select('*').order('code'),
    supabase.from('customers').select('id, legal_name').eq('active', true).order('legal_name').limit(500),
  ]);
  const canWrite = roles.includes('admin') || roles.includes('producao');
  return (
    <>
      <div className="top"><h1>Máquinas e moldes</h1><Link className="btn line" href="/producao">Voltar</Link></div>
      {sp.erro && <div className="alert err">{sp.erro === 'cliente' ? 'Molde de cliente precisa do cliente dono.' : 'Não foi possível salvar (código já existe?).'}</div>}
      {sp.ok && <div className="alert ok">Salvo.</div>}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div className="card"><h2>Máquinas</h2>
          <table className="table"><tbody>{(machines ?? []).map((m) => <tr key={m.id}><td><b>{m.code}</b> {m.name}</td><td><span className="badge">{m.kind === 'sopro' ? 'Sopro' : 'Injeção'}</span></td></tr>)}
            {!machines?.length && <tr><td className="muted">Nenhuma máquina.</td></tr>}</tbody></table>
          {canWrite && <form action={saveMachine} className="stack" style={{ marginTop: 12 }}>
            <div className="grid2"><label>Código<input name="code" required /></label><label>Nome<input name="name" required /></label></div>
            <label>Processo<select name="kind"><option value="injecao">Injeção</option><option value="sopro">Sopro</option></select></label>
            <div><button className="btn sm" type="submit">Adicionar máquina</button></div></form>}
        </div>
        <div className="card"><h2>Moldes</h2>
          <table className="table"><tbody>{(molds ?? []).map((m) => (
            <tr key={m.id}><td><b>{m.code}</b> {m.name}<div className="muted small">{m.ownership === 'cliente' ? `Do cliente: ${custs?.find((c) => c.id === m.customer_id)?.legal_name ?? ''}` : 'Da empresa'} · {m.cavities} cavidade(s){m.location ? ` · ${m.location}` : ''}</div></td>
              <td>{canWrite ? <form action={setMoldStatus} className="inline"><input type="hidden" name="id" value={m.id} />
                <select name="status" defaultValue={m.status}>{Object.entries(MS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button className="btn line sm" type="submit">OK</button></form> : <span className="badge">{MS[m.status]}</span>}</td></tr>))}
            {!molds?.length && <tr><td className="muted">Nenhum molde.</td></tr>}</tbody></table>
          {canWrite && <form action={saveMold} className="stack" style={{ marginTop: 12 }}>
            <div className="grid2"><label>Código<input name="code" required /></label><label>Nome<input name="name" required /></label></div>
            <div className="grid2"><label>Propriedade<select name="ownership"><option value="empresa">Da empresa</option><option value="cliente">Do cliente</option></select></label>
              <label>Cliente dono (se do cliente)<select name="customer_id" defaultValue=""><option value="">—</option>{(custs ?? []).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label></div>
            <div className="grid2"><label>Cavidades<input name="cavities" defaultValue="1" inputMode="numeric" /></label><label>Localização<input name="location" /></label></div>
            <div><button className="btn sm" type="submit">Adicionar molde</button></div></form>}
        </div>
      </div>
    </>
  );
}

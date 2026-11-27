import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { createProject } from '../actions';

export default async function NovoProjeto({ searchParams }: { searchParams: Promise<{ erro?: string; customer?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'comercial']);
  const { data } = await supabase.from('customers').select('id, legal_name').eq('active', true).order('legal_name').limit(1000);
  return (
    <>
      <div className="top"><h1>Novo projeto exclusivo</h1><Link className="btn line" href="/projetos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      <form action={createProject} className="card stack" style={{ maxWidth: 680 }}>
        <label>Cliente<select name="customer_id" required defaultValue={sp.customer ?? ''}><option value="" disabled>Selecione…</option>{(data ?? []).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}</select></label>
        <label>Nome do projeto<input name="title" required placeholder="ex.: Frasco 300 ml com tampa flip" /></label>
        <label>Briefing (o que o cliente precisa)<textarea name="briefing" rows={5} placeholder="Produto, uso, medidas, cores, quantidade esperada, referências…" /></label>
        <div><button className="btn" type="submit">Criar projeto</button></div>
      </form>
    </>
  );
}

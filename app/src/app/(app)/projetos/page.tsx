import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { PROJECT_STAGE_LABEL } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function Projetos({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  let q = supabase.from('projects').select('id, number, title, customer_id, stage, due_date, owner_id, created_at').order('created_at', { ascending: false }).limit(200);
  if (sp.f === 'abertos') q = q.not('stage', 'in', '(liberado,recusado,cancelado)');
  const { data } = await q;
  const { data: custs } = (data ?? []).length ? await supabase.from('customers').select('id, legal_name').in('id', [...new Set((data ?? []).map((p) => p.customer_id))]) : { data: [] };
  const canWrite = roles.includes('admin') || roles.includes('comercial');
  return (
    <>
      <div className="top"><h1>Projetos exclusivos</h1>{canWrite && <Link className="btn" href="/projetos/novo">Novo projeto</Link>}</div>
      <div className="tabs"><Link href="/projetos" className={!sp.f ? 'on' : undefined}>Todos</Link><Link href="/projetos?f=abertos" className={sp.f === 'abertos' ? 'on' : undefined}>Em andamento</Link></div>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Projeto</th><th>Cliente</th><th>Etapa</th><th>Prazo</th></tr></thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.id}><td><Link href={`/projetos/${p.id}`}><b>{p.number}</b></Link><div className="small">{p.title}</div></td>
              <td>{custs?.find((c) => c.id === p.customer_id)?.legal_name}</td>
              <td><span className={`badge ${p.stage === 'liberado' ? 'on' : ['recusado', 'cancelado'].includes(p.stage) ? 'off' : 'acc'}`}>{PROJECT_STAGE_LABEL[p.stage]}</span></td>
              <td>{p.due_date ? dataBR(p.due_date + 'T12:00:00') : '—'}</td></tr>))}
          {!data?.length && <tr><td colSpan={4} className="muted">Nenhum projeto.</td></tr>}
        </tbody></table></div>
    </>
  );
}

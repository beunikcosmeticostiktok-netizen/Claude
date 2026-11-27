import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { PROJECT_STAGE_LABEL } from '@/lib/labels';

export default async function PortalProjetos() {
  const { supabase } = await getSession();
  const { data } = await supabase.from('portal_projects').select('id, number, title, stage, due_date').order('number', { ascending: false });
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>Projetos exclusivos</h1>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Projeto</th><th>Etapa</th><th>Prazo desejado</th></tr></thead>
        <tbody>
          {(data ?? []).map((p) => <tr key={p.id}><td><Link href={`/portal/projetos/${p.id}`}><b>{p.number}</b></Link><div className="small">{p.title}</div></td>
            <td><span className={`badge ${p.stage === 'liberado' ? 'on' : ['recusado', 'cancelado'].includes(p.stage) ? 'off' : 'acc'}`}>{PROJECT_STAGE_LABEL[p.stage]}</span></td>
            <td>{p.due_date ? dataBR(p.due_date + 'T12:00:00') : '—'}</td></tr>)}
          {!data?.length && <tr><td colSpan={3} className="muted">Você ainda não tem projetos exclusivos. Fale com seu vendedor para desenvolver um produto sob medida.</td></tr>}
        </tbody></table></div>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText, PROJECT_STAGE_LABEL, PROJECT_STAGES } from '@/lib/labels';
import { approveProjectVersion, decideSample, requestProjectChange } from '../../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { aprovada: 'Versão aprovada. Obrigado! A equipe segue para o desenvolvimento.', alteracao: 'Pedido de alteração enviado.', amostra_aprovada: 'Amostra aprovada.', amostra_reprovada: 'Amostra reprovada. Registramos o motivo.' };
const SS: Record<string, string> = { enviada: 'Aguardando sua decisão', aprovada: 'Aprovada', reprovada: 'Reprovada' };

export default async function PortalProjeto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, portal } = await getSession();
  const { data: p } = await supabase.from('portal_projects').select('*').eq('id', id).maybeSingle();
  if (!p) notFound();
  const [{ data: versions }, { data: samples }, { data: files }, { data: cust }] = await Promise.all([
    supabase.from('portal_project_versions').select('*').eq('project_id', id).order('version', { ascending: false }),
    supabase.from('portal_project_samples').select('*').eq('project_id', id).order('number'),
    supabase.from('portal_project_files').select('*').eq('project_id', id),
    supabase.from('portal_customer').select('id').limit(1),
  ]);
  const access = portal.find((x) => x.customer_id === cust?.[0]?.id)?.access ?? portal[0]?.access;
  const aprovador = access === 'aprovador';
  const idx = PROJECT_STAGES.findIndex(([k]) => k === p.stage);

  return (
    <>
      <div className="top"><div><h1>{p.number} <span className={`badge ${p.stage === 'liberado' ? 'on' : 'acc'}`}>{PROJECT_STAGE_LABEL[p.stage]}</span></h1><span className="muted">{p.title}</span></div><Link className="btn line" href="/portal/projetos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok]}</div>}
      <ul className="inline" style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }}>
        {PROJECT_STAGES.map(([k, l], i) => <li key={k} className={`badge ${i < idx || p.stage === 'liberado' ? 'on' : i === idx ? 'acc' : ''}`}>{l}</li>)}
      </ul>
      {(p.development_price != null || p.mold_price != null || p.sample_price != null || p.charge_notes) && (
        <div className="card" style={{ marginBottom: 16 }}><h2>Investimento do projeto</h2><div className="kv" style={{ marginTop: 10 }}>
          {p.development_price != null && <div><small>Desenvolvimento</small><b>{brl(p.development_price)}</b></div>}
          {p.mold_price != null && <div><small>Molde</small><b>{brl(p.mold_price)}</b></div>}
          {p.sample_price != null && <div><small>Amostra</small><b>{brl(p.sample_price)}</b></div>}</div>
          {p.charge_notes && <p className="small" style={{ marginTop: 10 }}>{p.charge_notes}</p>}</div>
      )}

      <div className="card"><h2>Versões técnicas</h2>
        {(versions ?? []).map((v) => (
          <div key={v.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
            <b>Versão {v.version}</b> <span className={`badge ${v.status === 'aprovada' ? 'on' : v.status === 'enviada' ? 'acc' : ''}`}>{v.status === 'enviada' ? 'Aguardando sua aprovação' : v.status === 'aprovada' ? 'Aprovada' : 'Substituída'}</span>
            {v.approved_at && <span className="muted small"> · aprovada em {dataBR(v.approved_at)}</span>}
            <p className="small" style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{v.requirements}</p>
            {v.status === 'enviada' && aprovador && (
              <div className="grid2" style={{ alignItems: 'start' }}>
                <form action={approveProjectVersion} className="stack"><input type="hidden" name="project_id" value={p.id} /><input type="hidden" name="version_id" value={v.id} />
                  <p className="muted small">Ao aprovar, você confirma esta versão técnica. Mudanças depois exigem nova versão e nova amostra.</p><div><button className="btn" type="submit">Aprovar versão {v.version}</button></div></form>
                <form action={requestProjectChange} className="stack"><input type="hidden" name="project_id" value={p.id} /><input type="hidden" name="version_id" value={v.id} />
                  <label>Solicitar alteração<textarea name="message" rows={2} required /></label><div><button className="btn line" type="submit">Enviar pedido</button></div></form>
              </div>)}
            {v.status === 'enviada' && !aprovador && <p className="muted small">Seu acesso é só de consulta: peça a um contato aprovador da sua empresa.</p>}
          </div>))}
        {!versions?.length && <p className="muted small">A equipe ainda não enviou a proposta técnica.</p>}
      </div>

      {(samples ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}><h2>Amostras</h2>
          {(samples ?? []).map((s) => (
            <div key={s.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
              <b>Amostra {s.number}</b> <span className={`badge ${s.status === 'aprovada' ? 'on' : s.status === 'reprovada' ? 'off' : 'acc'}`}>{SS[s.status]}</span>
              {s.notes && <p className="small" style={{ margin: '6px 0' }}>{s.notes}</p>}{s.decision_note && <p className="small muted">Seu comentário: {s.decision_note}</p>}
              {s.status === 'enviada' && aprovador && (
                <form action={decideSample} className="inline" style={{ marginTop: 8 }}><input type="hidden" name="project_id" value={p.id} /><input type="hidden" name="sample_id" value={s.id} />
                  <input name="note" placeholder="Comentário (obrigatório se reprovar)" style={{ minWidth: 240 }} />
                  <button className="btn" name="approve" value="1" type="submit">Aprovar amostra</button><button className="btn danger" name="approve" value="0" type="submit">Reprovar</button></form>)}
            </div>))}
        </div>
      )}
      {(files ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}><h2>Arquivos</h2>
          {(files ?? []).map((f) => <p key={f.id} className="small" style={{ margin: '8px 0' }}><a href={f.url} target="_blank" rel="noopener noreferrer"><b>{f.title}</b></a> <span className="muted">· {f.kind}{f.version_no ? ` · v${f.version_no}` : ''}</span></p>)}</div>
      )}
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText, PROJECT_NEXT, PROJECT_STAGE_LABEL, PROJECT_STAGES } from '@/lib/labels';
import { addFile, advance, cancelProject, createItem, sampleCreate, sampleDecide, sampleSend, saveCosts, saveProject, setFeasibility, toggleFile, versionApproveOffline, versionCreate, versionSend } from '../actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { criado: 'Projeto criado.', salvo: 'Salvo.', custo: 'Custo interno salvo.', viabilidade: 'Viabilidade registrada.', etapa: 'Etapa atualizada.', cancelado: 'Projeto cancelado.', versao: 'Versão criada em rascunho.', enviada: 'Versão enviada ao cliente (visível no portal).', aprovada: 'Versão marcada como aprovada.', arquivo: 'Arquivos atualizados.', amostra: 'Amostra criada.', amostra_enviada: 'Amostra enviada.', amostra_decidida: 'Decisão da amostra registrada.', item: 'Produto exclusivo criado no catálogo.' };
const VS: Record<string, string> = { rascunho: 'Rascunho', enviada: 'Aguardando o cliente', aprovada: 'Aprovada', recusada: 'Recusada', substituida: 'Substituída' };
const SS: Record<string, string> = { em_producao: 'Em produção', enviada: 'Enviada ao cliente', aprovada: 'Aprovada', reprovada: 'Reprovada' };

export default async function ProjetoDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: p } = await supabase.from('projects').select('*').eq('id', id).maybeSingle();
  if (!p) notFound();
  const [{ data: cust }, { data: versions }, { data: files }, { data: samples }, { data: events }, { data: costs }, { data: molds }, { data: item }, { data: reqs }] = await Promise.all([
    supabase.from('customers').select('legal_name').eq('id', p.customer_id).single(),
    supabase.from('project_versions').select('*').eq('project_id', id).order('version', { ascending: false }),
    supabase.from('project_files').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('project_samples').select('*').eq('project_id', id).order('number'),
    supabase.from('project_events').select('at, kind, detail, note').eq('project_id', id).order('at', { ascending: false }).limit(40),
    supabase.from('project_costs').select('*').eq('project_id', id).maybeSingle(),
    supabase.from('molds').select('id, code, name').in('status', ['disponivel', 'em_uso', 'manutencao']).order('code'),
    p.item_id ? supabase.from('items').select('sku, name').eq('id', p.item_id).single() : Promise.resolve({ data: null }),
    supabase.from('project_change_requests').select('message, created_at, version_id').eq('project_id', id).order('created_at', { ascending: false }),
  ]);
  const can = (r: string[]) => roles.some((x) => r.includes(x));
  const closed = ['recusado', 'cancelado'].includes(p.stage);
  const draft = (versions ?? []).find((v) => v.status === 'rascunho');
  const hid = <input type="hidden" name="id" value={p.id} />;
  const idx = PROJECT_STAGES.findIndex(([k]) => k === p.stage);

  return (
    <>
      <div className="top"><div><h1>{p.number} <span className={`badge ${p.stage === 'liberado' ? 'on' : closed ? 'off' : 'acc'}`}>{PROJECT_STAGE_LABEL[p.stage]}</span></h1>
        <span className="muted"><Link href={`/clientes/${p.customer_id}`}><b>{cust?.legal_name}</b></Link> · {p.title}</span></div><Link className="btn line" href="/projetos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}

      <ul className="inline" style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }}>
        {PROJECT_STAGES.map(([k, l], i) => <li key={k} className={`badge ${i < idx || p.stage === 'liberado' ? 'on' : i === idx ? 'acc' : ''}`}>{i + 1}. {l}</li>)}
      </ul>
      {p.stage === 'liberado' && <div className="alert ok">Projeto liberado para produção. Produto no catálogo: {item ? <b>{item.sku}</b> : <b>ainda não criado</b>}. A produção usa a versão técnica aprovada.</div>}
      {p.cancel_reason && <div className="alert warn">Motivo: {p.cancel_reason}</div>}

      {can(['admin', 'gestor', 'comercial', 'producao']) && !closed && PROJECT_NEXT[p.stage] && (
        <div className="card" style={{ marginBottom: 16 }}><h2>Avançar etapa</h2>
          <div className="inline" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            {PROJECT_NEXT[p.stage].map((to) => (
              <form key={to} action={advance} className="inline">{hid}<input type="hidden" name="to" value={to} />
                <input name="note" placeholder={to === 'recusado' || to === 'desenvolvimento' && p.stage === 'aprovacao_amostra' ? 'Motivo (obrigatório)' : 'Observação (opcional)'} style={{ minWidth: 200 }} />
                <button className={`btn ${to === 'recusado' ? 'danger' : ''}`} type="submit">→ {PROJECT_STAGE_LABEL[to]}</button></form>))}
          </div></div>
      )}

      <form action={saveProject} className="card stack">
        <h2>Dados do projeto</h2>{hid}
        <div className="grid2"><label>Nome<input name="title" defaultValue={p.title} required /></label><label>Prazo desejado<input name="due_date" type="date" defaultValue={p.due_date ?? ''} /></label></div>
        <label>Briefing<textarea name="briefing" rows={3} defaultValue={p.briefing ?? ''} /></label>
        <label>Requisitos do cliente / observações técnicas<textarea name="requirements" rows={2} defaultValue={p.requirements ?? ''} /></label>
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <label>Desenvolvimento cobrado (R$)<input name="development_price" inputMode="decimal" defaultValue={p.development_price != null ? String(p.development_price).replace('.', ',') : ''} /></label>
          <label>Molde cobrado (R$)<input name="mold_price" inputMode="decimal" defaultValue={p.mold_price != null ? String(p.mold_price).replace('.', ',') : ''} /></label>
          <label>Amostra cobrada (R$)<input name="sample_price" inputMode="decimal" defaultValue={p.sample_price != null ? String(p.sample_price).replace('.', ',') : ''} /></label>
          <label>Molde<select name="mold_id" defaultValue={p.mold_id ?? ''}><option value="">—</option>{(molds ?? []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></label>
        </div>
        <label>Como será cobrado (visível ao cliente)<input name="charge_notes" defaultValue={p.charge_notes ?? ''} placeholder="ex.: molde pago à vista; desenvolvimento diluído nos primeiros pedidos" /></label>
        {can(['admin', 'comercial', 'producao']) && <div><button className="btn line sm" type="submit">Salvar dados</button></div>}
      </form>

      {p.stage === 'viabilidade' || p.feasible != null ? (
        <div className="card" style={{ marginTop: 16 }}><h2>Análise de viabilidade</h2>
          {p.feasible != null && <p className="small" style={{ margin: '8px 0' }}><span className={`badge ${p.feasible ? 'on' : 'off'}`}>{p.feasible ? 'Viável' : 'Inviável'}</span> {p.feasibility_notes} <span className="muted">({p.feasibility_at ? dataBR(p.feasibility_at) : ''})</span></p>}
          {p.stage === 'viabilidade' && can(['admin', 'gestor', 'producao']) && (
            <form action={setFeasibility} className="stack">{hid}
              <label>Parecer técnico<textarea name="notes" rows={2} required /></label>
              <div className="inline"><select name="feasible"><option value="1">Viável</option><option value="0">Inviável</option></select><button className="btn sm" type="submit">Registrar parecer</button></div></form>)}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}><h2>Versões técnicas</h2>
        <p className="muted small" style={{ margin: '6px 0' }}>O cliente aprova uma versão no portal. Mudar o projeto depois da aprovação cria nova versão e exige nova aprovação e nova amostra.</p>
        {(versions ?? []).map((v) => (
          <div key={v.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
            <b>v{v.version}</b> <span className={`badge ${v.status === 'aprovada' ? 'on' : v.status === 'enviada' ? 'acc' : ''}`}>{VS[v.status]}</span>
            {v.approved_at && <span className="muted small"> · {dataBR(v.approved_at)} ({v.approved_via === 'portal' ? 'portal' : 'registrado internamente'})</span>}
            <p className="small" style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{v.requirements}</p>
            {(reqs ?? []).filter((r) => r.version_id === v.id).map((r, i) => <div key={i} className="alert warn"><b>Pedido de alteração do cliente:</b> {r.message}</div>)}
            {v.status === 'rascunho' && can(['admin', 'comercial', 'producao']) && <form action={versionSend}>{hid}<input type="hidden" name="version_id" value={v.id} /><button className="btn sm" type="submit">Enviar ao cliente</button></form>}
            {v.status === 'enviada' && can(['admin', 'gestor', 'comercial']) && (
              <form action={versionApproveOffline} className="inline">{hid}<input type="hidden" name="version_id" value={v.id} /><input name="note" placeholder="Como o cliente aprovou? (obrigatório)" required style={{ minWidth: 260 }} /><button className="btn line sm" type="submit">Registrar aprovação fora do sistema</button></form>)}
          </div>
        ))}
        {!versions?.length && <p className="muted small">Nenhuma versão.</p>}
        {!draft && !closed && can(['admin', 'comercial', 'producao']) && !['briefing', 'viabilidade'].includes(p.stage) && (
          <form action={versionCreate} className="stack" style={{ marginTop: 12 }}>{hid}
            <label>Requisitos técnicos desta versão<textarea name="requirements" rows={3} required placeholder="Material, medidas, espessura, acabamento, cor, tampa, quantidade mínima…" /></label>
            <div><button className="btn sm" type="submit">Criar nova versão</button></div></form>)}
      </div>

      <div className="card" style={{ marginTop: 16 }}><h2>Amostras</h2>
        {(samples ?? []).map((s) => (
          <div key={s.id} className="inline" style={{ margin: '10px 0', alignItems: 'flex-start' }}>
            <span className="small" style={{ minWidth: 240 }}><b>Amostra {s.number}</b> <span className={`badge ${s.status === 'aprovada' ? 'on' : s.status === 'reprovada' ? 'off' : ''}`}>{SS[s.status]}</span>{s.notes ? ` — ${s.notes}` : ''}{s.decision_note ? ` · Cliente: ${s.decision_note}` : ''}</span>
            {s.status === 'em_producao' && can(['admin', 'producao']) && <form action={sampleSend}>{hid}<input type="hidden" name="sample_id" value={s.id} /><button className="btn sm" type="submit">Enviar ao cliente</button></form>}
            {s.status === 'enviada' && can(['admin', 'gestor', 'comercial']) && (
              <form action={sampleDecide} className="inline">{hid}<input type="hidden" name="sample_id" value={s.id} /><input name="note" placeholder="Como o cliente decidiu? (obrigatório)" required />
                <select name="approve"><option value="1">Aprovada</option><option value="0">Reprovada</option></select><button className="btn line sm" type="submit">Registrar decisão</button></form>)}
          </div>))}
        {!samples?.length && <p className="muted small">Nenhuma amostra.</p>}
        {can(['admin', 'producao']) && ['desenvolvimento', 'amostra', 'aprovacao_amostra'].includes(p.stage) && (
          <form action={sampleCreate} className="inline" style={{ marginTop: 10 }}>{hid}<input name="notes" placeholder="Observação da amostra" /><button className="btn sm" type="submit">Criar amostra</button></form>)}
      </div>

      <div className="card scroll" style={{ marginTop: 16 }}><h2>Arquivos (links)</h2>
        <table className="table"><tbody>
          {(files ?? []).map((f) => (
            <tr key={f.id} style={{ opacity: f.active ? 1 : 0.5 }}><td><a href={f.url} target="_blank" rel="noopener noreferrer"><b>{f.title}</b></a><div className="muted small">{f.kind}{f.version_no ? ` · v${f.version_no}` : ''}{f.notes ? ` · ${f.notes}` : ''}</div></td>
              <td><span className={`badge ${f.visible_to_customer ? 'on' : ''}`}>{f.visible_to_customer ? 'Cliente vê' : 'Interno'}</span></td>
              <td>{can(['admin', 'comercial', 'producao']) && <form action={toggleFile} className="inline">{hid}<input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="what" value="visible" /><input type="hidden" name="value" value={f.visible_to_customer ? '0' : '1'} /><button className="btn line sm" type="submit">{f.visible_to_customer ? 'Ocultar do cliente' : 'Mostrar ao cliente'}</button></form>}</td></tr>))}
          {!files?.length && <tr><td className="muted">Nenhum arquivo.</td></tr>}</tbody></table>
        {can(['admin', 'comercial', 'producao']) && (
          <form action={addFile} className="stack" style={{ marginTop: 12 }}>{hid}
            <div className="grid2"><label>Título<input name="title" required /></label><label>Link (Drive, Dropbox…)<input name="url" type="url" required placeholder="https://" /></label></div>
            <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}><label>Tipo<select name="kind"><option value="desenho">Desenho</option><option value="3d">Modelo 3D</option><option value="especificacao">Especificação</option><option value="foto">Foto</option><option value="amostra">Amostra</option><option value="outro">Outro</option></select></label>
              <label>Versão (nº)<input name="version_no" inputMode="numeric" /></label><label>Observação<input name="notes" /></label></div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" name="visible" style={{ width: 'auto' }} /> Mostrar ao cliente no portal</label>
            <div><button className="btn sm" type="submit">Adicionar arquivo</button></div></form>)}
        <p className="muted small">Por enquanto os arquivos são links. O envio direto de arquivos fica para quando o armazenamento privado estiver ligado.</p>
      </div>

      <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
        {can(['admin', 'gestor', 'comercial']) && (
          <form action={saveCosts} className="card stack"><h2>Custo interno estimado</h2>{hid}
            <p className="muted small">Nunca aparece para o cliente nem para a produção.</p>
            <label>Custo estimado de desenvolvimento + molde (R$)<input name="cost" inputMode="decimal" defaultValue={costs?.internal_cost_estimate != null ? String(costs.internal_cost_estimate).replace('.', ',') : ''} /></label>
            <label>Observações<input name="notes" defaultValue={costs?.notes ?? ''} /></label><div><button className="btn line sm" type="submit">Salvar custo</button></div>
            {p.development_price != null && costs?.internal_cost_estimate != null && <p className="small">Cobrado: {brl(Number(p.development_price ?? 0) + Number(p.mold_price ?? 0) + Number(p.sample_price ?? 0))} · custo estimado: {brl(costs.internal_cost_estimate)}</p>}</form>)}
        <div className="card stack"><h2>Produto no catálogo</h2>
          {item ? <p className="small">Criado: <b>{item.sku}</b> — {item.name}. Use este produto nos itens do orçamento do cliente.</p>
            : <><p className="muted small">Para orçar e produzir, o projeto precisa de um produto exclusivo no catálogo (invisível para outros clientes e para a loja).</p>
              {can(['admin', 'gestor', 'comercial']) && !closed && <form action={createItem}>{hid}<button className="btn sm" type="submit">Criar produto exclusivo</button></form>}</>}
          {can(['admin', 'gestor', 'comercial']) && !closed && (
            <form action={cancelProject} className="inline" style={{ marginTop: 10 }}>{hid}<input name="reason" placeholder="Motivo do cancelamento" required /><button className="btn danger sm" type="submit">Cancelar projeto</button></form>)}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}><h2>Histórico</h2>
        {(events ?? []).map((e, i) => <p key={i} className="small" style={{ margin: '8px 0' }}><b>{dataBR(e.at)}</b> · {e.kind}{e.detail?.de ? ` ${PROJECT_STAGE_LABEL[e.detail.de]} → ${PROJECT_STAGE_LABEL[e.detail.para]}` : ''}{e.note ? ` — ${e.note}` : ''}</p>)}</div>
    </>
  );
}

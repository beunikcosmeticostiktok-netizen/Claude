import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { convertLead, moveOpportunity } from './actions';

export const dynamic = 'force-dynamic';
const INTEREST: Record<string, string> = { produto_existente: 'Produto de linha', projeto_exclusivo: 'Projeto exclusivo' };

export default async function Crm({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await requireRole(['admin', 'gestor', 'comercial']);
  const canWrite = roles.includes('admin') || roles.includes('comercial');
  const [{ data: leads }, { data: opps }, { data: stages }, { data: reasons }] = await Promise.all([
    supabase.from('leads').select('id, created_at, source, interest_type, name, company, phone, email, message').eq('status', 'novo').order('created_at', { ascending: false }).limit(50),
    supabase.from('opportunities').select('id, title, customer_id, stage_id, owner_id, next_contact_at, loss_reason_id, interest_type, closed_at').order('created_at', { ascending: false }).limit(200),
    supabase.from('pipeline_stages').select('id, name, position, kind').eq('active', true).order('position'),
    supabase.from('loss_reasons').select('id, name').eq('active', true).order('name'),
  ]);
  const cids = [...new Set((opps ?? []).map((o) => o.customer_id))];
  const { data: custs } = cids.length ? await supabase.from('customers').select('id, legal_name').in('id', cids) : { data: [] };
  const cname = (id: string) => custs?.find((c) => c.id === id)?.legal_name ?? '—';
  const stage = (id: string) => stages?.find((s) => s.id === id);

  return (
    <>
      <div className="top"><h1>CRM</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{sp.ok === 'convertido' ? 'Lead convertido em oportunidade.' : 'Oportunidade atualizada.'}</div>}

      <div className="card">
        <h2>Leads novos ({leads?.length ?? 0})</h2>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>Contatos recebidos pelo site. Normalmente já viram oportunidade sozinhos; os que ficaram aqui precisam de conversão manual.</p>
        <div className="scroll"><table className="table"><thead><tr><th>Quando</th><th>Contato</th><th>Interesse</th><th>Mensagem</th><th></th></tr></thead><tbody>
          {(leads ?? []).map((l) => (
            <tr key={l.id}>
              <td>{dataBR(l.created_at)}</td>
              <td><b>{l.name}</b>{l.company && <div className="small">{l.company}</div>}<div className="muted small">{[l.phone, l.email].filter(Boolean).join(' · ')}</div></td>
              <td><span className="badge acc">{INTEREST[l.interest_type]}</span></td>
              <td className="small">{l.message ?? '—'}</td>
              <td>{canWrite && <form action={convertLead}><input type="hidden" name="lead_id" value={l.id} /><button className="btn sm" type="submit">Converter</button></form>}</td>
            </tr>
          ))}
          {!leads?.length && <tr><td colSpan={5} className="muted">Nenhum lead aguardando.</td></tr>}
        </tbody></table></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Oportunidades</h2>
        <div className="scroll"><table className="table"><thead><tr><th>Oportunidade</th><th>Etapa / ação</th></tr></thead><tbody>
          {(opps ?? []).map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/clientes/${o.customer_id}`}><b>{cname(o.customer_id)}</b></Link>
                <div className="small">{o.title}</div>
                <div className="muted small">{o.next_contact_at ? `Próximo contato: ${dataBR(o.next_contact_at)}` : 'Sem próximo contato'}</div>
              </td>
              <td>
                {canWrite ? (
                  <form action={moveOpportunity} className="inline">
                    <input type="hidden" name="id" value={o.id} />
                    <select name="stage_id" defaultValue={o.stage_id}>{(stages ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                    <select name="loss_reason_id" defaultValue={o.loss_reason_id ?? ''}>
                      <option value="">Motivo (se perdido)</option>{(reasons ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input name="next_contact" type="date" defaultValue={o.next_contact_at?.slice(0, 10) ?? ''} />
                    <button className="btn line sm" type="submit">Salvar</button>
                  </form>
                ) : <span className="badge">{stage(o.stage_id)?.name}</span>}
              </td>
            </tr>
          ))}
          {!opps?.length && <tr><td colSpan={2} className="muted">Nenhuma oportunidade.</td></tr>}
        </tbody></table></div>
      </div>
    </>
  );
}

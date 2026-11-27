import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { QUOTE_STATUS, quoteBadge } from '@/lib/labels';

export default async function PortalOrcamentos() {
  const { supabase } = await getSession();
  const { data } = await supabase.from('portal_quote_versions').select('id, number, version, status, total, valid_until, sent_at').order('sent_at', { ascending: false });
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>Orçamentos</h1>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Número</th><th>Situação</th><th>Enviado em</th><th>Validade</th><th className="right">Total</th></tr></thead>
        <tbody>
          {(data ?? []).map((q) => (
            <tr key={q.id}>
              <td><Link href={`/portal/orcamentos/${q.id}`}><b>{q.number}</b> v{q.version}</Link></td>
              <td><span className={`badge ${quoteBadge(q.status)}`}>{QUOTE_STATUS[q.status]}</span></td>
              <td>{q.sent_at ? dataBR(q.sent_at) : '—'}</td><td>{q.valid_until ? dataBR(q.valid_until + 'T12:00:00') : '—'}</td><td className="right">{brl(q.total)}</td>
            </tr>
          ))}
          {!data?.length && <tr><td colSpan={5} className="muted">Nenhum orçamento.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

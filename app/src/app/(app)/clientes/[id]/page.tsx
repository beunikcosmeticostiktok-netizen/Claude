import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR, formatTaxId } from '@/lib/format';
import { QUOTE_STATUS, quoteBadge } from '@/lib/labels';
import { addAddress, addContact, createPortalLogin, setPortalActive } from './actions';

export const dynamic = 'force-dynamic';
const ERR: Record<string, string> = {
  nome: 'Informe o nome do contato.', falha: 'Não foi possível concluir.', email_existente: 'Já existe um usuário com este e-mail.',
  login_dados: 'Informe nome, e-mail e senha temporária (mínimo de 10 caracteres).',
};
const OK: Record<string, string> = { contato: 'Contato adicionado.', endereco: 'Endereço adicionado.', login: 'Login do portal criado. O contato trocará a senha no primeiro acesso.', acesso: 'Acesso atualizado.' };
const ACCESS: Record<string, string> = { leitura: 'Somente leitura', aprovador: 'Aprovador', financeiro: 'Financeiro' };

export default async function ClienteDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: c } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
  if (!c) notFound();
  const [{ data: contacts }, { data: addresses }, { data: links }, { data: quotes }, { data: orders }] = await Promise.all([
    supabase.from('contacts').select('*').eq('customer_id', id).order('name'),
    supabase.from('addresses').select('*').eq('customer_id', id).order('kind'),
    supabase.from('customer_users').select('user_id, contact_id, access, active').eq('customer_id', id),
    supabase.from('quotes').select('id, number, created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10),
    supabase.from('orders').select('id, number, total, status_commercial, created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(10),
  ]);
  const userIds = (links ?? []).map((l) => l.user_id);
  const { data: profs } = userIds.length ? await supabase.from('profiles').select('id, full_name, email').in('id', userIds) : { data: [] };
  const pname = (uid: string) => profs?.find((p) => p.id === uid);
  const qIds = (quotes ?? []).map((q) => q.id);
  const { data: vers } = qIds.length ? await supabase.from('quote_versions').select('quote_id, version, status, total').in('quote_id', qIds) : { data: [] };
  const lastV = (qid: string) => (vers ?? []).filter((v) => v.quote_id === qid).sort((a, b) => b.version - a.version)[0];
  const canWrite = roles.includes('admin') || roles.includes('comercial');

  return (
    <>
      <div className="top">
        <div><h1>{c.legal_name}</h1><span className="muted">{c.trade_name}</span></div>
        <div className="inline">
          {canWrite && <Link className="btn" href={`/orcamentos/novo?customer=${c.id}`}>Novo orçamento</Link>}
          <Link className="btn line" href="/clientes">Voltar</Link>
        </div>
      </div>
      {sp.erro && <div className="alert err">{ERR[sp.erro] ?? ERR.falha}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}

      <div className="card">
        <div className="kv">
          <div><small>CNPJ/CPF</small><b>{formatTaxId(c.tax_id) || '—'}</b></div>
          <div><small>Segmento</small><b>{c.segment ?? '—'}</b></div>
          <div><small>Origem</small><b>{c.origin ?? '—'}</b></div>
          <div><small>Situação</small><span className={`badge ${c.active ? 'on' : 'off'}`}>{c.active ? 'Ativo' : 'Inativo'}</span></div>
          <div><small>Cliente desde</small><b>{dataBR(c.created_at)}</b></div>
        </div>
        {c.internal_notes && <p className="small" style={{ marginTop: 14 }}><b>Observações internas:</b> {c.internal_notes}</p>}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Contatos</h2>
        <div className="scroll"><table className="table"><thead><tr><th>Nome</th><th>Cargo</th><th>Telefone</th><th>E-mail</th></tr></thead><tbody>
          {(contacts ?? []).map((k) => <tr key={k.id}><td><b>{k.name}</b></td><td>{k.role_title ?? '—'}</td><td>{k.phone ?? '—'}</td><td>{k.email ?? '—'}</td></tr>)}
          {!contacts?.length && <tr><td colSpan={4} className="muted">Nenhum contato.</td></tr>}
        </tbody></table></div>
        {canWrite && (
          <form action={addContact} className="stack" style={{ marginTop: 14 }}>
            <input type="hidden" name="customer_id" value={c.id} />
            <div className="grid2"><label>Nome<input name="name" required /></label><label>Cargo<input name="role_title" /></label></div>
            <div className="grid2"><label>WhatsApp / telefone<input name="phone" inputMode="tel" /></label><label>E-mail<input name="email" type="email" /></label></div>
            <div><button className="btn sm" type="submit">Adicionar contato</button></div>
          </form>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Endereços</h2>
        {(addresses ?? []).map((a) => (
          <p key={a.id} className="small" style={{ margin: '8px 0' }}>
            <span className="badge">{a.kind === 'entrega' ? 'Entrega' : 'Faturamento'}</span>
            {[a.street, a.number, a.complement, a.district, a.city && `${a.city}/${a.state ?? ''}`, a.cep].filter(Boolean).join(', ')}
          </p>
        ))}
        {!addresses?.length && <p className="muted small">Nenhum endereço.</p>}
        {canWrite && (
          <form action={addAddress} className="stack" style={{ marginTop: 14 }}>
            <input type="hidden" name="customer_id" value={c.id} />
            <div className="grid2">
              <label>Tipo<select name="kind"><option value="faturamento">Faturamento</option><option value="entrega">Entrega</option></select></label>
              <label>CEP<input name="cep" inputMode="numeric" /></label>
            </div>
            <div className="grid2"><label>Rua<input name="street" /></label><label>Número<input name="number" /></label></div>
            <div className="grid2"><label>Complemento<input name="complement" /></label><label>Bairro<input name="district" /></label></div>
            <div className="grid2"><label>Cidade<input name="city" /></label><label>UF<input name="state" maxLength={2} /></label></div>
            <div><button className="btn sm" type="submit">Adicionar endereço</button></div>
          </form>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Acesso ao portal do cliente</h2>
        <p className="muted small" style={{ margin: '6px 0 12px' }}>Cada contato pode ter o seu login. O nível “Aprovador” pode aprovar orçamentos e indicar a transportadora.</p>
        <div className="scroll"><table className="table"><thead><tr><th>Contato</th><th>Nível</th><th>Situação</th><th></th></tr></thead><tbody>
          {(links ?? []).map((l) => (
            <tr key={l.user_id}>
              <td><b>{pname(l.user_id)?.full_name || '—'}</b><div className="muted small">{pname(l.user_id)?.email}</div></td>
              <td>{ACCESS[l.access]}</td>
              <td><span className={`badge ${l.active ? 'on' : 'off'}`}>{l.active ? 'Ativo' : 'Desativado'}</span></td>
              <td>{canWrite && (
                <form action={setPortalActive}>
                  <input type="hidden" name="customer_id" value={c.id} /><input type="hidden" name="user_id" value={l.user_id} />
                  <input type="hidden" name="active" value={l.active ? '0' : '1'} />
                  <button className="btn line sm" type="submit">{l.active ? 'Desativar' : 'Reativar'}</button>
                </form>)}
              </td>
            </tr>
          ))}
          {!links?.length && <tr><td colSpan={4} className="muted">Nenhum login criado.</td></tr>}
        </tbody></table></div>
        {canWrite && (
          <form action={createPortalLogin} className="stack" style={{ marginTop: 14 }}>
            <input type="hidden" name="customer_id" value={c.id} />
            <div className="grid2"><label>Nome<input name="name" required /></label><label>E-mail de acesso<input name="email" type="email" required /></label></div>
            <div className="grid2">
              <label>Nível de acesso<select name="access" defaultValue="aprovador">{Object.entries(ACCESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Contato<select name="contact_id" defaultValue=""><option value="">—</option>{(contacts ?? []).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
            </div>
            <label>Senha temporária (mín. 10 caracteres)<input name="password" minLength={10} required autoComplete="off" /></label>
            <div><button className="btn sm" type="submit">Criar login do portal</button></div>
          </form>
        )}
      </div>

      <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="card"><h2>Orçamentos</h2>
          {(quotes ?? []).map((q) => { const v = lastV(q.id); return (
            <p key={q.id} className="small" style={{ margin: '8px 0' }}>
              <Link href={`/orcamentos/${q.id}`}><b>{q.number}</b></Link> {v && <span className={`badge ${quoteBadge(v.status)}`}>{QUOTE_STATUS[v.status]}</span>} {v && brl(v.total)}
            </p>); })}
          {!quotes?.length && <p className="muted small">Nenhum orçamento.</p>}
        </div>
        <div className="card"><h2>Pedidos</h2>
          {(orders ?? []).map((o) => (
            <p key={o.id} className="small" style={{ margin: '8px 0' }}><Link href={`/pedidos/${o.id}`}><b>{o.number}</b></Link> {brl(o.total)} · {dataBR(o.created_at)}</p>))}
          {!orders?.length && <p className="muted small">Nenhum pedido.</p>}
        </div>
      </div>
    </>
  );
}

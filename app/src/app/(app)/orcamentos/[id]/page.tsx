import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { precisaAprovacao } from '@/lib/cost';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText, QUOTE_STATUS, quoteBadge } from '@/lib/labels';
import { addCatalogItem, addFreeItem, quoteAction, removeItem, updateContact, updateItem, updateVersion } from '../actions';

export const dynamic = 'force-dynamic';
const LOCAL_ERR: Record<string, string> = {
  qtd: 'Informe uma quantidade inteira maior que zero.', numero: 'Confira os números informados.',
  minimo: 'Quantidade abaixo do mínimo de venda deste produto.', multiplo: 'A quantidade precisa ser múltipla da unidade de venda do produto.',
  sem_preco: 'Este produto ainda não tem preço cadastrado para esta quantidade.',
};
const OK: Record<string, string> = {
  salvo: 'Alterações salvas.', item: 'Itens atualizados.', nova_versao: 'Nova versão criada em rascunho.', request_approval: 'Enviado para aprovação do gestor.',
  approve: 'Aprovado internamente. Já pode enviar ao cliente.', reject: 'Devolvido ao vendedor.', send: 'Orçamento enviado ao cliente (visível no portal).',
  refuse: 'Marcado como recusado.',
};

export default async function OrcamentoDetalhe({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ v?: string; erro?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: quote } = await supabase.from('quotes').select('*').eq('id', id).maybeSingle();
  if (!quote) notFound();
  const { data: versions } = await supabase.from('quote_versions').select('*').eq('quote_id', id).order('version', { ascending: false });
  const ver = (versions ?? []).find((v) => v.id === sp.v) ?? (versions ?? [])[0];
  if (!ver) notFound();

  const draft = ver.status === 'rascunho';
  const [{ data: items }, { data: customer }, { data: contacts }, { data: seller }, { data: setting }, { data: changes }, { data: order }] = await Promise.all([
    supabase.from('quote_items').select('*').eq('version_id', ver.id).order('position'),
    supabase.from('customers').select('id, legal_name').eq('id', quote.customer_id).single(),
    supabase.from('contacts').select('id, name').eq('customer_id', quote.customer_id).eq('active', true),
    supabase.from('profiles').select('full_name').eq('id', quote.seller_id).single(),
    supabase.from('settings').select('value').eq('key', 'markup_minimo').single(),
    supabase.from('quote_change_requests').select('message, created_at').eq('version_id', ver.id).order('created_at'),
    supabase.from('orders').select('id, number').eq('quote_version_id', ver.id).maybeSingle(),
  ]);
  const catalog = draft ? (await supabase.from('items').select('id, sku, name').eq('active', true).order('name').limit(1000)).data : [];
  const markupMin = Number(setting?.value ?? 1.5);
  const needsApproval = (items ?? []).some((i) => precisaAprovacao(Number(i.unit_price), i.unit_cost == null ? null : Number(i.unit_cost), markupMin));
  const canEdit = roles.includes('admin') || roles.includes('comercial');
  const isManager = roles.includes('admin') || roles.includes('gestor');
  const canAct = canEdit || roles.includes('gestor');
  const hidden = (n: string, v: string) => <input type="hidden" name={n} value={v} />;
  const base = <>{hidden('quote_id', quote.id)}{hidden('version_id', ver.id)}</>;
  const erro = sp.erro ? (LOCAL_ERR[sp.erro] ?? dbErrorText(sp.erro)) : '';

  return (
    <>
      <div className="top">
        <div>
          <h1>{quote.number} <span className="muted" style={{ fontSize: '1rem' }}>v{ver.version}</span> <span className={`badge ${quoteBadge(ver.status)}`}>{QUOTE_STATUS[ver.status]}</span></h1>
          <span className="muted">
            <Link href={`/clientes/${quote.customer_id}`}><b>{customer?.legal_name}</b></Link> · Vendedor: {seller?.full_name}
          </span>
        </div>
        <div className="inline">
          {ver.status !== 'rascunho' && ver.status !== 'aguardando_aprovacao' && <Link className="btn line" href={`/orcamentos/${quote.id}/imprimir?v=${ver.id}`}>Imprimir / PDF</Link>}
          <Link className="btn line" href="/orcamentos">Voltar</Link>
        </div>
      </div>
      {erro && <div className="alert err">{erro}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}

      <div className="tabs">
        {(versions ?? []).map((v) => <Link key={v.id} href={`/orcamentos/${quote.id}?v=${v.id}`} className={v.id === ver.id ? 'on' : undefined}>v{v.version} · {QUOTE_STATUS[v.status]}</Link>)}
      </div>

      {order && <div className="alert ok">Pedido gerado: <Link href={`/pedidos/${order.id}`}><b>{order.number}</b></Link></div>}
      {draft && needsApproval && <div className="alert warn">Há item abaixo do markup mínimo ({markupMin}) ou sem custo informado. Este orçamento precisa da aprovação do gestor antes do envio.</div>}
      {ver.status === 'aguardando_aprovacao' && <div className="alert warn">Aguardando aprovação interna do gestor.</div>}
      {ver.internal_approved && draft && <div className="alert ok">Aprovado internamente{ver.internal_approval_note ? `: ${ver.internal_approval_note}` : ''}.</div>}
      {!draft && ver.internal_approval_note && <p className="muted small">Justificativa interna: {ver.internal_approval_note}</p>}
      {(changes ?? []).map((c, i) => <div key={i} className="alert warn"><b>Pedido de alteração do cliente ({dataBR(c.created_at)}):</b> {c.message}</div>)}

      <div className="card scroll">
        <h2>Itens</h2>
        <table className="table">
          <thead><tr><th>Descrição</th><th>Qtd</th><th>Preço lista</th><th>Preço unit.</th><th>Custo unit.</th><th>Markup</th><th className="right">Total</th><th></th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => {
              const low = precisaAprovacao(Number(i.unit_price), i.unit_cost == null ? null : Number(i.unit_cost), markupMin);
              return draft && canEdit ? (
                <tr key={i.id} className={low ? 'warnrow' : undefined}>
                  <td>{i.description}</td>
                  <td colSpan={3}>
                    <form action={updateItem} className="inline" id={`f${i.id}`}>
                      {base}{hidden('id', i.id)}
                      <input name="qty" defaultValue={i.qty} inputMode="numeric" style={{ width: 80 }} />
                      <span className="muted small">lista {i.list_price != null ? brl(i.list_price) : '—'}</span>
                      <input name="unit_price" defaultValue={String(i.unit_price).replace('.', ',')} inputMode="decimal" style={{ width: 90 }} />
                      <input name="unit_cost" defaultValue={i.unit_cost != null ? String(i.unit_cost).replace('.', ',') : ''} placeholder="custo" inputMode="decimal" style={{ width: 90 }} />
                      <button className="btn line sm" type="submit">Salvar</button>
                    </form>
                  </td>
                  <td colSpan={1}></td>
                  <td>{i.markup ?? '—'}</td><td className="right">{brl(i.line_total)}</td>
                  <td><form action={removeItem}>{base}{hidden('id', i.id)}<button className="btn danger sm" type="submit">Remover</button></form></td>
                </tr>
              ) : (
                <tr key={i.id} className={low ? 'warnrow' : undefined}>
                  <td>{i.description}</td><td>{i.qty}</td><td>{i.list_price != null ? brl(i.list_price) : '—'}</td><td>{brl(i.unit_price)}</td>
                  <td>{i.unit_cost != null ? brl(i.unit_cost) : '—'}</td><td>{i.markup ?? '—'}</td><td className="right">{brl(i.line_total)}</td><td></td>
                </tr>
              );
            })}
            {!items?.length && <tr><td colSpan={8} className="muted">Nenhum item.</td></tr>}
            <tr><td colSpan={6} className="right muted">Subtotal</td><td className="right">{brl(ver.subtotal)}</td><td></td></tr>
            {Number(ver.discount_total) > 0 && <tr><td colSpan={6} className="right muted">Descontos já aplicados</td><td className="right">{brl(ver.discount_total)}</td><td></td></tr>}
            <tr><td colSpan={6} className="right muted">Frete</td><td className="right">{brl(ver.freight_value)}</td><td></td></tr>
            <tr><td colSpan={6} className="right"><b>Total</b></td><td className="right"><b>{brl(ver.total)}</b></td><td></td></tr>
          </tbody>
        </table>
        <p className="muted small">Linhas em amarelo estão abaixo do markup mínimo ou sem custo. O custo é interno e nunca aparece para o cliente.</p>

        {draft && canEdit && (
          <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
            <form action={addCatalogItem} className="stack card">
              <h2>Adicionar produto do catálogo</h2>{base}
              <label>Produto<select name="item_id" required defaultValue=""><option value="" disabled>Selecione…</option>
                {(catalog ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.sku})</option>)}</select></label>
              <div className="grid2"><label>Quantidade<input name="qty" required inputMode="numeric" /></label><label>Custo completo unit. (R$)<input name="unit_cost" inputMode="decimal" placeholder="opcional" /></label></div>
              <p className="muted small">O preço vem da faixa de quantidade do produto. Use a <Link href="/custos"><b>calculadora de custo</b></Link> para obter o custo.</p>
              <div><button className="btn sm" type="submit">Adicionar</button></div>
            </form>
            <form action={addFreeItem} className="stack card">
              <h2>Adicionar item avulso / projeto exclusivo</h2>{base}
              <label>Descrição<input name="description" required /></label>
              <div className="grid2"><label>Quantidade<input name="qty" required inputMode="numeric" /></label><label>Preço unit. (R$)<input name="unit_price" required inputMode="decimal" /></label></div>
              <label>Custo completo unit. (R$)<input name="unit_cost" inputMode="decimal" placeholder="opcional" /></label>
              <div><button className="btn sm" type="submit">Adicionar</button></div>
            </form>
          </div>
        )}
      </div>

      {draft && canEdit && (
        <form action={updateVersion} className="card stack" style={{ marginTop: 16 }}>
          <h2>Condições</h2>{base}
          <div className="grid2">
            <label>Validade até<input name="valid_until" type="date" defaultValue={ver.valid_until ?? ''} /></label>
            <label>Prazo estimado (dias)<input name="lead_time_days" inputMode="numeric" defaultValue={ver.lead_time_days ?? ''} /></label>
          </div>
          <div className="grid2">
            <label>Frete<select name="freight_mode" defaultValue={ver.freight_mode}><option value="fob">FOB (cliente indica o transporte)</option><option value="retirada">Retirada na fábrica</option></select></label>
            <label>Valor do frete (R$)<input name="freight_value" inputMode="decimal" defaultValue={String(ver.freight_value).replace('.', ',')} /></label>
          </div>
          <div className="grid2">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}><input type="checkbox" name="deposit_required" defaultChecked={ver.deposit_required} style={{ width: 'auto' }} /> Exigir sinal para iniciar a produção</label>
            <label>Percentual do sinal (%)<input name="deposit_pct" inputMode="decimal" defaultValue={ver.deposit_pct} /></label>
          </div>
          <label>Condições de pagamento<textarea name="payment_terms" rows={2} defaultValue={ver.payment_terms ?? ''} /></label>
          <label>Observações para o cliente (aparecem no orçamento)<textarea name="notes_client" rows={2} defaultValue={ver.notes_client ?? ''} /></label>
          <label>Observações internas (nunca aparecem para o cliente)<textarea name="notes_internal" rows={2} defaultValue={ver.notes_internal ?? ''} /></label>
          <div><button className="btn" type="submit">Salvar condições</button></div>
        </form>
      )}
      {!draft && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Condições</h2>
          <div className="kv" style={{ marginTop: 10 }}>
            <div><small>Validade</small><b>{ver.valid_until ? dataBR(ver.valid_until + 'T12:00:00') : '—'}</b></div>
            <div><small>Prazo estimado</small><b>{ver.lead_time_days != null ? `${ver.lead_time_days} dias` : '—'}</b></div>
            <div><small>Frete</small><b>{ver.freight_mode === 'fob' ? 'FOB' : 'Retirada'}</b></div>
            <div><small>Sinal</small><b>{ver.deposit_required ? `${ver.deposit_pct}%` : 'Não exigido'}</b></div>
            <div><small>Pagamento</small><b>{ver.payment_terms ?? '—'}</b></div>
            {ver.approved_at && <div><small>Aprovado em</small><b>{dataBR(ver.approved_at)} ({ver.approved_via === 'portal' ? 'portal' : 'registrado internamente'})</b></div>}
          </div>
          {ver.notes_internal && <p className="small" style={{ marginTop: 12 }}><b>Observações internas:</b> {ver.notes_internal}</p>}
        </div>
      )}

      {canEdit && (
        <form action={updateContact} className="card inline" style={{ marginTop: 16 }}>
          {base}<b className="small">Contato do orçamento</b>
          <select name="contact_id" defaultValue={quote.contact_id ?? ''}><option value="">—</option>{(contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn line sm" type="submit">Salvar</button>
        </form>
      )}

      {canAct && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Ações</h2>
          <div className="inline" style={{ marginTop: 12, alignItems: 'flex-start' }}>
            {draft && canEdit && needsApproval && (
              <form action={quoteAction}>{base}{hidden('action', 'request_approval')}<button className="btn line" type="submit">Solicitar aprovação interna</button></form>)}
            {draft && (!needsApproval || ver.internal_approved) && (
              <form action={quoteAction}>{base}{hidden('action', 'send')}<button className="btn" type="submit">Enviar ao cliente</button></form>)}
            {ver.status === 'aguardando_aprovacao' && isManager && (
              <>
                <form action={quoteAction} className="inline">{base}{hidden('action', 'approve')}<input name="note" placeholder="Justificativa (opcional)" /><button className="btn" type="submit">Aprovar</button></form>
                <form action={quoteAction} className="inline">{base}{hidden('action', 'reject')}<input name="note" placeholder="Motivo da devolução" required /><button className="btn danger" type="submit">Devolver</button></form>
              </>
            )}
            {(ver.status === 'enviado' || ver.status === 'em_negociacao') && (
              <>
                <form action={quoteAction} className="inline">{base}{hidden('action', 'approve_offline')}<input name="note" placeholder="Como o cliente aprovou? (ex.: WhatsApp 27/11)" required style={{ minWidth: 260 }} /><button className="btn line" type="submit">Registrar aprovação do cliente</button></form>
                <form action={quoteAction}>{base}{hidden('action', 'refuse')}<button className="btn danger" type="submit">Marcar como recusado</button></form>
              </>
            )}
            {ver.status === 'aprovado' && !order && (
              <form action={quoteAction}>{base}{hidden('action', 'convert')}<button className="btn" type="submit">Gerar pedido</button></form>)}
            {canEdit && ['enviado', 'em_negociacao', 'aprovado', 'recusado', 'expirado'].includes(ver.status) && ver.id === versions?.[0]?.id && (
              <form action={quoteAction}>{base}{hidden('action', 'new_version')}<button className="btn line" type="submit">Criar nova versão</button></form>)}
          </div>
        </div>
      )}
    </>
  );
}

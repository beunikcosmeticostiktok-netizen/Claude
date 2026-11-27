import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { brl, dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { addLine, poAction, removeLine, saveHeader } from '../actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { rascunho: 'Rascunho', aprovado: 'Aprovado', enviado: 'Enviado ao fornecedor', recebido_parcial: 'Recebido parcialmente', recebido: 'Recebido', cancelado: 'Cancelado' };
const OK: Record<string, string> = { linha: 'Linhas atualizadas.', salvo: 'Salvo.', approve: 'Pedido aprovado.', send: 'Marcado como enviado ao fornecedor.', cancel: 'Pedido cancelado.' };

export default async function CompraDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: po } = await supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle();
  if (!po) notFound();
  const [{ data: lines }, { data: sup }, { data: items }, { data: receipts }] = await Promise.all([
    supabase.from('purchase_lines').select('*').eq('po_id', id).order('position'),
    supabase.from('suppliers').select('legal_name').eq('id', po.supplier_id).single(),
    po.status === 'rascunho' ? supabase.from('items').select('id, sku, name').eq('active', true).order('name').limit(1000) : Promise.resolve({ data: [] }),
    supabase.from('receipts').select('id, received_at, document_number').eq('po_id', id).order('received_at'),
  ]);
  const { data: allItems } = await supabase.from('items').select('id, sku, name').in('id', (lines ?? []).map((l) => l.item_id));
  const nm = (i: string) => { const x = allItems?.find((a) => a.id === i); return x ? `${x.name} (${x.sku})` : ''; };
  const total = (lines ?? []).reduce((s, l) => s + Number(l.line_total), 0);
  const canEdit = (roles.includes('admin') || roles.includes('compras')) && po.status === 'rascunho';
  const hid = <input type="hidden" name="po_id" value={po.id} />;

  return (
    <>
      <div className="top"><div><h1>{po.number} <span className="badge">{ST[po.status]}</span></h1><span className="muted">{sup?.legal_name}</span></div><Link className="btn line" href="/compras">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}
      <div className="card scroll">
        <h2>Linhas</h2>
        <table className="table">
          <thead><tr><th>Produto</th><th className="right">Qtd</th><th className="right">Custo unit.</th><th className="right">Recebido</th><th className="right">Total</th><th></th></tr></thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id}><td>{nm(l.item_id)}</td><td className="right">{Number(l.qty).toLocaleString('pt-BR')}</td><td className="right">{brl(l.unit_cost)}</td>
                <td className="right">{Number(l.qty_received).toLocaleString('pt-BR')}</td><td className="right">{brl(l.line_total)}</td>
                <td>{canEdit && <form action={removeLine}>{hid}<input type="hidden" name="id" value={l.id} /><button className="btn danger sm" type="submit">Remover</button></form>}</td></tr>
            ))}
            {!lines?.length && <tr><td colSpan={6} className="muted">Nenhuma linha.</td></tr>}
            <tr><td colSpan={4} className="right"><b>Total</b></td><td className="right"><b>{brl(total)}</b></td><td></td></tr>
          </tbody>
        </table>
        {canEdit && (
          <form action={addLine} className="inline" style={{ marginTop: 14 }}>
            {hid}
            <select name="item_id" required defaultValue=""><option value="" disabled>Produto / matéria-prima…</option>{(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}</select>
            <input name="qty" placeholder="Qtd" inputMode="decimal" required style={{ width: 90 }} />
            <input name="unit_cost" placeholder="Custo unit. R$" inputMode="decimal" required style={{ width: 120 }} />
            <button className="btn sm" type="submit">Adicionar linha</button>
          </form>
        )}
      </div>

      {canEdit && (
        <form action={saveHeader} className="card stack" style={{ marginTop: 16 }}>
          <h2>Condições</h2>{hid}
          <div className="grid2"><label>Previsão de entrega<input name="expected_date" type="date" defaultValue={po.expected_date ?? ''} /></label><label>Condição de pagamento<input name="payment_terms" defaultValue={po.payment_terms ?? ''} /></label></div>
          <label>Observações<textarea name="notes" rows={2} defaultValue={po.notes ?? ''} /></label>
          <div><button className="btn line sm" type="submit">Salvar</button></div>
        </form>
      )}

      {(receipts ?? []).length > 0 && (
        <div className="card" style={{ marginTop: 16 }}><h2>Recebimentos</h2>
          {(receipts ?? []).map((r) => <p key={r.id} className="small" style={{ margin: '8px 0' }}>{dataBR(r.received_at)} · NF do fornecedor: {r.document_number ?? '—'}</p>)}</div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Ações</h2>
        <div className="inline" style={{ marginTop: 12, alignItems: 'flex-start' }}>
          {po.status === 'rascunho' && roles.some((r) => ['admin', 'gestor'].includes(r)) && <form action={poAction}>{hid}<input type="hidden" name="action" value="approve" /><button className="btn" type="submit">Aprovar pedido</button></form>}
          {po.status === 'rascunho' && !roles.some((r) => ['admin', 'gestor'].includes(r)) && <span className="muted small">Aguardando aprovação do gestor.</span>}
          {po.status === 'aprovado' && roles.some((r) => ['admin', 'compras'].includes(r)) && <form action={poAction}>{hid}<input type="hidden" name="action" value="send" /><button className="btn" type="submit">Marcar como enviado ao fornecedor</button></form>}
          {['aprovado', 'enviado', 'recebido_parcial'].includes(po.status) && <Link className="btn line" href="/recebimentos">Ir para recebimentos</Link>}
          {['rascunho', 'aprovado', 'enviado'].includes(po.status) && roles.some((r) => ['admin', 'gestor', 'compras'].includes(r)) && (
            <form action={poAction} className="inline">{hid}<input type="hidden" name="action" value="cancel" /><input name="reason" placeholder="Motivo do cancelamento" required /><button className="btn danger" type="submit">Cancelar pedido</button></form>)}
        </div>
      </div>
    </>
  );
}

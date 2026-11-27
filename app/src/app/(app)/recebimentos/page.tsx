import { randomUUID } from 'node:crypto';
import { requireRole } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { receive } from './actions';

export const dynamic = 'force-dynamic';

export default async function Recebimentos({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'gestor', 'compras', 'estoque']);
  const [{ data: lines }, { data: locs }] = await Promise.all([
    supabase.from('receiving_lines').select('*').order('number').order('position'),
    supabase.from('stock_locations').select('id, code, name').eq('active', true).order('code'),
  ]);
  const ids = [...new Set((lines ?? []).map((l) => l.item_id))];
  const { data: items } = ids.length ? await supabase.from('items').select('id, sku, name, uom').in('id', ids) : { data: [] };
  const pos = [...new Map((lines ?? []).map((l) => [l.po_id, l])).values()];
  const mayReceive = true;

  return (
    <>
      <div className="top"><h1>Recebimentos</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">Recebimento registrado e entrada feita no estoque.</div>}
      <p className="muted" style={{ marginBottom: 14, maxWidth: 720 }}>Confira a mercadoria contra o pedido e informe o que realmente chegou. A entrada no estoque acontece aqui, uma única vez por conferência.</p>
      {pos.map((p) => {
        const mine = (lines ?? []).filter((l) => l.po_id === p.po_id);
        const key = randomUUID();
        return (
          <form key={p.po_id} action={receive} className="card stack" style={{ marginBottom: 16 }}>
            <h2>{p.number} <span className="muted small">· previsão {p.expected_date ? dataBR(p.expected_date + 'T12:00:00') : 'não informada'}</span></h2>
            <input type="hidden" name="po_id" value={p.po_id} /><input type="hidden" name="key" value={key} />
            <div className="scroll"><table className="table">
              <thead><tr><th>Produto</th><th className="right">Pedido</th><th className="right">Já recebido</th><th>Recebido agora</th><th>Lote</th><th>Observação (divergência)</th></tr></thead>
              <tbody>
                {mine.map((l) => { const it = items?.find((i) => i.id === l.item_id); return (
                  <tr key={l.line_id}>
                    <td><b>{it?.name}</b><div className="muted small">{it?.sku}</div></td>
                    <td className="right">{Number(l.qty).toLocaleString('pt-BR')} {it?.uom}</td><td className="right">{Number(l.qty_received).toLocaleString('pt-BR')}</td>
                    <td><input name={`qty_${l.line_id}`} inputMode="decimal" placeholder="0" style={{ width: 100 }} /></td>
                    <td><input name={`lot_${l.line_id}`} style={{ width: 110 }} /></td><td><input name={`note_${l.line_id}`} /></td>
                  </tr>); })}
              </tbody>
            </table></div>
            <div className="grid2">
              <label>Local de armazenagem<select name="location_id">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></label>
              <label>Nota fiscal do fornecedor<input name="doc" /></label>
            </div>
            {mayReceive && <div><button className="btn" type="submit">Confirmar recebimento</button></div>}
          </form>
        );
      })}
      {!pos.length && <div className="card muted">Nenhuma compra aguardando recebimento.</div>}
    </>
  );
}

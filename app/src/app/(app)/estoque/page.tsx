import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { moveStock, reverseMovement, transferStock } from './actions';

export const dynamic = 'force-dynamic';
const OK: Record<string, string> = { movido: 'Movimento registrado.', transferido: 'Transferência registrada.', estornado: 'Movimento estornado.' };
const KIND: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', transferencia: 'Transferência', recebimento: 'Recebimento', consumo: 'Consumo', producao: 'Produção', estorno: 'Estorno' };
const fmt = (n: number | string) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default async function Estoque({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string; item?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const canMove = roles.includes('admin') || roles.includes('estoque');
  const canReverse = canMove || roles.includes('gestor');
  const [{ data: pos }, { data: items }, { data: locs }, { data: bal }] = await Promise.all([
    supabase.from('stock_position').select('item_id, physical, reserved, available'),
    supabase.from('items').select('id, sku, name, uom, active').order('name').limit(1000),
    supabase.from('stock_locations').select('id, code, name').eq('active', true).order('code'),
    supabase.from('stock_balances').select('item_id, location_id, lot_id, physical'),
  ]);
  let mq = supabase.from('stock_movements').select('id, at, item_id, location_id, qty, kind, note, reversal_of, lot_id').order('id', { ascending: false }).limit(40);
  if (sp.item) mq = mq.eq('item_id', sp.item);
  const { data: movs } = await mq;
  const lotIds = [...new Set((bal ?? []).map((b) => b.lot_id).filter(Boolean))] as string[];
  const { data: lots } = lotIds.length ? await supabase.from('lots').select('id, code').in('id', lotIds) : { data: [] };
  const item = (id: string) => items?.find((i) => i.id === id);
  const loc = (id: string) => locs?.find((l) => l.id === id)?.code ?? '';
  const reversed = new Set((movs ?? []).filter((m) => m.reversal_of).map((m) => Number(m.reversal_of)));

  return (
    <>
      <div className="top"><h1>Estoque</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok]}</div>}

      <div className="card scroll">
        <h2>Posição por produto</h2>
        <table className="table">
          <thead><tr><th>Produto</th><th className="right">Físico</th><th className="right">Reservado (pedidos)</th><th className="right">Disponível</th><th>Locais / lotes</th></tr></thead>
          <tbody>
            {(pos ?? []).map((p) => (
              <tr key={p.item_id}>
                <td><a href={`/estoque?item=${p.item_id}`}><b>{item(p.item_id)?.name}</b></a><div className="muted small">{item(p.item_id)?.sku}</div></td>
                <td className="right">{fmt(p.physical)} {item(p.item_id)?.uom}</td><td className="right">{fmt(p.reserved)}</td>
                <td className="right"><b>{fmt(p.available)}</b></td>
                <td className="small">{(bal ?? []).filter((b) => b.item_id === p.item_id).map((b) => `${loc(b.location_id)}${b.lot_id ? ' · ' + (lots?.find((l) => l.id === b.lot_id)?.code ?? 'lote') : ''}: ${fmt(b.physical)}`).join(' | ')}</td>
              </tr>
            ))}
            {!pos?.length && <tr><td colSpan={5} className="muted">Nenhum movimento ainda.</td></tr>}
          </tbody>
        </table>
        <p className="muted small">O saldo é a soma dos movimentos: ele nunca é editado. Erros são corrigidos por estorno, que fica registrado.</p>
      </div>

      {canMove && (
        <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
          <form action={moveStock} className="card stack">
            <h2>Entrada, saída ou ajuste</h2>
            <div className="grid2">
              <label>Produto<select name="item_id" required defaultValue=""><option value="" disabled>Selecione…</option>{(items ?? []).filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}</select></label>
              <label>Local<select name="location_id" required>{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</select></label>
            </div>
            <div className="grid2">
              <label>Tipo<select name="kind"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Ajuste (+ ou −)</option></select></label>
              <label>Quantidade<input name="qty" required inputMode="decimal" /></label>
            </div>
            <div className="grid2"><label>Lote (opcional)<input name="lot" /></label><label>Justificativa (obrigatória no ajuste)<input name="note" /></label></div>
            <div><button className="btn sm" type="submit">Registrar</button></div>
          </form>
          <form action={transferStock} className="card stack">
            <h2>Transferir entre locais</h2>
            <label>Produto<select name="item_id" required defaultValue=""><option value="" disabled>Selecione…</option>{(items ?? []).filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}</select></label>
            <div className="grid2">
              <label>De<select name="from">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>
              <label>Para<select name="to">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>
            </div>
            <div className="grid2"><label>Quantidade<input name="qty" required inputMode="decimal" /></label><label>Lote (se houver)<input name="lot" /></label></div>
            <div><button className="btn line sm" type="submit">Transferir</button></div>
          </form>
        </div>
      )}

      <div className="card scroll" style={{ marginTop: 16 }}>
        <h2>Últimos movimentos{sp.item ? ` — ${item(sp.item)?.name}` : ''} {sp.item && <a className="btn line sm" href="/estoque">ver todos</a>}</h2>
        <table className="table">
          <thead><tr><th>Quando</th><th>Produto</th><th>Tipo</th><th className="right">Qtd</th><th>Local</th><th>Obs.</th><th></th></tr></thead>
          <tbody>
            {(movs ?? []).map((m) => (
              <tr key={m.id}>
                <td>{dataBR(m.at)}</td><td>{item(m.item_id)?.name}</td><td><span className="badge">{KIND[m.kind]}</span></td>
                <td className="right" style={{ color: Number(m.qty) < 0 ? 'var(--err)' : 'var(--ok)' }}>{Number(m.qty) > 0 ? '+' : ''}{fmt(m.qty)}</td>
                <td>{loc(m.location_id)}</td><td className="small">{m.note ?? ''}{m.reversal_of ? ` (estorno do #${m.reversal_of})` : ''}</td>
                <td>{canReverse && !m.reversal_of && !reversed.has(Number(m.id)) && m.kind !== 'transferencia' && (
                  <form action={reverseMovement} className="inline"><input type="hidden" name="id" value={m.id} /><input name="note" placeholder="Motivo do estorno" required style={{ width: 150 }} /><button className="btn danger sm" type="submit">Estornar</button></form>)}</td>
              </tr>
            ))}
            {!movs?.length && <tr><td colSpan={7} className="muted">Sem movimentos.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

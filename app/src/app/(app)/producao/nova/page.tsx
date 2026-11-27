import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { createPO } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NovaOP({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'producao']);
  const { data: orders } = await supabase.from('orders').select('id, number, customer_id, status_production').neq('status_commercial', 'cancelado').in('status_production', ['liberado', 'programado', 'em_producao', 'parcial', 'nao_liberado']).order('created_at', { ascending: false }).limit(100);
  const ids = (orders ?? []).map((o) => o.id);
  const [{ data: ois }, { data: ops }, { data: machines }, { data: molds }, { data: custs }] = await Promise.all([
    ids.length ? supabase.from('order_items').select('id, order_id, description, qty, item_id').in('order_id', ids).not('item_id', 'is', null) : { data: [] },
    supabase.from('production_orders').select('order_item_id, qty_planned, qty_released, status').neq('status', 'cancelada'),
    supabase.from('machines').select('id, code, name').eq('active', true).order('code'),
    supabase.from('molds').select('id, code, name, status').in('status', ['disponivel', 'em_uso']).order('code'),
    supabase.from('customers').select('id, legal_name').in('id', [...new Set((orders ?? []).map((o) => o.customer_id))]),
  ]);
  const planned = (oi: string) => (ops ?? []).filter((p) => p.order_item_id === oi).reduce((s, p) => s + Number(p.status === 'concluida' ? p.qty_released : p.qty_planned), 0);
  const rows = (ois ?? []).map((i) => ({ ...i, left: i.qty - planned(i.id), order: orders?.find((o) => o.id === i.order_id)! })).filter((r) => r.left > 0);
  return (
    <>
      <div className="top"><h1>Nova ordem de produção</h1><Link className="btn line" href="/producao">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      <form action={createPO} className="card stack" style={{ maxWidth: 640 }}>
        <label>Item do pedido (com saldo a produzir)
          <select name="order_item_id" required defaultValue=""><option value="" disabled>Selecione…</option>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.order.number} · {custs?.find((c) => c.id === r.order.customer_id)?.legal_name} · {r.description} · saldo {r.left}{r.order.status_production === 'nao_liberado' ? ' (pedido não liberado)' : ''}</option>)}
          </select></label>
        <div className="grid2"><label>Quantidade a produzir<input name="qty" required inputMode="numeric" /></label><label>Início previsto<input name="start" type="date" /></label></div>
        <div className="grid2">
          <label>Máquina<select name="machine_id" defaultValue=""><option value="">—</option>{(machines ?? []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></label>
          <label>Molde<select name="mold_id" defaultValue=""><option value="">—</option>{(molds ?? []).map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}</select></label>
        </div>
        <p className="muted small">A ordem nasce “planejada” e só pode ser liberada quando o pedido estiver liberado para produção.</p>
        <div><button className="btn" type="submit">Criar ordem</button></div>
      </form>
    </>
  );
}

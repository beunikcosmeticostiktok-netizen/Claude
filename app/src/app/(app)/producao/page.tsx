import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { PRODUCTION_STATUS as ST } from '@/lib/labels';

export const dynamic = 'force-dynamic';
const fmt = (n: number | string) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default async function Producao({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  let q = supabase.from('production_orders').select('id, number, order_item_id, item_id, status, qty_planned, qty_produced, qty_scrap, qty_released, machine_id, planned_start').order('created_at', { ascending: false }).limit(100);
  if (sp.f === 'ativas') q = q.in('status', ['planejada', 'liberada', 'em_producao', 'pausada']);
  const { data: ops } = await q;
  const [{ data: items }, { data: machines }, { data: ois }] = await Promise.all([
    supabase.from('items').select('id, name, sku').in('id', [...new Set((ops ?? []).map((o) => o.item_id))]),
    supabase.from('machines').select('id, code'),
    (ops ?? []).length ? supabase.from('order_items').select('id, order_id').in('id', (ops ?? []).map((o) => o.order_item_id)) : Promise.resolve({ data: [] }),
  ]);
  const orderIds = [...new Set((ois ?? []).map((x) => x.order_id))];
  const { data: orders } = orderIds.length ? await supabase.from('orders').select('id, number').in('id', orderIds) : { data: [] };
  const ordNum = (oiId: string) => orders?.find((o) => o.id === ois?.find((x) => x.id === oiId)?.order_id)?.number;
  const canWrite = roles.includes('admin') || roles.includes('producao');
  return (
    <>
      <div className="top"><h1>Produção</h1><div className="inline">
        <Link className="btn line" href="/producao/recursos">Máquinas e moldes</Link>
        {canWrite && <Link className="btn" href="/producao/nova">Nova ordem de produção</Link>}</div></div>
      <div className="tabs"><Link href="/producao" className={!sp.f ? 'on' : undefined}>Todas</Link><Link href="/producao?f=ativas" className={sp.f === 'ativas' ? 'on' : undefined}>Em aberto</Link></div>
      <div className="card scroll"><table className="table">
        <thead><tr><th>Ordem</th><th>Produto</th><th>Pedido</th><th>Situação</th><th className="right">Planejado</th><th className="right">Produzido</th><th className="right">Liberado (qualidade)</th></tr></thead>
        <tbody>
          {(ops ?? []).map((o) => (
            <tr key={o.id}>
              <td><Link href={`/producao/${o.id}`}><b>{o.number}</b></Link><div className="muted small">{machines?.find((m) => m.id === o.machine_id)?.code ?? 'sem máquina'}</div></td>
              <td>{items?.find((i) => i.id === o.item_id)?.name}</td><td>{ordNum(o.order_item_id)}</td>
              <td><span className={`badge ${o.status === 'concluida' ? 'on' : o.status === 'cancelada' ? 'off' : 'acc'}`}>{ST[o.status]}</span></td>
              <td className="right">{fmt(o.qty_planned)}</td><td className="right">{fmt(o.qty_produced)}</td><td className="right">{fmt(o.qty_released)}</td>
            </tr>
          ))}
          {!ops?.length && <tr><td colSpan={7} className="muted">Nenhuma ordem de produção.</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}

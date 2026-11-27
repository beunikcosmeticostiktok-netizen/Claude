import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { dataBR } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { poStatus, quality, report } from '../actions';

export const dynamic = 'force-dynamic';
const ST: Record<string, string> = { planejada: 'Planejada', liberada: 'Liberada', em_producao: 'Em produção', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
const OK: Record<string, string> = { criada: 'Ordem criada.', release: 'Ordem liberada.', pause: 'Ordem pausada.', resume: 'Produção retomada.', conclude: 'Ordem concluída.', cancel: 'Ordem cancelada.', apontado: 'Apontamento registrado.', qualidade: 'Qualidade registrada: os aprovados entraram no estoque.' };
const fmt = (n: number | string) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export default async function OPDetalhe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data: po } = await supabase.from('production_orders').select('*').eq('id', id).maybeSingle();
  if (!po) notFound();
  const [{ data: item }, { data: oi }, { data: reps }, { data: insps }, { data: locs }, { data: mats }, { data: machine }, { data: mold }] = await Promise.all([
    supabase.from('items').select('name, sku').eq('id', po.item_id).single(),
    supabase.from('order_items').select('order_id, description, qty').eq('id', po.order_item_id).single(),
    supabase.from('production_reports').select('*').eq('po_id', id).order('at', { ascending: false }),
    supabase.from('quality_inspections').select('*').eq('po_id', id).order('at', { ascending: false }),
    supabase.from('stock_locations').select('id, code, name').eq('active', true).order('code'),
    supabase.from('items').select('id, name, sku, uom').eq('type', 'materia_prima').eq('active', true).order('name'),
    po.machine_id ? supabase.from('machines').select('code, name').eq('id', po.machine_id).single() : Promise.resolve({ data: null }),
    po.mold_id ? supabase.from('molds').select('code, name').eq('id', po.mold_id).single() : Promise.resolve({ data: null }),
  ]);
  const { data: ord } = oi ? await supabase.from('orders').select('number, status_production').eq('id', oi.order_id).single() : { data: null };
  const canProd = roles.includes('admin') || roles.includes('producao');
  const canStatus = canProd || roles.includes('gestor');
  const active = po.status === 'liberada' || po.status === 'em_producao';
  const hid = <input type="hidden" name="po_id" value={po.id} />;
  const toInspect = Number(po.qty_produced) - Number(po.qty_scrap) - Number(po.qty_inspected);

  return (
    <>
      <div className="top"><div><h1>{po.number} <span className={`badge ${po.status === 'concluida' ? 'on' : po.status === 'cancelada' ? 'off' : 'acc'}`}>{ST[po.status]}</span></h1>
        <span className="muted">{item?.name} ({item?.sku}) · Pedido {ord?.number}</span></div><Link className="btn line" href="/producao">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">{OK[sp.ok] ?? 'Feito.'}</div>}

      <div className="cards">
        {([['Planejado', po.qty_planned], ['Produzido', po.qty_produced], ['Refugo', po.qty_scrap], ['Inspecionado', po.qty_inspected], ['Liberado (em estoque)', po.qty_released]] as [string, number][]).map(([l, v]) => (
          <div key={l} className="card stat"><b>{fmt(v)}</b><span>{l}</span></div>))}
      </div>
      <div className="card"><div className="kv">
        <div><small>Máquina</small><b>{machine ? `${machine.code} — ${machine.name}` : '—'}</b></div>
        <div><small>Molde</small><b>{mold ? `${mold.code} — ${mold.name}` : '—'}</b></div>
        <div><small>Início previsto</small><b>{po.planned_start ? dataBR(po.planned_start + 'T12:00:00') : '—'}</b></div>
        <div><small>Pedido</small><b>{ord?.status_production}</b></div>
      </div>{po.notes && <p className="small" style={{ marginTop: 10 }}>{po.notes}</p>}</div>

      {canStatus && !['concluida', 'cancelada'].includes(po.status) && (
        <div className="card" style={{ marginTop: 16 }}><h2>Situação</h2>
          <div className="inline" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            {po.status === 'planejada' && <form action={poStatus}>{hid}<input type="hidden" name="action" value="release" /><button className="btn" type="submit">Liberar para produção</button></form>}
            {po.status === 'em_producao' && <form action={poStatus}>{hid}<input type="hidden" name="action" value="pause" /><button className="btn line" type="submit">Pausar</button></form>}
            {po.status === 'pausada' && <form action={poStatus}>{hid}<input type="hidden" name="action" value="resume" /><button className="btn" type="submit">Retomar</button></form>}
            {['em_producao', 'pausada'].includes(po.status) && <form action={poStatus} className="inline">{hid}<input type="hidden" name="action" value="conclude" /><input name="note" placeholder="Motivo (se produziu a menos)" style={{ minWidth: 220 }} /><button className="btn line" type="submit">Concluir ordem</button></form>}
            {po.status !== 'planejada' ? null : null}
            {Number(po.qty_produced) === 0 && <form action={poStatus} className="inline">{hid}<input type="hidden" name="action" value="cancel" /><input name="note" placeholder="Motivo do cancelamento" required /><button className="btn danger" type="submit">Cancelar</button></form>}
          </div></div>
      )}

      {canProd && active && (
        <form action={report} className="card stack" style={{ marginTop: 16 }}>
          <h2>Apontar produção</h2>{hid}<input type="hidden" name="key" value={randomUUID()} />
          <div className="grid2"><label>Produzido (peças)<input name="produced" inputMode="numeric" required /></label><label>Refugo (peças)<input name="rejected" inputMode="numeric" defaultValue="0" /></label></div>
          <div className="grid2"><label>Retrabalho (peças)<input name="rework" inputMode="numeric" defaultValue="0" /></label><label>Parada (minutos)<input name="downtime" inputMode="numeric" defaultValue="0" /></label></div>
          <div className="grid2"><label>Lote<input name="lot" /></label><label>Local do estoque (consumo)<select name="location_id">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label></div>
          <label>Ocorrência<input name="occurrence" placeholder="ex.: troca de bico, ajuste de molde" /></label>
          <b className="small">Matéria-prima consumida (opcional)</b>
          {[1, 2, 3].map((i) => (
            <div key={i} className="grid2"><select name={`cons_item_${i}`} defaultValue=""><option value="">—</option>{(mats ?? []).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}</select>
              <input name={`cons_qty_${i}`} inputMode="decimal" placeholder="Quantidade" /></div>))}
          <div><button className="btn" type="submit">Registrar apontamento</button></div>
        </form>
      )}

      {canStatus && ['em_producao', 'pausada', 'concluida'].includes(po.status) && toInspect > 0 && (
        <form action={quality} className="card stack" style={{ marginTop: 16 }}>
          <h2>Liberação de qualidade</h2>{hid}<input type="hidden" name="key" value={randomUUID()} />
          <p className="muted small">Pendentes de inspeção: <b>{fmt(toInspect)}</b>. Só os aprovados entram no estoque como produto acabado.</p>
          <div className="grid2"><label>Inspecionadas<input name="inspected" inputMode="numeric" required /></label><label>Aprovadas<input name="approved" inputMode="numeric" required /></label></div>
          <div className="grid2"><label>Lote<input name="lot" /></label><label>Local de entrada<select name="location_id">{(locs ?? []).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label></div>
          <label>Observação (obrigatória se houver reprovadas)<input name="note" /></label>
          <div><button className="btn" type="submit">Liberar aprovadas</button></div>
        </form>
      )}

      <div className="grid2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="card"><h2>Apontamentos</h2>
          {(reps ?? []).map((r) => <p key={r.id} className="small" style={{ margin: '8px 0' }}><b>{dataBR(r.at)}</b> · produzido {fmt(r.qty_produced)} · refugo {fmt(r.qty_rejected)}{r.downtime_min ? ` · parada ${r.downtime_min} min` : ''}{r.occurrence ? ` — ${r.occurrence}` : ''}</p>)}
          {!reps?.length && <p className="muted small">Nenhum apontamento.</p>}</div>
        <div className="card"><h2>Inspeções de qualidade</h2>
          {(insps ?? []).map((q) => <p key={q.id} className="small" style={{ margin: '8px 0' }}><b>{dataBR(q.at)}</b> · inspecionadas {fmt(q.qty_inspected)} · aprovadas {fmt(q.qty_approved)}{q.lot_code ? ` · lote ${q.lot_code}` : ''}{q.note ? ` — ${q.note}` : ''}</p>)}
          {!insps?.length && <p className="muted small">Nenhuma inspeção.</p>}</div>
      </div>
    </>
  );
}

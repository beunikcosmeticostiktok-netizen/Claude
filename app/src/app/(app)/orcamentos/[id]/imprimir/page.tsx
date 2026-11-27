import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { brl, dataBR, formatTaxId } from '@/lib/format';
import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

export default async function Imprimir({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial', 'financeiro']);
  const { data: quote } = await supabase.from('quotes').select('number, customer_id, seller_id').eq('id', id).maybeSingle();
  if (!quote) notFound();
  const { data: ver } = v
    ? await supabase.from('quote_versions').select('id, version, status, snapshot').eq('id', v).eq('quote_id', id).maybeSingle()
    : await supabase.from('quote_versions').select('id, version, status, snapshot').eq('quote_id', id).order('version', { ascending: false }).limit(1).maybeSingle();
  if (!ver || !ver.snapshot) notFound();   // só versões enviadas têm retrato oficial
  const [{ data: c }, { data: s }] = await Promise.all([
    supabase.from('customers').select('legal_name, trade_name, tax_id').eq('id', quote.customer_id).single(),
    supabase.from('profiles').select('full_name, phone').eq('id', quote.seller_id).single(),
  ]);
  const sv = ver.snapshot.version as Record<string, any>;
  const items = ver.snapshot.items as { description: string; qty: number; unit_price: number; line_total: number }[];

  return (
    <div className="card" style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="inline noprint" style={{ justifyContent: 'flex-end', marginBottom: 12 }}><PrintButton /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <img src="/logo.png" alt="Century Shalom" style={{ height: 64, width: 'auto' }} />
        <div style={{ textAlign: 'right' }}>
          <h1>Orçamento {quote.number}</h1>
          <span className="muted">Versão {ver.version} · Validade até {sv.valid_until ? dataBR(sv.valid_until + 'T12:00:00') : '—'}</span>
        </div>
      </div>
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />
      <div className="kv">
        <div><small>Cliente</small><b>{c?.legal_name}</b></div>
        <div><small>CNPJ/CPF</small><b>{formatTaxId(c?.tax_id) || '—'}</b></div>
        <div><small>Vendedor</small><b>{s?.full_name}</b></div>
      </div>
      <table className="table" style={{ marginTop: 18 }}>
        <thead><tr><th>Descrição</th><th className="right">Qtd</th><th className="right">Preço unit.</th><th className="right">Total</th></tr></thead>
        <tbody>
          {items.map((i, k) => <tr key={k}><td>{i.description}</td><td className="right">{i.qty}</td><td className="right">{brl(i.unit_price)}</td><td className="right">{brl(i.line_total)}</td></tr>)}
          <tr><td colSpan={3} className="right muted">Frete</td><td className="right">{brl(sv.freight_value)}</td></tr>
          <tr><td colSpan={3} className="right"><b>Total</b></td><td className="right"><b>{brl(sv.total)}</b></td></tr>
        </tbody>
      </table>
      <div className="kv" style={{ marginTop: 18 }}>
        <div><small>Prazo estimado</small><b>{sv.lead_time_days != null ? `${sv.lead_time_days} dias` : 'A combinar'}</b></div>
        <div><small>Frete</small><b>{sv.freight_mode === 'fob' ? 'FOB (transporte indicado pelo cliente)' : 'Retirada na fábrica'}</b></div>
        <div><small>Sinal para iniciar a produção</small><b>{sv.deposit_required ? `${sv.deposit_pct}% (${brl(Number(sv.total) * Number(sv.deposit_pct) / 100)})` : 'Não exigido'}</b></div>
        <div><small>Pagamento</small><b>{sv.payment_terms || 'A combinar'}</b></div>
      </div>
      {sv.notes_client && <p style={{ marginTop: 18 }}><b>Observações:</b> {sv.notes_client}</p>}
      <p className="muted small" style={{ marginTop: 24 }}>Century Shalom Indústria de Plásticos · Rua Renato Werneck, 1117 – Dona Amélia, Araçatuba - SP · CEP 16050-660</p>
    </div>
  );
}

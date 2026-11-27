import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { dbErrorText } from '@/lib/labels';
import { buildTimeline } from '@/lib/timeline';
import { requestReturn } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Seu pedido · Century Shalom', robots: { index: false } };
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n));
const dt = (s?: string | null) => (s ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(s)) : '');
const RET: Record<string, string> = { solicitada: 'Devolução solicitada', recebida: 'Mercadoria recebida; reembolso em análise', reembolsada: 'Reembolso autorizado', recusada: 'Devolução recusada' };

type View = {
  number: string; total: number; expires_at: string; status_commercial: string; status_financial: string; status_production: string; status_logistics: string;
  freight_mode: string; carrier_name: string | null; invoice_number: string | null; received_at: string | null; checkout_url: string | null;
  items: { description: string; qty: number; unit_price: number; line_total: number }[];
  shipments: { number: string; status: string; tracking: string | null }[]; return: { status: string } | null; return_deadline: string | null;
};

export default async function Pedido({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ erro?: string; ok?: string; novo?: string }> }) {
  const { token } = await params; const sp = await searchParams;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const admin = createAdminClient();
  await admin.rpc('store_expire_unpaid');
  const { data } = await admin.rpc('store_order_by_token', { p_token: token });
  if (!data) notFound();
  const o = data as View;
  const cancelled = o.status_commercial === 'cancelado';
  const paid = o.status_financial === 'quitado';
  const steps = buildTimeline({ channel: 'loja', deposit_required: true, ...o });
  const canReturn = paid && o.received_at && !o.return && o.return_deadline && new Date(o.return_deadline) > new Date();
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>Pedido {o.number}</h1>
      {sp.novo && !cancelled && !paid && <div className="alert ok">Pedido recebido. Falta o pagamento para confirmar.</div>}
      {sp.ok && <div className="alert ok">Devolução solicitada. Entraremos em contato.</div>}
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {cancelled && <div className="alert err">Pedido cancelado (pagamento não confirmado no prazo). Se você já pagou, fale conosco informando o número do pedido.</div>}
      {!cancelled && !paid && (
        <div className="card">
          <p><b>Total: {brl(o.total)}</b> · reservado até {dt(o.expires_at)}</p>
          {o.checkout_url
            ? <a className="btn" href={o.checkout_url}>Pagar agora (Pix ou cartão)</a>
            : <p>O link de pagamento automático não está disponível. Fale com a nossa equipe informando o número do pedido para combinar o pagamento.</p>}
        </div>
      )}
      <div className="card"><h2>Andamento</h2>
        {steps.map((s) => <p key={s.label}>{s.done ? '✔' : '○'} {s.label}</p>)}
        {o.invoice_number && <p>Nota fiscal: {o.invoice_number}</p>}
        {o.shipments.map((s) => <p key={s.number} className="small">Coleta {s.number}: {s.status}{s.tracking ? ` · ${s.tracking}` : ''}</p>)}
      </div>
      <div className="card"><h2>Itens</h2>
        {o.items.map((i, k) => <p key={k}>{i.qty} × {i.description} — {brl(i.line_total)}</p>)}
        <p><b>Total {brl(o.total)}</b> · {o.freight_mode === 'retirada' ? 'Retirada na fábrica' : `Frete FOB: ${o.carrier_name ?? ''}`}</p>
      </div>
      {o.return && <div className="card"><b>{RET[o.return.status] ?? o.return.status}</b></div>}
      {canReturn && (
        <div className="card"><h2>Direito de arrependimento</h2>
          <p className="small">Você pode solicitar a devolução até {dt(o.return_deadline)}. O frete de devolução é por sua conta e o reembolso é feito depois que a mercadoria chega com a nota de devolução.</p>
          <form action={requestReturn} className="stack"><input type="hidden" name="token" value={token} />
            <label>Motivo<textarea name="reason" required rows={2} /></label><button className="btn line" type="submit">Solicitar devolução</button></form>
        </div>
      )}
    </main>
  );
}

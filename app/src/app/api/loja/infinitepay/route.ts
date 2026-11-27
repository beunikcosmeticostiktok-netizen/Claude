import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyPayment } from '@/lib/infinitepay';

export const runtime = 'nodejs';

// Webhook da InfinitePay. Não confiamos no corpo recebido: o pagamento é conferido na API deles antes de baixar o título.
export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const order = String(b.order_nsu ?? ''), tx = String(b.transaction_nsu ?? ''), slug = String(b.invoice_slug ?? '');
  if (!order || !tx || !slug) return NextResponse.json({ ok: false }, { status: 400 });
  const paid = await verifyPayment({ orderNumber: order, transactionNsu: tx, slug });
  if (paid == null) return NextResponse.json({ ok: false }, { status: 400 });   // não confirmado: a InfinitePay tenta de novo
  const { data, error } = await createAdminClient().rpc('store_confirm_payment', {
    p_order_number: order, p_provider: 'infinitepay', p_ref: tx, p_amount: paid,
  });
  if (error) {
    console.error('store_confirm_payment', error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, result: data });
}

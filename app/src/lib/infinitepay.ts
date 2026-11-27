// Integração InfinitePay (link de checkout + confirmação). ATENÇÃO: escrita a partir da documentação pública,
// AINDA NÃO TESTADA contra a API real. Valide com uma compra real de valor baixo antes de divulgar a loja.
const BASE = 'https://api.checkout.infinitepay.io';
export const infinitepayHandle = () => (process.env.INFINITEPAY_HANDLE ?? '').trim().replace(/^\$/, '');
export const infinitepayEnabled = () => Boolean(infinitepayHandle());
const cents = (n: number) => Math.round(n * 100);

export async function createCheckoutLink(p: {
  orderNumber: string; items: { description: string; qty: number; unitPrice: number }[]; redirectUrl: string; webhookUrl: string;
}): Promise<string | null> {
  const handle = infinitepayHandle();
  if (!handle) return null;
  try {
    const res = await fetch(`${BASE}/links`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        handle, order_nsu: p.orderNumber, redirect_url: p.redirectUrl, webhook_url: p.webhookUrl,
        items: p.items.map((i) => ({ quantity: i.qty, price: cents(i.unitPrice), description: i.description.slice(0, 120) })),
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const url = (j.url ?? j.checkout_url ?? j.link) as unknown;
    return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
  } catch { return null; }
}

/** Confirma o pagamento direto na InfinitePay. O webhook NUNCA é confiado sozinho. Retorna o valor pago em reais ou null. */
export async function verifyPayment(p: { orderNumber: string; transactionNsu: string; slug: string }): Promise<number | null> {
  const handle = infinitepayHandle();
  if (!handle) return null;
  try {
    const res = await fetch(`${BASE}/payment_check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ handle, order_nsu: p.orderNumber, transaction_nsu: p.transactionNsu, slug: p.slug }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    if (j.success === false || j.paid !== true) return null;
    const c = Number(j.paid_amount ?? j.amount);
    return Number.isFinite(c) && c > 0 ? c / 100 : null;
  } catch { return null; }
}

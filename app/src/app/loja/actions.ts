'use server';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { dbErrorKey } from '@/lib/labels';
import { createCheckoutLink, infinitepayEnabled } from '@/lib/infinitepay';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function placeOrder(fd: FormData) {
  let cart: { item_id: string; qty: number }[] = [];
  try { cart = JSON.parse(str(fd, 'cart')); } catch { redirect('/loja?erro=no_items'); }
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'sem-ip';
  const ipHash = createHash('sha256').update(ip + (process.env.LEAD_IP_SALT ?? '')).digest('hex');
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('store_create_order', {
    p_buyer: {
      name: str(fd, 'name'), tax_id: str(fd, 'tax_id'), phone: str(fd, 'phone'), email: str(fd, 'email'),
      freight_mode: str(fd, 'freight_mode'), carrier_name: str(fd, 'carrier_name'), note: str(fd, 'note'),
    },
    p_items: cart.map((c) => ({ item_id: String(c.item_id), qty: Math.trunc(Number(c.qty)) })),
    p_ip_hash: ipHash,
  });
  if (error || !data) redirect('/loja?erro=' + dbErrorKey(error?.message));
  const o = data as { order_id: string; number: string; token: string; total: number };

  if (infinitepayEnabled()) {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || `https://${h.get('host')}`;
    const { data: v } = await admin.rpc('store_order_by_token', { p_token: o.token });
    const items = ((v as { items?: { description: string; qty: number; unit_price: number }[] } | null)?.items ?? [])
      .map((i) => ({ description: i.description, qty: i.qty, unitPrice: Number(i.unit_price) }));
    const url = await createCheckoutLink({
      orderNumber: o.number, items, redirectUrl: `${origin}/loja/pedido/${o.token}`, webhookUrl: `${origin}/api/loja/infinitepay`,
    });
    if (url) await admin.rpc('store_set_checkout', { p_order: o.order_id, p_provider: 'infinitepay', p_url: url });
  }
  redirect(`/loja/pedido/${o.token}?novo=1`);
}

export async function requestReturn(fd: FormData) {
  const token = str(fd, 'token');
  const { error } = await createAdminClient().rpc('store_request_return', { p_token: token, p_reason: str(fd, 'reason') });
  redirect(`/loja/pedido/${token}?` + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=1'));
}

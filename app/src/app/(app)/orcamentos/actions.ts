'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim() || null;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
function back(quote: string, version: string | null, q: string): never {
  redirect(`/orcamentos/${quote}?${version ? `v=${version}&` : ''}${q}`);
}

export async function createQuote(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const customer = str(fd, 'customer_id');
  if (!customer) redirect('/orcamentos/novo?erro=cliente');
  const { data, error } = await supabase.rpc('quote_create', { p_customer: customer });
  if (error || !data) redirect('/orcamentos/novo?erro=' + dbErrorKey(error?.message));
  redirect(`/orcamentos/${data}`);
}

export async function updateVersion(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id');
  const freight = parseMoney(fd.get('freight_value')); const dep = parseMoney(fd.get('deposit_pct'));
  const lead = parseMoney(fd.get('lead_time_days'));
  if ([freight, dep, lead].some((x) => x !== null && Number.isNaN(x))) back(q, v, 'erro=numero');
  const { error } = await supabase.from('quote_versions').update({
    valid_until: text(fd, 'valid_until'), payment_terms: text(fd, 'payment_terms'),
    freight_mode: fd.get('freight_mode') === 'retirada' ? 'retirada' : 'fob', carrier_name: text(fd, 'carrier_name'),
    lead_time_days: lead == null ? null : Math.round(lead), deposit_required: fd.get('deposit_required') === 'on',
    deposit_pct: dep ?? 50, freight_value: freight ?? 0, notes_client: text(fd, 'notes_client'), notes_internal: text(fd, 'notes_internal'),
  }).eq('id', v);
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  back(q, v, 'ok=salvo');
}

export async function updateContact(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id');
  await supabase.from('quotes').update({ contact_id: text(fd, 'contact_id') }).eq('id', q);
  back(q, text(fd, 'version_id'), 'ok=salvo');
}

async function pricing(supabase: Awaited<ReturnType<typeof requireRole>>['supabase'], itemId: string, qty: number) {
  const [{ data: tier }, { data: price }] = await Promise.all([
    supabase.rpc('tier_for_qty', { p_qty: qty }), supabase.rpc('item_price_for_qty', { p_item: itemId, p_qty: qty }),
  ]);
  return { tier: tier as number | null, price: price as number | null };
}

export async function addCatalogItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id'), itemId = str(fd, 'item_id');
  const qty = parseMoney(fd.get('qty')); const cost = parseMoney(fd.get('unit_cost'));
  if (!itemId || qty == null || Number.isNaN(qty) || qty < 1 || !Number.isInteger(qty)) back(q, v, 'erro=qtd');
  if (cost !== null && Number.isNaN(cost)) back(q, v, 'erro=numero');
  const { data: item } = await supabase.from('items').select('id, sku, name, min_qty, qty_multiple').eq('id', itemId).single();
  if (!item) back(q, v, 'erro=not_found');
  if (qty! < item!.min_qty) back(q, v, 'erro=minimo');
  if (qty! % item!.qty_multiple !== 0) back(q, v, 'erro=multiplo');
  const { tier, price } = await pricing(supabase, itemId, qty!);
  if (price == null) back(q, v, 'erro=sem_preco');
  const { data: last } = await supabase.from('quote_items').select('position').eq('version_id', v).order('position', { ascending: false }).limit(1);
  const { error } = await supabase.from('quote_items').insert({
    version_id: v, item_id: itemId, description: `${item!.name} (${item!.sku})`, qty, tier_id: tier, list_price: price,
    unit_price: price, unit_cost: cost, position: (last?.[0]?.position ?? 0) + 1,
  });
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  back(q, v, 'ok=item');
}

export async function addFreeItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id');
  const qty = parseMoney(fd.get('qty')); const price = parseMoney(fd.get('unit_price')); const cost = parseMoney(fd.get('unit_cost'));
  const desc = text(fd, 'description');
  if (!desc || qty == null || Number.isNaN(qty) || qty < 1 || !Number.isInteger(qty)) back(q, v, 'erro=qtd');
  if (price == null || Number.isNaN(price) || (cost !== null && Number.isNaN(cost))) back(q, v, 'erro=numero');
  const { data: last } = await supabase.from('quote_items').select('position').eq('version_id', v).order('position', { ascending: false }).limit(1);
  const { error } = await supabase.from('quote_items').insert({
    version_id: v, description: desc, qty, unit_price: price, unit_cost: cost, position: (last?.[0]?.position ?? 0) + 1,
  });
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  back(q, v, 'ok=item');
}

export async function updateItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id'), id = str(fd, 'id');
  const qty = parseMoney(fd.get('qty')); const price = parseMoney(fd.get('unit_price')); const cost = parseMoney(fd.get('unit_cost'));
  if (qty == null || Number.isNaN(qty) || qty < 1 || !Number.isInteger(qty) || price == null || Number.isNaN(price)
      || (cost !== null && Number.isNaN(cost))) back(q, v, 'erro=numero');
  const { data: cur } = await supabase.from('quote_items').select('item_id').eq('id', id).single();
  const patch: Record<string, unknown> = { qty, unit_price: price, unit_cost: cost };
  if (cur?.item_id) {
    const { tier, price: list } = await pricing(supabase, cur.item_id, qty!);
    patch.tier_id = tier; patch.list_price = list;     // a faixa muda com a quantidade
  }
  const { error } = await supabase.from('quote_items').update(patch).eq('id', id);
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  back(q, v, 'ok=item');
}

export async function removeItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id');
  const { error } = await supabase.from('quote_items').delete().eq('id', str(fd, 'id'));
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  back(q, v, 'ok=item');
}

const ACTIONS: Record<string, { fn: string; args: (fd: FormData) => Record<string, unknown>; roles: ('admin' | 'gestor' | 'comercial')[] }> = {
  request_approval: { fn: 'quote_request_internal_approval', args: (fd) => ({ p_version: str(fd, 'version_id') }), roles: ['admin', 'comercial'] },
  approve: { fn: 'quote_internal_approve', args: (fd) => ({ p_version: str(fd, 'version_id'), p_note: text(fd, 'note') }), roles: ['admin', 'gestor'] },
  reject: { fn: 'quote_internal_reject', args: (fd) => ({ p_version: str(fd, 'version_id'), p_note: str(fd, 'note') }), roles: ['admin', 'gestor'] },
  send: { fn: 'quote_send', args: (fd) => ({ p_version: str(fd, 'version_id') }), roles: ['admin', 'gestor', 'comercial'] },
  refuse: { fn: 'quote_mark_refused', args: (fd) => ({ p_version: str(fd, 'version_id') }), roles: ['admin', 'gestor', 'comercial'] },
  approve_offline: { fn: 'quote_mark_approved_offline', args: (fd) => ({ p_version: str(fd, 'version_id'), p_note: str(fd, 'note') }), roles: ['admin', 'gestor', 'comercial'] },
  convert: { fn: 'quote_convert_to_order', args: (fd) => ({ p_version: str(fd, 'version_id') }), roles: ['admin', 'gestor', 'comercial'] },
  new_version: { fn: 'quote_new_version', args: (fd) => ({ p_quote: str(fd, 'quote_id') }), roles: ['admin', 'comercial'] },
};

export async function quoteAction(fd: FormData) {
  const name = str(fd, 'action');
  const def = ACTIONS[name];
  const q = str(fd, 'quote_id'), v = str(fd, 'version_id') || null;
  if (!def) back(q, v, 'erro=falha');
  const { supabase } = await requireRole(def.roles);
  const { data, error } = await supabase.rpc(def.fn, def.args(fd));
  if (error) back(q, v, 'erro=' + dbErrorKey(error.message));
  revalidatePath(`/orcamentos/${q}`);
  if (name === 'new_version') back(q, String(data), 'ok=nova_versao');
  if (name === 'approve_offline' || name === 'convert') redirect(`/pedidos/${data}`);
  back(q, v, 'ok=' + name);
}

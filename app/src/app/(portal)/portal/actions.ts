'use server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');

export async function approveQuote(fd: FormData) {
  const { supabase } = await getSession();
  const v = str(fd, 'version_id');
  const ip = ((await headers()).get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const { data, error } = await supabase.rpc('portal_approve_quote', { p_version: v, p_ip: ip });
  if (error) redirect(`/portal/orcamentos/${v}?erro=${dbErrorKey(error.message)}`);
  revalidatePath('/portal');
  redirect(`/portal/pedidos/${data}?ok=aprovado`);
}

export async function requestChange(fd: FormData) {
  const { supabase } = await getSession();
  const v = str(fd, 'version_id');
  const message = str(fd, 'message').trim();
  if (!message) redirect(`/portal/orcamentos/${v}?erro=note_required`);
  const { error } = await supabase.rpc('portal_request_quote_change', { p_version: v, p_message: message });
  if (error) redirect(`/portal/orcamentos/${v}?erro=${dbErrorKey(error.message)}`);
  revalidatePath(`/portal/orcamentos/${v}`);
  redirect(`/portal/orcamentos/${v}?ok=alteracao`);
}

export async function setCarrier(fd: FormData) {
  const { supabase } = await getSession();
  const o = str(fd, 'order_id');
  const { error } = await supabase.rpc('portal_set_carrier', { p_order: o, p_name: str(fd, 'name'), p_contact: str(fd, 'contact').trim() || null });
  if (error) redirect(`/portal/pedidos/${o}?erro=${dbErrorKey(error.message === 'name_required' ? 'name_required' : error.message)}`);
  revalidatePath(`/portal/pedidos/${o}`);
  redirect(`/portal/pedidos/${o}?ok=transportadora`);
}

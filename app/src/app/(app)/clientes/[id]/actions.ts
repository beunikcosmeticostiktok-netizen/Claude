'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim() || null;
function back(id: string, q: string): never { redirect(`/clientes/${id}?${q}`); }

export async function addContact(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const id = String(fd.get('customer_id'));
  const name = text(fd, 'name');
  if (!name) back(id, 'erro=nome');
  const { error } = await supabase.from('contacts').insert({
    customer_id: id, name, role_title: text(fd, 'role_title'), phone: text(fd, 'phone'),
    whatsapp: text(fd, 'phone'), email: text(fd, 'email'),
  });
  if (error) back(id, 'erro=falha');
  revalidatePath(`/clientes/${id}`);
  back(id, 'ok=contato');
}

export async function addAddress(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const id = String(fd.get('customer_id'));
  const state = (text(fd, 'state') ?? '').toUpperCase().slice(0, 2) || null;
  const { error } = await supabase.from('addresses').insert({
    customer_id: id, kind: fd.get('kind') === 'entrega' ? 'entrega' : 'faturamento', cep: text(fd, 'cep'),
    street: text(fd, 'street'), number: text(fd, 'number'), complement: text(fd, 'complement'),
    district: text(fd, 'district'), city: text(fd, 'city'), state,
  });
  if (error) back(id, 'erro=falha');
  revalidatePath(`/clientes/${id}`);
  back(id, 'ok=endereco');
}

/** Cria o login do portal para um contato da empresa (senha temporária, trocada no primeiro acesso). */
export async function createPortalLogin(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const customerId = String(fd.get('customer_id'));
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const name = String(fd.get('name') ?? '').trim();
  const password = String(fd.get('password') ?? '');
  const access = ['leitura', 'aprovador', 'financeiro'].includes(String(fd.get('access'))) ? String(fd.get('access')) : 'leitura';
  if (!email.includes('@') || !name || password.length < 10) back(customerId, 'erro=login_dados');

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name, must_change_password: true },
  });
  if (error || !data.user) back(customerId, 'erro=' + (/already|registered/i.test(error?.message ?? '') ? 'email_existente' : 'falha'));
  const { error: linkErr } = await supabase.from('customer_users').insert({
    user_id: data!.user.id, customer_id: customerId, access, contact_id: text(fd, 'contact_id'),
  });
  if (linkErr) back(customerId, 'erro=falha');
  revalidatePath(`/clientes/${customerId}`);
  back(customerId, 'ok=login');
}

export async function setPortalActive(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const customerId = String(fd.get('customer_id'));
  const { error } = await supabase.from('customer_users').update({ active: fd.get('active') === '1' })
    .eq('customer_id', customerId).eq('user_id', String(fd.get('user_id')));
  if (error) back(customerId, 'erro=falha');
  revalidatePath(`/clientes/${customerId}`);
  back(customerId, 'ok=acesso');
}

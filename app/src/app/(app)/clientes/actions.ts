'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { onlyDigits } from '@/lib/format';

const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim() || null;

export async function createCustomer(fd: FormData) {
  const { supabase, user } = await requireRole(['admin', 'comercial']);
  const legal = text(fd, 'legal_name');
  if (!legal) redirect('/clientes/novo?erro=nome');

  const { data, error } = await supabase.from('customers').insert({
    legal_name: legal, trade_name: text(fd, 'trade_name'), tax_id: onlyDigits(text(fd, 'tax_id')) || null,
    segment: text(fd, 'segment'), origin: text(fd, 'origin') ?? 'manual', owner_id: user.id,
    internal_notes: text(fd, 'internal_notes'),
  }).select('id').single();

  if (error || !data) {
    const m = error?.message ?? '';
    redirect('/clientes/novo?erro=' + (m.includes('tax_id_uk') ? 'duplicado' : m.includes('tax_id_valid') ? 'documento' : 'falha'));
  }
  const contact = text(fd, 'contact_name');
  if (contact) {
    await supabase.from('contacts').insert({
      customer_id: data.id, name: contact, phone: text(fd, 'contact_phone'),
      whatsapp: text(fd, 'contact_phone'), email: text(fd, 'contact_email'),
    });
  }
  revalidatePath('/clientes');
  redirect('/clientes?ok=criado');
}

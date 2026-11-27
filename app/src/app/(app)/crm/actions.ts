'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { dbErrorKey } from '@/lib/labels';

export async function convertLead(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const { error } = await supabase.rpc('process_lead', { p_lead: String(fd.get('lead_id')) });
  revalidatePath('/crm');
  redirect('/crm?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=convertido'));
}

export async function moveOpportunity(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const next = String(fd.get('next_contact') ?? '').trim();
  const { error } = await supabase.from('opportunities').update({
    stage_id: String(fd.get('stage_id')), loss_reason_id: String(fd.get('loss_reason_id') ?? '') || null,
    next_contact_at: next ? new Date(next + 'T12:00:00-03:00').toISOString() : null,
  }).eq('id', String(fd.get('id')));
  revalidatePath('/crm');
  redirect('/crm?' + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=movida'));
}

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

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/** Registra à mão um contato (WhatsApp, telefone, indicação...) e já cria a oportunidade, com a mesma deduplicação do site. */
export async function createLead(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const name = str(fd, 'name'); const phone = str(fd, 'phone'); const email = str(fd, 'email');
  const interest = str(fd, 'interest_type') === 'projeto_exclusivo' ? 'projeto_exclusivo' : 'produto_existente';
  if (name.length < 2) redirect('/crm?erro=lead_nome');
  if (!phone && !email) redirect('/crm?erro=lead_contato');
  const origem = str(fd, 'origem') || 'Outro';
  const message = [`[Origem: ${origem}]`, str(fd, 'message')].filter(Boolean).join(' ');
  const { data: lead, error } = await supabase.from('leads').insert({
    source: 'manual', interest_type: interest, name, company: str(fd, 'company') || null, tax_id: str(fd, 'tax_id') || null,
    phone: phone || null, email: email || null, product_interest: str(fd, 'product_interest') || null, message,
    consent_at: new Date().toISOString(), raw: { origem },
  }).select('id').single();
  if (error || !lead) redirect('/crm?erro=falha');
  const { error: procErr } = await supabase.rpc('process_lead', { p_lead: lead.id });
  revalidatePath('/crm');
  redirect('/crm?' + (procErr ? 'erro=' + dbErrorKey(procErr.message) : 'ok=lead_criado'));
}

export type ImportRow = { n: number; name?: string; company?: string; phone?: string; email?: string; tax_id?: string; interest?: string; product?: string; message?: string };
export type ChunkResult = { created: number; attached: number; errors: { n: number; msg: string }[] };
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

/** Importa um lote (até 50 linhas) de contatos de uma planilha. Cada linha vira lead + oportunidade, com deduplicação. */
export async function importLeadsChunk(rows: ImportRow[], fileName: string): Promise<ChunkResult> {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const out: ChunkResult = { created: 0, attached: 0, errors: [] };
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) return { ...out, errors: [{ n: 0, msg: 'lote inválido' }] };
  for (const r of rows) {
    const n = Number(r.n) || 0;
    const name = clip(r.name, 120), phone = clip(r.phone, 30), email = clip(r.email, 160).toLowerCase();
    if (name.length < 2) { out.errors.push({ n, msg: 'sem nome' }); continue; }
    if (!phone && !email) { out.errors.push({ n, msg: 'sem telefone nem e-mail' }); continue; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { out.errors.push({ n, msg: 'e-mail inválido' }); continue; }
    const interest = /exclusiv|projeto|sob medida/i.test(clip(r.interest, 60)) ? 'projeto_exclusivo' : 'produto_existente';
    const { data: lead, error } = await supabase.from('leads').insert({
      source: 'manual', interest_type: interest, name, company: clip(r.company, 160) || null, tax_id: clip(r.tax_id, 20) || null,
      phone: phone || null, email: email || null, product_interest: clip(r.product, 200) || null,
      message: ['[Origem: Importação de planilha]', clip(r.message, 1500)].filter(Boolean).join(' '),
      consent_at: new Date().toISOString(), raw: { origem: 'Importação', arquivo: clip(fileName, 120), linha: n },
    }).select('id').single();
    if (error || !lead) { out.errors.push({ n, msg: 'não foi possível gravar' }); continue; }
    const { error: pe } = await supabase.rpc('process_lead', { p_lead: lead.id });
    if (pe) { out.errors.push({ n, msg: 'gravado, mas ficou em "Leads novos" para converter' }); continue; }
    const { data: st } = await supabase.from('leads').select('status').eq('id', lead.id).single();
    if (st?.status === 'anexado') out.attached++; else out.created++;
  }
  revalidatePath('/crm');
  return out;
}

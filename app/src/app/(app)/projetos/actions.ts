'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const text = (fd: FormData, k: string) => str(fd, k).trim() || null;
function back(id: string, q: string): never { redirect(`/projetos/${id}?${q}`); }
async function run(id: string, call: PromiseLike<{ error: { message: string } | null }>, ok: string): Promise<never> {
  const { error } = await call;
  revalidatePath(`/projetos/${id}`);
  return back(id, error ? 'erro=' + dbErrorKey(error.message) : 'ok=' + ok);
}
const ROLES = ['admin', 'gestor', 'comercial', 'producao'] as const;

export async function createProject(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial']);
  const { data, error } = await supabase.rpc('project_create', { p_customer: str(fd, 'customer_id'), p_title: str(fd, 'title'), p_briefing: str(fd, 'briefing'), p_opportunity: null });
  if (error || !data) redirect('/projetos/novo?erro=' + dbErrorKey(error?.message));
  redirect(`/projetos/${data}?ok=criado`);
}
export async function saveProject(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial', 'producao']);
  const id = str(fd, 'id');
  const money = (k: string) => { const v = parseMoney(fd.get(k)); return v == null || Number.isNaN(v) ? null : v; };
  const { error } = await supabase.from('projects').update({
    title: str(fd, 'title').trim(), briefing: text(fd, 'briefing'), requirements: text(fd, 'requirements'), due_date: text(fd, 'due_date'),
    mold_id: text(fd, 'mold_id'), development_price: money('development_price'), mold_price: money('mold_price'),
    sample_price: money('sample_price'), charge_notes: text(fd, 'charge_notes'),
  }).eq('id', id);
  await run(id, Promise.resolve({ error }), 'salvo');
}
export async function saveCosts(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  const id = str(fd, 'id'); const v = parseMoney(fd.get('cost'));
  const { error } = await supabase.from('project_costs').upsert({ project_id: id, internal_cost_estimate: v == null || Number.isNaN(v) ? null : v, notes: text(fd, 'notes') });
  await run(id, Promise.resolve({ error }), 'custo');
}
export async function setFeasibility(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'producao']);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_set_feasibility', { p_project: id, p_feasible: str(fd, 'feasible') === '1', p_notes: str(fd, 'notes') }), 'viabilidade');
}
export async function advance(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_advance', { p_project: id, p_to: str(fd, 'to'), p_note: text(fd, 'note') }), 'etapa');
}
export async function cancelProject(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_cancel', { p_project: id, p_reason: str(fd, 'reason') }), 'cancelado');
}
export async function versionCreate(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial', 'producao']);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_version_create', { p_project: id, p_requirements: str(fd, 'requirements'), p_specs: null }), 'versao');
}
export async function versionSend(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial', 'producao']);
  await run(str(fd, 'id'), supabase.rpc('project_version_send', { p_version: str(fd, 'version_id') }), 'enviada');
}
export async function versionApproveOffline(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  await run(str(fd, 'id'), supabase.rpc('project_version_approve_offline', { p_version: str(fd, 'version_id'), p_note: str(fd, 'note') }), 'aprovada');
}
export async function addFile(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial', 'producao']);
  const vn = parseMoney(fd.get('version_no'));
  await run(str(fd, 'id'), supabase.rpc('project_file_add', {
    p_project: str(fd, 'id'), p_kind: str(fd, 'kind'), p_title: str(fd, 'title'), p_url: str(fd, 'url').trim(), p_notes: text(fd, 'notes'),
    p_visible: fd.get('visible') === 'on', p_version_no: vn == null || Number.isNaN(vn) ? null : Math.round(vn),
  }), 'arquivo');
}
export async function toggleFile(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'comercial', 'producao']);
  const id = str(fd, 'id');
  const patch = fd.get('what') === 'visible' ? { visible_to_customer: fd.get('value') === '1' } : { active: fd.get('value') === '1' };
  const { error } = await supabase.from('project_files').update(patch).eq('id', str(fd, 'file_id'));
  await run(id, Promise.resolve({ error }), 'arquivo');
}
export async function sampleCreate(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_sample_create', { p_project: id, p_notes: text(fd, 'notes') }), 'amostra');
}
export async function sampleSend(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'producao']);
  await run(str(fd, 'id'), supabase.rpc('project_sample_send', { p_sample: str(fd, 'sample_id') }), 'amostra_enviada');
}
export async function sampleDecide(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  await run(str(fd, 'id'), supabase.rpc('project_sample_decide_internal', { p_sample: str(fd, 'sample_id'), p_approve: str(fd, 'approve') === '1', p_note: str(fd, 'note') }), 'amostra_decidida');
}
export async function createItem(fd: FormData) {
  const { supabase } = await requireRole(['admin', 'gestor', 'comercial']);
  const id = str(fd, 'id');
  await run(id, supabase.rpc('project_create_item', { p_project: id }), 'item');
}

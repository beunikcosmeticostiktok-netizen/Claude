'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { parseMoney } from '@/lib/format';
import { dbErrorKey } from '@/lib/labels';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const money = (fd: FormData, k: string) => { const v = parseMoney(fd.get(k)); return v == null ? 0 : v; };
const nn = (fd: FormData, k: string) => { const v = parseMoney(fd.get(k)); return v; };
function done(path: string, error: { message: string } | null, ok: string): never {
  revalidatePath(path);
  redirect(`${path}?` + (error ? 'erro=' + dbErrorKey(error.message) : 'ok=' + ok));
}
const ROLES = ['admin', 'financeiro'] as const;

export async function payTitle(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const vals = ['amount', 'interest', 'fine', 'discount'].map((k) => money(fd, k));
  if (vals.some(Number.isNaN)) redirect('/financeiro/titulos?erro=invalid_amount');
  const { error } = await supabase.rpc('title_pay', {
    p_title: str(fd, 'title_id'), p_account: str(fd, 'account_id'), p_amount: vals[0], p_paid_on: str(fd, 'paid_on') || null,
    p_interest: vals[1], p_fine: vals[2], p_discount: vals[3], p_note: str(fd, 'note').trim() || null, p_key: str(fd, 'key'),
  });
  done(str(fd, 'back') || '/financeiro/titulos', error, 'pago');
}
export async function reversePayment(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('payment_reverse', { p_payment: str(fd, 'payment_id'), p_note: str(fd, 'note') });
  done('/financeiro/titulos', error, 'estornado');
}
export async function cancelTitle(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('title_cancel', { p_title: str(fd, 'title_id'), p_reason: str(fd, 'reason') });
  done('/financeiro/titulos', error, 'cancelado');
}
export async function createInstallments(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const total = nn(fd, 'total');
  if (total == null || Number.isNaN(total)) redirect('/financeiro/titulos?erro=invalid_amount');
  const { error } = await supabase.rpc('title_create_installments', {
    p_kind: str(fd, 'kind') === 'pagar' ? 'pagar' : 'receber', p_description: str(fd, 'description'), p_total: total,
    p_first_due: str(fd, 'first_due'), p_n: Math.round(money(fd, 'n') || 1), p_category: str(fd, 'category_id') || null,
    p_cost_center: str(fd, 'cost_center_id') || null, p_customer: str(fd, 'customer_id') || null, p_supplier: str(fd, 'supplier_id') || null,
  });
  done('/financeiro/titulos', error, 'criado');
}
export async function generateReceivables(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('order_generate_receivables', { p_order: str(fd, 'order_id'), p_balance_due: str(fd, 'due') || null });
  done('/financeiro/titulos', error, 'cobranca');
}
export async function generatePayable(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('receipt_generate_payable', { p_receipt: str(fd, 'receipt_id'), p_due: str(fd, 'due'), p_category: null });
  done('/financeiro/titulos', error, 'pagar');
}
export async function validateProof(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('proof_validate', { p_proof: str(fd, 'proof_id'), p_account: str(fd, 'account_id'), p_key: str(fd, 'key') });
  done('/financeiro', error, 'validado');
}
export async function rejectProof(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = await supabase.rpc('proof_reject', { p_proof: str(fd, 'proof_id'), p_reason: str(fd, 'reason') });
  done('/financeiro', error, 'recusado');
}
export async function transfer(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const amount = nn(fd, 'amount');
  if (amount == null || Number.isNaN(amount)) redirect('/financeiro/caixa?erro=invalid_amount');
  const { error } = await supabase.rpc('account_transfer', { p_from: str(fd, 'from'), p_to: str(fd, 'to'), p_amount: amount, p_date: str(fd, 'date') || null, p_note: str(fd, 'note') || null });
  done('/financeiro/caixa', error, 'transferido');
}
export async function addStatementLine(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const amount = nn(fd, 'amount');
  if (amount == null || Number.isNaN(amount) || amount === 0) redirect('/financeiro/caixa?erro=invalid_amount');
  const { error } = await supabase.rpc('statement_add_line', { p_account: str(fd, 'account_id'), p_date: str(fd, 'date'), p_description: str(fd, 'description'), p_amount: amount });
  done('/financeiro/caixa', error, 'linha');
}
export async function matchLine(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const { error } = str(fd, 'unmatch') ? await supabase.rpc('statement_unmatch', { p_line: str(fd, 'line_id') })
    : await supabase.rpc('statement_match', { p_line: str(fd, 'line_id'), p_movement: Number(str(fd, 'movement_id')) });
  done('/financeiro/caixa', error, 'conciliado');
}
export async function saveCadastro(fd: FormData) {
  const { supabase } = await requireRole([...ROLES]);
  const kind = str(fd, 'what'); const name = str(fd, 'name').trim();
  const res = kind === 'conta' ? await supabase.from('bank_accounts').insert({ name, kind: str(fd, 'type') === 'caixa' ? 'caixa' : 'banco', opening_balance: money(fd, 'opening') })
    : kind === 'categoria' ? await supabase.from('finance_categories').insert({ name, kind: str(fd, 'type') === 'despesa' ? 'despesa' : 'receita' })
    : await supabase.from('cost_centers').insert({ name });
  done('/financeiro/contas', res.error, 'salvo');
}

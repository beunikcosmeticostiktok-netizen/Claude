export const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
export function formatTaxId(v: string | null | undefined) {
  const d = onlyDigits(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}
export const brl = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n ?? 0));
export const dataBR = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso)) : '';

/** Converte "1.234,56" ou "3,2" ou "3.2" em número; vazio vira null; inválido vira NaN. */
export function parseMoney(v: FormDataEntryValue | null | undefined): number | null {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!s) return null;
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  return /^\d+(\.\d+)?$/.test(norm) ? Number(norm) : NaN;
}

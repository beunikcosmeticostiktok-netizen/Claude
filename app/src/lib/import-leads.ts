/** Lógica pura de importação de lista de contatos (testada). A planilha é lida no navegador. */
export const FIELDS = [
  ['name', 'Nome do contato'], ['company', 'Empresa'], ['phone', 'Telefone / WhatsApp'], ['email', 'E-mail'],
  ['tax_id', 'CNPJ / CPF'], ['interest', 'Interesse'], ['product', 'Produto de interesse'], ['message', 'Observações'],
] as const;
export type FieldKey = (typeof FIELDS)[number][0];
export type Mapping = Record<FieldKey, number>;   // índice da coluna, ou -1 = não importar
export type LeadRow = Record<FieldKey, string> & { n: number };

export const norm = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const SYN: Record<FieldKey, string[]> = {
  name: ['nome', 'nome do contato', 'contato', 'cliente', 'responsavel'],
  company: ['empresa', 'razao social', 'nome fantasia', 'fantasia'],
  phone: ['telefone', 'whatsapp', 'celular', 'fone', 'tel', 'telefone whatsapp', 'whats'],
  email: ['email', 'e mail', 'mail'],
  tax_id: ['cnpj', 'cpf', 'cnpj cpf', 'documento'],
  interest: ['interesse', 'tipo', 'tipo de interesse'],
  product: ['produto', 'produto de interesse', 'item'],
  message: ['observacoes', 'observacao', 'obs', 'mensagem', 'comentarios', 'anotacoes'],
};

export function guessMapping(headers: unknown[]): Mapping {
  const hs = headers.map(norm);
  const map = {} as Mapping;
  const used = new Set<number>();
  for (const [key] of FIELDS) {
    let idx = hs.findIndex((h, i) => !used.has(i) && SYN[key].includes(h));
    if (idx < 0) idx = hs.findIndex((h, i) => !used.has(i) && h !== '' && SYN[key].some((s) => h.includes(s)));
    map[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return map;
}

/** Converte a célula para texto sem estragar telefones (Excel entrega números como 14991570389). */
export function toCell(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v).trim();
}

export function buildRows(data: unknown[][], map: Mapping, firstDataRow = 1): LeadRow[] {
  return data.slice(firstDataRow).map((row, i) => {
    const get = (k: FieldKey) => (map[k] >= 0 ? toCell(row[map[k]]) : '');
    return { n: firstDataRow + i + 1, name: get('name'), company: get('company'), phone: get('phone'), email: get('email'),
      tax_id: get('tax_id'), interest: get('interest'), product: get('product'), message: get('message') };
  }).filter((r) => Object.entries(r).some(([k, v]) => k !== 'n' && v !== ''));
}

/** Devolve o motivo se a linha não pode ser importada, ou null se está ok. */
export function validateRow(r: Pick<LeadRow, 'name' | 'phone' | 'email'>): string | null {
  if (r.name.trim().length < 2) return 'sem nome';
  if (!r.phone.trim() && !r.email.trim()) return 'sem telefone nem e-mail';
  if (r.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim())) return 'e-mail inválido';
  return null;
}

export const interestOf = (s: string) => (/exclusiv|projeto|sob medida/i.test(s) ? 'projeto_exclusivo' : 'produto_existente');
export const MODEL_CSV = 'Nome;Empresa;Telefone;E-mail;CNPJ;Interesse;Produto;Observações\nMaria Souza;Cosméticos Alfa Ltda;(14) 99999-1111;maria@alfa.com.br;11.222.333/0001-81;Produto de linha;Frasco 250 ml;Pediu preço para 5 mil unidades\n';

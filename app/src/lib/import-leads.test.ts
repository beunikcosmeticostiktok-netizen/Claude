import { describe, expect, it } from 'vitest';
import { buildRows, guessMapping, interestOf, toCell, validateRow } from './import-leads';

describe('importação de lista de contatos', () => {
  it('reconhece os cabeçalhos mais comuns, com ou sem acento', () => {
    const m = guessMapping(['Nome', 'Razão Social', 'WhatsApp', 'E-mail', 'CNPJ/CPF', 'Observações', 'Coluna X']);
    expect(m).toMatchObject({ name: 0, company: 1, phone: 2, email: 3, tax_id: 4, message: 5, interest: -1, product: -1 });
  });
  it('não usa a mesma coluna para dois campos', () => {
    const m = guessMapping(['Contato', 'Telefone']);
    expect(m.name).toBe(0); expect(m.phone).toBe(1);
  });
  it('mantém telefone numérico do Excel sem notação científica', () => {
    expect(toCell(14991570389)).toBe('14991570389');
    expect(toCell('  (14) 99157-0389 ')).toBe('(14) 99157-0389');
    expect(toCell(null)).toBe('');
  });
  it('monta as linhas (ignora vazias) e numera como na planilha', () => {
    const data = [['Nome', 'Tel'], ['Ana', 11999990000], ['', ''], ['Bruno', '']];
    const rows = buildRows(data, guessMapping(data[0]));
    expect(rows.map((r) => [r.n, r.name, r.phone])).toEqual([[2, 'Ana', '11999990000'], [4, 'Bruno', '']]);
  });
  it('valida nome, contato e e-mail', () => {
    expect(validateRow({ name: 'A', phone: '1', email: '' })).toBe('sem nome');
    expect(validateRow({ name: 'Ana', phone: '', email: '' })).toBe('sem telefone nem e-mail');
    expect(validateRow({ name: 'Ana', phone: '', email: 'ana@x' })).toBe('e-mail inválido');
    expect(validateRow({ name: 'Ana', phone: '(14) 9', email: '' })).toBeNull();
  });
  it('interpreta o interesse', () => {
    expect(interestOf('Projeto exclusivo')).toBe('projeto_exclusivo');
    expect(interestOf('')).toBe('produto_existente');
  });
});

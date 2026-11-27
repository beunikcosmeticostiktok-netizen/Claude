import { describe, expect, it } from 'vitest';
import { formatTaxId, parseMoney } from './format';

describe('parseMoney (formato brasileiro)', () => {
  it('aceita vírgula, ponto e milhar', () => {
    expect(parseMoney('3,20')).toBe(3.2);
    expect(parseMoney('3.2')).toBe(3.2);
    expect(parseMoney('1.234,56')).toBe(1234.56);
    expect(parseMoney('R$ 2,10')).toBe(2.1);
    expect(parseMoney('0')).toBe(0);
  });
  it('vazio vira null e lixo vira NaN', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(Number.isNaN(parseMoney('abc'))).toBe(true);
    expect(Number.isNaN(parseMoney('1,2,3'))).toBe(true);
  });
});
describe('formatTaxId', () => {
  it('formata CNPJ e CPF', () => {
    expect(formatTaxId('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatTaxId('52998224725')).toBe('529.982.247-25');
  });
});

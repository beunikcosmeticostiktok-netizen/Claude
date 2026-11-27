import { describe, expect, it } from 'vitest';
import { calcularCusto, descontoLivreMaximoPct, precisaAprovacao, round2, type CostInput } from './cost';

const base: CostInput = {
  pesoPecaKg: 0.02, precoKgMateriaPrima: 10, perdaPct: 10,
  cicloSegundos: 36, cavidades: 1, eficienciaPct: 100,
  custoHoraMaquina: 100, operadoresPorMaquina: 2, custoHoraMaoObra: 20,
  horasSetup: 1, loteQtd: 1000, embalagemUnit: 0.05, terceirizadoUnit: 0,
  despesasFixasMensais: 20000, horasProdutivasMes: 400,
  markupMinimo: 1.5, aliquotaSimplesPct: 10, comissaoPct: 2,
};

describe('motor de custo', () => {
  const r = calcularCusto(base);
  it('calcula cada bloco (conferido à mão)', () => {
    expect(r.materiaPrima).toBeCloseTo(0.22, 6);
    expect(r.processo).toBeCloseTo(1.0, 6);       // 0,01 h x R$100
    expect(r.maoDeObra).toBeCloseTo(0.4, 6);      // 0,01 h x 2 x R$20
    expect(r.despesaFixa).toBeCloseTo(0.5, 6);    // 0,01 h x (20000/400)
    expect(r.preparacao).toBeCloseTo(0.14, 6);    // 1h x (100+40) / 1000
  });
  it('custo direto, completo e preço mínimo (markup 1,5 sobre o custo completo)', () => {
    expect(r.custoDireto).toBeCloseTo(1.67, 6);
    expect(r.custoCompleto).toBeCloseTo(2.31, 6);
    expect(r.precoMinimo).toBe(3.47);
  });
  it('imposto do Simples está dentro do markup: resultado após imposto e comissão', () => {
    expect(r.resultadoAposImposto(3.47)).toBeCloseTo(0.7436, 4);
  });
  it('markup efetivo de um preço', () => {
    expect(r.markupDe(3.465)).toBeCloseTo(1.5, 6);
  });
  it('cavidades e eficiência reduzem o tempo por peça', () => {
    const r2 = calcularCusto({ ...base, cavidades: 2, eficienciaPct: 50 });
    expect(r2.processo).toBeCloseTo(1.0, 6);
  });
  it('alerta quando o resultado fica negativo ou o Simples não foi informado', () => {
    const ruim = calcularCusto({ ...base, markupMinimo: 1.0, aliquotaSimplesPct: 12 });
    expect(ruim.alertas.some((a) => a.includes('zero ou negativo'))).toBe(true);
    expect(calcularCusto({ ...base, aliquotaSimplesPct: 0 }).alertas.some((a) => a.includes('Alíquota'))).toBe(true);
  });
  it('recusa parâmetros inválidos', () => {
    expect(() => calcularCusto({ ...base, cavidades: 0 })).toThrow();
    expect(() => calcularCusto({ ...base, horasProdutivasMes: 0 })).toThrow();
    expect(() => calcularCusto({ ...base, eficienciaPct: 0 })).toThrow();
    expect(() => calcularCusto({ ...base, precoKgMateriaPrima: -1 })).toThrow();
  });
});

describe('regras de desconto e aprovação (iguais às do banco)', () => {
  it('arredonda a centavos como o numeric do PostgreSQL', () => {
    expect(round2(3.465)).toBe(3.47);
    expect(round2(2.675)).toBe(2.68);
  });
  it('desconto livre até o markup mínimo', () => {
    expect(descontoLivreMaximoPct(4.0, 2.0, 1.5)).toBeCloseTo(25, 6);
    expect(descontoLivreMaximoPct(3.0, 2.0, 1.5)).toBe(0);
  });
  it('exige aprovação abaixo do mínimo ou sem custo conhecido', () => {
    expect(precisaAprovacao(2.9, 2.0, 1.5)).toBe(true);
    expect(precisaAprovacao(3.0, 2.0, 1.5)).toBe(false);
    expect(precisaAprovacao(10, null, 1.5)).toBe(true);
  });
});

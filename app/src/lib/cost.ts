/**
 * Motor de cálculo de custo e preço mínimo.
 * ESTRUTURA sugerida (docs/sistema-gestao/02 §3): todos os valores vêm de parâmetros da empresa.
 * Regras decididas: markup mínimo sobre o CUSTO COMPLETO (após todas as despesas); o imposto do
 * Simples está DENTRO do markup (não é somado ao preço); rateio das despesas fixas por hora-máquina.
 */
export type CostInput = {
  pesoPecaKg: number;
  precoKgMateriaPrima: number;
  perdaPct: number;
  cicloSegundos: number;
  cavidades: number;
  eficienciaPct: number;
  custoHoraMaquina: number;
  operadoresPorMaquina: number;
  custoHoraMaoObra: number;
  horasSetup: number;
  loteQtd: number;
  embalagemUnit: number;
  terceirizadoUnit: number;
  despesasFixasMensais: number;
  horasProdutivasMes: number;
  markupMinimo: number;
  aliquotaSimplesPct: number;
  comissaoPct: number;
};

export type CostResult = {
  materiaPrima: number;
  processo: number;
  maoDeObra: number;
  preparacao: number;
  embalagem: number;
  terceirizado: number;
  despesaFixa: number;
  custoDireto: number;
  custoCompleto: number;
  precoMinimo: number;
  /** Resultado estimado por unidade ao preço informado, depois de imposto e comissão. */
  resultadoAposImposto: (preco: number) => number;
  markupDe: (preco: number) => number | null;
  alertas: string[];
};

/** Arredondamento a centavos igual ao do banco (numeric: metade para longe do zero). */
export const round2 = (x: number) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;

const positivo = (n: number, nome: string, erros: string[]) => {
  if (!Number.isFinite(n) || n < 0) erros.push(`${nome} inválido`);
};

export function calcularCusto(i: CostInput): CostResult {
  const erros: string[] = [];
  (Object.entries(i) as [string, number][]).forEach(([k, v]) => positivo(v, k, erros));
  if (i.cavidades < 1) erros.push('cavidades deve ser >= 1');
  if (i.eficienciaPct <= 0 || i.eficienciaPct > 100) erros.push('eficienciaPct deve estar entre 0 e 100');
  if (i.loteQtd < 1) erros.push('loteQtd deve ser >= 1');
  if (i.horasProdutivasMes <= 0) erros.push('horasProdutivasMes deve ser > 0');
  if (i.markupMinimo < 1) erros.push('markupMinimo deve ser >= 1');
  if (erros.length) throw new Error('Parâmetros inválidos: ' + erros.join('; '));

  const horasPorPeca = (i.cicloSegundos / i.cavidades / 3600) / (i.eficienciaPct / 100);
  const despesaFixaPorHora = i.despesasFixasMensais / i.horasProdutivasMes;

  const materiaPrima = i.pesoPecaKg * (1 + i.perdaPct / 100) * i.precoKgMateriaPrima;
  const processo = horasPorPeca * i.custoHoraMaquina;
  const maoDeObra = horasPorPeca * i.operadoresPorMaquina * i.custoHoraMaoObra;
  const preparacao = (i.horasSetup * (i.custoHoraMaquina + i.operadoresPorMaquina * i.custoHoraMaoObra)) / i.loteQtd;
  const despesaFixa = horasPorPeca * despesaFixaPorHora;

  const custoDireto = materiaPrima + processo + maoDeObra + i.embalagemUnit + i.terceirizadoUnit;
  const custoCompleto = custoDireto + preparacao + despesaFixa;
  const precoMinimo = round2(custoCompleto * i.markupMinimo);

  const alertas: string[] = [];
  const resultadoAposImposto = (preco: number) =>
    preco - custoCompleto - (preco * i.aliquotaSimplesPct) / 100 - (preco * i.comissaoPct) / 100;
  if (resultadoAposImposto(precoMinimo) <= 0) {
    alertas.push('Com o markup mínimo, o resultado após imposto e comissão é zero ou negativo. Revise o markup ou os parâmetros.');
  }
  if (i.aliquotaSimplesPct === 0) alertas.push('Alíquota do Simples não informada (0%): o resultado após imposto está superestimado.');

  return {
    materiaPrima, processo, maoDeObra, preparacao, embalagem: i.embalagemUnit, terceirizado: i.terceirizadoUnit,
    despesaFixa, custoDireto, custoCompleto, precoMinimo, resultadoAposImposto,
    markupDe: (preco) => (custoCompleto > 0 ? preco / custoCompleto : null), alertas,
  };
}

/** Desconto livre enquanto o preço mantiver o markup mínimo. */
export const descontoLivreMaximoPct = (precoLista: number, custoCompleto: number, markupMinimo: number) =>
  precoLista <= 0 ? 0 : Math.max(0, (1 - round2(custoCompleto * markupMinimo) / precoLista) * 100);

export const precisaAprovacao = (precoUnit: number, custoCompleto: number | null, markupMinimo: number) =>
  custoCompleto == null || precoUnit < round2(custoCompleto * markupMinimo);

'use client';
import { useMemo, useState } from 'react';
import { calcularCusto, type CostInput } from '@/lib/cost';

const num = (s: string) => { const t = s.trim().replace(',', '.'); return t === '' ? NaN : Number(t); };
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });

const FIELDS: [keyof CostInput, string, string][] = [
  ['pesoPecaKg', 'Peso da peça (kg)', '0,024'], ['precoKgMateriaPrima', 'Preço da matéria-prima (R$/kg)', ''], ['perdaPct', 'Perda prevista (%)', ''],
  ['cicloSegundos', 'Tempo de ciclo (s)', ''], ['cavidades', 'Cavidades do molde', '1'], ['eficienciaPct', 'Eficiência (%)', '100'],
  ['custoHoraMaquina', 'Custo da hora-máquina (R$)', ''], ['operadoresPorMaquina', 'Operadores por máquina', ''], ['custoHoraMaoObra', 'Custo da hora de mão de obra (R$)', ''],
  ['horasSetup', 'Horas de preparação (setup)', ''], ['loteQtd', 'Tamanho do lote (peças)', ''], ['embalagemUnit', 'Embalagem (R$/peça)', '0'],
  ['terceirizadoUnit', 'Terceirizado (R$/peça)', '0'], ['despesasFixasMensais', 'Despesas fixas do mês (R$)', ''], ['horasProdutivasMes', 'Horas produtivas previstas no mês', ''],
  ['markupMinimo', 'Markup mínimo', '1,5'], ['aliquotaSimplesPct', 'Alíquota do Simples (%)', '0'], ['comissaoPct', 'Comissão (%)', '0'],
];

export function Calculadora() {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map(([k, , d]) => [k, d])));
  const [preco, setPreco] = useState('');
  const out = useMemo(() => {
    const input = Object.fromEntries(FIELDS.map(([k]) => [k, num(v[k])])) as unknown as CostInput;
    if (Object.values(input).some((x) => Number.isNaN(x))) return { erro: 'Preencha todos os campos com números.' } as const;
    try { return { r: calcularCusto(input) } as const; } catch (e) { return { erro: (e as Error).message } as const; }
  }, [v]);
  const p = num(preco);

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card stack">
        <h2>Parâmetros</h2>
        <div className="grid2">
          {FIELDS.map(([k, label]) => (
            <label key={k}>{label}<input inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
          ))}
        </div>
      </div>
      <div className="card stack" style={{ position: 'sticky', top: 16 }}>
        <h2>Resultado por peça</h2>
        {'erro' in out ? <div className="alert warn">{out.erro}</div> : (
          <>
            <table className="table"><tbody>
              {([['Matéria-prima', out.r.materiaPrima], ['Processo (hora-máquina)', out.r.processo], ['Mão de obra', out.r.maoDeObra],
                ['Preparação rateada', out.r.preparacao], ['Embalagem', out.r.embalagem], ['Terceirizado', out.r.terceirizado],
                ['Despesas fixas rateadas', out.r.despesaFixa]] as [string, number][]).map(([l, n]) => (
                <tr key={l}><td>{l}</td><td className="right">{brl(n)}</td></tr>))}
              <tr><td><b>Custo completo</b></td><td className="right"><b>{brl(out.r.custoCompleto)}</b></td></tr>
              <tr><td><b>Preço mínimo (markup {v.markupMinimo})</b></td><td className="right"><b>{brl(out.r.precoMinimo)}</b></td></tr>
            </tbody></table>
            {out.r.alertas.map((a) => <div key={a} className="alert warn">{a}</div>)}
            <label>Testar um preço de venda (R$)<input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
            {!Number.isNaN(p) && p > 0 && (
              <div className="small">
                Markup: <b>{out.r.markupDe(p)?.toFixed(2)}</b> ·
                Resultado após imposto e comissão: <b>{brl(out.r.resultadoAposImposto(p))}</b>/peça
                {out.r.markupDe(p)! < Number(v.markupMinimo.replace(',', '.')) && <div className="alert err" style={{ marginTop: 8 }}>Abaixo do markup mínimo: exigirá aprovação do gestor.</div>}
              </div>
            )}
            <p className="muted small">Use o <b>custo completo</b> no campo “custo” do item do orçamento. Os parâmetros são da empresa; nada aqui é gravado.</p>
          </>
        )}
      </div>
    </div>
  );
}

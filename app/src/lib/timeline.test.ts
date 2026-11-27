import { describe, expect, it } from 'vitest';
import { buildTimeline } from './timeline';
import { dbErrorKey } from './labels';

const base = { channel: 'orcamento', status_commercial: 'aprovado', status_financial: 'aguardando_sinal', deposit_required: true,
  status_production: 'nao_liberado', status_logistics: 'aguardando' };
const done = (o: Parameters<typeof buildTimeline>[0]) => buildTimeline(o).filter((s) => s.done).map((s) => s.label);

describe('linha do tempo do cliente', () => {
  it('pedido recém-aprovado: só enviado e aprovado; condições iniciais pendentes', () => {
    expect(done(base)).toEqual(['Orçamento enviado', 'Aprovado']);
  });
  it('sinal pago libera a etapa de condições iniciais', () => {
    expect(done({ ...base, status_financial: 'sinal_pago' })).toContain('Condições iniciais atendidas');
  });
  it('sem sinal exigido, as condições iniciais já estão atendidas', () => {
    expect(done({ ...base, deposit_required: false })).toContain('Condições iniciais atendidas');
  });
  it('produção e coleta avançam as etapas', () => {
    const o = { ...base, status_financial: 'quitado', status_production: 'concluido', status_logistics: 'coletado' };
    expect(buildTimeline(o).every((s) => s.done)).toBe(true);
  });
  it('pronta entrega (loja) não tem etapas de fabricação', () => {
    const t = buildTimeline({ ...base, channel: 'loja', status_financial: 'quitado' });
    expect(t.map((s) => s.label)).toEqual(['Pedido recebido', 'Pagamento confirmado', 'Pronto para coleta', 'Coletado']);
    expect(t.some((s) => /produ/i.test(s.label))).toBe(false);
  });
});
describe('erros do banco', () => {
  it('reconhece a chave do erro dentro da mensagem', () => {
    expect(dbErrorKey('xyz needs_internal_approval abc')).toBe('needs_internal_approval');
    expect(dbErrorKey('algo inesperado')).toBe('falha');
  });
});

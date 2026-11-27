export type OrderLike = {
  channel: string; status_commercial: string; status_financial: string; deposit_required: boolean;
  status_production: string; status_logistics: string;
};
export type Step = { label: string; done: boolean };

/** Linha do tempo do cliente. Pedidos de pronta entrega (loja) não têm etapas de fabricação. */
export function buildTimeline(o: OrderLike): Step[] {
  const paid = !o.deposit_required || ['sinal_pago', 'quitado'].includes(o.status_financial);
  const prodStarted = ['programado', 'em_producao', 'concluido', 'parcial'].includes(o.status_production);
  const prodRunning = ['em_producao', 'concluido', 'parcial'].includes(o.status_production);
  const prodDone = o.status_production === 'concluido';
  const readyOrBeyond = ['pronto_coleta', 'coleta_agendada', 'coletado_parcial', 'coletado'].includes(o.status_logistics);
  const collected = o.status_logistics === 'coletado';
  if (o.channel === 'loja') {
    return [
      { label: 'Pedido recebido', done: true }, { label: 'Pagamento confirmado', done: paid },
      { label: 'Pronto para coleta', done: readyOrBeyond }, { label: 'Coletado', done: collected },
    ];
  }
  return [
    { label: 'Orçamento enviado', done: true }, { label: 'Aprovado', done: o.status_commercial !== 'cancelado' },
    { label: 'Condições iniciais atendidas', done: paid }, { label: 'Produção programada', done: prodStarted },
    { label: 'Em produção', done: prodRunning }, { label: 'Controle de qualidade', done: prodDone },
    { label: 'Pronto para coleta', done: readyOrBeyond }, { label: 'Coletado', done: collected },
  ];
}

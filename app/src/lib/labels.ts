export const QUOTE_STATUS: Record<string, string> = {
  rascunho: 'Rascunho', aguardando_aprovacao: 'Aguardando aprovação interna', enviado: 'Enviado',
  em_negociacao: 'Em negociação', aprovado: 'Aprovado', recusado: 'Recusado', expirado: 'Expirado', substituida: 'Substituída',
};
export const quoteBadge = (s: string) =>
  s === 'aprovado' ? 'on' : s === 'recusado' || s === 'expirado' ? 'off' : s === 'enviado' || s === 'em_negociacao' ? 'acc' : '';

export const AXES = {
  commercial: { label: 'Comercial', values: { aprovado: 'Aprovado', em_ajuste: 'Em ajuste', cancelado: 'Cancelado' } },
  financial: { label: 'Financeiro', values: { sem_cobranca: 'Sem cobrança', aguardando_sinal: 'Aguardando sinal', sinal_pago: 'Sinal pago', parcial: 'Pago parcialmente', quitado: 'Quitado', inadimplente: 'Inadimplente' } },
  production: { label: 'Produção', values: { nao_liberado: 'Não liberado', liberado: 'Liberado', programado: 'Programado', em_producao: 'Em produção', concluido: 'Concluído', parcial: 'Parcial' } },
  logistics: { label: 'Logística', values: { aguardando: 'Aguardando', disponivel_separacao: 'Disponível p/ separação', separado: 'Separado', pronto_coleta: 'Pronto p/ coleta', coleta_agendada: 'Coleta agendada', coletado_parcial: 'Coletado parcialmente', coletado: 'Coletado' } },
} as const;
export type Axis = keyof typeof AXES;
export const axisValue = (axis: Axis, v: string) => (AXES[axis].values as Record<string, string>)[v] ?? v;

/** Mensagens amigáveis para os erros levantados pelas funções do banco. */
export const DB_ERRORS: Record<string, string> = {
  needs_internal_approval: 'Há item abaixo do markup mínimo (ou sem custo informado). Solicite a aprovação do gestor antes de enviar.',
  valid_until_required: 'Informe uma validade futura para o orçamento.',
  no_items: 'Adicione pelo menos um item.',
  version_locked: 'Esta versão já foi enviada e não pode ser alterada. Crie uma nova versão.',
  draft_exists: 'Já existe uma versão em rascunho.',
  approval_not_required: 'Não precisa de aprovação interna: todos os itens estão dentro do markup mínimo.',
  not_waiting_approval: 'Esta versão não está aguardando aprovação.',
  note_required: 'Escreva a justificativa.',
  not_approvable: 'Esta versão não pode mais ser aprovada (já respondida, substituída ou vencida).',
  expired: 'O prazo de validade deste orçamento terminou. Peça uma nova versão.',
  not_found: 'Registro não encontrado.',
  release_blocked: 'Liberação bloqueada: faltam condições. Só gestor ou administrador libera, com justificativa.',
  invoice_required: 'Registre a nota fiscal antes de agendar ou registrar a coleta.',
  carrier_required: 'O cliente precisa indicar a transportadora antes de agendar a coleta (frete FOB).',
  order_in_progress: 'O pedido já está em produção ou coleta e não pode ser cancelado.',
  order_cancelled: 'Este pedido está cancelado.',
  order_locked: 'A coleta já foi agendada: não é mais possível alterar a transportadora.',
  reason_required: 'Informe o motivo.',
  invoice_key: 'A chave da nota fiscal precisa ter 44 números.',
  forbidden: 'Você não tem permissão para esta ação.',
  loss_reason_required: 'Informe o motivo da perda.',
  number_required: 'Informe o número da nota.',
  name_required: 'Informe o nome da transportadora.',
  insufficient_available: 'Quantidade maior que o disponível (o que está reservado para pedidos não sai).',
  insufficient_stock: 'Saldo insuficiente neste local.',
  invalid_qty: 'Quantidade inválida.', invalid_kind: 'Tipo de movimento inválido.',
  already_reversed: 'Este movimento já foi estornado.', cannot_reverse_reversal: 'Um estorno não pode ser estornado.',
  exceeds_order: 'A reserva ultrapassa a quantidade do pedido.', not_active: 'Reserva já encerrada.',
  po_locked: 'Pedido de compra já aprovado: as linhas não podem mais mudar.', not_draft: 'O pedido de compra não está em rascunho.',
  not_approved: 'O pedido precisa ser aprovado antes de enviar.', has_receipts: 'Já houve recebimento: não é possível cancelar.',
  not_cancellable: 'Este pedido de compra não pode mais ser cancelado.', not_receivable: 'Este pedido de compra não está liberado para recebimento.',
  over_receipt: 'A quantidade recebida passa do que foi comprado.', key_required: 'Atualize a página e tente de novo.',
  supplier_not_found: 'Fornecedor não encontrado.', line_not_found: 'Linha não encontrada.',
  suppliers_tax_id_uk: 'Já existe um fornecedor com este CNPJ/CPF.', suppliers_tax_id_valid: 'CNPJ/CPF inválido.',
};
export const dbErrorKey = (m?: string | null) => Object.keys(DB_ERRORS).find((k) => m?.includes(k)) ?? 'falha';
export const dbErrorText = (k?: string) => (k && DB_ERRORS[k]) || (k ? 'Não foi possível concluir a ação.' : '');

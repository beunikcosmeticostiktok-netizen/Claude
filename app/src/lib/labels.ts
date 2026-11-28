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
  po_locked: 'Pedido de compra já aprovado: as linhas não podem mais mudar.', not_draft: 'Este registro não está mais em rascunho.',
  not_approved: 'O pedido precisa ser aprovado antes de enviar.', has_receipts: 'Já houve recebimento: não é possível cancelar.',
  not_cancellable: 'Este pedido de compra não pode mais ser cancelado.', not_receivable: 'Este pedido de compra não está liberado para recebimento.',
  over_receipt: 'A quantidade recebida passa do que foi comprado.', key_required: 'Atualize a página e tente de novo.',
  supplier_not_found: 'Fornecedor não encontrado.', line_not_found: 'Linha não encontrada.',
  item_not_producible: 'Este item não é um produto do catálogo e não pode ir para produção.',
  mold_unavailable: 'Molde indisponível (em manutenção ou inativo).', mold_machine_incompatible: 'Este molde não é compatível com a máquina escolhida.',
  order_not_released: 'O pedido ainda não foi liberado para produção (sinal e demais condições).', not_planned: 'A ordem não está mais planejada.',
  po_not_active: 'A ordem de produção não está ativa para esta ação.', exceeds_produced: 'A quantidade inspecionada passa do que foi produzido (descontado o refugo).',
  short_note_required: 'A ordem foi produzida a menos do planejado: escreva o motivo para concluir.', invalid_transition: 'Esta mudança de situação não é permitida agora.',
  payment_required: 'Este pedido exige pagamento integral confirmado antes da separação/coleta.', schedule_required: 'Informe a data e hora da coleta.',
  shipment_not_found: 'Separação não encontrada.', item_not_found: 'Item do pedido não encontrado.', invalid_action: 'Ação inválida.',
  title_closed: 'Este título já está quitado ou cancelado.', exceeds_balance: 'O valor (somado ao desconto) passa do saldo do título.',
  invalid_amount: 'Valor inválido.', account_not_found: 'Conta não encontrada ou inativa.', payment_not_found: 'Pagamento não encontrado.',
  due_required: 'Informe o vencimento do saldo.', nothing_to_charge: 'Não há valor a cobrar.', has_payments: 'O título tem pagamentos: estorne antes de cancelar.',
  mismatch: 'O valor ou a conta do extrato não confere com o lançamento.', already_matched: 'Esta linha do extrato já foi conciliada.',
  movement_already_matched: 'Este lançamento já foi conciliado com outra linha.', proof_closed: 'Este comprovante já foi analisado.',
  receipt_not_found: 'Recebimento não encontrado.', invalid_regime: 'Escolha caixa ou competência.', title_not_found: 'Título não encontrado.',
  order_not_found: 'Pedido não encontrado.', proof_not_found: 'Comprovante não encontrado.',
  briefing_required: 'Preencha o briefing antes de avançar.', not_feasible: 'A viabilidade precisa estar registrada como viável.',
  wrong_stage: 'Esta ação não vale na etapa atual do projeto.', version_not_approved: 'O cliente ainda não aprovou uma versão técnica.',
  sample_required: 'Crie ao menos uma amostra da versão aprovada.', sample_not_sent: 'Envie a amostra ao cliente antes de avançar.',
  sample_not_approved: 'A amostra precisa estar aprovada para liberar o projeto.', requirements_required: 'Escreva os requisitos da versão.',
  not_sendable: 'Esta amostra não pode ser enviada agora.', not_open: 'Este item não está mais aguardando resposta.',
  project_not_released: 'O projeto exclusivo ainda não está liberado: a produção só começa depois da aprovação técnica e da amostra.',
  project_not_found: 'Projeto não encontrado.', version_not_found: 'Versão não encontrada.',
  project_files_url_check: 'Informe um link que comece com http:// ou https://.', customer_not_found: 'Cliente não encontrado.',
  lead_nome: 'Informe o nome do contato.', lead_contato: 'Informe ao menos o telefone/WhatsApp ou o e-mail.',
  suppliers_tax_id_uk: 'Já existe um fornecedor com este CNPJ/CPF.', suppliers_tax_id_valid: 'CNPJ/CPF inválido.',
  invalid_tax_id: 'CPF/CNPJ inválido.', contact_required: 'Informe telefone/WhatsApp ou e-mail.',
  invalid_shipping: 'Escolha o tipo de frete.', item_unavailable: 'Um dos produtos não está mais disponível.',
  below_minimum: 'Quantidade abaixo do mínimo de um produto.', invalid_multiple: 'A quantidade precisa ser múltipla da embalagem.',
  above_limit: 'Acima do limite da loja para um produto: fale com um vendedor.',
  rate_limited: 'Muitos pedidos em pouco tempo. Tente novamente mais tarde.', no_price: 'Produto sem preço cadastrado.',
  not_received: 'A devolução só é possível depois do recebimento da mercadoria.', return_window_closed: 'O prazo de devolução terminou.',
  already_requested: 'Já existe uma devolução em andamento para este pedido.',
  target_not_found: 'Este vendedor não tem meta cadastrada nesse mês.', month_not_over: 'Só é possível fechar meses já encerrados.',
  already_closed: 'Este mês já foi fechado para o vendedor. Cancele a apuração para refazer.', nothing_to_pay: 'A comissão é zero: não há o que pagar.',
  return_not_found: 'Devolução não encontrada.',
};
export const dbErrorKey = (m?: string | null) => Object.keys(DB_ERRORS).find((k) => m?.includes(k)) ?? 'falha';
export const dbErrorText = (k?: string) => (k && DB_ERRORS[k]) || (k ? 'Não foi possível concluir a ação.' : '');

export const PRODUCTION_STATUS: Record<string, string> = { planejada: 'Planejada', liberada: 'Liberada', em_producao: 'Em produção', pausada: 'Pausada', concluida: 'Concluída', cancelada: 'Cancelada' };
export const SHIPMENT_STATUS: Record<string, string> = { separado: 'Separado', pronto_coleta: 'Pronto para coleta', coleta_agendada: 'Coleta agendada', coletado: 'Coletado', cancelado: 'Cancelado' };

export const PROJECT_STAGES: [string, string][] = [
  ['briefing', 'Briefing'], ['viabilidade', 'Viabilidade'], ['proposta', 'Proposta'], ['desenvolvimento', 'Desenvolvimento'],
  ['amostra', 'Amostra'], ['aprovacao_amostra', 'Aprovação da amostra'], ['liberado', 'Liberado'],
];
export const PROJECT_STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(PROJECT_STAGES), recusado: 'Recusado', cancelado: 'Cancelado' };
export const PROJECT_NEXT: Record<string, string[]> = {
  briefing: ['viabilidade'], viabilidade: ['proposta', 'recusado'], proposta: ['desenvolvimento'], desenvolvimento: ['amostra'],
  amostra: ['aprovacao_amostra'], aprovacao_amostra: ['liberado', 'desenvolvimento'],
};

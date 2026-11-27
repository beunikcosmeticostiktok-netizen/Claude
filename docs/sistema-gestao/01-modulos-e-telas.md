# 01 — Mapa de módulos e telas

Legenda de etapa: **E1** fundação e comercial · **E2** operação industrial · **E3** financeiro · **E4** integrações · **L** loja.

## Módulos

| # | Módulo | Etapa | Principais telas |
|---|---|---|---|
| 1 | Acesso e administração | E1 | Login, convite de usuário, usuários e perfis, regras e limites, funil, auditoria |
| 2 | CRM | E1 | Funil (kanban), lista de oportunidades, empresa, contato, atividades/tarefas, leads recebidos |
| 3 | Catálogo e produtos | E1 | Lista de itens, ficha do item (técnica, variantes, preços por faixa, imagens, documentos) |
| 4 | **Custos e cotação** | E1 | Parâmetros de custo, ficha de custo por item/linha de orçamento, simulador |
| 5 | Orçamentos | E1 | Lista, editor de versão, comparação de versões, aprovação interna, PDF, histórico |
| 6 | Pedidos | E1 | Lista, pedido (4 status separados), condições e liberações |
| 7 | Portal do cliente | E1→ | Início, orçamentos, pedidos, linha do tempo, documentos, mensagens, financeiro (E3) |
| 8 | Projetos exclusivos | E2 | Kanban do projeto, briefing, arquivos/versões, viabilidade, amostras, aprovações |
| 9 | Moldes e máquinas | E2 | Cadastro de moldes (propriedade, local, manutenção), máquinas, compatibilidade |
| 10 | Produção | E2 | Programação, ordens de produção, apontamento, qualidade, ocorrências |
| 11 | Estoque | E2 | Saldos, movimentações, reservas, inventário, alertas |
| 12 | Compras e fornecedores | E2 | Solicitação, cotação comparativa, pedido de compra, recebimento/conferência |
| 13 | Expedição e coleta | E2 | Separação, volumes, coleta, parciais, comprovantes |
| 14 | Financeiro | E3 | Contas a pagar/receber, caixa, conciliação manual, fluxo, resultado |
| 15 | Painéis e notificações | E1→E3 | Painéis por perfil, central de notificações |
| 16 | **Loja de produtos de linha** | L | Vitrine, produto, carrinho, checkout, minha conta, meus pedidos |
| 17 | Integrações | E4 | Pix/boleto, NF-e, e-mail, WhatsApp — cada uma com configuração e registro de envio |

## Telas por perfil (navegação inicial)

| Perfil | Menu principal |
|---|---|
| Administrador | Tudo + Configurações, Usuários, Regras, Auditoria |
| Gestor | Painel executivo, Aprovações pendentes, Orçamentos, Pedidos, Relatórios |
| Comercial | Painel comercial, CRM, Clientes, Orçamentos, Pedidos (os seus, ou todos conforme regra) |
| Produção | Programação, Ordens, Apontamento, Ocorrências, Moldes/Máquinas |
| Estoque e expedição | Saldos, Movimentações, Reservas, Separação, Coletas |
| Compras | Solicitações, Cotações, Pedidos de compra, Recebimentos, Fornecedores |
| Financeiro | Contas a receber/pagar, Caixa, Conciliação, Fluxo, Resultado |
| Cliente | Início, Orçamentos, Pedidos, Documentos, Mensagens, Financeiro |

## Telas-chave da Etapa 1

1. **Leads recebidos**: origem (landing/loja/WhatsApp), tipo de interesse, status, botão "converter em oportunidade", alerta de possível duplicidade.
2. **Funil**: kanban configurável; arrastar muda a etapa e exige motivo ao marcar *Perdido*.
3. **Ficha de custo** (somente interno): blocos de matéria-prima, processo, mão de obra, preparação, embalagem, terceirizados, despesas fixas, impostos/margem; mostra **custo**, **preço sugerido** e **margem**; alerta se a margem estiver abaixo do mínimo definido.
4. **Editor de orçamento**: itens, quantidades, faixas de preço, desconto, frete, condições, validade, prazo; área de *observações internas* separada; botão "enviar para aprovação interna" quando a regra exigir.
5. **Versões**: lista e comparação campo a campo; versão enviada fica imutável.
6. **Portal — orçamento**: valores, condições, anexos técnicos; **Aprovar esta versão** ou **Solicitar alteração**; registra usuário, versão e data.
7. **Pedido**: quatro status independentes (comercial, financeiro, produção, logística), itens, condições, liberações exigidas.

## Experiência no celular

- Telas de apontamento de produção, separação/coleta e aprovação no portal são desenhadas **primeiro para celular**.
- Tabelas viram cartões; filtros ficam em painel recolhível; ações principais em barra fixa inferior.

## Loja (visão de telas)

Vitrine por categoria (pets, cabelo, embalagens, tampas) · página do produto (fotos, medidas, cores, múltiplos de venda, preço por faixa, disponibilidade) · carrinho · checkout (endereço, frete, pagamento) · minha conta (pedidos, segunda via, recompra) · e-mail/aviso de status. Detalhes de regra em `02` §Loja.

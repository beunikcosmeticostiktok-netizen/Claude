# 02 — Fluxos e regras de transição

Convenção: valores entre **[colchetes]** são **parâmetros configuráveis** a definir pela empresa.

## 1. Lead → oportunidade

1. A landing envia o formulário a uma **função de servidor** (nunca direto ao banco).
2. Proteções: campo isca (honeypot), verificação anti-robô (Cloudflare Turnstile ou similar), limite de envios por IP/telefone, validação de campos.
3. O lead recebe `tipo_interesse`: **produto existente** ou **projeto exclusivo**.
4. **Deduplicação**: chave por CNPJ/CPF quando informado; senão telefone normalizado e e-mail. Se houver cadastro/oportunidade aberta, o lead é **anexado** à existente e o responsável é avisado; não cria registro paralelo.
5. Cria (ou vincula) empresa e contato, abre **oportunidade** na etapa *Novo contato* e **notifica o responsável** (regra de distribuição **[a definir]**).

## 2. Funil comercial (configurável)

`Novo contato → Qualificação → Levantamento da necessidade → Orçamento em elaboração → Orçamento enviado → Negociação → Ganho | Perdido`

- Etapas são dados (tabela), não código: o administrador cria, renomeia, ordena.
- *Perdido* exige **motivo** (lista configurável). *Ganho* exige orçamento aprovado ou pedido criado **[confirmar]**.
- Tarefas, próximo contato e lembretes ficam ligados à oportunidade; vencidos geram notificação.

## 3. Cotação por custo (ficha de custo)

### Estrutura (a validar com a empresa e a contabilidade)

A ficha de custo é composta de **linhas tipadas**, todas alimentadas por **parâmetros versionados**. Cada versão de parâmetros tem estado *Rascunho → Validado* e guarda quem validou e quando. Orçamentos guardam um **retrato (snapshot)** dos parâmetros usados.

| Bloco | O que registra | Parâmetros envolvidos |
|---|---|---|
| Matéria-prima | resina/insumo, consumo por peça, **perda prevista**, preço | preço/kg [fornecedor ou média], perda % |
| Processo (hora-máquina) | tempo de ciclo, cavidades, eficiência | custo/hora por máquina |
| Mão de obra | operadores por máquina, tempo | custo/hora de mão de obra [com ou sem encargos] |
| Preparação | setup/troca de molde, lote mínimo | horas de setup, rateio por lote |
| Embalagem | caixa, saco, etiqueta | custo unitário |
| Terceirizados | serviços externos | valor por unidade/lote |
| Despesas fixas | rateio sobre a produção | **método de rateio [a definir]** |
| Impostos e comissão | percentuais | **regime tributário [a confirmar com contador]** |
| Margem | margem desejada e mínima | % por categoria/cliente |

### Esqueleto do cálculo (ilustrativo, não definitivo)

```
custo_unit = materia_prima + processo + mao_de_obra
           + preparacao_rateada + embalagem + terceirizados + despesa_fixa_rateada

materia_prima = peso_peca × (1 + perda%) × preco_kg
processo      = (tempo_ciclo / cavidades) × custo_hora_maquina ÷ eficiência
mao_de_obra   = (tempo_ciclo / cavidades) × operadores × custo_hora_MO ÷ eficiência
preparacao    = (horas_setup × (custo_hora_maquina + custo_hora_MO)) ÷ quantidade_do_lote
```

**Preço**: o sistema deve suportar **markup** ou **margem sobre preço** (escolha **[a definir]**), somando impostos e comissão. O preço sugerido é **proposta**: o vendedor ajusta; fora dos limites exige aprovação (§4).

### Regras
- Custos e margens são **somente internos**; o PDF e o portal nunca os exibem.
- Mudar parâmetros **não altera orçamentos já enviados**.
- Cada linha mostra a origem do valor (parâmetro, fornecedor, manual) para auditoria.
- Para itens exclusivos, a ficha inclui **molde** e **desenvolvimento/amostra** como itens separados (cobrança [a definir]).

## 4. Orçamento

`Rascunho → Aguardando aprovação interna → Enviado → Em negociação → Aprovado | Recusado | Expirado`

- **Numeração** própria; cada alteração relevante cria **nova versão** (`v1, v2…`). A versão *Enviada* é **imutável**.
- **Aprovação interna** obrigatória quando: desconto > **[limite]**, margem < **[mínimo]**, prazo/condição fora do padrão **[a definir]**. Aprovador: Gestor (ou Administrador).
- **Preço por faixa de quantidade** vindo do cadastro; o vendedor pode sobrescrever com justificativa.
- **Validade**: ao vencer, estado *Expirado* (job diário); reabrir cria nova versão.
- **PDF** gerado pelo servidor com a identidade visual, a partir do retrato da versão (não do dado “vivo”).
- **Portal**: o cliente vê a versão enviada; ao **Aprovar**, o sistema grava usuário, versão, data/hora e IP. **Solicitar alteração** reabre negociação e gera nova versão quando o comercial responder.
- **Aprovação só vale para a versão exibida**; versão mais nova invalida aprovação pendente das antigas.
- Quem pode aprovar no portal depende do nível do contato (*aprovador*).

## 5. Conversão em pedido (uma única vez)

- Ação executada em **transação** no servidor: trava a versão aprovada, cria o pedido copiando itens/condições, registra vínculo.
- **Restrição no banco**: `orders.quote_version_id` único → duplo clique, reenvio ou concorrência não geram dois pedidos.
- Idempotência: a requisição carrega uma chave; repetições devolvem o mesmo pedido.
- Alterar depois da conversão = **aditivo** ou **nova versão**, nunca edição silenciosa do pedido.

## 6. Projetos exclusivos (E2)

`Briefing → Análise de viabilidade → Proposta técnica e comercial → Desenvolvimento → Amostra → Aprovação da amostra → Liberação para produção`

- Cada etapa tem responsável, prazo e anexos versionados (desenhos, arquivos 3D, especificações).
- **A produção de item exclusivo só é liberada** com a aprovação técnica exigida para aquele projeto; a **versão aprovada** acompanha pedido e ordem de produção.
- Pedido de alteração do cliente cria nova versão técnica; amostras e aprovações ficam registradas (quem, quando, versão).
- Molde: propriedade (empresa/cliente), custo/cobrança, local e manutenção ligados ao projeto.

## 7. Pedido: quatro status independentes

| Eixo | Estados (exemplo) |
|---|---|
| Comercial | Aprovado · Em ajuste · Cancelado |
| Financeiro | Sem cobrança · Aguardando sinal · Parcial · Quitado · Inadimplente |
| Produção | Não liberado · Liberado · Programado · Em produção · Concluído · Parcial |
| Logístico | Aguardando · Disponível p/ separação · Separado · Pronto p/ coleta · Coleta agendada · Coletado parcial/total |

**Liberação para produção**: conjunto de **regras configuráveis** (aprovação do orçamento, aprovação técnica/amostra, sinal recebido **[se exigido]**, material, máquina e molde disponíveis). O sistema mostra **quais condições faltam**; exceção só por Gestor, com justificativa registrada.

## 8. Produção (E2)

- Uma ou mais **ordens de produção (OP)** por item do pedido; produção parcial permitida.
- Etapas da OP vêm de um **roteiro configurável** por produto (injeção ou sopro, rebarbação, montagem, embalagem etc.).
- Apontamentos: quantidade produzida/aprovada/rejeitada, perdas, retrabalho, paradas, ocorrências, consumo real de material, lote, responsável, máquina e molde.
- Liberação de qualidade antes de entrar como produto acabado **[critério a definir]**.
- Finalizar OP gera **movimentos de estoque** (consumo de matéria-prima e entrada de acabado). Correção = **estorno/ajuste** que referencia o movimento original.

## 9. Estoque (E2)

- **Livro-razão imutável** de movimentações: o saldo é derivado (soma), nunca editado.
- Saldo físico, **reservado** e **disponível** por item/local/lote.
- Reserva para pedido; falta de material antes da produção gera **alerta e solicitação de compra** sugerida.
- Inventário gera ajustes por diferença, com motivo.

## 10. Compras (E2)

`Solicitação → Cotação → Aprovação → Pedido de compra → Recebimento → Conferência`

- Comparativo de fornecedores (preço, prazo, condição).
- Recebimento parcial, divergência, devolução. **A entrada em estoque acontece na conferência**, e o título a pagar nasce **uma vez** por compra/recebimento (chave de vínculo para impedir lançamento duplicado).
- Aprovar compra **não** é pagar.

## 11. Financeiro (E3)

Entidades separadas: **orçamento ≠ pedido ≠ título financeiro ≠ movimentação de caixa**.

- Título (a pagar/receber) tem vencimento, competência, parcelas e saldo.
- Baixa parcial gera **movimentação de caixa** vinculada ao título; juros, multa e desconto são lançados à parte.
- **Transferência entre contas** = par de movimentos com um `transfer_group`, **fora** de receita/despesa.
- **Comprovante enviado pelo cliente** fica *Pendente*; só o Financeiro valida e dá baixa.
- Estorno e cancelamento criam lançamentos de reversão; nada é apagado.
- Visões por **caixa** e por **competência**, com critério escrito na tela do relatório.
- Conciliação bancária **manual** na primeira versão.

## 12. Expedição e coleta (E2)

`Disponível para separação → Separado → Pronto para coleta → Coleta agendada → Coletado/Expedido`

- Quantidades, volumes, peso, transportadora/responsável, datas, documentos, rastreio.
- Coletas **parciais**: o pedido mostra coletado × saldo.
- **Coletado ≠ entregue**: a entrega ao cliente só é marcada com comprovante ou confirmação **[a definir]**.

## 13. Portal do cliente — linha do tempo

`Orçamento enviado → Aprovado → Condições iniciais atendidas → Produção programada → Em produção → Controle de qualidade → Pronto para coleta → Coletado`

- Para pedido atendido **com estoque disponível**, a linha **omite** a etapa de fabricação.
- **Previsão ≠ data confirmada**; mudanças de prazo ficam registradas, com justificativa **adequada ao cliente** (campo separado da justificativa interna).
- Tudo reflete registros reais da equipe; nada de rastreio automático de máquinas.

## 14. Loja de produtos de linha (e-commerce)

**Decisão importante:** “comprar e já receber” exige, na prática, **pagamento online, frete e nota fiscal**, que dependem de provedores externos e da contabilidade. Proposta em níveis:

| Nível | Entrega | Depende de |
|---|---|---|
| **L1 — Catálogo e pedido** | Vitrine, carrinho, checkout que gera **pedido**; pagamento por Pix/transferência **validado pelo Financeiro**; frete combinado ou tabela simples | Produtos de linha cadastrados com preço, múltiplos de venda e estoque |
| **L2 — Pagamento automático** | Cartão/Pix com confirmação automática (webhook) | Contrato com gateway (ex.: Mercado Pago, Asaas, Pagar.me, Stripe), credenciais, taxas |
| **L3 — Frete e fiscal** | Cotação de frete em tempo real, etiqueta, NF-e | Provedor de frete (ex.: Melhor Envio), emissor fiscal, validação contábil |

Regras já previsíveis:
- Venda da loja vira **pedido do mesmo sistema** (canal = *loja*), com a mesma separação de status; não existe “estoque paralelo”.
- Só vende o que está **publicado**, com preço de loja, **múltiplo/quantidade mínima** e **disponibilidade** (estoque disponível ou "sob encomenda" [a definir]).
- Reserva de estoque ao confirmar o pedido; liberação se não houver pagamento em **[prazo]**.
- Cliente cria conta (mesmo login do portal) e acompanha o pedido.
- **Perguntas bloqueantes**: loja é só para empresas (B2B) ou também consumidor final? Preço único ou por perfil/faixa? Entrega ou só retirada? Emissão de NF por pedido?

## 15. Notificações

- **Internas (E1)**: sino no sistema + lista; eventos: lead novo, aprovação pendente, orçamento aprovado/recusado, tarefa vencida, falta de material, atraso.
- **E-mail e WhatsApp (E4)**: integrações **explícitas**, com configuração, modelos e **registro de cada envio** (sucesso/falha). Até lá, a interface não promete esse envio.

## 16. Regras transversais

- Toda mudança de estado grava **quem, quando, de/para** no histórico.
- Cancelar nunca apaga: gera registro de cancelamento com motivo; efeitos (reservas, títulos) são revertidos por lançamentos.
- Cadastros usados são **inativados**, não excluídos.
- Ações que criam documentos (pedido, OP, título, recebimento) usam **chave de idempotência** e restrições únicas.

# 07 — Decisões registradas

Registro das respostas dadas pela Century Shalom (Marcelo, administrador) em 27/11/2026, com o que cada uma muda no sistema. Itens marcados **⚠ confirmar** ainda precisam de validação (empresa ou contador) antes de virar regra definitiva.

## Decisões

| # | Decisão | Efeito no sistema |
|---|---|---|
| D1 | **Ainda não há método de cálculo de preço.** O sistema vai definir o método junto com a empresa. | A ficha de custo (02 §3) nasce como padrão **sugerido e editável**; parâmetros começam como rascunho até alguém validar. |
| D2 | **Despesas fixas** atuais: funcionários, internet, água, luz, aluguel, pró-labore. Rateio ainda **não definido**. | Cadastro de despesas fixas por categoria e **método de rateio configurável** (ver recomendação abaixo). |
| D3 | **Markup mínimo = 1,5**. | Parâmetro `markup_minimo = 1,5`. Preço abaixo de `custo × 1,5` exige aprovação do Gestor. **⚠ confirmar** o que compõe o "custo" desse markup (ver pergunta N1). |
| D4 | **Desconto livre até o markup chegar a 1,5.** | O vendedor pode conceder desconto sem aprovação **enquanto o markup resultante for ≥ 1,5**; abaixo disso, bloqueia e pede aprovação. O limite deixa de ser um percentual fixo e passa a ser calculado por item. |
| D5 | **Regime: Simples Nacional.** | Imposto é percentual sobre a **receita** (alíquota efetiva do mês), não sobre o custo. Parâmetro `aliquota_simples` informado pelo contador e atualizável. **⚠ confirmar** anexo/faixa e alíquota efetiva. |
| D6 | **Sinal de 50% na entrada** para pedidos. | Regra de liberação padrão: `sinal = 50%` recebido (validado pelo Financeiro) antes de liberar a produção. Exceção só por Gestor, com justificativa. **⚠ confirmar** se vale também para a loja e para pedidos sobre estoque pronto. |
| D7 | **Leads novos vão para o administrador (Marcelo).** | Regra de distribuição inicial = responsável fixo; troca por rodízio/segmento fica como configuração futura. |
| D8 | **Loja atende empresas e consumidor final.** **Acima de 300 peças, preço especial.** Também aceita **encomenda**. | Faixas de preço com corte em 300 un. (`price_tiers`). Cliente pessoa física passa a existir (CPF). Produto com estoque = pronta entrega; sem estoque = **sob encomenda** com prazo informado. Venda a consumidor final exige atenção ao CDC (arrependimento, devolução). **⚠ confirmar com jurídico/contador.** |
| D9 | **Gateway: InfinitePay.** | Nível L2 da loja usa a API de checkout da InfinitePay (ver notas abaixo). |
| D10 | **Frete FOB e retirada; ambos aceitos.** | FOB: cliente (ou transportadora indicada) paga/contrata o transporte. Cadastro de pedido registra modalidade e transportadora; **cálculo de frete automático não é necessário na v1**. |
| D11 | **Marcelo emite as notas fiscais** (fora do sistema, por enquanto). | O sistema **não emite NF** na v1. Cada pedido tem campos para **número, chave e anexos (PDF/XML)** da nota emitida e fica visível ao cliente no portal. Emissão integrada fica para a Etapa 4. |

## Recomendação para ratear despesas fixas (você pediu ideias)

O melhor método na prática depende de dados que a empresa ainda não tem. Proposta para **começar simples e corrigir com dados reais**:

**Método sugerido: rateio por hora-máquina produtiva.**

1. Some as despesas fixas mensais (aluguel, energia base, água, internet, funcionários **indiretos**, pró-labore, etc.).
2. Calcule as **horas produtivas previstas** por mês: `máquinas × horas por turno × dias úteis × utilização-alvo`. Como não há histórico, use uma utilização **conservadora** (por exemplo, abaixo de 100%) e revise a cada trimestre com os apontamentos reais.
3. `Despesa fixa por hora-máquina = despesas fixas ÷ horas produtivas previstas`.
4. Some esse valor ao **custo/hora da máquina**. O custo de cada peça passa a carregar sua parte de despesa fixa proporcional ao tempo de máquina que ocupa.

**Por que esse método:** em injeção e sopro, a máquina é o recurso que limita a produção; peças que ocupam mais tempo de máquina devem carregar mais despesa fixa. É simples de explicar e de calcular.

**Cuidados:**
- **Funcionários diretos** (operadores) entram em **mão de obra**, não em despesa fixa; só os **indiretos** (administrativo, comercial) e o pró-labore entram no rateio. Assim nada é contado duas vezes.
- Se a utilização real for menor que a prevista, o rateio fica **subestimado** e a margem real cai; o sistema deve comparar **previsto × realizado** (a partir da Etapa 2).
- Alternativas mais simples, porém mais distorcidas: percentual sobre o faturamento previsto ou sobre o custo direto. O sistema pode oferecer mais de um método, mas **uma versão de parâmetros usa apenas um**.
- Pró-labore: manter como linha própria, para a margem ficar visível.

**⚠ A confirmar com o contador:** quais despesas são fixas, a política de pró-labore e a alíquota do Simples.

## Dúvidas novas geradas pelas respostas

| # | Pergunta | Por que importa |
|---|---|---|
| N1 | O **markup 1,5** é aplicado sobre qual custo: só custo direto (material + máquina + mão de obra) ou já incluindo o rateio das despesas fixas? | Muda o preço final. Com markup 1,5 sobre custo direto, a margem precisa cobrir despesas fixas, imposto e lucro; sobre custo completo sobra mais lucro. |
| N2 | O **imposto do Simples** está dentro desse 1,5 ou é somado depois? | Se o imposto vem por fora, o preço precisa ser dividido por `(1 − alíquota)`. |
| N3 | A **faixa de preço acima de 300 peças** é um desconto sobre o preço de linha ou um preço separado por produto? E vale por pedido ou por item? | Define como o preço por faixa é cadastrado. |
| N4 | O **sinal de 50%** vale na **loja**? Para consumidor final, o pagamento costuma ser integral na compra. | A regra de liberação da loja pode ser diferente da do pedido sob orçamento. |
| N5 | **Pronta entrega** (estoque) também exige sinal ou é pago integralmente? | Evita criar pedido sem pagamento. |
| N6 | No **frete FOB**, o cliente indica a transportadora no pedido ou vocês a indicam? | Define o campo do pedido e a mensagem no portal. |
| N7 | Para **consumidor final**: aceitam devolução/arrependimento? Em quantos dias? | Exigência do CDC em compra online. |
| N8 | **Nota fiscal por pedido de loja**: continuará sendo emitida manualmente, mesmo com pagamento automático? | Define se o pedido espera a nota antes de liberar a coleta. |

## InfinitePay — o que a documentação indica

Resumo da pesquisa em fontes públicas (a confirmar na conta e na documentação oficial **antes** da implementação):

- Há **API de checkout integrado**: o sistema cria um link de pagamento com itens, valor (em centavos), número do pedido (`order_nsu`), URL de retorno e URL de webhook.
- A **confirmação deve ser conferida** na API de verificação de pagamento (`payment_check`) e o pedido só é marcado como pago quando ela retornar `paid: true`.
- O **webhook não é assinado**, então qualquer pessoa que descobrir a URL poderia mandar um aviso falso; **nunca** liberar pedido só pelo webhook.
- É preciso **ativar o checkout integrado** na conta; formas de pagamento: Pix e cartão (parcelado).
- Material de terceiros (AsyncAPI/OpenAPI no apis.io) cita endpoints que **não batem** com a documentação oficial; usar apenas a documentação oficial da InfinitePay como referência.

Isso mantém a regra do projeto: **cobrança paga só é baixada após validação** (no L1 pelo Financeiro; no L2 pela confirmação da API).

Fontes: [Documentação do checkout InfinitePay](https://www.infinitepay.io/checkout-documentacao) · [Página para desenvolvedores](https://www.infinitepay.io/desenvolvedores) · [Link de pagamento](https://www.infinitepay.io/checkout-externo) · [Webhooks (AsyncAPI, terceiros)](https://apis.io/asyncapis/cloudwalk/cloudwalk-infinitepay-webhooks/)


---

# Rodada 2 — respostas às dúvidas N1–N8 (27/11/2026)

| # | Resposta | Efeito |
|---|---|---|
| N1 | O markup 1,5 incide **depois de todas as despesas** (custo completo). | `preço mínimo = custo_completo × 1,5`; o rateio das despesas fixas entra **antes** do markup. |
| N2 | O imposto do Simples **está dentro** do 1,5. | Não se soma imposto depois. A ficha mostra o **resultado estimado após imposto** e alerta se o 1,5 não for suficiente com a alíquota do mês. |
| N3 | **Preço separado por faixa**: até 300 · até 2.000 · até 5.000 · até 15.000 · a partir de 16.000. | Cada item tem 5 preços (um por faixa). Faixas são parâmetros do sistema. **⚠ Vão entre 15.001 e 15.999 peças** (ver N10). |
| N4 | **Sinal de 50% só para produção grande.** A **loja vende estoque já produzido.** | A loja **não aceita encomenda** (encomenda vai pelo orçamento). Sinal vale para pedidos que exigem produção. |
| N5 | **Pronta entrega: pago integral.** | Pedido de estoque/loja só é liberado para separação com pagamento integral validado. |
| N6 | **O cliente indica o transporte** (FOB). | Campos de transportadora no pedido, preenchidos pelo cliente; sem eles, a coleta não é agendada. |
| N7 | **Arrependimento/devolução: 7 dias, só na loja on-line.** | Registro de recebimento e de solicitação de devolução; reembolso por estorno. Prazo costuma ser contado do **recebimento**: **validar com jurídico/contador.** |
| N8 | **Nota manual nos dois casos** e a **coleta só sai com NF anexada**. | Bloqueio de coleta sem número e chave da nota no pedido (orçamento e loja). |

## Efeito sobre decisões anteriores

- **D6 (sinal 50%)**: passa a valer **só para produção grande**; pronta entrega é paga integralmente.
- **D8 (“também aceitamos encomenda”)**: a **loja** vende só estoque produzido; a **encomenda** continua existindo pelo **canal de orçamento**.
- **D11 (NF manual)**: confirmada para orçamento e loja; agora **bloqueia a coleta** até a nota ser anexada.

## Novas dúvidas (rodada 2)

| # | Pergunta | Por que importa |
|---|---|---|
| N9 | O que define **“produção grande”** para exigir sinal de 50%? Uma quantidade (por exemplo, a partir da faixa 2), um valor mínimo em R$, ou **todo** pedido que vai para a fábrica? | Sem isso o sistema não sabe quando cobra o sinal. |
| N10 | A última faixa começa em **15.001** ou em **16.000**? (A resposta deixa um vão entre 15.001 e 15.999.) | Evita preço indefinido nessa quantidade. |
| N11 | **Quanto do estoque** produzido vai para a loja? Quem decide, para não vender o que já está reservado a um pedido? | Define a quantidade publicada e a reserva. |
| N12 | Na loja, o preço de **1 unidade** é o da faixa “até 300”? As demais faixas valem também para compras grandes na loja (limitadas ao estoque)? | Define o preço do carrinho. |
| N13 | A loja tem **quantidade mínima** por pedido? | Regra do checkout. |
| N14 | Na **devolução de 7 dias**, quem paga o frete? E como o sistema fica sabendo a **data de recebimento** (FOB, cliente retira): confirmação do cliente, comprovante de coleta? | A contagem do prazo depende dessa data. |
| N15 | Há **comissão de vendedor**? Em que percentual? | Comissão sai do 1,5; afeta o resultado estimado. |

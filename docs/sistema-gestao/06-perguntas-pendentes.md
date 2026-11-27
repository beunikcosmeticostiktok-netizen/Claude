# 06 — Perguntas indispensáveis sobre a operação

**Atualização 27/11/2026:** as perguntas marcadas com ✅ foram respondidas — ver `07-decisoes-registradas.md` (que também traz novas dúvidas N1–N8).

Nenhuma resposta abaixo foi presumida no projeto. 🔴 = bloqueia o início da etapa indicada · 🟡 = precisa estar definida antes de a fatia correspondente · 🟢 = pode esperar.

## Estratégia e escopo

1. 🔴 **E1** — Concorda com o escopo da Etapa 1 (comercial primeiro) e com a loja em níveis L1→L3?
2. 🔴 **E1** — A aplicação nova ficará em domínio próprio (ex.: `sistema.` / `app.` do domínio da empresa)? Qual é o domínio e onde está registrado?
3. 🟡 O sistema atual de trabalho (planilhas, ERP, WhatsApp) deve ser **importado** (clientes, produtos)? Em que formato?
4. 🟢 Quantos usuários internos e quantos clientes ativos esperam nos primeiros 6 meses (dimensiona o plano do Supabase)?

## Comercial e CRM

5. ✅ **E1** — Quem recebe os leads novos? Distribuição por pessoa, rodízio ou por segmento (pets/cosméticos/tampas)?
6. 🔴 **E1** — Etapas do funil: as sete do briefing servem como estão? Quais motivos de perda usar?
7. 🟡 Comercial vê **só suas** oportunidades ou todas?
8. 🟡 Clientes pessoa física existem (CPF) ou só empresas (CNPJ)?

## Custos e preços (os mais importantes para a cotação)

9. ✅ **E1** — **Como a empresa calcula hoje** o preço de uma peça? (planilha, fórmula, markup, margem). Pode enviar um exemplo real **anonimizado**.
10. ✅ (parcial) **E1** — Quais custos entram: matéria-prima (preço por kg: média, último compra ou fornecedor?), **hora-máquina** (por máquina ou média?), **mão de obra** (com ou sem encargos), **setup**, embalagem, terceirizados.
11. ✅ (parcial) **E1** — **Despesas fixas**: quais são e **como rateá-las** (por hora-máquina, por peso produzido, percentual sobre faturamento)? Essa é decisão da gestão/contabilidade.
12. ✅ (parcial) **E1** — **Impostos** sobre venda e comissão: regime tributário, percentuais, o que embutir no preço.
13. ✅ **E1** — **Markup ou margem sobre preço?** Margem mínima por categoria? Limite de desconto do vendedor sem aprovação?
14. ✅ Preço por faixa de quantidade: quais faixas? Valem para linha e projetos exclusivos?
15. 🟡 Perda prevista de material: um percentual por produto, por processo ou geral?
16. 🟡 Moldes de projeto exclusivo: cobrados do cliente (integral, parcelado, amortizado no preço)? Quem é o dono do molde?
17. 🟡 Desenvolvimento e amostra: cobrados? Valor-padrão ou por projeto?

## Orçamentos e pedidos

18. 🔴 **E1** — Validade padrão do orçamento? Condições de pagamento padrão? Prazo estimado vem de onde (cadastro do produto, programação)?
19. ✅ **E1** — Exigem **sinal/adiantamento**? Percentual? Para todos os pedidos ou só exclusivos/novos clientes?
20. 🟡 O que o cliente pode alterar depois de aprovar? Aditivos?
21. 🟡 Quem, no cliente, aprova (contato específico)? Aceite eletrônico simples basta, ou é preciso assinatura formal?
22. 🟡 Numeração desejada de orçamento e pedido (ex.: `ORC-2026-0001`)?

## Produção e qualidade (E2)

23. 🟡 Máquinas existentes (quantidade, tipo, tonelagem) e se a programação é por máquina e turno.
24. 🟡 Roteiros: quais etapas além de injeção/sopro (rebarbação, montagem, embalagem, etiquetagem)?
25. 🟡 Critério de **liberação de qualidade**: inspeção por amostragem, por lote, cartilha de defeitos?
26. 🟡 Controle de **lote**: obrigatório para todos os itens ou só alguns (cosméticos, por exemplo)?
27. 🟡 Moldes: quantos, quem os mantém, calendário de manutenção?
28. 🟡 Há produção **sem pedido** (para estoque dos itens de linha)? Política de reposição?

## Estoque, compras e fornecedores (E2)

29. 🟡 Locais de estoque (almoxarifado, expedição, terceiros)? Estoque em poder do cliente (molde/embalagem)?
30. 🟡 Estoque mínimo: por item, com cálculo ou valor manual?
31. 🟡 Fluxo de compras: quem solicita, quem aprova, **limites de alçada**?
32. 🟡 Unidades e conversões da resina (kg, saco, tonelada) e de acabados (unidade, caixa, milheiro).

## Financeiro (E3)

33. 🟡 Contas bancárias e caixas atuais; centros de custo e plano de categorias.
34. 🟡 Regime **caixa** ou **competência** como padrão gerencial?
35. 🟡 Política de juros/multa, desconto por antecipação, cobrança de inadimplentes.
36. 🟢 O financeiro usa contador externo? Que formato precisa receber (relatórios, exportação)?

## Expedição (E2)

37. ✅ (parcial) Transportadoras habituais? Cliente sempre retira (coleta) ou há entrega própria/frete?
38. 🟡 O que comprova **entrega** ao cliente (assinatura, canhoto, confirmação no portal)?

## Loja / e-commerce (L)

39. ✅ **L** — Loja é **B2B (CNPJ)**, **B2C (consumidor)** ou ambos? Há pedido mínimo e múltiplos de venda?
40. ✅ (parcial) **L** — Preço de loja: tabela única, por faixa, por perfil de cliente?
41. ✅ **L** — Disponibilidade: só vende o que há em estoque, ou aceita **sob encomenda** com prazo?
42. ✅ **L** — Formas de pagamento: Pix, cartão, boleto? Já têm conta em algum gateway (Mercado Pago, Asaas, Pagar.me, Stripe)?
43. ✅ **L** — Entrega: frete por tabela, transportadora própria, só retirada na fábrica?
44. ✅ **L** — Emitem **nota fiscal** por pedido? Qual software/contador emite hoje?
45. ✅ (parcial) **L** — Políticas de troca, devolução e arrependimento (CDC se houver consumidor final).
46. 🟡 **L** — Quais produtos de linha entram primeiro (SKU, fotos, medidas, preços)?

## Integrações e marca

47. 🟡 Quais sistemas do Grupo Masc Professional devem trocar dados no futuro, e quais dados (clientes, produtos, financeiro)?
48. 🟡 E-mail de envio (domínio próprio) e número de WhatsApp comercial para automações futuras.
49. 🟢 Política de privacidade e termos de uso já existem? (a landing e a loja precisam deles).
50. 🟢 Logotipo vetorial (SVG/PDF) e fontes oficiais, se houver, para PDF e portal.

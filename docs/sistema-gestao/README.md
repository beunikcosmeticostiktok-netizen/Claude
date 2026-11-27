# Sistema de Gestão — Century Shalom Indústria de Plásticos

> **Status: proposta para validação.** Nenhum código do sistema foi escrito. Este conjunto de documentos organiza requisitos, arquitetura e etapas, e **lista o que ainda depende de decisão da empresa** (arquivo `06`). Nada aqui define regra de negócio definitiva: onde há fórmula ou política, ela aparece como *estrutura configurável a validar*.

## Documentos

| Arquivo | Conteúdo |
|---|---|
| `README.md` | Resumo, princípios, escopo e limites da primeira versão |
| `01-modulos-e-telas.md` | Mapa de módulos, telas por perfil, loja e portal |
| `02-fluxos-e-regras.md` | Máquinas de estado, regras de transição, custos/cotação, loja |
| `03-modelo-de-dados.md` | Entidades, relacionamentos, restrições de integridade |
| `04-permissoes-e-seguranca.md` | Matriz de permissões, isolamento de clientes, auditoria |
| `05-arquitetura-e-plano.md` | Stack, serviços, ambientes, integrações, etapas e critérios de aceite |
| `06-perguntas-pendentes.md` | Perguntas indispensáveis, priorizadas por etapa |
| `07-decisoes-registradas.md` | **Respostas da empresa**, efeito no sistema e novas dúvidas |

## Resumo da proposta

- **Aplicação web responsiva** (computador e celular), em português, valores em R$, datas dd/mm/aaaa.
- **PostgreSQL + Supabase** (banco, autenticação, armazenamento privado, funções de servidor). As permissões são aplicadas **no banco** (Row Level Security), não só na interface.
- **Um só sistema, uma só empresa** (Century Shalom), com pontos de integração preparados para o Grupo Masc Professional, sem virar ERP multiempresa.
- **Fluxo comercial completo antes do resto**: landing → oportunidade → ficha de custo → orçamento versionado → aprovação do cliente no portal → pedido único.
- **Cotação por custo**: matéria-prima, hora-máquina, mão de obra, preparação, despesas fixas, impostos e margem entram em uma ficha de custo parametrizável; o resultado alimenta o preço do orçamento. Parâmetros e rateios são da empresa, não meus.
- **Loja de produtos de linha** (e-commerce): entra em fase própria porque depende de pagamento, frete, estoque e fiscal (detalhes em `02` e `05`).

## Princípios (do briefing)

Aplicação responsiva · banco real e relacional · autenticação e permissões no servidor · histórico de quem fez o quê · busca/filtros/paginação/exportação · anexos privados · ambiente de demonstração separado do de produção · nenhuma integração exibida como funcionando se estiver simulada · `localStorage` nunca como base de dados · ajustes e estornos em vez de apagar histórico.

## Escopo da primeira versão (Etapa 1 — Fundação e comercial)

**Entra:**
1. Multi-login com perfis (Administrador, Gestor, Comercial, Produção, Estoque/Expedição, Compras, Financeiro, Cliente) e vários contatos por empresa cliente.
2. Clientes, contatos, endereços, histórico de atividades e documentos.
3. Funil configurável, tarefas, lembretes, motivos de perda.
4. Landing → oportunidade (com deduplicação e proteção contra spam), distinguindo *produto existente* e *projeto exclusivo*.
5. Cadastro de produtos, variantes, preços por faixa e especificações.
6. **Ficha de custo e parâmetros de custo** (cotação interna).
7. Orçamentos versionados, aprovação interna por limites, PDF com identidade visual.
8. Portal do cliente: ver orçamento, aprovar a versão ou pedir alteração.
9. Conversão do orçamento aprovado em pedido, **uma única vez**.
10. Auditoria de ações críticas; notificações internas.

**Fica para depois (etapas 2–4):** projetos exclusivos completos e moldes, estoque, compras, ordens de produção, qualidade, expedição, financeiro, integrações (Pix/boleto, NF-e, e-mail/WhatsApp automáticos).

**Loja (e-commerce):** proposta em três níveis — ver `02` §Loja. O catálogo e o carrinho podem vir logo após a Etapa 1; pagamento automático, frete e nota fiscal dependem de provedores externos e de validação contábil.

**Fora do escopo declarado:** multiempresa, integração com máquinas (IoT/MES), aplicativo nativo, BI avançado, emissão fiscal automática na v1.

> **Atualização 27/11/2026:** a empresa respondeu parte das perguntas (markup mínimo 1,5; Simples Nacional; sinal de 50%; leads para o administrador; loja para empresas e consumidor com preço especial acima de 300 peças; InfinitePay; frete FOB/retirada; notas emitidas manualmente). Ver `07-decisoes-registradas.md`.

## O que não vou assumir

Fórmulas de rateio de despesas fixas, margens mínimas, limites de desconto, regras de sinal/adiantamento, prazos-padrão, política de frete, tributação e se a loja atende pessoa física ou só empresas. Todos estão em `06-perguntas-pendentes.md`.

## Estado da construção (atualizado)

**Etapa 1 (comercial) — telas e banco prontos:** acesso por perfil, usuários, clientes (contatos, endereços e logins do portal), CRM
(leads, funil), produtos com 5 faixas de preço, calculadora de custo, orçamentos versionados (aprovação interna por markup,
envio, versões, impressão em PDF), pedidos (4 situações, liberação, nota fiscal, recebimento, cancelamento) e **portal do cliente**
(aprovar/pedir alteração, indicar transportadora, acompanhar andamento).
Banco: `supabase/migrations` (5 migrações, 50 testes). Aplicação: `app/` (19 testes).

**Também pronto (Etapa 2, parte 1):** estoque (livro-razão imutável, reservas, transferências, estornos), fornecedores, pedidos de compra (aprovação do gestor) e recebimentos com entrada em estoque sem duplicidade (64 testes no banco).

**Pendente:** parâmetros de custo salvos no sistema (hoje a calculadora não grava), projetos exclusivos,
produção/apontamento, expedição, financeiro, loja, e-mail/WhatsApp automáticos. Cada módulo novo começa pelo banco e seus testes.

**Também pronto (Etapa 2, parte 2):** máquinas e moldes, ordens de produção (parciais, várias por pedido, só liberadas com o pedido liberado),
apontamento com consumo de matéria-prima, liberação de qualidade (acabado só entra no estoque depois), separação e coleta parcial
(nota fiscal obrigatória, baixa de estoque na coleta, regra de quitação configurável) e coletas no portal do cliente. Banco: 78 testes.

**Ainda não construído:** projetos exclusivos (aprovação técnica/amostra), financeiro (títulos, caixa, comissões a pagar), loja,
e-mail/WhatsApp automáticos, parâmetros de custo salvos no sistema.

**Também pronto (Etapa 3 — financeiro):** contas bancárias e caixas, títulos a receber/pagar (cobrança do pedido com sinal e saldo, uma vez só;
conta a pagar por recebimento de compra; parcelamento), pagamentos parciais com juros, multa e desconto, estorno, **caixa imutável**, transferências
(fora de receita/despesa), comprovantes do cliente que só dão baixa após validação do financeiro, conciliação manual e relatório por caixa e competência.
Banco: 93 testes.

**Ainda não construído:** projetos exclusivos, loja, comissões a pagar, e-mail/WhatsApp automáticos, parâmetros de custo salvos.

**Também pronto (projetos exclusivos):** briefing → viabilidade (com parecer) → proposta (versão técnica aprovada pelo cliente no portal) →
desenvolvimento → amostra (reprovação volta ao desenvolvimento) → aprovação da amostra → liberado. Produto exclusivo no catálogo (invisível para
outros clientes e para a loja). A produção só é liberada com o projeto liberado; o pedido e a ordem de produção carregam a versão técnica aprovada;
mudar a versão revoga a liberação. Custo interno do projeto não aparece ao cliente nem à produção. Arquivos por enquanto são links.
Banco: 105 testes.

**Ainda não construído:** loja, comissões a pagar, e-mail/WhatsApp automáticos, upload privado de arquivos, parâmetros de custo salvos.

**Também pronto (loja on-line):** catálogo público só com produto publicado, não exclusivo e com preço da faixa 1; carrinho; compra sem login (CPF/CNPJ validado,
frete FOB ou retirada); preço sempre lido do banco; limite por produto (padrão 300); estoque reservado enquanto o pagamento não chega (físico menos o pendente) e
liberado na expiração; link de pagamento InfinitePay (confirmação conferida na API antes de baixar o título; **integração ainda não testada com a API real**);
acompanhamento do pedido por link seguro; devolução (7 dias após o recebimento, nota de devolução obrigatória, reembolso só depois) e tela de configurações.
Banco: 123 testes. Pendente de decisão da empresa: pedido mínimo da loja, horas de reserva (padrão 24) e conta de recebimento da loja.

**Ainda não construído:** comissões a pagar, e-mail/WhatsApp automáticos, upload privado de arquivos, parâmetros de custo salvos.

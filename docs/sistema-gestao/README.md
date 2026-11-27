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

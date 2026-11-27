# 05 — Arquitetura, ambientes e plano de implantação

## Escolha de tecnologia e por quê

| Camada | Proposta | Motivo |
|---|---|---|
| Banco | **PostgreSQL** (via Supabase) | Relacional, transacional, restrições de integridade e RLS — exatamente o que o fluxo exige (único pedido por orçamento, livro-razão, títulos). |
| Autenticação | **Supabase Auth** | Multi-login, convite, recuperação de senha, MFA, sem construir do zero. |
| Permissões | **RLS no Postgres** + funções `security definer` | Permissão verificada no servidor, também para a API direta. |
| Arquivos | **Supabase Storage** (buckets privados, URLs assinadas) | Anexos privados com política por perfil. |
| Lógica de servidor | **Edge Functions** + funções SQL transacionais | Formulário público, conversão em pedido, geração de PDF, webhooks de provedores. |
| Interface | **Next.js (React + TypeScript)** + Tailwind | Responsiva, boa para portal + painel interno + loja pública (SEO) no mesmo projeto. |
| Hospedagem do app | **Vercel** (ou equivalente) | Deploy contínuo e ambientes de preview. |
| Região | Supabase em **São Paulo** (se disponível no plano) | Latência e localização dos dados pessoais. |

**Alternativas consideradas:** banco e autenticação próprios (mais controle, **muito** mais trabalho de operação e segurança); ERP pronto (não cobre o fluxo de projetos exclusivos e portal sob medida, ou custa mais). Supabase reduz risco de infraestrutura mantendo PostgreSQL padrão — dá para migrar depois.

**Limites a conhecer:** plano pago é necessário para backups com recuperação por ponto no tempo; geração de PDF em ambiente serverless pede escolha cuidadosa de ferramenta; a v1 é de **uma empresa** (sem `tenant_id` global), mas as tabelas ficam compatíveis com integração por API/eventos.

## Visão de componentes

```
 Landing (site público)  ─┐
 Loja pública            ─┼─►  Next.js (app) ──► Supabase
 Portal do cliente       ─┤                      ├─ Auth (logins)
 Painel interno          ─┘                      ├─ Postgres (dados + RLS + auditoria)
                                                 ├─ Storage (anexos privados)
        Formulário público ─► Edge Function ─────┤  Edge Functions
        (anti-spam)            submit-lead       │  (lead, PDF, webhooks, jobs)
                                                 └─ Jobs agendados (expirar orçamentos, lembretes)
 Futuro (E4): gateway de pagamento · frete · NF-e · e-mail · WhatsApp · API p/ Grupo Masc
```

## Ambientes

| Ambiente | Uso | Dados |
|---|---|---|
| Local | Desenvolvimento | Fictícios |
| **Demonstração** | Validação com a equipe | **Fictícios, rotulados “DEMONSTRAÇÃO”** |
| **Produção** | Operação real | Reais; acesso restrito; backup testado |

Migrações de banco versionadas no repositório (SQL), aplicadas em demonstração antes de produção.

## Estrutura sugerida do repositório

```
/                      landing atual (index.html, logo.png) — permanece
/app                   Next.js (painel, portal, loja)
/supabase/migrations   esquema, políticas RLS, gatilhos
/supabase/functions    Edge Functions
/docs/sistema-gestao   estes documentos
```
(Decisão pendente: manter landing estática separada ou migrá-la para dentro do app.)

## Integração com a landing

- Formulário passa a enviar para `submit-lead` (com anti-spam), incluindo o novo campo **tipo de interesse**.
- O botão de WhatsApp continua funcionando; o registro do lead acontece **antes** e é independente dele.
- Resposta do servidor informa de verdade se o pedido foi **registrado**; a interface nunca afirma sucesso sem confirmação.

## Integrações: o que é interno e o que depende de terceiros

| Item | Depende de | Observação |
|---|---|---|
| Orçamento, pedido, produção, estoque, compras, financeiro gerencial | Só do sistema | Etapas 1–3 |
| Pix/cartão automáticos | **InfinitePay** (checkout integrado ativado, credenciais) — confirmação por consulta à API, não só por webhook | E4 / L2 |
| Boleto | Não definido (InfinitePay pode não cobrir) | Decisão futura |
| Frete em tempo real, etiquetas | Provedor de frete (opcional; v1 usa FOB/retirada) | L3 |
| Emissão de NF-e | v1: **manual** (administrador emite; sistema guarda número, chave e anexos). Integrada: emissor fiscal + contador (CFOP, NCM, certificado) | **Nada de fiscal sem validação contábil** |
| E-mail transacional | Serviço de envio + domínio verificado (SPF/DKIM) | Log de envio obrigatório |
| WhatsApp automático | API oficial (Business) + modelos aprovados | Custo e aprovação da Meta |
| Conciliação automática | Open Finance/arquivo OFX | Começa manual |
| Grupo Masc Professional | API/eventos a definir | Contrato de dados a combinar; v1 só expõe pontos de integração |

## Plano por etapas

### Etapa 0 — Validação (antes de programar)
Responder `06-perguntas-pendentes.md` (bloqueantes), validar este escopo, fechar parâmetros de custo iniciais e criar os projetos Supabase (demonstração e produção).

### Etapa 1 — Fundação e comercial (fatias completas, uma por vez)

| Fatia | Entrega (fluxo inteiro, persistido e validado) |
|---|---|
| 1.1 | Projeto, ambientes, migrações, **login multi-perfil**, convites, auditoria, **testes das políticas RLS** |
| 1.2 | Clientes, contatos, endereços, itens, variantes, preços por faixa, anexos |
| 1.3 | **Landing → lead → oportunidade** (anti-spam, deduplicação, notificação), funil, tarefas |
| 1.4 | **Parâmetros e ficha de custo** → preço sugerido e margem |
| 1.5 | **Orçamento versionado**, aprovação interna por limites, PDF com identidade visual |
| 1.6 | **Portal do cliente**: login, ver versão enviada, aprovar/pedir alteração |
| 1.7 | **Conversão em pedido (única)** com status separados e regras de liberação (cadastro) |

### Loja (após 1.7, em paralelo à Etapa 2 se houver capacidade)
L1 catálogo + carrinho + pedido com pagamento validado manualmente → L2 pagamento automático → L3 frete e fiscal.

### Etapa 2 — Operação industrial
Projetos exclusivos e aprovações, moldes/máquinas, estoque (livro-razão), compras, OP e apontamento, qualidade, expedição/coleta parcial. O portal ganha linha do tempo e produção/coleta.

### Etapa 3 — Financeiro integrado
Títulos, caixa, parcelas, baixas parciais, estornos, transferências, comprovantes validados, conciliação manual, fluxo, caixa × competência, margem por pedido.

### Etapa 4 — Integrações e evolução
Cobrança, fiscal, e-mail/WhatsApp, indicadores avançados, integração com o Grupo Masc.

## Critérios de aceite (rastreáveis às fatias)

| Critério | Fatia | Como será demonstrado |
|---|---|---|
| Contato da landing gera oportunidade | 1.3 | Enviar formulário; ver oportunidade e notificação; reenviar → anexa, não duplica |
| Orçamento versionado e aprovado pelo cliente correto | 1.5–1.6 | Dois contatos em empresas diferentes; só o aprovador da empresa certa aprova |
| Aprovação gera um único pedido | 1.7 | Clique duplo e chamadas simultâneas → um pedido |
| Condições controlam a liberação | 1.7 / E2 | Pedido sem sinal/aprovação técnica mostra o que falta e bloqueia |
| Produção, compra, pagamento e coleta parciais | E2/E3 | Casos de teste com quantidades parciais |
| Movimentações sem duplicidade | E2 | Reprocessar finalização não duplica; estorno referencia original |
| Cliente só vê sua empresa | 1.1/1.6 | Teste automatizado de RLS com dois clientes |
| Interface sem custos/informação interna | 1.6 | Teste de visão do portal e inspeção das respostas da API |
| Cancelamentos preservam rastreabilidade | todas | Auditoria mostra cancelamento + reversões |
| Funciona no celular e persiste | todas | Roteiro em celular real; sair/entrar mantém dados |

**Regra de entrega:** cada fatia só é dada como pronta com persistência, validação, testes e verificação no celular. Dados de demonstração rotulados, em projeto separado.

## O que preciso para começar a Etapa 1

1. Respostas às perguntas **bloqueantes** (`06`).
2. Contas: **Supabase** (projetos demonstração e produção), **Vercel** (ou onde publicar) — criadas por vocês; eu não crio contas nem guardo senhas.
3. Primeiros **parâmetros de custo** reais (ou aceitação de valores fictícios rotulados na demonstração). **Já definidos:** markup mínimo 1,5, Simples Nacional, sinal de 50%.
4. Lista inicial de **produtos de linha** (pelo menos 5–10) com medidas, materiais e preços.

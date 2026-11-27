# 04 — Permissões e segurança

## Princípio

**A permissão é decidida no banco** (Row Level Security + funções de servidor), nunca apenas escondendo botões. Mesmo que alguém chame a API diretamente, o PostgreSQL recusa o que o perfil não pode.

## Multi-login

- Autenticação por e-mail e senha (Supabase Auth), com opção de link mágico; **MFA (2º fator) recomendado** para Administrador, Gestor e Financeiro.
- **Convite**: o administrador convida o usuário interno por e-mail e atribui perfil(is). Contatos de clientes recebem convite do Comercial/Administrador e são vinculados a **uma** empresa com um nível de acesso.
- Um usuário interno pode acumular perfis (ex.: Comercial + Compras). Desativar usuário bloqueia o login sem apagar histórico.
- Clientes: **vários contatos por empresa**, com níveis: *Leitura*, *Aprovador* (aprova orçamentos/amostras), *Financeiro* (vê cobranças e envia comprovantes).

## Matriz de permissões

Legenda: **V** ver · **C** criar · **E** editar · **A** aprovar · **X** excluir/inativar · **—** sem acesso · *(próprio)* só os registros sob sua responsabilidade / sua empresa · **(a definir)** depende de decisão da empresa.

| Recurso | Admin | Gestor | Comercial | Produção | Estoque/Exped. | Compras | Financeiro | Cliente |
|---|---|---|---|---|---|---|---|---|
| Usuários, perfis, regras | V C E X | V | — | — | — | — | — | — |
| Clientes e contatos | V C E X | V | V C E | V | V | V | V | *(própria empresa)* V |
| Leads e oportunidades | V C E | V | V C E *(próprias ou todas — a definir)* | — | — | — | — | — |
| Itens e preços | V C E X | V | V | V | V | V | V | V *(publicados)* |
| **Custos, parâmetros, margens** | V C E | V A | V *(a definir)* | — | — | V *(matéria-prima)* | V | **—** |
| Orçamentos | V C E | V A | V C E *(próprios)* | — | — | — | V | V *(da empresa; só versões enviadas)* |
| Aprovação de orçamento | — | A | — | — | — | — | — | A *(nível Aprovador)* |
| Pedidos | V C E | V A | V C E | V | V | — | V | V *(da empresa)* |
| Liberação/exceção de produção | A | A | — | — | — | — | — | — |
| Projetos exclusivos | V C E | V A | V C E | V E | — | — | — | V *(arquivos autorizados)* A *(aprovações)* |
| Moldes e máquinas | V C E | V | V | V C E | V | — | — | — |
| Ordens e apontamento | V | V | V | V C E | V | — | — | V *(avanço apenas)* |
| Estoque e movimentos | V | V | V *(disponível)* | V C *(consumo)* | V C E | V | V | — |
| Compras e fornecedores | V | V A | — | — | V *(receber)* | V C E | V | — |
| Contas a pagar/receber, caixa | V | V A | V *(cobranças dos seus)* | — | — | V *(títulos de compra)* | V C E | V *(só os seus títulos)* |
| Conciliação, relatórios financeiros | V | V | — | — | — | — | V C E | — |
| Expedição e coleta | V | V | V | — | V C E | — | — | V *(status/coletado)* |
| Auditoria | V | V *(a definir)* | — | — | — | — | — | — |

### Itens que **nunca** aparecem ao Cliente
Custos, margens, parâmetros, fornecedores, observações internas, justificativas internas de prazo, aprovações internas de desconto, dados de outros clientes. O portal lê **visões dedicadas** que já excluem essas colunas — não filtra no navegador.

## Isolamento entre clientes (exemplo de política)

```sql
-- O cliente só enxerga pedidos da empresa à qual está vinculado
create policy orders_cliente on orders for select
using (
  exists (select 1 from customer_users cu
          where cu.user_id = auth.uid() and cu.customer_id = orders.customer_id)
);
```
Escrita de cliente (aprovar orçamento, enviar comprovante, mensagem) passa por **funções de servidor** que validam empresa, versão e nível de acesso — não por `UPDATE` direto.

## Auditoria

- `audit_log` grava ator, ação, entidade, valores anteriores/novos, data/hora e IP para: login, mudança de estado, aprovações, descontos fora do padrão, liberação de exceção, ajustes e estornos, baixas financeiras, alteração de parâmetros de custo, permissões.
- O log é **somente inserção** (sem edição/exclusão por perfis de aplicação).

## Arquivos

- Armazenamento **privado** com URL assinada e de curta duração.
- Cada anexo tem `visibility` (interno/cliente); cliente só baixa o que é seu **e** liberado.
- Validação: tipos e tamanho permitidos, nome sanitizado, hash registrado; antivírus **[a definir — depende de serviço]**; PDFs e imagens servidos com `Content-Disposition` seguro.

## Proteção de dados (LGPD)

- Coleta mínima no formulário, com texto de finalidade e link de privacidade.
- Registro de consentimento do lead; exportação e eliminação/anonimização sob solicitação, **preservando registros fiscais e financeiros** exigidos por lei **[validar com contador/jurídico]**.
- Dados pessoais fora de logs de aplicação.

## Segredos e ambientes

- Chaves de serviço **apenas no servidor** (variáveis de ambiente do provedor); nada de credencial no repositório ou no navegador.
- **Dois projetos separados**: *demonstração* (dados fictícios rotulados) e *produção*. Dados fictícios não existem no ambiente de produção.

## Confiabilidade

- Backups automáticos do provedor; **procedimento de restauração testado** antes do uso real (restauração em projeto separado).
- Transações para operações compostas (conversão em pedido, finalizar OP, baixar título).
- Idempotência e restrições únicas contra duplicidade (ver `03`).
- Monitoramento de erros e alerta de falha em jobs (expiração de orçamento, lembretes).

## Anti-spam do formulário público

Honeypot · verificação anti-robô · limite por IP/telefone · validação no servidor · fila de revisão para leads suspeitos (nunca cria oportunidade automaticamente se reprovado).

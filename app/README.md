# Sistema Century Shalom — aplicação web

Next.js (App Router) + Supabase. O banco (tabelas, regras de permissão e testes) está em `../supabase`.

## Como colocar no ar (produção)

1. **Supabase**: o projeto já está ligado a este repositório pela integração do GitHub. Os arquivos de
   `supabase/migrations/` são aplicados quando chegam à branch que a integração observa.
2. **Vercel**: crie/ajuste o projeto com **Root Directory = `app`** e cadastre as variáveis de `app/.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SETUP_TOKEN`, `LEAD_IP_SALT`).
   A integração Supabase ↔ Vercel pode preencher as três primeiras automaticamente.
3. **Primeiro acesso**: abra `/setup`, informe o `SETUP_TOKEN` e crie o administrador. Depois apague `SETUP_TOKEN`.
4. **Desative o cadastro público** no Supabase (Authentication → Sign In / Providers → Email → *Allow new users to sign up* = desligado).
   Usuários novos são criados pelo administrador em **Usuários**.
5. **Landing**: em `index.html`, preencha `LEADS_API_URL` com `https://SEU-DOMINIO/api/leads`.

## Desenvolvimento

```bash
cd app && npm install && cp .env.example .env.local   # preencha com o projeto de DEMONSTRAÇÃO
npm run dev        # http://localhost:3000
npm run typecheck && npm test
cd ../supabase/tests && npm install && npm test      # testes do banco (50)
```

## Segurança

- Permissões são aplicadas no banco (RLS). A chave `SUPABASE_SERVICE_ROLE_KEY` é só do servidor e nunca vai ao navegador.
- Não grave senhas, chaves ou tokens no repositório.

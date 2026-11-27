-- =====================================================================
-- Migração 0010: cria o perfil interno de logins que já existiam no Supabase Auth
-- (criados antes das tabelas). Não concede nenhum papel: o administrador é definido
-- pela tela /setup (com a palavra secreta) ou por outro administrador.
-- =====================================================================
insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

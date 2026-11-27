import { redirect } from 'next/navigation';
import { createAdminClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { createFirstAdmin, recoverAdmin } from './actions';

export const dynamic = 'force-dynamic';

export default async function Setup({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SETUP_TOKEN) redirect('/configuracao-pendente');
  const admin = createAdminClient();
  const [{ count: admins }, { count: profiles }] = await Promise.all([
    admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin'),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
  ]);
  if ((admins ?? 0) > 0) redirect('/login');
  const recover = (profiles ?? 0) > 0;

  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom" />
      <h1>{recover ? 'Recuperar administrador' : 'Primeiro acesso'}</h1>
      <p className="muted">{recover
        ? 'Já existe um login, mas ainda não há administrador. Informe a palavra secreta e o e-mail do seu login para torná-lo administrador.'
        : 'Crie o administrador do sistema. Esta tela some assim que existir um administrador.'}</p>
      {erro === 'token' && <div className="alert err">Palavra secreta incorreta.</div>}
      {erro === 'dados' && <div className="alert err">Preencha os campos (senha com pelo menos 10 caracteres).</div>}
      {erro === 'usuario' && <div className="alert err">Não encontrei um login com este e-mail.</div>}
      {erro === 'falha' && <div className="alert err">Não foi possível concluir.</div>}
      {recover ? (
        <form action={recoverAdmin} className="stack">
          <label>Palavra secreta (SETUP_TOKEN)<input name="token" type="password" required autoComplete="off" /></label>
          <label>E-mail do seu login<input name="email" type="email" required autoComplete="email" /></label>
          <button className="btn full" type="submit">Tornar administrador</button>
        </form>
      ) : (
        <form action={createFirstAdmin} className="stack">
          <label>Palavra secreta (SETUP_TOKEN)<input name="token" type="password" required autoComplete="off" /></label>
          <label>Seu nome<input name="name" required autoComplete="name" /></label>
          <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
          <label>Senha (mín. 10 caracteres)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
          <button className="btn full" type="submit">Criar administrador</button>
        </form>
      )}
    </div></div>
  );
}

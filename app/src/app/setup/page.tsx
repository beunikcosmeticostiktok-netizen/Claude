import { redirect } from 'next/navigation';
import { createAdminClient, hasSupabaseEnv } from '@/lib/supabase/server';
import { createFirstAdmin } from './actions';

export const dynamic = 'force-dynamic';

export default async function Setup({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  if (!hasSupabaseEnv() || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SETUP_TOKEN) redirect('/configuracao-pendente');
  const { count } = await createAdminClient().from('profiles').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) redirect('/login');

  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom" />
      <h1>Primeiro acesso</h1>
      <p className="muted">Crie o administrador do sistema. Esta tela some assim que o primeiro usuário existir.</p>
      {erro === 'token' && <div className="alert err">Palavra secreta incorreta.</div>}
      {erro === 'dados' && <div className="alert err">Preencha nome, e-mail e uma senha de pelo menos 10 caracteres.</div>}
      {erro === 'falha' && <div className="alert err">Não foi possível criar o usuário.</div>}
      <form action={createFirstAdmin} className="stack">
        <label>Palavra secreta (SETUP_TOKEN)<input name="token" type="password" required autoComplete="off" /></label>
        <label>Seu nome<input name="name" required autoComplete="name" /></label>
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Senha (mín. 10 caracteres)<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <button className="btn full" type="submit">Criar administrador</button>
      </form>
    </div></div>
  );
}

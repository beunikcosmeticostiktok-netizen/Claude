import { signIn } from './actions';

const MENSAGEM: Record<string, string> = {
  credenciais: 'E-mail ou senha incorretos.',
  invalid_credentials: 'E-mail ou senha incorretos.',
  inativo: 'Seu acesso está desativado. Fale com o administrador.',
  email_provider_disabled: 'O login por e-mail está desligado no Supabase. Em Authentication → Sign In / Providers → Email, ligue “Enable Email provider” (deixe só “Allow new users to sign up” desligado).',
  email_not_confirmed: 'O e-mail deste login ainda não foi confirmado no Supabase.',
  user_banned: 'Este usuário está bloqueado.',
  over_request_rate_limit: 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.',
  validation_failed: 'Preencha o e-mail e a senha.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string; criado?: string; recuperado?: string }> }) {
  const { erro, criado, recuperado } = await searchParams;
  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom — Indústria de Plásticos" />
      <h1>Entrar</h1>
      <p className="muted">Acesso à equipe e a clientes cadastrados.</p>
      {criado && <div className="alert ok">Administrador criado. Entre com o seu e-mail e a senha.</div>}
      {recuperado && <div className="alert ok">Acesso de administrador recuperado. Entre com o seu e-mail e a senha.</div>}
      {erro && <div className="alert err">{MENSAGEM[erro] ?? `Não foi possível entrar (código: ${erro}).`}</div>}
      <form action={signIn} className="stack">
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Senha<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn full" type="submit">Entrar</button>
      </form>
    </div></div>
  );
}

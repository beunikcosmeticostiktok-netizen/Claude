import { signIn } from './actions';

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom — Indústria de Plásticos" />
      <h1>Entrar</h1>
      <p className="muted">Acesso à equipe e a clientes cadastrados.</p>
      {erro === 'credenciais' && <div className="alert err">E-mail ou senha incorretos.</div>}
      {erro === 'inativo' && <div className="alert err">Seu acesso está desativado. Fale com o administrador.</div>}
      <form action={signIn} className="stack">
        <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
        <label>Senha<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn full" type="submit">Entrar</button>
      </form>
    </div></div>
  );
}

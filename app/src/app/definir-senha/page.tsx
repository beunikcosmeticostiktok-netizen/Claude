import { setPassword } from './actions';

export default async function DefinirSenha({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom" />
      <h1>Defina sua senha</h1>
      <p className="muted">Por segurança, troque a senha temporária antes de continuar.</p>
      {erro === 'curta' && <div className="alert err">A senha precisa ter pelo menos 10 caracteres.</div>}
      {erro === 'diferente' && <div className="alert err">As senhas não conferem.</div>}
      {erro === 'falha' && <div className="alert err">Não foi possível salvar. Tente novamente.</div>}
      <form action={setPassword} className="stack">
        <label>Nova senha<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
        <label>Repita a senha<input name="confirm" type="password" minLength={10} required autoComplete="new-password" /></label>
        <button className="btn full" type="submit">Salvar e entrar</button>
      </form>
    </div></div>
  );
}

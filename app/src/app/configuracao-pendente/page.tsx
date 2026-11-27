export default function Pendente() {
  return (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom" />
      <h1>Configuração pendente</h1>
      <p className="muted">O sistema ainda não está ligado ao banco de dados. Cadastre as variáveis do Supabase no Vercel
        (veja <code>app/.env.example</code>) e publique novamente.</p>
    </div></div>
  );
}

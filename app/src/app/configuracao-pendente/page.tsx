export const dynamic = 'force-dynamic';

const REQUIRED: { name: string; alt?: string; note: string }[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', note: 'Endereço do projeto Supabase' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', alt: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', note: 'Chave pública (publishable/anon)' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', note: 'Chave secreta (secret/service_role)' },
  { name: 'SETUP_TOKEN', note: 'Palavra secreta do /setup (só necessária para criar ou recuperar o administrador)' },
  { name: 'LEAD_IP_SALT', note: 'Texto aleatório do formulário da landing' },
];

export default function Pendente() {
  // Só mostra NOMES e se existem, nunca os valores.
  const rows = REQUIRED.map((r) => ({ ...r, ok: Boolean(process.env[r.name] || (r.alt && process.env[r.alt])) }));
  const env = process.env.VERCEL_ENV ?? 'desconhecido';
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? 'desconhecida';
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7);
  return (
    <div className="center-page"><div className="auth card" style={{ width: 'min(560px,100%)' }}>
      <img src="/logo.png" alt="Century Shalom" />
      <h1>Configuração pendente</h1>
      <p className="muted">O sistema não encontrou todas as variáveis nesta publicação. Cadastre as que faltam no Vercel (Settings → Environment Variables, marcando <b>Production</b> e <b>Preview</b>) e use <b>Redeploy</b>.</p>
      <table className="table" style={{ marginTop: 14 }}><tbody>
        {rows.map((r) => (
          <tr key={r.name}><td>{r.ok ? '✅' : '❌'} <b>{r.name}</b><div className="muted small">{r.note}</div></td></tr>
        ))}
      </tbody></table>
      <p className="muted small" style={{ marginTop: 12 }}>Publicação no ar: ambiente <b>{env}</b> · branch <b>{branch}</b> {sha && `· commit ${sha}`}</p>
    </div></div>
  );
}

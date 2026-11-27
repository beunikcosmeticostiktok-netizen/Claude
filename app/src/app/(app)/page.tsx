import Link from 'next/link';
import { getSession } from '@/lib/auth';

async function count(q: PromiseLike<{ count: number | null }>) {
  try { return (await q).count ?? 0; } catch { return 0; }
}

export default async function Inicio() {
  const { supabase, profile, roles } = await getSession();
  const [clientes, leads, abertas] = await Promise.all([
    count(supabase.from('customers').select('id', { count: 'exact', head: true }).eq('active', true)),
    count(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'novo')),
    count(supabase.from('opportunities').select('id, pipeline_stages!inner(kind)', { count: 'exact', head: true }).eq('pipeline_stages.kind', 'aberta')),
  ]);
  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <>
      <div className="top"><h1>Olá{first ? `, ${first}` : ''}</h1></div>
      <div className="cards">
        <div className="card stat"><b>{clientes}</b><span>clientes ativos</span></div>
        <div className="card stat"><b>{leads}</b><span>leads novos aguardando</span></div>
        <div className="card stat"><b>{abertas}</b><span>oportunidades em aberto</span></div>
      </div>
      <div className="card">
        <h2>Situação do sistema</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Etapa 1 em construção. Disponível agora: acesso por perfil, usuários, clientes e recebimento de contatos da landing.
          Orçamentos, pedidos e portal do cliente chegam nas próximas entregas (o banco de dados delas já está pronto e testado).
        </p>
        {roles.includes('comercial') || roles.includes('admin')
          ? <p style={{ marginTop: 12 }}><Link className="btn sm" href="/clientes/novo">Cadastrar cliente</Link></p> : null}
      </div>
    </>
  );
}

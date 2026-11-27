import Link from 'next/link';
import { getSession } from '@/lib/auth';

async function count(q: PromiseLike<{ count: number | null }>) {
  try { return (await q).count ?? 0; } catch { return 0; }
}

export default async function Inicio() {
  const { supabase, profile, roles } = await getSession();
  const [clientes, leads, abertas, enviados, aliberar, aprovacoes] = await Promise.all([
    count(supabase.from('customers').select('id', { count: 'exact', head: true }).eq('active', true)),
    count(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'novo')),
    count(supabase.from('opportunities').select('id, pipeline_stages!inner(kind)', { count: 'exact', head: true }).eq('pipeline_stages.kind', 'aberta')),
    count(supabase.from('quote_versions').select('id', { count: 'exact', head: true }).in('status', ['enviado', 'em_negociacao'])),
    count(supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status_production', 'nao_liberado').neq('status_commercial', 'cancelado')),
    count(supabase.from('quote_versions').select('id', { count: 'exact', head: true }).eq('status', 'aguardando_aprovacao')),
  ]);
  const first = (profile?.full_name ?? '').split(' ')[0];
  return (
    <>
      <div className="top"><h1>Olá{first ? `, ${first}` : ''}</h1></div>
      <div className="cards">
        <div className="card stat"><b>{clientes}</b><span>clientes ativos</span></div>
        <div className="card stat"><b>{leads}</b><span>leads novos aguardando</span></div>
        <div className="card stat"><b>{abertas}</b><span>oportunidades em aberto</span></div>
        <div className="card stat"><b>{enviados}</b><span>orçamentos com o cliente</span></div>
        <div className="card stat"><b>{aliberar}</b><span>pedidos aguardando liberação</span></div>
        {(roles.includes('admin') || roles.includes('gestor')) && <div className="card stat"><b>{aprovacoes}</b><span>aprovações internas pendentes</span></div>}
      </div>
      <div className="card">
        <h2>Situação do sistema</h2>
        <p className="muted small" style={{ marginTop: 8 }}>
          Disponível: acesso por perfil, usuários, clientes, CRM, produtos com 5 faixas de preço, calculadora de custo, orçamentos
          versionados, pedidos e portal do cliente. Próximas etapas: projetos exclusivos, estoque, compras, produção, expedição e financeiro.
        </p>
        {roles.includes('comercial') || roles.includes('admin')
          ? <p style={{ marginTop: 12 }}><Link className="btn sm" href="/clientes/novo">Cadastrar cliente</Link></p> : null}
      </div>
    </>
  );
}

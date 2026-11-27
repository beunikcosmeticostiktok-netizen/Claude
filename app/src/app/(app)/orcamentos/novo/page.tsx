import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { createQuote } from '../actions';

export default async function NovoOrcamento({ searchParams }: { searchParams: Promise<{ customer?: string; erro?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'comercial']);
  const { data: customers } = await supabase.from('customers').select('id, legal_name, trade_name').eq('active', true).order('legal_name').limit(1000);
  return (
    <>
      <div className="top"><h1>Novo orçamento</h1><Link className="btn line" href="/orcamentos">Voltar</Link></div>
      {sp.erro && <div className="alert err">{sp.erro === 'cliente' ? 'Escolha o cliente.' : dbErrorText(sp.erro)}</div>}
      <form action={createQuote} className="card stack" style={{ maxWidth: 560 }}>
        <label>Cliente
          <select name="customer_id" required defaultValue={sp.customer ?? ''}>
            <option value="" disabled>Selecione…</option>
            {(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.legal_name}{c.trade_name ? ` (${c.trade_name})` : ''}</option>)}
          </select>
        </label>
        <p className="muted small">O cliente não está na lista? <Link href="/clientes/novo"><b>Cadastre primeiro.</b></Link></p>
        <div><button className="btn" type="submit">Criar orçamento</button></div>
      </form>
    </>
  );
}

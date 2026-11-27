import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { formatTaxId } from '@/lib/format';
import { dbErrorText } from '@/lib/labels';
import { createSupplier } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Fornecedores({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase, roles } = await getSession();
  const { data } = await supabase.from('suppliers').select('id, legal_name, trade_name, tax_id, contact_name, phone, email, active').order('legal_name');
  const canWrite = roles.includes('admin') || roles.includes('compras');
  return (
    <>
      <div className="top"><h1>Fornecedores</h1><Link className="btn line" href="/compras">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      {sp.ok && <div className="alert ok">Fornecedor cadastrado.</div>}
      <div className="card scroll"><table className="table">
        <thead><tr><th>Fornecedor</th><th>CNPJ/CPF</th><th>Contato</th></tr></thead>
        <tbody>
          {(data ?? []).map((s) => <tr key={s.id}><td><b>{s.legal_name}</b>{s.trade_name && <div className="muted small">{s.trade_name}</div>}</td><td>{formatTaxId(s.tax_id) || '—'}</td>
            <td className="small">{[s.contact_name, s.phone, s.email].filter(Boolean).join(' · ')}</td></tr>)}
          {!data?.length && <tr><td colSpan={3} className="muted">Nenhum fornecedor.</td></tr>}
        </tbody>
      </table></div>
      {canWrite && (
        <form action={createSupplier} className="card stack" style={{ marginTop: 16 }}>
          <h2>Novo fornecedor</h2>
          <div className="grid2"><label>Razão social<input name="legal_name" required /></label><label>Nome fantasia<input name="trade_name" /></label></div>
          <div className="grid2"><label>CNPJ ou CPF<input name="tax_id" inputMode="numeric" /></label><label>Condição de pagamento padrão<input name="payment_terms" /></label></div>
          <div className="grid2"><label>Contato<input name="contact_name" /></label><label>Telefone<input name="phone" inputMode="tel" /></label></div>
          <label>E-mail<input name="email" type="email" /></label>
          <div><button className="btn" type="submit">Cadastrar fornecedor</button></div>
        </form>
      )}
    </>
  );
}

import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { createPO } from '../actions';

export default async function NovaCompra({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin', 'compras']);
  const { data } = await supabase.from('suppliers').select('id, legal_name').eq('active', true).order('legal_name');
  return (
    <>
      <div className="top"><h1>Novo pedido de compra</h1><Link className="btn line" href="/compras">Voltar</Link></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}
      <form action={createPO} className="card stack" style={{ maxWidth: 520 }}>
        <label>Fornecedor<select name="supplier_id" required defaultValue=""><option value="" disabled>Selecione…</option>{(data ?? []).map((s) => <option key={s.id} value={s.id}>{s.legal_name}</option>)}</select></label>
        <p className="muted small">Sem o fornecedor? <Link href="/compras/fornecedores"><b>Cadastre primeiro.</b></Link></p>
        <div><button className="btn" type="submit">Criar pedido</button></div>
      </form>
    </>
  );
}

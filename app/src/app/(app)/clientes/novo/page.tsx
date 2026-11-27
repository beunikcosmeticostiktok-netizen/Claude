import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createCustomer } from '../actions';

const MSG: Record<string, string> = {
  nome: 'Informe o nome da empresa.',
  duplicado: 'Já existe um cliente com este CNPJ/CPF.',
  documento: 'CNPJ/CPF inválido. Confira os dígitos.',
  falha: 'Não foi possível cadastrar. Tente novamente.',
};

export default async function NovoCliente({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  await requireRole(['admin', 'comercial']);
  return (
    <>
      <div className="top"><h1>Novo cliente</h1><Link className="btn line" href="/clientes">Voltar</Link></div>
      {erro && <div className="alert err">{MSG[erro] ?? MSG.falha}</div>}
      <form action={createCustomer} className="card stack">
        <div className="grid2">
          <label>Razão social / nome<input name="legal_name" required /></label>
          <label>Nome fantasia<input name="trade_name" /></label>
        </div>
        <div className="grid2">
          <label>CNPJ ou CPF<input name="tax_id" inputMode="numeric" placeholder="somente números ou com pontuação" /></label>
          <label>Segmento<input name="segment" placeholder="ex.: cosméticos, pet shop, indústria" /></label>
        </div>
        <h2 style={{ marginTop: 8 }}>Contato principal</h2>
        <div className="grid2">
          <label>Nome<input name="contact_name" /></label>
          <label>WhatsApp / telefone<input name="contact_phone" inputMode="tel" /></label>
        </div>
        <label>E-mail<input name="contact_email" type="email" /></label>
        <label>Observações internas (nunca aparecem para o cliente)<textarea name="internal_notes" rows={3} /></label>
        <div><button className="btn" type="submit">Cadastrar cliente</button></div>
      </form>
    </>
  );
}

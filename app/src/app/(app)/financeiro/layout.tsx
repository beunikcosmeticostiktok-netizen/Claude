import Link from 'next/link';
import { requireRole } from '@/lib/auth';

export default async function FinLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['admin', 'gestor', 'financeiro']);
  return (
    <>
      <div className="tabs">
        <Link href="/financeiro">Visão geral</Link><Link href="/financeiro/titulos">Contas a receber e a pagar</Link>
        <Link href="/financeiro/pagamentos">Pagamentos</Link><Link href="/financeiro/caixa">Caixa e conciliação</Link><Link href="/financeiro/relatorios">Relatórios</Link><Link href="/financeiro/contas">Contas e categorias</Link>
      </div>
      {children}
    </>
  );
}

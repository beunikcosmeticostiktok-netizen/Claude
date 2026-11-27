import { redirect } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { getSession } from '@/lib/auth';
import { signOut } from '../../login/actions';

export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, portal, roles } = await getSession();
  if (user.user_metadata?.must_change_password) redirect('/definir-senha');
  if (!profile?.active || portal.length === 0) redirect(roles.length ? '/' : '/login');
  return (
    <>
      <header className="ptop"><div className="in">
        <img src="/logo.png" alt="Century Shalom" />
        <Nav variant="side" items={[{ href: '/portal', label: 'Início' }, { href: '/portal/orcamentos', label: 'Orçamentos' }, { href: '/portal/pedidos', label: 'Pedidos' }]} />
        <form action={signOut} className="inline"><span className="muted small">{profile.full_name || profile.email}</span><button className="btn line sm" type="submit">Sair</button></form>
      </div></header>
      <main className="pmain">{children}</main>
    </>
  );
}

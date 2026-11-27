import { redirect } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { getSession } from '@/lib/auth';
import { NAV, ROLE_LABEL, canSee } from '@/lib/roles';
import { signOut } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, roles } = await getSession();
  if (user.user_metadata?.must_change_password) redirect('/definir-senha');

  const Blocked = ({ title, text }: { title: string; text: string }) => (
    <div className="center-page"><div className="auth card">
      <img src="/logo.png" alt="Century Shalom" />
      <h1>{title}</h1><p className="muted">{text}</p>
      <form action={signOut}><button className="btn line full" type="submit">Sair</button></form>
    </div></div>
  );
  if (!profile?.active) return <Blocked title="Acesso desativado" text="Seu acesso foi desativado. Fale com o administrador." />;
  if (roles.length === 0) {
    return <Blocked title="Acesso ainda não liberado"
      text="Seu login existe, mas ainda não tem permissões. O portal do cliente está em construção: assim que estiver disponível, você receberá o aviso." />;
  }

  const items = NAV.filter((n) => canSee(roles, n.roles)).map(({ href, label }) => ({ href, label }));
  return (
    <div className="shell">
      <aside className="side">
        <img src="/logo.png" alt="Century Shalom" />
        <Nav items={items} variant="side" />
        <div className="me">
          <b>{profile.full_name || profile.email}</b>
          <span className="muted small">{roles.map((r) => ROLE_LABEL[r]).join(' · ')}</span>
          <form action={signOut} style={{ marginTop: 10 }}><button className="btn line sm" type="submit">Sair</button></form>
        </div>
      </aside>
      <div>
        <div className="mobilebar">
          <img src="/logo.png" alt="Century Shalom" />
          <form action={signOut}><button className="btn line sm" type="submit">Sair</button></form>
        </div>
        <Nav items={items} variant="top" />
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

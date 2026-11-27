import { requireRole } from '@/lib/auth';
import { ALL_ROLES, ROLE_LABEL, type Role } from '@/lib/roles';
import { createUser, resetPassword, saveUser, setActive } from './actions';

export const dynamic = 'force-dynamic';

const MSG: Record<string, string> = {
  dados: 'Preencha nome, e-mail e senha temporária (mínimo de 10 caracteres).',
  email_existente: 'Já existe um usuário com este e-mail.',
  ultimo_admin: 'Não é possível remover ou desativar o último administrador.',
  senha_curta: 'A senha precisa ter pelo menos 10 caracteres.',
  falha: 'Não foi possível concluir a operação.',
};
const OK: Record<string, string> = { criado: 'Usuário criado. Ele trocará a senha no primeiro acesso.', salvo: 'Alterações salvas.', senha: 'Senha redefinida. O usuário trocará no próximo acesso.' };

function Roles({ selected }: { selected: Role[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {ALL_ROLES.map((r) => (
        <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
          <input type="checkbox" name="roles" value={r} defaultChecked={selected.includes(r)} style={{ width: 'auto' }} /> {ROLE_LABEL[r]}
        </label>
      ))}
    </div>
  );
}

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { erro, ok } = await searchParams;
  const { supabase } = await requireRole(['admin']);
  const [{ data: profiles }, { data: roleRows }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, active, is_seller').order('full_name'),
    supabase.from('user_roles').select('user_id, role'),
  ]);
  const rolesOf = (id: string) => (roleRows ?? []).filter((r) => r.user_id === id).map((r) => r.role as Role);

  return (
    <>
      <div className="top"><h1>Usuários</h1></div>
      {erro && <div className="alert err">{MSG[erro] ?? MSG.falha}</div>}
      {ok && <div className="alert ok">{OK[ok] ?? 'Feito.'}</div>}

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Novo usuário interno</h2>
        <p className="muted small" style={{ margin: '6px 0 14px' }}>
          Defina uma senha temporária e combine o envio com a pessoa. No primeiro acesso ela será obrigada a trocar.
        </p>
        <form action={createUser} className="stack">
          <div className="grid2">
            <label>Nome<input name="name" required /></label>
            <label>E-mail<input name="email" type="email" required /></label>
          </div>
          <label>Senha temporária (mín. 10 caracteres)<input name="password" type="text" minLength={10} required autoComplete="off" /></label>
          <div><span className="small muted">Perfis de acesso</span><div style={{ marginTop: 8 }}><Roles selected={[]} /></div></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
            <input type="checkbox" name="seller" style={{ width: 'auto' }} /> É vendedor (aparece no rastro de vendas e comissões)
          </label>
          <div><button className="btn" type="submit">Criar usuário</button></div>
        </form>
      </div>

      <div className="card scroll">
        <table className="table">
          <thead><tr><th>Nome</th><th>Perfis</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {(profiles ?? []).map((p) => {
              const rs = rolesOf(p.id);
              return (
                <tr key={p.id}>
                  <td><b>{p.full_name || '—'}</b><div className="muted small">{p.email}</div></td>
                  <td>
                    {rs.length ? rs.map((r) => <span key={r} className="badge">{ROLE_LABEL[r]}</span>) : <span className="muted small">Sem perfil (cliente ou pendente)</span>}
                    {p.is_seller && <span className="badge acc">Vendedor</span>}
                  </td>
                  <td><span className={`badge ${p.active ? 'on' : 'off'}`}>{p.active ? 'Ativo' : 'Desativado'}</span></td>
                  <td>
                    <details>
                      <summary className="btn line sm" style={{ listStyle: 'none', display: 'inline-flex' }}>Editar</summary>
                      <div className="stack" style={{ marginTop: 12, minWidth: 260 }}>
                        <form action={saveUser} className="stack">
                          <input type="hidden" name="id" value={p.id} />
                          <Roles selected={rs} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                            <input type="checkbox" name="seller" defaultChecked={p.is_seller} style={{ width: 'auto' }} /> Vendedor
                          </label>
                          <button className="btn sm" type="submit">Salvar perfis</button>
                        </form>
                        <form action={resetPassword} className="stack">
                          <input type="hidden" name="id" value={p.id} />
                          <label>Nova senha temporária<input name="password" type="text" minLength={10} autoComplete="off" /></label>
                          <button className="btn line sm" type="submit">Redefinir senha</button>
                        </form>
                        <form action={setActive}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? '0' : '1'} />
                          <button className={`btn sm ${p.active ? 'danger' : 'line'}`} type="submit">{p.active ? 'Desativar acesso' : 'Reativar acesso'}</button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { requireRole } from '@/lib/auth';
import { dbErrorText } from '@/lib/labels';
import { saveSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(['admin']);
  const [{ data: rows }, { data: users }, { data: accounts }] = await Promise.all([
    supabase.from('settings').select('key, value, description').order('key'),
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
    supabase.from('bank_accounts').select('id, name').eq('active', true).order('name'),
  ]);
  return (
    <>
      <div className="top"><h1>Configurações</h1></div>
      {sp.erro && <div className="alert err">{dbErrorText(sp.erro)}</div>}{sp.ok && <div className="alert ok">Salvo.</div>}
      <form action={saveSettings} className="card stack">
        {(rows ?? []).map((r) => {
          const name = 's:' + r.key;
          let input;
          if (typeof r.value === 'boolean') input = <input type="checkbox" name={name} defaultChecked={r.value} style={{ width: 'auto' }} />;
          else if (r.key === 'lead_responsavel_id') input = (
            <select name={name} defaultValue={(r.value as string | null) ?? ''}><option value="">Primeiro administrador</option>
              {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}</select>);
          else if (r.key === 'loja_conta_recebimento') input = (
            <select name={name} defaultValue={(r.value as string | null) ?? ''}><option value="">Única conta ativa (se houver só uma)</option>
              {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>);
          else input = <input name={name} inputMode="decimal" defaultValue={String(r.value ?? '').replace('.', ',')} />;
          return <label key={r.key}><b>{r.key}</b><span className="muted small"> — {r.description}</span>{input}</label>;
        })}
        <div><button className="btn" type="submit">Salvar configurações</button></div>
      </form>
    </>
  );
}

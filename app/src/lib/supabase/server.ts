import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const supabaseAnonKey = () =>
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const hasSupabaseEnv = () => Boolean(supabaseUrl() && supabaseAnonKey());

/** Cliente com a sessão do usuário: as regras de permissão (RLS) do banco valem. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* chamado de um Server Component: o middleware renova a sessão */
        }
      },
    },
  });
}

/** Cliente de serviço (ignora RLS). Usar SOMENTE no servidor e só depois de checar permissão. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  return createSupabaseClient(supabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
}

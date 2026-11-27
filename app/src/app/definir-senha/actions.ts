'use server';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function setPassword(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const p1 = String(formData.get('password') ?? '');
  const p2 = String(formData.get('confirm') ?? '');
  if (p1.length < 10) redirect('/definir-senha?erro=curta');
  if (p1 !== p2) redirect('/definir-senha?erro=diferente');
  const { error } = await supabase.auth.updateUser({ password: p1, data: { must_change_password: false } });
  if (error) redirect('/definir-senha?erro=falha');
  redirect('/');
}

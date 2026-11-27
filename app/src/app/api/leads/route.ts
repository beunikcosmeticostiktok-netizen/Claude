import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function corsHeaders(origin: string | null) {
  const allowed = (process.env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin',
  };
  if (allowed.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (body: unknown, status: number, origin: string | null) =>
  NextResponse.json(body, { status, headers: corsHeaders(origin) });

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, erro: 'json' }, 400, origin); }

  // Campo-isca: robôs preenchem; fingimos sucesso e não gravamos nada.
  if (clip(b.website, 200)) return json({ ok: true }, 200, origin);

  const name = clip(b.name, 120);
  const phone = clip(b.phone, 30);
  const email = clip(b.email, 160).toLowerCase();
  const interest = b.interest_type === 'projeto_exclusivo' ? 'projeto_exclusivo' : b.interest_type === 'produto_existente' ? 'produto_existente' : null;
  if (name.length < 2 || !interest) return json({ ok: false, erro: 'dados' }, 400, origin);
  if (phone.replace(/\D/g, '').length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, erro: 'contato' }, 400, origin);
  if (b.consent !== true) return json({ ok: false, erro: 'consentimento' }, 400, origin);

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret) {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: clip(b.token, 2048) }),
    }).then((x) => x.json()).catch(() => ({ success: false }));
    if (!r.success) return json({ ok: false, erro: 'robo' }, 400, origin);
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'desconhecido';
  const ipHash = createHash('sha256').update(ip + (process.env.LEAD_IP_SALT ?? '')).digest('hex');

  const admin = createAdminClient();
  const { data: allowedNow } = await admin.rpc('lead_rate_ok', { p_ip_hash: ipHash, p_phone: phone });
  if (allowedNow === false) return json({ ok: false, erro: 'limite' }, 429, origin);

  const { data: lead, error } = await admin.from('leads').insert({
    source: 'landing', interest_type: interest, name, company: clip(b.company, 160) || null,
    tax_id: clip(b.tax_id, 20) || null, phone: phone || null, email: email || null,
    product_interest: clip(b.product_interest, 200) || null, message: clip(b.message, 2000) || null,
    consent_at: new Date().toISOString(), ip_hash: ipHash,
    raw: { user_agent: clip(req.headers.get('user-agent'), 300), origin: clip(origin, 200) },
  }).select('id').single();
  if (error || !lead) { console.error('lead_insert_failed', error?.code); return json({ ok: false, erro: 'falha' }, 500, origin); }

  const { error: procErr } = await admin.rpc('process_lead', { p_lead: lead.id });
  if (procErr) console.error('lead_process_failed', procErr.code);   // o lead fica salvo e pode ser convertido depois
  return json({ ok: true }, 200, origin);
}

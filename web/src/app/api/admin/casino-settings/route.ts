import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { getCasinoSettings, setCasinoSettings, CASINO_DEFAULTS } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

async function getAdminUser() {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!data?.is_admin) return null;
  return user;
}

// GET /api/admin/casino-settings — returns all settings
export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const keys = Object.keys(CASINO_DEFAULTS) as (keyof typeof CASINO_DEFAULTS)[];
  const settings: Record<string, unknown> = {};
  for (const key of keys) {
    settings[key] = await getCasinoSettings(admin, key);
  }
  return NextResponse.json({ success: true, data: settings });
}

// PUT /api/admin/casino-settings — update one game's settings
export async function PUT(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { game, settings } = body as { game: string; settings: Record<string, number> };

  if (!game || !settings || !(game in CASINO_DEFAULTS)) {
    return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });
  }

  // bj_payout (e.g. 1.5 for 3:2) may exceed 1; all others must be in [0,1]
  for (const [k, v] of Object.entries(settings)) {
    if (typeof v !== 'number' || isNaN(v) || v < 0) {
      return NextResponse.json({ success: false, error: `Valor inválido para ${k}` }, { status: 400 });
    }
    if (k !== 'bj_payout' && v > 1) {
      return NextResponse.json({ success: false, error: `${k} debe estar entre 0 y 1` }, { status: 400 });
    }
    if (k === 'bj_payout' && v > 3) {
      return NextResponse.json({ success: false, error: 'bj_payout demasiado alto (máx 3)' }, { status: 400 });
    }
  }

  const admin = createAdminSupabaseClient();
  await setCasinoSettings(admin, game as keyof typeof CASINO_DEFAULTS, settings);
  return NextResponse.json({ success: true });
}

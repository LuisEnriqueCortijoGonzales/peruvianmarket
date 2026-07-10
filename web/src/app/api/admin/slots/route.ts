import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

async function getAdminUser() {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cs.getAll(),
        setAll: (list: { name: string; value: string; options: CookieOptions }[]) =>
          list.forEach(({ name, value, options }) => cs.set(name, value, options)),
      },
    },
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

const DEFAULTS = { win_rate: 30, max_mult: 100, min_bet: 1, max_bet: 100, fs_win_rate: 60, is_active: true, house_edge: 8 };

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin.from('slots_config').select('*').eq('id', 1).single();
    return NextResponse.json({ success: true, data: data ?? DEFAULTS });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getAdminUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const body = await req.json();
    const allowed = ['win_rate', 'max_mult', 'min_bet', 'max_bet', 'fs_win_rate', 'is_active', 'house_edge'];
    const patch: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    for (const k of allowed) if (k in body) patch[k] = body[k];

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.from('slots_config').upsert(patch).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

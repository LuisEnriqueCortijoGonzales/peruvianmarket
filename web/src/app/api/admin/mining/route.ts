import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getAdminUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

const DEFAULTS = { rate_per_click: 0.01, cooldown_seconds: 2, is_active: true };

export async function GET() {
  try {
    const sc = serviceClient();
    const { data } = await sc.from('mining_config').select('*').eq('id', 1).single();
    return NextResponse.json({ success: true, data: data ?? DEFAULTS });
  } catch {
    return NextResponse.json({ success: true, data: DEFAULTS });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };

    if (body.rate_per_click !== undefined) {
      const r = Number(body.rate_per_click);
      if (isNaN(r) || r < 0) return NextResponse.json({ success: false, error: 'rate inválido' }, { status: 400 });
      updates.rate_per_click = r;
    }
    if (body.cooldown_seconds !== undefined) {
      updates.cooldown_seconds = Math.max(1, Number(body.cooldown_seconds));
    }
    if (body.is_active !== undefined) {
      updates.is_active = Boolean(body.is_active);
    }

    const sc = serviceClient();
    const { data, error } = await sc.from('mining_config').upsert(updates).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

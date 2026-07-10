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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

// GET: list all tasks (active and inactive)
export async function GET() {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const sc = serviceClient();
    const { data, error } = await sc
      .from('earn_tasks')
      .select('*')
      .order('reward_pen', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PATCH: update task reward or toggle active status
export async function PATCH(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const { task_id, reward_pen, is_active } = await request.json();
    if (!task_id) return NextResponse.json({ success: false, error: 'task_id requerido' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (reward_pen !== undefined) {
      if (reward_pen < 0) return NextResponse.json({ success: false, error: 'reward_pen no puede ser negativo' }, { status: 400 });
      updates.reward_pen = reward_pen;
    }
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: false, error: 'Nada que actualizar' }, { status: 400 });
    }

    const sc = serviceClient();
    const { data, error } = await sc
      .from('earn_tasks')
      .update(updates)
      .eq('id', task_id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// POST — create suggestion (any authenticated user)
export async function POST(req: NextRequest) {
  try {
    const cs = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { title, description, category } = body;

    if (!title?.trim() || title.trim().length < 5)
      return NextResponse.json({ success: false, error: 'El título debe tener al menos 5 caracteres' }, { status: 400 });
    if (title.trim().length > 140)
      return NextResponse.json({ success: false, error: 'El título no puede superar 140 caracteres' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('profiles').select('username').eq('id', user.id).maybeSingle();

    const { data, error } = await admin.from('market_suggestions').insert({
      user_id: user.id,
      username: profile?.username ?? user.email?.split('@')[0] ?? 'usuario',
      title: title.trim(),
      description: description?.trim() ?? null,
      category: category ?? 'general',
      status: 'pending',
    }).select('id').single();

    if (error) throw error;
    return NextResponse.json({ success: true, data: { id: data.id } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// GET — list suggestions (admin only)
export async function GET(req: NextRequest) {
  try {
    const cs = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return NextResponse.json({ success: false, error: 'Solo admins' }, { status: 403 });

    const status = new URL(req.url).searchParams.get('status') ?? 'pending';
    const { data } = await admin
      .from('market_suggestions')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// PATCH — update suggestion status (admin only)
export async function PATCH(req: NextRequest) {
  try {
    const cs = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const admin = createAdminSupabaseClient();
    const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!profile?.is_admin) return NextResponse.json({ success: false, error: 'Solo admins' }, { status: 403 });

    const { id, status, admin_note } = await req.json().catch(() => ({}));
    if (!id || !['approved', 'rejected'].includes(status))
      return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 });

    await admin.from('market_suggestions').update({
      status,
      admin_note: admin_note?.trim() ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
    }).eq('id', id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

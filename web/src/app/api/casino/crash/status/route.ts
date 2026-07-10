import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

const K = 0.08;

export async function GET() {
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
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, data: { active: false } });

    const { data: game } = await admin
      .from('crash_games').select('*').eq('address', wallet.address).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!game) return NextResponse.json({ success: true, data: { active: false } });

    const elapsed = Date.now() - new Date(game.started_at).getTime();
    const current = Math.exp((elapsed / 1000) * K);
    const crashed = current >= game.crash_at;

    if (crashed) {
      await admin.from('crash_games').update({
        status: 'crashed', multiplier_at_cashout: game.crash_at, payout: 0,
      }).eq('id', game.id);
    }

    return NextResponse.json({
      success: true,
      data: {
        active: !crashed,
        game_id: game.id,
        crashed,
        crash_at: crashed ? game.crash_at : null,
        multiplier: crashed ? game.crash_at : Math.round(current * 100) / 100,
        started_at: game.started_at,
        bet: game.bet,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// Recent history
export async function POST() {
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
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: true, data: [] });

    const { data: games } = await admin
      .from('crash_games').select('multiplier_at_cashout, status, payout, bet')
      .eq('address', wallet.address).neq('status', 'active')
      .order('created_at', { ascending: false }).limit(15);

    return NextResponse.json({ success: true, data: games ?? [] });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

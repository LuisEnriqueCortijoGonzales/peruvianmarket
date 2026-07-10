// Crash game start — house edge via provably fair crash distribution.
// P(crash > m) = (1 - edge) / m  →  E[return] = (1-edge) per unit bet.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { getCasinoSettings } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

function genCrash(houseEdge: number): number {
  const r = Math.random();
  if (r < houseEdge) return 1.00;          // instant crash (keeps EV = 1 - edge)
  return Math.round(Math.max(1.01, (1 - houseEdge) / (1 - r)) * 100) / 100;
}

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
    const bet = parseFloat(body.bet ?? '1');
    if (isNaN(bet) || bet < 0.5) return NextResponse.json({ success: false, error: 'Mínimo 0.5 CHC' },    { status: 400 });
    if (bet > 1000000)             return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: existing } = await admin
      .from('crash_games').select('id').eq('address', wallet.address).eq('status', 'active').maybeSingle();
    if (existing) return NextResponse.json({ success: false, error: 'Ya tienes una partida activa' }, { status: 400 });

    // Fetch configurable house edge
    const cfg       = await getCasinoSettings(admin, 'crash');
    const crash_at  = genCrash(cfg.house_edge);
    const started_at = new Date().toISOString();

    // Débito atómico: chequeo y descuento en una sola operación SQL
    const debitRes = await debit(admin, wallet.address, bet);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });
    await adjustHouse(admin, bet);

    const { data: game, error: gameErr } = await admin.from('crash_games').insert({
      address: wallet.address, bet, crash_at, started_at, status: 'active',
    }).select('id').single();

    if (gameErr || !game) {
      // Rollback: devolver la apuesta
      await credit(admin, wallet.address, bet);
      await adjustHouse(admin, -bet);
      throw new Error('No se pudo crear la partida');
    }

    return NextResponse.json({ success: true, data: { game_id: game.id, started_at, bet } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// Crash cashout — house already holds the bet. On successful cashout, house pays payout.
// If crashed, house keeps bet (net: +bet). If cashed out at m×, house net: bet - m×bet.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit } from '@/lib/casino-bank';
import { cookies } from 'next/headers';

const K = 0.08; // growth rate — must match client exactly

function multAt(elapsedMs: number): number {
  return Math.exp((elapsedMs / 1000) * K);
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
    const { game_id } = body;
    if (!game_id) return NextResponse.json({ success: false, error: 'game_id requerido' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: game } = await admin
      .from('crash_games').select('*').eq('id', game_id).eq('address', wallet.address).single();
    if (!game)                    return NextResponse.json({ success: false, error: 'Partida no encontrada' }, { status: 404 });
    if (game.status !== 'active') return NextResponse.json({ success: false, error: 'Partida ya terminada' }, { status: 400 });

    const now     = Date.now();
    const elapsed = now - new Date(game.started_at).getTime();
    const current = multAt(elapsed);
    const crashed = current >= game.crash_at;

    const finalMult = crashed ? game.crash_at : Math.round(current * 100) / 100;
    const payout    = crashed ? 0 : Math.round(game.bet * finalMult * 100) / 100;

    // Claim condicional: solo el primer request termina la partida y paga
    const claimed = await claimGame(admin, 'crash_games', game_id, {
      status: crashed ? 'crashed' : 'cashed_out',
      multiplier_at_cashout: finalMult,
      payout,
    });
    if (!claimed)
      return NextResponse.json({ success: false, error: 'Partida ya terminada' }, { status: 400 });

    if (!crashed) {
      // House pays payout to player (house already has the bet from /start)
      await credit(admin, wallet.address, payout);
      // House: already received `bet`, now pays `payout`. Net = bet - payout (negative if player won big).
      await adjustHouse(admin, -payout);
    }
    // If crashed: house keeps the bet (already received in /start — no further action).

    try {
      await admin.from('transactions').insert({
        type: crashed ? 'BUY' : 'CLAIM',
        from_address: wallet.address,
        to_address: 'CRASH',
        amount: crashed ? game.bet : payout,
        status: 'confirmed',
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      data: { crashed, multiplier: finalMult, payout, net_change: payout - game.bet, crash_at: game.crash_at },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

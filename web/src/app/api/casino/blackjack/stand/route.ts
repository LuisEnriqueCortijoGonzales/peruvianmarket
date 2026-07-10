import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit } from '@/lib/casino-bank';
import { dealerDraw, resolve, payout } from '@/lib/blackjack';
import { getCasinoSettings } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

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

    const { game_id } = await req.json().catch(() => ({}));
    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: game } = await admin.from('blackjack_games').select('*')
      .eq('id', game_id).eq('address', wallet.address).single();
    if (!game || game.status !== 'active')
      return NextResponse.json({ success: false, error: 'Mano no activa' }, { status: 400 });

    const cfg = await getCasinoSettings(admin, 'blackjack');
    const effectiveBet = game.bet * (game.doubled ? 2 : 1);
    const finalDealerHand = dealerDraw(game.dealer_hand);
    const result = resolve(game.player_hand, finalDealerHand);
    const p = payout(result, effectiveBet, cfg.bj_payout, cfg.house_edge);

    // Claim primero: solo el primer request resuelve la mano y paga
    const claimed = await claimGame(admin, 'blackjack_games', game_id, {
      dealer_hand: finalDealerHand,
      status: 'done',
      result,
      payout: p,
    });
    if (!claimed)
      return NextResponse.json({ success: false, error: 'Mano no activa' }, { status: 400 });

    if (p > 0) await credit(admin, wallet.address, p);
    await adjustHouse(admin, -p);

    return NextResponse.json({
      success: true,
      data: { dealer_hand: finalDealerHand, result, payout: p, net_change: p - effectiveBet },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

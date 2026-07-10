import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit } from '@/lib/casino-bank';
import { randomCard, handTotal, dealerDraw, resolve, payout } from '@/lib/blackjack';
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

    const effectiveBet = game.bet * (game.doubled ? 2 : 1);
    const newCard = randomCard();
    const playerHand: string[] = [...game.player_hand, newCard];
    const total = handTotal(playerHand);
    const bust = total > 21;
    const auto21 = total === 21; // auto-stand on 21

    let status = 'active';
    let result: string | null = null;
    let p = 0;
    let finalDealerHand: string[] = game.dealer_hand;

    if (bust || auto21) {
      // Resolve: bust = dealer wins; 21 = dealer plays out
      finalDealerHand = dealerDraw(game.dealer_hand);
      const r = bust ? 'dealer_win' : resolve(playerHand, finalDealerHand);
      const cfg = await getCasinoSettings(admin, 'blackjack');
      result = r;
      p = payout(r as Parameters<typeof payout>[0], effectiveBet, cfg.bj_payout, cfg.house_edge);
      status = 'done';

      // Claim primero: solo el primer request resuelve la mano y paga
      const claimed = await claimGame(admin, 'blackjack_games', game_id, {
        player_hand: playerHand,
        dealer_hand: finalDealerHand,
        status,
        result,
        payout: p,
      });
      if (!claimed)
        return NextResponse.json({ success: false, error: 'Mano no activa' }, { status: 400 });

      if (p > 0) await credit(admin, wallet.address, p);
      await adjustHouse(admin, -p);
    } else {
      // Carta adicional sin resolver — solo si la mano sigue activa
      const { data: updated } = await admin.from('blackjack_games').update({
        player_hand: playerHand,
      }).eq('id', game_id).eq('status', 'active').select('id');
      if (!updated || updated.length === 0)
        return NextResponse.json({ success: false, error: 'Mano no activa' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        player_hand: playerHand,
        player_total: total,
        dealer_hand: status === 'done' ? finalDealerHand : null,
        dealer_visible: [game.dealer_hand[0]],
        status,
        result,
        payout: p,
        bust,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

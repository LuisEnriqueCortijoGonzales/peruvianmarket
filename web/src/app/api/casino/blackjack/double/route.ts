import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit, debit } from '@/lib/casino-bank';
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
    if (game.player_hand.length !== 2)
      return NextResponse.json({ success: false, error: 'Solo se puede doblar con 2 cartas' }, { status: 400 });
    if (game.doubled)
      return NextResponse.json({ success: false, error: 'Ya doblaste' }, { status: 400 });

    // Claim exclusivo del doble: solo un request puede marcar doubled=true
    const { data: doubling } = await admin.from('blackjack_games')
      .update({ doubled: true })
      .eq('id', game_id).eq('status', 'active').eq('doubled', false)
      .select('id');
    if (!doubling || doubling.length === 0)
      return NextResponse.json({ success: false, error: 'Ya doblaste o la mano terminó' }, { status: 400 });

    // Débito atómico de la apuesta adicional
    const debitRes = await debit(admin, wallet.address, game.bet);
    if (!debitRes.ok) {
      // Revertir el claim del doble
      await admin.from('blackjack_games').update({ doubled: false }).eq('id', game_id);
      return NextResponse.json({ success: false, error: 'Balance insuficiente para doblar' }, { status: 400 });
    }
    await adjustHouse(admin, game.bet); // house receives additional bet

    const cfg = await getCasinoSettings(admin, 'blackjack');

    // One card only, then dealer plays
    const newCard = randomCard();
    const playerHand: string[] = [...game.player_hand, newCard];
    const playerTotal = handTotal(playerHand);
    const bust = playerTotal > 21;
    const effectiveBet = game.bet * 2; // doubled

    const finalDealerHand = dealerDraw(game.dealer_hand);
    const result = bust ? 'dealer_win' : resolve(playerHand, finalDealerHand);
    const p = payout(result as Parameters<typeof payout>[0], effectiveBet, cfg.bj_payout, cfg.house_edge);

    // Claim final: cerrar la mano antes de pagar (anti doble pago)
    const claimed = await claimGame(admin, 'blackjack_games', game_id, {
      player_hand: playerHand,
      dealer_hand: finalDealerHand,
      doubled: true,
      status: 'done',
      result,
      payout: p,
    });
    if (!claimed) {
      // Carrera extrema (stand concurrente cerró la mano): devolver la apuesta extra
      await credit(admin, wallet.address, game.bet);
      await adjustHouse(admin, -game.bet);
      return NextResponse.json({ success: false, error: 'La mano ya fue resuelta' }, { status: 409 });
    }

    if (p > 0) await credit(admin, wallet.address, p);
    await adjustHouse(admin, -p);

    return NextResponse.json({
      success: true,
      data: {
        player_hand: playerHand,
        player_total: playerTotal,
        dealer_hand: finalDealerHand,
        result,
        payout: p,
        net_change: p - effectiveBet,
        bust,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

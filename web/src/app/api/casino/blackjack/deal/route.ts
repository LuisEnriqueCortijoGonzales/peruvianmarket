// Blackjack /deal — house edge ≈0.5% (rules-based, no extra multiplier).
// House receives bet upfront; pays back payout on stand/hit resolution.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { randomCard, isNatural, dealerDraw, resolve, payout } from '@/lib/blackjack';
import { getCasinoSettings } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

async function getAuth() {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
  );
  return sb.auth.getUser().then(r => r.data.user);
}

// GET — resume an active game
export async function GET() {
  try {
    const user = await getAuth();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: true, data: null });
    const { data: game } = await admin.from('blackjack_games').select('*')
      .eq('address', wallet.address).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ success: true, data: game });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// POST — new hand
export async function POST(req: NextRequest) {
  try {
    const user = await getAuth();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const bet = parseFloat(body.bet ?? '5');
    if (isNaN(bet) || bet < 1)    return NextResponse.json({ success: false, error: 'Mínimo 1 CHC' }, { status: 400 });
    if (bet > 1000000)               return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: existing } = await admin.from('blackjack_games').select('id')
      .eq('address', wallet.address).eq('status', 'active').maybeSingle();
    if (existing) return NextResponse.json({ success: false, error: 'Ya tienes una mano activa' }, { status: 400 });

    // Fetch configurable BJ payout + house edge
    const cfg = await getCasinoSettings(admin, 'blackjack');

    // Deal: player[0,2], dealer[1,3]
    const cards = [randomCard(), randomCard(), randomCard(), randomCard()];
    const playerHand = [cards[0], cards[2]];
    const dealerHand = [cards[1], cards[3]];

    // Débito atómico de la apuesta; la casa la recibe
    const debitRes = await debit(admin, wallet.address, bet);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });
    await adjustHouse(admin, bet);
    let newBalance = debitRes.newBalance;

    // Check for immediate naturals
    const pBJ = isNatural(playerHand), dBJ = isNatural(dealerHand);
    const immediateEnd = pBJ || dBJ;
    let finalDealerHand = dealerHand;
    let gameStatus = 'active';
    let gameResult: string | null = null;
    let gamePayout: number | null = null;

    if (immediateEnd) {
      // Reveal and resolve
      const result = resolve(playerHand, dealerHand);
      const p = payout(result, bet, cfg.bj_payout, cfg.house_edge);
      gameResult = result;
      gamePayout = p;
      gameStatus = 'done';
      if (!dBJ) finalDealerHand = dealerDraw(dealerHand); // let dealer play for display
      // Pay player
      if (p > 0) {
        const credited = await credit(admin, wallet.address, p);
        newBalance = credited ?? Math.round((newBalance + p) * 100) / 100;
      }
      await adjustHouse(admin, -p);
    }

    const { data: game, error: insertErr } = await admin.from('blackjack_games').insert({
      address: wallet.address,
      bet,
      player_hand: playerHand,
      dealer_hand: finalDealerHand,
      status: gameStatus,
      result: gameResult,
      payout: gamePayout,
    }).select('id').single();

    if (insertErr || !game) {
      // Rollback: devolver la apuesta (y el premio natural si se pagó)
      await credit(admin, wallet.address, bet);
      await adjustHouse(admin, -bet);
      return NextResponse.json({
        success: false,
        error: insertErr?.message ?? 'Error al crear la mano. ¿Existe la tabla blackjack_games?',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        game_id: game.id,
        player_hand: playerHand,
        dealer_visible: [dealerHand[0]], // show only first card while active
        dealer_hand: immediateEnd ? finalDealerHand : null,
        bet,
        status: gameStatus,
        result: gameResult,
        payout: gamePayout,
        new_balance: newBalance,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit } from '@/lib/casino-bank';
import { getMultiplier, MINES_N } from '@/lib/mines';
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

    const { game_id, cell } = await req.json().catch(() => ({}));
    if (cell == null || cell < 0 || cell >= MINES_N)
      return NextResponse.json({ success: false, error: 'Celda inválida' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: game } = await admin.from('mines_games').select('*')
      .eq('id', game_id).eq('address', wallet.address).single();
    if (!game || game.status !== 'active')
      return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });

    const revealed = game.revealed_safe as number[];
    if (revealed.includes(cell))
      return NextResponse.json({ success: false, error: 'Celda ya revelada' }, { status: 400 });

    const isMine = (game.mine_positions as number[]).includes(cell);

    if (isMine) {
      const claimed = await claimGame(admin, 'mines_games', game_id, { status: 'hit_mine', payout: 0 });
      if (!claimed)
        return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });
      return NextResponse.json({
        success: true,
        data: {
          is_mine: true,
          mine_positions: game.mine_positions,
          revealed_safe: revealed,
          net_change: -(game.bet as number),
        },
      });
    }

    // Safe reveal
    const newRevealed = [...revealed, cell];
    const houseEdge   = game.house_edge as number;
    const mines       = game.mines_count as number;
    const bet         = game.bet as number;
    const newMult     = getMultiplier(mines, newRevealed.length, houseEdge);
    const potential   = Math.round(bet * newMult * 100) / 100;
    const safeCells   = MINES_N - mines;
    const allSafe     = newRevealed.length >= safeCells;

    if (allSafe) {
      // Auto-cashout — reclamar la partida ANTES de pagar (anti doble pago)
      const claimed = await claimGame(admin, 'mines_games', game_id, {
        revealed_safe: newRevealed, status: 'cashed_out', payout: potential,
      });
      if (!claimed)
        return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });
      await credit(admin, wallet.address, potential);
      await adjustHouse(admin, -potential);
      return NextResponse.json({
        success: true,
        data: {
          is_mine: false,
          revealed_safe: newRevealed,
          multiplier: newMult,
          auto_cashout: true,
          mine_positions: game.mine_positions,
          payout: potential,
          net_change: potential - bet,
        },
      });
    }

    await admin.from('mines_games').update({ revealed_safe: newRevealed }).eq('id', game_id);
    return NextResponse.json({
      success: true,
      data: {
        is_mine: false,
        revealed_safe: newRevealed,
        multiplier: newMult,
        potential_payout: potential,
        auto_cashout: false,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

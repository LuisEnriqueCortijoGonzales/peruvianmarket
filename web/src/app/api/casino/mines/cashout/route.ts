import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { claimGame, credit } from '@/lib/casino-bank';
import { getMultiplier } from '@/lib/mines';
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

    const { data: game } = await admin.from('mines_games').select('*')
      .eq('id', game_id).eq('address', wallet.address).single();
    if (!game || game.status !== 'active')
      return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });

    const revealed   = (game.revealed_safe as number[]).length;
    if (revealed === 0)
      return NextResponse.json({ success: false, error: 'Debes revelar al menos una celda antes de cobrar' }, { status: 400 });

    const houseEdge = game.house_edge as number;
    const mines     = game.mines_count as number;
    const bet       = game.bet as number;
    const mult      = getMultiplier(mines, revealed, houseEdge);
    const payout    = Math.round(bet * mult * 100) / 100;

    // Claim primero: solo el primer request marca la partida y paga
    const claimed = await claimGame(admin, 'mines_games', game_id, { status: 'cashed_out', payout });
    if (!claimed)
      return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });

    await credit(admin, wallet.address, payout);
    await adjustHouse(admin, -payout);

    return NextResponse.json({
      success: true,
      data: { payout, net_change: payout - bet, multiplier: mult, mine_positions: game.mine_positions },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// "Advance" — player moves one lane forward.
// Server rolls Math.random() against survival_rate; no client-side cell needed.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { claimGame } from '@/lib/casino-bank';
import { getMultiplier } from '@/lib/chicken';
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
    if (!game_id) return NextResponse.json({ success: false, error: 'game_id requerido' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: game } = await admin.from('chicken_games')
      .select('id, bet, step, survival_rate, house_edge, status')
      .eq('id', game_id).eq('address', wallet.address).single();
    if (!game || game.status !== 'active')
      return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });

    const survivalRate: number = game.survival_rate as number;
    const houseEdge: number    = game.house_edge as number;
    const bet: number          = game.bet as number;
    const step: number         = game.step as number;

    // Roll the lane
    const hit = Math.random() >= survivalRate;

    if (hit) {
      // Claim condicional: no sobrescribir una partida ya cobrada por un
      // cashout concurrente
      const claimed = await claimGame(admin, 'chicken_games', game_id, { status: 'hit', payout: 0 });
      if (!claimed)
        return NextResponse.json({ success: false, error: 'Partida no activa' }, { status: 400 });
      return NextResponse.json({
        success: true,
        data: { hit: true, step, payout: 0, net_change: -bet },
      });
    }

    // Survived — advance (condicionado al step leído: evita avances perdidos
    // o dobles por requests concurrentes)
    const newStep  = step + 1;
    const newMult  = getMultiplier(newStep, survivalRate, houseEdge);
    const payout   = Math.round(bet * newMult * 100) / 100;
    const nextMult = getMultiplier(newStep + 1, survivalRate, houseEdge);

    const { data: advanced } = await admin.from('chicken_games')
      .update({ step: newStep })
      .eq('id', game_id).eq('status', 'active').eq('step', step)
      .select('id');
    if (!advanced || advanced.length === 0)
      return NextResponse.json({ success: false, error: 'La partida cambió — reintenta' }, { status: 409 });

    return NextResponse.json({
      success: true,
      data: { hit: false, step: newStep, multiplier: newMult, potential_payout: payout, next_multiplier: nextMult },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

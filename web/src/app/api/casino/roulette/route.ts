// European Roulette — multi-bet support. 2.70% house edge via zero.
// All losing CHC routes to the house wallet.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { getCasinoSettings } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
type BetType = 'number'|'red'|'black'|'even'|'odd'|'low'|'high'|'dozen1'|'dozen2'|'dozen3';

interface PlacedBet { type: BetType; value?: number; amount: number }

// Returns NET profit multiplier (not total return). Win payout = bet + bet*mult.
function resolveOne(result: number, type: BetType, value?: number): { win: boolean; mult: number } {
  switch (type) {
    case 'number': return { win: result === value,                        mult: 35 };
    case 'red':    return { win: RED.has(result),                         mult: 1  };
    case 'black':  return { win: result > 0 && !RED.has(result),          mult: 1  };
    case 'even':   return { win: result > 0 && result % 2 === 0,          mult: 1  };
    case 'odd':    return { win: result > 0 && result % 2 !== 0,          mult: 1  };
    case 'low':    return { win: result >= 1 && result <= 18,             mult: 1  };
    case 'high':   return { win: result >= 19 && result <= 36,            mult: 1  };
    case 'dozen1': return { win: result >= 1  && result <= 12,            mult: 2  };
    case 'dozen2': return { win: result >= 13 && result <= 24,            mult: 2  };
    case 'dozen3': return { win: result >= 25 && result <= 36,            mult: 2  };
  }
}

const VALID_TYPES: BetType[] = ['number','red','black','even','odd','low','high','dozen1','dozen2','dozen3'];

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
    const bets: PlacedBet[] = body.bets ?? [];

    if (!Array.isArray(bets) || bets.length === 0)
      return NextResponse.json({ success: false, error: 'Debes colocar al menos una apuesta' }, { status: 400 });
    if (bets.length > 30)
      return NextResponse.json({ success: false, error: 'Máximo 30 apuestas por giro' }, { status: 400 });

    for (const b of bets) {
      if (!VALID_TYPES.includes(b.type))
        return NextResponse.json({ success: false, error: `Tipo inválido: ${b.type}` }, { status: 400 });
      if (b.type === 'number' && (b.value == null || b.value < 0 || b.value > 36))
        return NextResponse.json({ success: false, error: 'Número inválido (0-36)' }, { status: 400 });
      if (!b.amount || b.amount < 0.5)
        return NextResponse.json({ success: false, error: 'Mínimo 0.5 CHC por apuesta' }, { status: 400 });
    }

    const totalBet = Math.round(bets.reduce((s, b) => s + b.amount, 0) * 100) / 100;

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    // Débito atómico del total apostado
    const debitRes = await debit(admin, wallet.address, totalBet);
    if (!debitRes.ok)
      return NextResponse.json({ success: false, error: `Balance insuficiente (total: ${totalBet} CHC)` }, { status: 400 });

    // Fetch configurable house edge (applied on top of natural ~2.7% European edge)
    const cfg = await getCasinoSettings(admin, 'roulette');
    const winMult = 1 - Math.max(0, Math.min(0.5, cfg.house_edge));

    // Single spin for all bets
    const result = Math.floor(Math.random() * 37);
    const color  = result === 0 ? 'green' : RED.has(result) ? 'red' : 'black';

    const resolved = bets.map(b => {
      const { win, mult } = resolveOne(result, b.type, b.value);
      const netChange = win ? Math.round(b.amount * mult * winMult * 100) / 100 : -b.amount;
      return { ...b, win, multiplier: mult, net_change: netChange };
    });

    const totalNetChange = Math.round(resolved.reduce((s, r) => s + r.net_change, 0) * 100) / 100;
    // Retorno total = stakes de apuestas ganadoras + ganancia neta
    const totalReturn = Math.round(
      resolved.reduce((s, r) => s + (r.win ? r.amount + r.net_change : 0), 0) * 100,
    ) / 100;

    let newBal = debitRes.newBalance;
    if (totalReturn > 0) {
      const credited = await credit(admin, wallet.address, totalReturn);
      newBal = credited ?? Math.round((debitRes.newBalance + totalReturn) * 100) / 100;
    }

    // House: gains what player loses (net opposite)
    await adjustHouse(admin, -totalNetChange);

    try {
      await admin.from('transactions').insert({
        type: totalNetChange >= 0 ? 'CLAIM' : 'BUY',
        from_address: wallet.address,
        to_address: 'ROULETTE',
        amount: Math.abs(totalNetChange),
        status: 'confirmed',
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      data: { result, color, bets: resolved, total_net_change: totalNetChange, new_balance: newBal },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

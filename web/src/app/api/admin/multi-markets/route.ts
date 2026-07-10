import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getAdminUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
  return profile?.is_admin ? user : null;
}

// GET: fetch outcomes for a multi-market with probabilities (service role — bypasses RLS)
export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const marketId = request.nextUrl.searchParams.get('market_id');
    if (!marketId) return NextResponse.json({ success: false, error: 'market_id requerido' }, { status: 400 });

    const sc = serviceClient();

    const { data: outs, error: outsErr } = await sc
      .from('market_outcomes')
      .select('*')
      .eq('market_id', marketId)
      .order('display_order');

    if (outsErr || !outs) {
      return NextResponse.json({ success: false, error: outsErr?.message ?? 'No encontrado' }, { status: 404 });
    }

    const { data: bets } = await sc
      .from('outcome_bets')
      .select('outcome_id, amount')
      .eq('market_id', marketId);

    const betsByOutcome: Record<string, number> = {};
    (bets ?? []).forEach(b => {
      betsByOutcome[b.outcome_id] = (betsByOutcome[b.outcome_id] ?? 0) + Number(b.amount);
    });

    const totalPool = outs.reduce((s, o) => s + Number(o.seed) + (betsByOutcome[o.id] ?? 0), 0);

    const outcomes = outs.map(o => {
      const totalBet = betsByOutcome[o.id] ?? 0;
      const calcProbability = totalPool > 0
        ? (Number(o.seed) + totalBet) / totalPool
        : 1 / outs.length;
      const override = (o as Record<string, unknown>).probability_override as number | null ?? null;
      return {
        id: o.id,
        label: o.label,
        seed: Number(o.seed),
        display_order: o.display_order,
        total_bet: totalBet,
        calc_probability: calcProbability,
        override,
      };
    });

    return NextResponse.json({ success: true, data: outcomes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST: create multi-outcome market
export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const body = await request.json();
    const { question, description, category, end_date, outcomes, seed_pool = 250, seed_per_outcome } = body;

    if (!question?.trim()) return NextResponse.json({ success: false, error: 'Pregunta requerida' }, { status: 400 });
    if (!Array.isArray(outcomes) || outcomes.length < 2) {
      return NextResponse.json({ success: false, error: 'Mínimo 2 opciones' }, { status: 400 });
    }

    // Support both formats: string[] (legacy) and { label, prob }[] (new)
    const isLegacy = typeof outcomes[0] === 'string';
    const normalised: { label: string; prob: number }[] = isLegacy
      ? outcomes.map((o: string) => ({ label: o, prob: 100 / outcomes.length }))
      : outcomes;

    if (normalised.some(o => !o?.label?.trim())) {
      return NextResponse.json({ success: false, error: 'Todas las opciones deben tener nombre' }, { status: 400 });
    }
    const totalProb = normalised.reduce((s, o) => s + Number(o.prob), 0);
    if (Math.abs(totalProb - 100) > 1) {
      return NextResponse.json({ success: false, error: `Las probabilidades deben sumar 100% (actual: ${totalProb.toFixed(1)}%)` }, { status: 400 });
    }

    // Seed pool: use seed_pool if provided, otherwise fall back to seed_per_outcome * n
    const effectiveSeedPool = seed_pool ?? (seed_per_outcome ?? 50) * normalised.length;

    const sc = serviceClient();

    const { data: market, error: mErr } = await sc.from('markets').insert({
      question: question.trim(),
      description: description?.trim() || null,
      category: category || 'general',
      end_date: end_date || null,
      market_type: 'multi',
      creator_address: 'HOUSE',
      creator_user_id: admin.id,
      yes_reserve: 0,
      no_reserve: 0,
      status: 'open',
    }).select().single();

    if (mErr || !market) throw new Error(mErr?.message ?? 'Error creando mercado');

    const outcomeRows = normalised.map((o, i) => ({
      market_id: market.id,
      label: o.label.trim(),
      seed: (o.prob / 100) * effectiveSeedPool,
      display_order: i,
    }));

    const { error: oErr } = await sc.from('market_outcomes').insert(outcomeRows);
    if (oErr) throw new Error(oErr.message);

    return NextResponse.json({ success: true, data: market });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PATCH: resolve multi-outcome market (pick winner)
export async function PATCH(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });

    const { market_id, winning_outcome_id } = await request.json();
    if (!market_id || !winning_outcome_id) {
      return NextResponse.json({ success: false, error: 'market_id y winning_outcome_id requeridos' }, { status: 400 });
    }

    const sc = serviceClient();

    // Get all outcomes for this market
    const { data: outcomes } = await sc.from('market_outcomes').select('id, seed').eq('market_id', market_id);
    if (!outcomes?.length) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });

    // Get all bets
    const { data: bets } = await sc.from('outcome_bets').select('outcome_id, address, amount').eq('market_id', market_id);
    const allBets = bets ?? [];

    // Parimutuel payout — total pool includes seeds (initial liquidity)
    const totalSeedPool = outcomes.reduce((s, o) => s + Number(o.seed), 0);
    const totalBetPool  = allBets.reduce((s, b) => s + Number(b.amount), 0);
    const totalPool     = totalSeedPool + totalBetPool;

    const winningOutcome = outcomes.find(o => o.id === winning_outcome_id);
    const winnerSeed     = winningOutcome ? Number(winningOutcome.seed) : 0;
    const winnerBets     = allBets.filter(b => b.outcome_id === winning_outcome_id);
    const winnerBetPool  = winnerBets.reduce((s, b) => s + Number(b.amount), 0);
    const winnerPool     = winnerSeed + winnerBetPool;

    let payoutRatio = 0;
    if (winnerPool > 0 && totalPool > 0) {
      payoutRatio = (totalPool * 0.98) / winnerPool;

      // Group payouts by address
      const payouts: Record<string, number> = {};
      for (const bet of winnerBets) {
        payouts[bet.address] = (payouts[bet.address] ?? 0) + Number(bet.amount) * payoutRatio;
      }

      for (const [address, payout] of Object.entries(payouts)) {
        const { data: bal } = await sc.from('balances').select('amount, nonce').eq('address', address).single();
        await sc.from('balances').upsert({
          address,
          amount: (bal?.amount ?? 0) + payout,
          nonce: (bal?.nonce ?? 0) + 1,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Mark winner — wrapped in try/catch in case is_winner column not yet migrated
    try {
      await sc.from('market_outcomes').update({ is_winner: false }).eq('market_id', market_id);
      await sc.from('market_outcomes').update({ is_winner: true }).eq('id', winning_outcome_id);
    } catch {
      // Column may not exist yet — resolution still completes
    }

    // Resolve market
    const { error: resolveErr } = await sc.from('markets').update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    }).eq('id', market_id);

    if (resolveErr) throw new Error(resolveErr.message);

    return NextResponse.json({ success: true, data: { payout_ratio: payoutRatio } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

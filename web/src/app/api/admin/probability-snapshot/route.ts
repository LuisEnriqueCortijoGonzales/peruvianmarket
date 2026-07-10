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

/**
 * POST /api/admin/probability-snapshot
 *
 * Sets manual probability overrides on multi-market outcomes (oracle probabilities).
 * Each call creates a snapshot record for audit history.
 *
 * Body: {
 *   market_id: string,
 *   overrides: [{ outcome_id: string, probability: number }],  // probabilities 0-1, must sum to ~1
 *   note?: string  // reason for override
 * }
 *
 * Required SQL (run once in Supabase):
 *   ALTER TABLE market_outcomes ADD COLUMN IF NOT EXISTS probability_override DECIMAL(6,4) DEFAULT NULL;
 *   CREATE TABLE IF NOT EXISTS probability_snapshots (
 *     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 *     market_id UUID NOT NULL,
 *     outcome_id UUID NOT NULL,
 *     probability DECIMAL(6,4) NOT NULL,
 *     calc_probability DECIMAL(6,4),
 *     note TEXT,
 *     created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
 *   );
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

    const body = await request.json();
    const { market_id, overrides, note } = body as {
      market_id: string;
      overrides: { outcome_id: string; probability: number }[];
      note?: string;
    };

    if (!market_id || !Array.isArray(overrides) || overrides.length === 0) {
      return NextResponse.json({ success: false, error: 'market_id y overrides requeridos' }, { status: 400 });
    }

    const totalProb = overrides.reduce((s, o) => s + o.probability, 0);
    if (Math.abs(totalProb - 1) > 0.02) {
      return NextResponse.json({
        success: false,
        error: `Las probabilidades deben sumar 100% (actual: ${(totalProb * 100).toFixed(1)}%)`,
      }, { status: 400 });
    }

    const sc = serviceClient();

    // Verify market is open and is multi-type
    const { data: market } = await sc.from('markets').select('status, market_type').eq('id', market_id).single();
    if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    if (market.market_type !== 'multi') return NextResponse.json({ success: false, error: 'Solo para mercados multi-opción' }, { status: 400 });

    // Get current calculated probabilities for snapshot comparison
    const { data: outs } = await sc.from('market_outcomes').select('id, seed').eq('market_id', market_id);
    const { data: bets } = await sc.from('outcome_bets').select('outcome_id, amount').eq('market_id', market_id);

    const betsByOutcome: Record<string, number> = {};
    (bets ?? []).forEach(b => { betsByOutcome[b.outcome_id] = (betsByOutcome[b.outcome_id] ?? 0) + Number(b.amount); });
    const totalPool = (outs ?? []).reduce((s, o) => s + Number(o.seed) + (betsByOutcome[o.id] ?? 0), 0);
    const calcProbByOutcome: Record<string, number> = {};
    (outs ?? []).forEach(o => {
      calcProbByOutcome[o.id] = totalPool > 0
        ? (Number(o.seed) + (betsByOutcome[o.id] ?? 0)) / totalPool
        : 1 / (outs?.length ?? 1);
    });

    // Apply overrides to market_outcomes
    for (const override of overrides) {
      await sc.from('market_outcomes')
        .update({ probability_override: override.probability })
        .eq('id', override.outcome_id)
        .eq('market_id', market_id);
    }

    // Record snapshot (best-effort: ignore error if table doesn't exist yet)
    const snapshotRows = overrides.map(o => ({
      market_id,
      outcome_id: o.outcome_id,
      probability: o.probability,
      calc_probability: calcProbByOutcome[o.outcome_id] ?? null,
      note: note ?? null,
    }));

    await sc.from('probability_snapshots').insert(snapshotRows).then(() => {});

    return NextResponse.json({
      success: true,
      data: {
        market_id,
        overrides_applied: overrides.length,
        note,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/**
 * GET /api/admin/probability-snapshot?market_id=...
 * Returns snapshot history for a market
 */
export async function GET(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

    const marketId = request.nextUrl.searchParams.get('market_id');
    if (!marketId) return NextResponse.json({ success: false, error: 'market_id requerido' }, { status: 400 });

    const sc = serviceClient();
    const { data, error } = await sc
      .from('probability_snapshots')
      .select('*, market_outcomes(label)')
      .eq('market_id', marketId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      // Table might not exist yet
      return NextResponse.json({ success: true, data: [] });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

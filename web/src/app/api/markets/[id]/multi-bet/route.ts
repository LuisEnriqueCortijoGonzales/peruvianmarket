import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createClient } from '@/lib/supabase/server';
import { debit } from '@/lib/casino-bank';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: market_id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const { outcome_id, address, amount } = await request.json();
    if (!outcome_id || !address || !amount || amount <= 0) {
      return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();

    // Verify wallet belongs to user
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).eq('address', address).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Wallet no autorizada' }, { status: 401 });

    // Verify market is open and multi
    const { data: market } = await admin.from('markets').select('status, market_type').eq('id', market_id).single();
    if (!market || market.status !== 'open') return NextResponse.json({ success: false, error: 'Mercado no disponible' }, { status: 400 });
    if (market.market_type !== 'multi') return NextResponse.json({ success: false, error: 'Use la API de trades para mercados binarios' }, { status: 400 });

    // Verify outcome belongs to market
    const { data: outcome } = await admin.from('market_outcomes').select('id').eq('id', outcome_id).eq('market_id', market_id).single();
    if (!outcome) return NextResponse.json({ success: false, error: 'Opción no encontrada' }, { status: 400 });

    // Débito atómico: chequeo y descuento en una sola operación SQL
    const debitRes = await debit(admin, address, amount);
    if (!debitRes.ok) {
      return NextResponse.json({ success: false, error: `Saldo insuficiente: ${debitRes.newBalance.toFixed(2)} CHC` }, { status: 400 });
    }

    // Record bet
    await admin.from('outcome_bets').insert({ outcome_id, market_id, address, amount });

    // Record transaction
    await admin.from('transactions').insert({
      type: 'BUY',
      from_address: address,
      market_id,
      amount,
      outcome: outcome_id,
      status: 'confirmed',
    });

    // Record bet-calculated probability snapshot so the chart updates.
    // Both bets and admin oracle updates appear in the chart; admin overrides
    // are stored separately in probability_override — they don't block bet snapshots.
    try {
      const { data: allOutcomes } = await admin
        .from('market_outcomes')
        .select('id, seed')
        .eq('market_id', market_id);

      if (allOutcomes?.length) {
        const { data: allBets } = await admin
          .from('outcome_bets')
          .select('outcome_id, amount')
          .eq('market_id', market_id);

        const betsByOutcome: Record<string, number> = {};
        (allBets ?? []).forEach(b => {
          betsByOutcome[b.outcome_id] = (betsByOutcome[b.outcome_id] ?? 0) + Number(b.amount);
        });

        const totalPool = allOutcomes.reduce(
          (s, o) => s + Number(o.seed) + (betsByOutcome[o.id] ?? 0), 0,
        );

        const snapshotRows = allOutcomes.map(o => {
          const prob = totalPool > 0
            ? (Number(o.seed) + (betsByOutcome[o.id] ?? 0)) / totalPool
            : 1 / allOutcomes.length;
          return { market_id, outcome_id: o.id, probability: prob, calc_probability: prob, note: 'bet' };
        });

        await admin.from('probability_snapshots').insert(snapshotRows);
      }
    } catch {
      // probability_snapshots table may not exist yet — safe to ignore
    }

    return NextResponse.json({ success: true, data: { new_balance: debitRes.newBalance } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

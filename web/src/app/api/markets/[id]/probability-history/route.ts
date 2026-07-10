import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const admin = createAdminSupabaseClient();

    const { data: market } = await admin
      .from('markets')
      .select('id, created_at, market_type')
      .eq('id', id)
      .single();

    if (!market || market.market_type !== 'multi') {
      return NextResponse.json({ success: false, error: 'Not found' });
    }

    const { data: outcomes } = await admin
      .from('market_outcomes')
      .select('id, label, seed, display_order')
      .eq('market_id', id)
      .order('display_order');

    if (!outcomes?.length) {
      return NextResponse.json({ success: true, data: { outcomes: [], history: [] } });
    }

    // Initial probabilities from seed values
    const seedTotal = outcomes.reduce((s, o) => s + Number(o.seed), 0);
    const initialProbs: Record<string, number> = {};
    outcomes.forEach(o => {
      initialProbs[o.id] = seedTotal > 0 ? Number(o.seed) / seedTotal : 1 / outcomes.length;
    });

    // Fetch snapshots — best-effort (table may not exist yet)
    let snapshots: { outcome_id: string; probability: number; created_at: string }[] = [];
    try {
      const { data: snaps } = await admin
        .from('probability_snapshots')
        .select('outcome_id, probability, created_at')
        .eq('market_id', id)
        .order('created_at', { ascending: true });
      if (snaps) {
        snapshots = snaps.map(s => ({
          outcome_id: s.outcome_id,
          probability: Number(s.probability),
          created_at: s.created_at,
        }));
      }
    } catch {
      // probability_snapshots table doesn't exist yet — that's OK
    }

    // Group snapshot rows that arrived within 5 s of each other = one admin update
    const eventMap = new Map<number, Record<string, number>>();
    for (const snap of snapshots) {
      const bucket = Math.floor(new Date(snap.created_at).getTime() / 5000) * 5000;
      if (!eventMap.has(bucket)) eventMap.set(bucket, {});
      eventMap.get(bucket)![snap.outcome_id] = snap.probability;
    }
    const sortedEvents = Array.from(eventMap.entries()).sort((a, b) => a[0] - b[0]);

    // Build step-function history
    const startTime = new Date(market.created_at).getTime();
    const now = Date.now();
    const currentState: Record<string, number> = { ...initialProbs };

    const history: { timestamp: string; probabilities: Record<string, number> }[] = [];

    history.push({
      timestamp: new Date(startTime).toISOString(),
      probabilities: { ...currentState },
    });

    for (const [time, probs] of sortedEvents) {
      if (time <= startTime) continue;
      Object.assign(currentState, probs);
      history.push({
        timestamp: new Date(time).toISOString(),
        probabilities: { ...currentState },
      });
    }

    // Add a point at current time so the line extends to now
    const lastTs = new Date(history[history.length - 1].timestamp).getTime();
    if (now - lastTs > 60 * 1000) {
      history.push({
        timestamp: new Date(now).toISOString(),
        probabilities: { ...currentState },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        outcomes: outcomes.map(o => ({ id: o.id, label: o.label })),
        history,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

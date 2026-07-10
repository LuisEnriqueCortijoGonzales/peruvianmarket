import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { Position, Market } from '@/lib/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const admin = createAdminSupabaseClient();
    const { address } = await params;

    const [balanceRes, faucetRes, positionsRes] = await Promise.all([
      admin.from('balances').select('amount, nonce').eq('address', address).single(),
      admin.from('faucet_claims').select('address').eq('address', address).maybeSingle(),
      admin
        .from('positions')
        .select('*, markets(*)')
        .eq('address', address)
        .returns<(Position & { markets: Market | null })[]>(),
    ]);

    const positions = (positionsRes.data ?? [])
      .filter((p) => p.yes_shares > 0 || p.no_shares > 0)
      .map((p) => ({
        market_id: p.market_id,
        yes_shares: p.yes_shares,
        no_shares: p.no_shares,
        market: p.markets,
      }));

    return NextResponse.json({
      success: true,
      data: {
        address,
        balance: balanceRes.data?.amount ?? 0,
        nonce: balanceRes.data?.nonce ?? 0,
        has_faucet: !!faucetRes.data,
        positions,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import type { Position, Market } from '@/lib/types';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Get wallet by user_id — no localStorage needed
    const { data: wallet } = await admin
      .from('wallets')
      .select('address, public_key')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Sin wallet configurada' }, { status: 404 });
    }

    const { address, public_key } = wallet;

    const [balanceRes, faucetRes, positionsRes] = await Promise.all([
      admin.from('balances').select('*').eq('address', address).maybeSingle(),
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
        publicKey: public_key,
        balance: balanceRes.data?.amount ?? 0,
        nonce: balanceRes.data?.nonce ?? 0,
        scc: Number(balanceRes.data?.scc ?? 0),
        hasFaucet: !!faucetRes.data,
        positions,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

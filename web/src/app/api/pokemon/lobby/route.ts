// Lobby: retos abiertos + mi batalla en curso (para retomar).
import { NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';

export async function GET() {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const [openRes, mineRes] = await Promise.all([
      admin.from('pokemon_battles')
        .select('id, creator_address, wager, mode, created_at')
        .eq('status', 'waiting')
        .order('created_at', { ascending: false })
        .limit(20),
      admin.from('pokemon_battles')
        .select('id, creator_address, opponent_address, wager, status, mode, bot_level, created_at')
        .or(`creator_address.eq.${address},opponent_address.eq.${address}`)
        .in('status', ['waiting', 'active'])
        .limit(1).maybeSingle(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        open: (openRes.data ?? []).filter(b => b.creator_address !== address),
        mine: mineRes.data ?? null,
        my_address: address,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

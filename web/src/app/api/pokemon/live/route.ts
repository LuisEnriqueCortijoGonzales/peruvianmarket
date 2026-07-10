// Batallas en vivo para espectar y apostar.
import { NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { getBattle, SIDEBET_MAX_TURN } from '@/lib/pokemon-battle';

export async function GET() {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { data } = await admin.from('pokemon_battles')
      .select('id, creator_address, opponent_address, wager, mode, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);

    const live = (data ?? [])
      .filter(b => b.creator_address !== address && b.opponent_address !== address)
      .map(b => {
        const mem = getBattle(b.id);
        return {
          ...b,
          turn: mem?.turn ?? 0,
          bets_open: !!mem && !mem.ended && (mem.turn ?? 0) <= SIDEBET_MAX_TURN,
        };
      })
      .filter(b => !!getBattle(b.id)); // solo las que este servidor tiene en memoria

    return NextResponse.json({ success: true, data: live });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

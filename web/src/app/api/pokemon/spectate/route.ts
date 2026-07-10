// Vista de espectador: log neutral (sin requests ni equipos ocultos) + pools
// de apuestas laterales en vivo.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { getBattle, SIDEBET_MAX_TURN } from '@/lib/pokemon-battle';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const battleId = req.nextUrl.searchParams.get('battle_id');
    const since = Math.max(0, parseInt(req.nextUrl.searchParams.get('since') ?? '0', 10) || 0);
    if (!battleId) return NextResponse.json({ success: false, error: 'battle_id requerido' }, { status: 400 });

    const { data: row } = await admin.from('pokemon_battles')
      .select('id, creator_address, opponent_address, wager, status, winner_address')
      .eq('id', battleId).single();
    if (!row) return NextResponse.json({ success: false, error: 'Batalla no encontrada' }, { status: 404 });

    // Pools de apuestas laterales
    const { data: bets } = await admin.from('pokemon_side_bets')
      .select('address, side, amount')
      .eq('battle_id', battleId);
    const poolP1 = (bets ?? []).filter(b => b.side === 'p1').reduce((s, b) => s + Number(b.amount), 0);
    const poolP2 = (bets ?? []).filter(b => b.side === 'p2').reduce((s, b) => s + Number(b.amount), 0);
    const myBet = (bets ?? []).find(b => b.address === address) ?? null;

    if (row.status !== 'active') {
      return NextResponse.json({
        success: true,
        data: {
          status: row.status, winner_address: row.winner_address,
          creator: row.creator_address, opponent: row.opponent_address,
          wager: Number(row.wager), pool_p1: poolP1, pool_p2: poolP2,
          my_bet: myBet, log: [], log_seq: since, turn: 0, bets_open: false,
        },
      });
    }

    const battle = getBattle(battleId);
    if (!battle) return NextResponse.json({ success: false, error: 'Batalla no disponible en este servidor' }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: {
        status: battle.ended ? 'finished' : 'active',
        winner_address: battle.ended && !battle.tie ? battle.winnerAddress() : null,
        creator: row.creator_address,
        opponent: row.opponent_address,
        wager: Number(row.wager),
        turn: battle.turn,
        bets_open: !battle.ended && battle.turn <= SIDEBET_MAX_TURN,
        pool_p1: poolP1,
        pool_p2: poolP2,
        my_bet: myBet,
        log: battle.spectatorLog.slice(since),
        log_seq: battle.spectatorLog.length,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

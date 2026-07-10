// Estado de la batalla para el jugador que consulta (polling cada ~2s).
// Devuelve SOLO la vista de su lado: su log, su request (movimientos legales),
// y flags de fin/timeout. Nunca expone el equipo rival.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { getBattle, settleBattle, setAdminFactory, TURN_TIMEOUT_MS, BOT_PAYOUTS, type BotLevel } from '@/lib/pokemon-battle';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const battleId = req.nextUrl.searchParams.get('battle_id');
    const since = Math.max(0, parseInt(req.nextUrl.searchParams.get('since') ?? '0', 10) || 0);
    if (!battleId) return NextResponse.json({ success: false, error: 'battle_id requerido' }, { status: 400 });

    const { data: row } = await admin.from('pokemon_battles')
      .select('id, creator_address, opponent_address, wager, status, winner_address, mode, bot_level, updated_at')
      .eq('id', battleId).single();
    if (!row) return NextResponse.json({ success: false, error: 'Batalla no encontrada' }, { status: 404 });
    if (row.creator_address !== address && row.opponent_address !== address)
      return NextResponse.json({ success: false, error: 'No participas en esta batalla' }, { status: 403 });

    const mode = row.mode ?? 'pvp_random';
    const prize = mode === 'bot'
      ? Math.round(Number(row.wager) * (BOT_PAYOUTS[(row.bot_level ?? 'facil') as BotLevel] ?? 1.5) * 100) / 100
      : Number(row.wager) * 2;

    if (row.status === 'finished' || row.status === 'cancelled') {
      return NextResponse.json({
        success: true,
        data: { status: row.status, winner_address: row.winner_address, wager: Number(row.wager), mode, prize },
      });
    }
    if (row.status === 'waiting') {
      return NextResponse.json({ success: true, data: { status: 'waiting', wager: Number(row.wager) } });
    }

    // status === 'active'
    const battle = getBattle(battleId);
    if (!battle) {
      // Posible huérfana (reinicio del servidor a mitad de batalla).
      // Margen de gracia de 20s: no reembolsar batallas recién creadas por
      // una carrera momentánea entre requests.
      const ageMs = Date.now() - new Date(row.updated_at ?? 0).getTime();
      if (ageMs < 20_000) {
        return NextResponse.json({
          success: true,
          data: { status: 'active', starting: true, wager: Number(row.wager), mode, prize, log: [], log_seq: since },
        });
      }
      setAdminFactory(() => createAdminSupabaseClient());
      await settleBattle(admin, battleId, null);
      return NextResponse.json({
        success: true,
        data: { status: 'finished', winner_address: null, refunded: true, wager: Number(row.wager), mode, prize },
      });
    }

    if (battle.ended) {
      // El pago corre en onBattleEnded; settleBattle es idempotente por el claim
      await settleBattle(admin, battleId, battle.tie ? null : battle.winnerAddress());
    }

    const side = battle.sideOf(address)!;
    const other = side === 'p1' ? 'p2' : 'p1';
    const mySide = battle.sides[side];
    const opp = battle.sides[other];

    const oppPendingMs = opp.pendingSince ? Date.now() - opp.pendingSince : 0;

    return NextResponse.json({
      success: true,
      data: {
        status: battle.ended ? 'finished' : 'active',
        side,
        wager: Number(row.wager),
        mode,
        prize,
        log: mySide.log.slice(since),
        log_seq: mySide.log.length,
        request: mySide.request,
        my_pending: mySide.pendingSince !== null,
        opponent_pending_ms: oppPendingMs,
        timeout_claimable: mode !== 'bot' && oppPendingMs > TURN_TIMEOUT_MS,
        winner_address: battle.ended ? (battle.tie ? null : battle.winnerAddress()) : null,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

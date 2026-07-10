// Apuesta lateral de espectador: parimutuel sobre quién gana la batalla.
// Abiertas hasta el turno SIDEBET_MAX_TURN. Una apuesta por espectador.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { credit, debit } from '@/lib/casino-bank';
import { getBattle, SIDEBET_MAX_TURN } from '@/lib/pokemon-battle';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { battle_id, side, amount } = await req.json().catch(() => ({}));
    const amt = parseFloat(amount ?? '0');
    if (!battle_id || !['p1', 'p2'].includes(side))
      return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });
    if (isNaN(amt) || amt < 1)   return NextResponse.json({ success: false, error: 'Apuesta mínima 1 CHC' }, { status: 400 });
    if (amt > 1000000)            return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });

    const { data: row } = await admin.from('pokemon_battles')
      .select('id, creator_address, opponent_address, status')
      .eq('id', battle_id).single();
    if (!row || row.status !== 'active')
      return NextResponse.json({ success: false, error: 'La batalla no está activa' }, { status: 400 });
    if (row.creator_address === address || row.opponent_address === address)
      return NextResponse.json({ success: false, error: 'Los combatientes no pueden apostar de lado' }, { status: 400 });

    const battle = getBattle(battle_id);
    if (!battle || battle.ended || battle.turn > SIDEBET_MAX_TURN)
      return NextResponse.json({ success: false, error: `Las apuestas cierran en el turno ${SIDEBET_MAX_TURN}` }, { status: 400 });

    // Una apuesta por espectador por batalla
    const { data: prev } = await admin.from('pokemon_side_bets')
      .select('id').eq('battle_id', battle_id).eq('address', address).maybeSingle();
    if (prev) return NextResponse.json({ success: false, error: 'Ya apostaste en esta batalla' }, { status: 400 });

    const debitRes = await debit(admin, address, amt);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });

    const { error } = await admin.from('pokemon_side_bets').insert({
      battle_id, address, side, amount: amt, status: 'open',
    });
    if (error) {
      await credit(admin, address, amt);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { side, amount: amt } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

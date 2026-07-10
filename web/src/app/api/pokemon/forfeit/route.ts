// Rendirse — o reclamar victoria si el rival superó el timeout de turno.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { getBattle, setAdminFactory, TURN_TIMEOUT_MS } from '@/lib/pokemon-battle';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { address } = auth;

    const { battle_id, claim_timeout } = await req.json().catch(() => ({}));
    if (!battle_id) return NextResponse.json({ success: false, error: 'battle_id requerido' }, { status: 400 });

    const battle = getBattle(battle_id);
    if (!battle) return NextResponse.json({ success: false, error: 'Batalla no activa en este servidor' }, { status: 404 });
    if (battle.ended) return NextResponse.json({ success: false, error: 'La batalla ya terminó' }, { status: 400 });

    const side = battle.sideOf(address);
    if (!side) return NextResponse.json({ success: false, error: 'No participas en esta batalla' }, { status: 403 });

    setAdminFactory(() => createAdminSupabaseClient());

    if (claim_timeout) {
      // Reclamo de victoria: el RIVAL debe llevar más del timeout sin elegir
      const other = side === 'p1' ? 'p2' : 'p1';
      const oppPending = battle.sides[other].pendingSince;
      if (!oppPending || Date.now() - oppPending < TURN_TIMEOUT_MS)
        return NextResponse.json({ success: false, error: 'El rival aún está dentro del tiempo' }, { status: 400 });
      battle.forfeit(other); // el rival pierde por inactividad
      return NextResponse.json({ success: true, data: { won_by_timeout: true } });
    }

    battle.forfeit(side); // rendición propia
    return NextResponse.json({ success: true, data: { forfeited: true } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

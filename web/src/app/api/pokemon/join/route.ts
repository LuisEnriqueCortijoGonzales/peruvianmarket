// Aceptar reto PvP: claim atómico + escrow del retador. En modo custom carga
// los equipos de ambos jugadores y los empaqueta para el simulador.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { credit, debit } from '@/lib/casino-bank';
import { startBattle, setAdminFactory, packTeam, type BattleMode, type TeamSlotInput } from '@/lib/pokemon-battle';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { battle_id } = await req.json().catch(() => ({}));
    if (!battle_id) return NextResponse.json({ success: false, error: 'battle_id requerido' }, { status: 400 });

    const { data: current } = await admin.from('pokemon_battles').select('id')
      .or(`creator_address.eq.${address},opponent_address.eq.${address}`)
      .in('status', ['waiting', 'active'])
      .limit(1).maybeSingle();
    if (current) return NextResponse.json({ success: false, error: 'Ya tienes un reto o batalla en curso' }, { status: 400 });

    const { data: room } = await admin.from('pokemon_battles')
      .select('id, creator_address, wager, status, mode')
      .eq('id', battle_id).single();
    if (!room || room.status !== 'waiting')
      return NextResponse.json({ success: false, error: 'El reto ya no está disponible' }, { status: 400 });
    if (room.creator_address === address)
      return NextResponse.json({ success: false, error: 'No puedes aceptar tu propio reto' }, { status: 400 });

    const mode: BattleMode = (room.mode as BattleMode) ?? 'pvp_random';

    // Modo custom: ambos necesitan equipo guardado
    let p1Team: string | undefined;
    let p2Team: string | undefined;
    if (mode === 'pvp_custom') {
      const [{ data: t1 }, { data: t2 }] = await Promise.all([
        admin.from('pokemon_teams').select('slots').eq('address', room.creator_address).maybeSingle(),
        admin.from('pokemon_teams').select('slots').eq('address', address).maybeSingle(),
      ]);
      if (!t2) return NextResponse.json({ success: false, error: 'Primero crea tu equipo en el Team Builder' }, { status: 400 });
      if (!t1) return NextResponse.json({ success: false, error: 'El creador ya no tiene equipo válido' }, { status: 400 });
      p1Team = packTeam(t1.slots as TeamSlotInput[]);
      p2Team = packTeam(t2.slots as TeamSlotInput[]);
    }

    const wager = Number(room.wager);
    const debitRes = await debit(admin, address, wager);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });

    const { data: claimed } = await admin.from('pokemon_battles')
      .update({ opponent_address: address, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', battle_id).eq('status', 'waiting')
      .select('id');
    if (!claimed || claimed.length === 0) {
      await credit(admin, address, wager);
      return NextResponse.json({ success: false, error: 'Otro jugador aceptó el reto primero' }, { status: 409 });
    }

    setAdminFactory(() => createAdminSupabaseClient());
    try {
      startBattle({
        id: battle_id,
        mode,
        p1: { address: room.creator_address, name: room.creator_address, team: p1Team },
        p2: { address, name: address, team: p2Team },
      });
    } catch (simErr) {
      // El simulador no arrancó: cancelar y reembolsar a ambos
      await admin.from('pokemon_battles').update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', battle_id).eq('status', 'active');
      await credit(admin, address, wager);
      await credit(admin, room.creator_address, wager);
      return NextResponse.json({
        success: false,
        error: `No se pudo iniciar el simulador: ${simErr instanceof Error ? simErr.message : 'error'}`,
      }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { battle_id, wager, mode } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

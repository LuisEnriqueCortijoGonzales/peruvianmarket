// Equipo del jugador para el modo 1v1 custom (un equipo activo por wallet).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { Dex } from '@pkmn/sim';
import type { TeamSlotInput } from '@/lib/pokemon-battle';

export async function GET() {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { data } = await admin.from('pokemon_teams')
      .select('slots, updated_at').eq('address', address).maybeSingle();
    return NextResponse.json({ success: true, data: data ?? null });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const body = await req.json().catch(() => ({}));
    const slots = body.slots as TeamSlotInput[];

    if (!Array.isArray(slots) || slots.length !== 6)
      return NextResponse.json({ success: false, error: 'El equipo debe tener exactamente 6 Pokémon' }, { status: 400 });

    // Validación server-side: especies existen, movimientos existen, 1-4 por slot
    for (const [i, slot] of slots.entries()) {
      const species = Dex.species.get(slot.species ?? '');
      if (!species.exists || species.num <= 0)
        return NextResponse.json({ success: false, error: `Slot ${i + 1}: especie inválida` }, { status: 400 });
      const moves = (slot.moves ?? []).filter(Boolean);
      if (moves.length < 1 || moves.length > 4)
        return NextResponse.json({ success: false, error: `Slot ${i + 1} (${species.name}): entre 1 y 4 movimientos` }, { status: 400 });
      for (const mv of moves) {
        if (!Dex.moves.get(mv).exists)
          return NextResponse.json({ success: false, error: `Slot ${i + 1}: movimiento "${mv}" no existe` }, { status: 400 });
      }
      const validAbilities = Object.values(species.abilities).filter(Boolean) as string[];
      if (slot.ability && !validAbilities.includes(slot.ability))
        return NextResponse.json({ success: false, error: `Slot ${i + 1}: habilidad inválida para ${species.name}` }, { status: 400 });
    }

    const clean = slots.map(s => ({
      species: Dex.species.get(s.species).name,
      ability: s.ability ?? '',
      item: (s.item ?? '').slice(0, 40),
      moves: s.moves.filter(Boolean).slice(0, 4).map(m => Dex.moves.get(m).name),
    }));

    await admin.from('pokemon_teams').upsert(
      { address, slots: clean, updated_at: new Date().toISOString() },
      { onConflict: 'address' },
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// Pokédex para el team builder: búsqueda de especies y learnset legal.
// Los datos salen de @pkmn/sim server-side (no se envían MBs al cliente).
import { NextRequest, NextResponse } from 'next/server';
import { Dex } from '@pkmn/sim';
import { getAuthedWallet } from '@/lib/api-auth';

interface SpeciesLite { id: string; name: string; types: string[]; num: number }

// Lista de especies cacheada en memoria (se construye una vez)
let SPECIES_CACHE: SpeciesLite[] | null = null;
function allSpecies(): SpeciesLite[] {
  if (!SPECIES_CACHE) {
    SPECIES_CACHE = Dex.species.all()
      .filter(s => s.exists && s.num > 0 && !s.isNonstandard)
      .map(s => ({ id: s.id, name: s.name, types: s.types as string[], num: s.num }));
  }
  return SPECIES_CACHE;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const q = req.nextUrl.searchParams.get('q');
    const speciesId = req.nextUrl.searchParams.get('species');

    if (speciesId) {
      // Detalle: habilidades + learnset legal (movimientos que puede aprender)
      const species = Dex.species.get(speciesId);
      if (!species.exists) return NextResponse.json({ success: false, error: 'Especie no encontrada' }, { status: 404 });

      const abilities = Object.values(species.abilities).filter(Boolean) as string[];

      // Learnset: incluye el de la forma base si la forma no tiene propio
      const learnsetIds = new Set<string>();
      let ls = await Dex.learnsets.get(species.id);
      if ((!ls?.learnset || Object.keys(ls.learnset).length === 0) && species.baseSpecies) {
        ls = await Dex.learnsets.get(Dex.species.get(species.baseSpecies).id);
      }
      // Cadena de pre-evoluciones: heredan movimientos
      let prevo = species.prevo;
      const chain = [ls];
      while (prevo) {
        const prevoSpecies = Dex.species.get(prevo);
        chain.push(await Dex.learnsets.get(prevoSpecies.id));
        prevo = prevoSpecies.prevo;
      }
      for (const set of chain) {
        for (const moveId of Object.keys(set?.learnset ?? {})) learnsetIds.add(moveId);
      }

      const moves = [...learnsetIds]
        .map(id => Dex.moves.get(id))
        .filter(m => m.exists && !m.isNonstandard)
        .map(m => ({ id: m.id, name: m.name, type: m.type, power: m.basePower, category: m.category }))
        .sort((a, b) => (b.power || 0) - (a.power || 0));

      return NextResponse.json({
        success: true,
        data: { name: species.name, types: species.types, abilities, moves },
      });
    }

    // Búsqueda por nombre
    const term = (q ?? '').toLowerCase().trim();
    if (term.length < 2) return NextResponse.json({ success: true, data: [] });
    const results = allSpecies()
      .filter(s => s.name.toLowerCase().includes(term))
      .slice(0, 20);
    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

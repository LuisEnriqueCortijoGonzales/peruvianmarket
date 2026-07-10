// Elección de turno: "move 1-4" o "switch 2-6". El sim valida la legalidad
// real (PP, trampas, faints); aquí solo se sanea el formato del comando.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { getBattle } from '@/lib/pokemon-battle';

const CHOICE_RE = /^(move [1-4](?: terastallize)?|switch [2-6]|default)$/;

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { address } = auth;

    const { battle_id, choice } = await req.json().catch(() => ({}));
    if (!battle_id || typeof choice !== 'string' || !CHOICE_RE.test(choice))
      return NextResponse.json({ success: false, error: 'Elección inválida' }, { status: 400 });

    const battle = getBattle(battle_id);
    if (!battle) return NextResponse.json({ success: false, error: 'Batalla no activa en este servidor' }, { status: 404 });
    if (battle.ended) return NextResponse.json({ success: false, error: 'La batalla ya terminó' }, { status: 400 });

    const side = battle.sideOf(address);
    if (!side) return NextResponse.json({ success: false, error: 'No participas en esta batalla' }, { status: 403 });

    battle.choose(side, choice);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// Cancelar un reto propio en espera: claim condicional + reembolso del escrow.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { credit } from '@/lib/casino-bank';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { battle_id } = await req.json().catch(() => ({}));
    if (!battle_id) return NextResponse.json({ success: false, error: 'battle_id requerido' }, { status: 400 });

    const { data: claimed } = await admin.from('pokemon_battles')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', battle_id).eq('status', 'waiting').eq('creator_address', address)
      .select('wager');
    if (!claimed || claimed.length === 0)
      return NextResponse.json({ success: false, error: 'El reto ya no se puede cancelar' }, { status: 400 });

    await credit(admin, address, Number(claimed[0].wager));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

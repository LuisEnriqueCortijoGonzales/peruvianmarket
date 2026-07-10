// Cancelar/rechazar un mercado pendiente:
// - el creador puede cancelar su propio reto pendiente (reembolso)
// - el retado puede rechazarlo (reembolso al creador)
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { credit } from '@/lib/casino-bank';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { market_id } = await req.json().catch(() => ({}));
    if (!market_id) return NextResponse.json({ success: false, error: 'market_id requerido' }, { status: 400 });

    const { data: market } = await admin.from('p2p_markets')
      .select('id, creator_address, opponent_address, amount, status')
      .eq('id', market_id).single();
    if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    if (market.creator_address !== address && market.opponent_address !== address)
      return NextResponse.json({ success: false, error: 'No participas en este mercado' }, { status: 403 });

    // Claim condicional: solo desde pending (el escrow activo requiere resolución)
    const { data: claimed } = await admin.from('p2p_markets')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', market_id).eq('status', 'pending')
      .select('amount, creator_address');
    if (!claimed || claimed.length === 0)
      return NextResponse.json({ success: false, error: 'Solo se pueden cancelar mercados pendientes' }, { status: 400 });

    // Reembolso del escrow del creador (el retado aún no depositó)
    await credit(admin, claimed[0].creator_address, Number(claimed[0].amount));
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// Veredicto firmado de una parte. Ambos coinciden → pago automático.
// Difieren → disputa (interviene el oráculo).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { verifySignature } from '@/lib/crypto';
import { settleP2P } from '@/lib/p2p';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const body = await req.json().catch(() => ({}));
    const { market_id, verdict, timestamp, signature, public_key } = body;
    if (!market_id || !['creator', 'opponent'].includes(verdict) || !signature || !public_key)
      return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });

    const { data: market } = await admin.from('p2p_markets')
      .select('*').eq('id', market_id).single();
    if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    if (market.status !== 'active')
      return NextResponse.json({ success: false, error: 'El mercado no está activo' }, { status: 400 });

    const isCreator = market.creator_address === address;
    const isOpponent = market.opponent_address === address;
    if (!isCreator && !isOpponent)
      return NextResponse.json({ success: false, error: 'No participas en este mercado' }, { status: 403 });

    const signedMsg = { type: 'P2P_VERDICT', market_id, verdict, from: address, timestamp };
    if (!verifySignature(signedMsg, signature, public_key))
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });

    const { data: walletRow } = await admin.from('wallets')
      .select('address').eq('address', address).eq('public_key', public_key).maybeSingle();
    if (!walletRow) return NextResponse.json({ success: false, error: 'Llave pública no coincide' }, { status: 401 });

    const patch = isCreator
      ? { verdict_creator: verdict, verdict_creator_sig: signature }
      : { verdict_opponent: verdict, verdict_opponent_sig: signature };
    await admin.from('p2p_markets').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', market_id).eq('status', 'active');

    // Releer para evaluar acuerdo
    const { data: fresh } = await admin.from('p2p_markets')
      .select('verdict_creator, verdict_opponent, creator_address, opponent_address, status')
      .eq('id', market_id).single();
    if (!fresh || fresh.status !== 'active')
      return NextResponse.json({ success: true, data: { state: fresh?.status ?? 'unknown' } });

    if (fresh.verdict_creator && fresh.verdict_opponent) {
      if (fresh.verdict_creator === fresh.verdict_opponent) {
        // Acuerdo: liberar el escrow al ganador (claim condicional dentro)
        const winner = fresh.verdict_creator === 'creator' ? fresh.creator_address : fresh.opponent_address;
        await settleP2P(admin, market_id, winner, ['active']);
        return NextResponse.json({ success: true, data: { state: 'resolved', winner } });
      }
      // Desacuerdo: disputa — el oráculo decidirá
      await admin.from('p2p_markets').update({ status: 'disputed', updated_at: new Date().toISOString() })
        .eq('id', market_id).eq('status', 'active');
      return NextResponse.json({ success: true, data: { state: 'disputed' } });
    }

    return NextResponse.json({ success: true, data: { state: 'waiting_other' } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

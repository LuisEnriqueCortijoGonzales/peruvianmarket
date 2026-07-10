// Aceptar mercado P2P: el retado firma sobre el MISMO terms_hash (acuerdo
// verificable sobre términos idénticos) y deposita su parte.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { verifySignature } from '@/lib/crypto';
import { debitWithSignedNonce } from '@/lib/p2p';
import { credit } from '@/lib/casino-bank';

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const body = await req.json().catch(() => ({}));
    const { market_id, terms_hash, nonce, timestamp, signature, public_key } = body;
    if (!market_id || !terms_hash || !signature || !public_key)
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });

    const { data: market } = await admin.from('p2p_markets')
      .select('id, opponent_address, amount, terms_hash, status, deadline')
      .eq('id', market_id).single();
    if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    if (market.opponent_address !== address)
      return NextResponse.json({ success: false, error: 'Este reto no es para tu wallet' }, { status: 403 });
    if (market.status !== 'pending')
      return NextResponse.json({ success: false, error: 'El mercado ya no está pendiente' }, { status: 400 });
    if (new Date(market.deadline).getTime() < Date.now())
      return NextResponse.json({ success: false, error: 'El reto ya venció' }, { status: 400 });
    // La firma debe anclarse al MISMO hash de términos que firmó el creador
    if (market.terms_hash !== terms_hash)
      return NextResponse.json({ success: false, error: 'terms_hash no coincide — los términos fueron alterados' }, { status: 400 });

    const signedMsg = { type: 'P2P_ACCEPT', market_id, terms_hash, from: address, nonce, timestamp };
    if (!verifySignature(signedMsg, signature, public_key))
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });

    const { data: walletRow } = await admin.from('wallets')
      .select('address').eq('address', address).eq('public_key', public_key).maybeSingle();
    if (!walletRow) return NextResponse.json({ success: false, error: 'Llave pública no coincide con tu wallet' }, { status: 401 });

    // Escrow del retado
    const amt = Number(market.amount);
    const deb = await debitWithSignedNonce(admin, address, amt, Number(nonce));
    if (!deb.ok) return NextResponse.json({ success: false, error: deb.error }, { status: 400 });

    // Claim condicional pending → active
    const { data: claimed } = await admin.from('p2p_markets')
      .update({ status: 'active', accept_sig: signature, updated_at: new Date().toISOString() })
      .eq('id', market_id).eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) {
      await credit(admin, address, amt); // otro estado ganó — reembolso
      return NextResponse.json({ success: false, error: 'El mercado cambió de estado' }, { status: 409 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

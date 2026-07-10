// Crear mercado P2P privado: verifica la firma ECDSA del creador sobre el
// hash de los términos cifrados y deposita su parte en escrow.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { verifySignature } from '@/lib/crypto';
import { debitWithSignedNonce } from '@/lib/p2p';
import { credit } from '@/lib/casino-bank';

const MAX_DEADLINE_H = 24 * 30; // 30 días

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const body = await req.json().catch(() => ({}));
    const { to, amount, terms_hash, ciphertext, deadline_hours, nonce, timestamp, signature, public_key } = body;

    const amt = parseFloat(amount);
    const hours = parseInt(deadline_hours, 10);
    if (!to || !terms_hash || !ciphertext || !signature || !public_key)
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    if (to === address) return NextResponse.json({ success: false, error: 'No puedes apostar contra ti mismo' }, { status: 400 });
    if (isNaN(amt) || amt < 1)   return NextResponse.json({ success: false, error: 'Depósito mínimo 1 CHC' }, { status: 400 });
    if (amt > 1000000)            return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });
    if (isNaN(hours) || hours < 1 || hours > MAX_DEADLINE_H)
      return NextResponse.json({ success: false, error: 'Plazo inválido (1h a 30 días)' }, { status: 400 });
    if (ciphertext.length > 8000)
      return NextResponse.json({ success: false, error: 'Términos demasiado largos' }, { status: 400 });

    // Verificar firma ECDSA — cubre terms_hash: el creador firma ESE contenido
    const signedMsg = {
      type: 'P2P_CREATE', from: address, to, amount: amt,
      terms_hash, deadline: hours, nonce, timestamp,
    };
    if (!verifySignature(signedMsg, signature, public_key))
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });

    // La llave pública debe ser la de la wallet del creador
    const { data: walletRow } = await admin.from('wallets')
      .select('address').eq('address', address).eq('public_key', public_key).maybeSingle();
    if (!walletRow) return NextResponse.json({ success: false, error: 'Llave pública no coincide con tu wallet' }, { status: 401 });

    // El rival debe existir
    const { data: rival } = await admin.from('wallets').select('address').eq('address', to).maybeSingle();
    if (!rival) return NextResponse.json({ success: false, error: 'La wallet rival no existe' }, { status: 404 });

    // Escrow del creador (nonce firmado = anti-replay)
    const deb = await debitWithSignedNonce(admin, address, amt, Number(nonce));
    if (!deb.ok) return NextResponse.json({ success: false, error: deb.error }, { status: 400 });

    const deadline = new Date(Date.now() + hours * 3600_000).toISOString();
    const { data: row, error } = await admin.from('p2p_markets').insert({
      creator_address: address,
      opponent_address: to,
      amount: amt,
      ciphertext,
      terms_hash,
      deadline,
      status: 'pending',
      create_sig: signature,
    }).select('id').single();

    if (error || !row) {
      await credit(admin, address, amt); // rollback del escrow
      return NextResponse.json({ success: false, error: error?.message ?? '¿Corriste el SQL de p2p_markets?' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { market_id: row.id, deadline } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

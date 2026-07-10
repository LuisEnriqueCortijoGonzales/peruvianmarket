// Mis mercados P2P (como creador o retado) con las llaves públicas de ambas
// partes para derivar la clave ECDH en el cliente.
import { NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';

export async function GET() {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const { data: markets } = await admin.from('p2p_markets')
      .select('id, creator_address, opponent_address, amount, ciphertext, terms_hash, deadline, status, verdict_creator, verdict_opponent, winner_address, oracle_sig, created_at')
      .or(`creator_address.eq.${address},opponent_address.eq.${address}`)
      .order('created_at', { ascending: false })
      .limit(40);

    // Llaves públicas de todas las contrapartes en una sola consulta
    const addrs = new Set<string>();
    for (const m of markets ?? []) { addrs.add(m.creator_address); addrs.add(m.opponent_address); }
    const { data: wallets } = await admin.from('wallets')
      .select('address, public_key').in('address', [...addrs]);
    const pubkeys: Record<string, string> = {};
    for (const w of wallets ?? []) pubkeys[w.address] = w.public_key;

    return NextResponse.json({
      success: true,
      data: { markets: markets ?? [], pubkeys, my_address: address },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

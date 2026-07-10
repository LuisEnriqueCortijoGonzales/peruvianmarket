// Mercados P2P privados — helpers de servidor.
//
// Protocolo criptográfico:
//  1. Creador cifra los términos client-side: ECDH(privA, pubB) → AES-256-GCM.
//  2. Firma ECDSA sobre {type:'P2P_CREATE', from, to, amount, terms_hash,
//     deadline, nonce, timestamp} — terms_hash ancla la firma al contenido.
//  3. El retado descifra (ECDH es simétrico), y firma P2P_ACCEPT sobre el
//     MISMO terms_hash: ambas firmas prueban acuerdo sobre términos idénticos.
//  4. Cada parte firma su veredicto (P2P_VERDICT). Coinciden → pago automático.
//     Difieren o vence el plazo → el oráculo resuelve y firma con Ed25519.
import type { SupabaseClient } from '@supabase/supabase-js';
import { credit } from './casino-bank';

/**
 * Débito con lock de nonce firmado (patrón transfer): la firma cubre el nonce
 * esperado; solo aplica si el nonce actual coincide — anti-replay + anti-carrera.
 */
export async function debitWithSignedNonce(
  admin: SupabaseClient,
  address: string,
  amount: number,
  signedNonce: number,
): Promise<{ ok: boolean; error?: string }> {
  const { data: bal } = await admin.from('balances')
    .select('amount, nonce').eq('address', address).single();
  if (!bal) return { ok: false, error: 'Sin balance' };
  const currentNonce = bal.nonce ?? 0;
  if (signedNonce !== currentNonce + 1) return { ok: false, error: 'Nonce inválido — refresca e intenta de nuevo' };
  if (Number(bal.amount) < amount) return { ok: false, error: 'Balance insuficiente' };

  const { data: updated } = await admin.from('balances')
    .update({
      amount: Math.round((Number(bal.amount) - amount) * 100) / 100,
      nonce: currentNonce + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('address', address).eq('nonce', currentNonce)
    .select('address');
  if (!updated || updated.length === 0) return { ok: false, error: 'La cuenta cambió — reintenta' };
  return { ok: true };
}

/** Liquida un mercado P2P: claim condicional + pago del pot (2× amount). */
export async function settleP2P(
  admin: SupabaseClient,
  marketId: string,
  winnerAddress: string,
  fromStatuses: string[],
  extraPatch: Record<string, unknown> = {},
): Promise<boolean> {
  const { data: claimed } = await admin.from('p2p_markets')
    .update({ status: 'resolved', winner_address: winnerAddress, updated_at: new Date().toISOString(), ...extraPatch })
    .eq('id', marketId)
    .in('status', fromStatuses)
    .select('amount');
  if (!claimed || claimed.length === 0) return false;

  const pot = Number(claimed[0].amount) * 2;
  await credit(admin, winnerAddress, pot);
  try {
    await admin.from('transactions').insert({
      type: 'CLAIM', from_address: 'P2P_MARKET', to_address: winnerAddress,
      amount: pot, status: 'confirmed',
    });
  } catch { /* non-critical */ }
  return true;
}

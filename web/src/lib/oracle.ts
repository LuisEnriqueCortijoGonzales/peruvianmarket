// Oracle server-side — firma resoluciones con Ed25519
// Solo usar en API routes (Node.js), nunca en el browser
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes } from './crypto';

// Configurar SHA-512 síncrono para @noble/ed25519 v2
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
ed.etc.sha512Sync = (...m) => sha512(concatBytes(...m));

export function getOraclePublicKey(): string {
  const privHex = process.env.ORACLE_PRIVATE_KEY;
  if (!privHex) throw new Error('ORACLE_PRIVATE_KEY no configurada');
  return bytesToHex(ed.getPublicKey(hexToBytes(privHex)));
}

export async function signResolution(
  marketId: string,
  outcome: 'YES' | 'NO',
  timestamp: number,
): Promise<string> {
  const privHex = process.env.ORACLE_PRIVATE_KEY;
  if (!privHex) throw new Error('ORACLE_PRIVATE_KEY no configurada');
  const message = `${marketId}:${outcome}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const sig = await ed.signAsync(msgBytes, hexToBytes(privHex));
  return bytesToHex(sig);
}

/** Firma Ed25519 de la resolución de un mercado P2P por el oráculo. */
export async function signP2PResolution(
  marketId: string,
  winnerAddress: string,
  timestamp: number,
): Promise<string> {
  const privHex = process.env.ORACLE_PRIVATE_KEY;
  if (!privHex) throw new Error('ORACLE_PRIVATE_KEY no configurada');
  const message = `p2p:${marketId}:${winnerAddress}:${timestamp}`;
  const sig = await ed.signAsync(new TextEncoder().encode(message), hexToBytes(privHex));
  return bytesToHex(sig);
}

export function verifyResolution(
  marketId: string,
  outcome: string,
  timestamp: number,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const message = `${marketId}:${outcome}:${timestamp}`;
    const msgBytes = new TextEncoder().encode(message);
    return ed.verify(
      hexToBytes(signatureHex),
      msgBytes,
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}

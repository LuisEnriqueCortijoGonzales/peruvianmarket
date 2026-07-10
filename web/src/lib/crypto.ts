// Módulo de criptografía SECP256K1 — funciona en browser y Node.js
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import type { WalletKeypair } from './types';

// Configurar HMAC síncrono requerido por @noble/secp256k1 v2
secp.etc.hmacSha256Sync = (k, ...m) =>
  hmac(sha256, k, secp.etc.concatBytes(...m));

const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(data: Uint8Array): string {
  let num = 0n;
  for (const byte of data) {
    num = num * 256n + BigInt(byte);
  }
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  for (const byte of data) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  return result;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex inválido');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// Derivación de dirección estilo Bitcoin con byte de versión 'P' (0x35)
function deriveAddress(pubKeyBytes: Uint8Array): string {
  const hash160 = ripemd160(sha256(pubKeyBytes));
  const versioned = new Uint8Array([0x35, ...hash160]);
  const checksum = sha256(sha256(versioned)).slice(0, 4);
  const full = new Uint8Array([...versioned, ...checksum]);
  return base58Encode(full);
}

export function generateWallet(): WalletKeypair {
  const privKeyBytes = secp.utils.randomPrivateKey();
  const pubKeyBytes = secp.getPublicKey(privKeyBytes, true); // comprimida
  const address = deriveAddress(pubKeyBytes);
  return {
    privateKey: bytesToHex(privKeyBytes),
    publicKey: bytesToHex(pubKeyBytes),
    address,
  };
}

export function getAddressFromPublicKey(publicKeyHex: string): string {
  return deriveAddress(hexToBytes(publicKeyHex));
}

export function getPublicKeyFromPrivateKey(privateKeyHex: string): string {
  const pubBytes = secp.getPublicKey(hexToBytes(privateKeyHex), true);
  return bytesToHex(pubBytes);
}

function canonicalJSON(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

export function signTransaction(
  txData: Record<string, unknown>,
  privateKeyHex: string,
): string {
  const message = canonicalJSON(txData);
  const msgHash = sha256(new TextEncoder().encode(message));
  const sig = secp.sign(msgHash, hexToBytes(privateKeyHex));
  return bytesToHex(sig.toCompactRawBytes());
}

export function verifySignature(
  txData: Record<string, unknown>,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const message = canonicalJSON(txData);
    const msgHash = sha256(new TextEncoder().encode(message));
    const sig = secp.Signature.fromCompact(signatureHex);
    return secp.verify(sig, msgHash, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

// ── ECDH + AES-GCM: canal cifrado entre dos wallets ──────────────────────────
// Ambas partes derivan la MISMA clave simétrica sin intercambiarla:
//   A: ECDH(privA, pubB) == B: ECDH(privB, pubA)  →  SHA-256  →  AES-256-GCM
// Se usa para los términos de mercados P2P privados: el servidor solo
// almacena ciphertext; únicamente los dos participantes pueden leerlos.
export async function deriveSharedKey(
  myPrivateKeyHex: string,
  theirPublicKeyHex: string,
): Promise<CryptoKey> {
  const sharedPoint = secp.getSharedSecret(
    hexToBytes(myPrivateKeyHex),
    hexToBytes(theirPublicKeyHex),
    true, // comprimido: 33 bytes
  );
  // Descartar el byte de paridad y hashear la coordenada X (práctica estándar)
  const keyBytes = sha256(sharedPoint.slice(1));
  return globalThis.crypto.subtle.importKey(
    'raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'],
  );
}

export async function encryptShared(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array([...iv, ...new Uint8Array(ct)]);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptShared(key: CryptoKey, encryptedB64: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/** Hash de los términos cifrados — ambas firmas ECDSA se anclan a este hash. */
export function hashCiphertext(ciphertextB64: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(ciphertextB64)));
}

// Encripta la clave privada con AES-256-GCM usando una contraseña.
// v2: PBKDF2 ×600k (OWASP 2023). Blobs legacy sin prefijo usan 100k.
const PBKDF2_ITERATIONS_V2 = 600_000;
const PBKDF2_ITERATIONS_LEGACY = 100_000;
const VAULT_V2_PREFIX = 'v2:';

async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function encryptPrivateKey(
  privateKeyHex: string,
  password: string,
): Promise<string> {
  const enc = new TextEncoder();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await deriveAesKey(password, salt, PBKDF2_ITERATIONS_V2, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(privateKeyHex),
  );
  const combined = new Uint8Array([
    ...salt,
    ...iv,
    ...new Uint8Array(ciphertext),
  ]);
  return VAULT_V2_PREFIX + btoa(String.fromCharCode(...combined));
}

export async function decryptPrivateKey(
  encryptedB64: string,
  password: string,
): Promise<string> {
  const dec = new TextDecoder();
  const isV2 = encryptedB64.startsWith(VAULT_V2_PREFIX);
  const b64 = isV2 ? encryptedB64.slice(VAULT_V2_PREFIX.length) : encryptedB64;
  const iterations = isV2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS_LEGACY;

  const combined = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);

  const aesKey = await deriveAesKey(password, salt, iterations, 'decrypt');
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext,
  );
  return dec.decode(plaintext);
}

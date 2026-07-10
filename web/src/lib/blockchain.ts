// Cadena de bloques real — encadenamiento SHA-256 server-side.
// Cada bloque sella BLOCK_SIZE transacciones; su hash cubre el hash del bloque
// anterior y el contenido de las transacciones (id, tipo, partes, monto).
// Alterar cualquier transacción sellada o cualquier bloque rompe la cadena
// desde ese punto — verificable con verifyChain().
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from './crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const BLOCK_SIZE = 5;
export const GENESIS_HASH = '0'.repeat(64);

export interface ChainTxRecord {
  id: string;
  type: string;
  from_address: string | null;
  to_address: string | null;
  amount: number | null;
}

export interface BlockRow {
  number: number;
  prev_hash: string;
  hash: string;
  tx_ids: string[];
  tx_count: number;
  created_at: string;
}

function txFingerprint(t: ChainTxRecord): string {
  const amt = t.amount == null ? '' : Number(t.amount).toFixed(2);
  return `${t.id}:${t.type}:${t.from_address ?? ''}:${t.to_address ?? ''}:${amt}`;
}

export function computeBlockHash(
  number: number,
  prevHash: string,
  txs: ChainTxRecord[],
): string {
  const payload = `${number}|${prevHash}|${txs.map(txFingerprint).join(';')}`;
  return bytesToHex(sha256(new TextEncoder().encode(payload)));
}

/**
 * Sella transacciones pendientes en bloques de BLOCK_SIZE.
 * Idempotente y tolerante a concurrencia: si otro proceso selló primero,
 * el INSERT falla por PK y se aborta silenciosamente.
 */
export async function sealPendingBlocks(admin: SupabaseClient): Promise<number> {
  const { data: last } = await admin
    .from('blocks')
    .select('number, hash')
    .order('number', { ascending: false })
    .limit(1)
    .maybeSingle();

  let prevHash: string = last?.hash ?? GENESIS_HASH;
  let nextNumber: number = (last?.number ?? 0) + 1;

  const { data: pending } = await admin
    .from('transactions')
    .select('id, type, from_address, to_address, amount')
    .is('block_number', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BLOCK_SIZE * 12);

  if (!pending || pending.length < BLOCK_SIZE) return 0;

  let sealed = 0;
  for (let i = 0; i + BLOCK_SIZE <= pending.length; i += BLOCK_SIZE) {
    const chunk = pending.slice(i, i + BLOCK_SIZE) as ChainTxRecord[];
    const hash = computeBlockHash(nextNumber, prevHash, chunk);
    const txIds = chunk.map(t => t.id);

    const { error } = await admin.from('blocks').insert({
      number: nextNumber,
      prev_hash: prevHash,
      hash,
      tx_ids: txIds,
      tx_count: chunk.length,
    });
    if (error) break; // conflicto: otro proceso selló — abortar sin daño

    await admin
      .from('transactions')
      .update({ block_number: nextNumber })
      .in('id', txIds);

    prevHash = hash;
    nextNumber++;
    sealed++;
  }
  return sealed;
}

export interface ChainVerification {
  valid: boolean;
  blocks_checked: number;
  txs_checked: number;
  first_invalid: { number: number; reason: string } | null;
}

/** Recorre toda la cadena recomputando hashes y validando el encadenamiento. */
export async function verifyChain(admin: SupabaseClient): Promise<ChainVerification> {
  const { data: blocks } = await admin
    .from('blocks')
    .select('number, prev_hash, hash, tx_ids, tx_count, created_at')
    .order('number', { ascending: true })
    .limit(2000);

  const chain = (blocks ?? []) as BlockRow[];
  if (chain.length === 0) {
    return { valid: true, blocks_checked: 0, txs_checked: 0, first_invalid: null };
  }

  // Traer todas las transacciones selladas en lotes
  const allIds = chain.flatMap(b => b.tx_ids);
  const txMap = new Map<string, ChainTxRecord>();
  for (let i = 0; i < allIds.length; i += 200) {
    const { data } = await admin
      .from('transactions')
      .select('id, type, from_address, to_address, amount')
      .in('id', allIds.slice(i, i + 200));
    for (const t of data ?? []) txMap.set(t.id, t as ChainTxRecord);
  }

  let expectedPrev = GENESIS_HASH;
  let txsChecked = 0;

  for (const block of chain) {
    if (block.prev_hash !== expectedPrev) {
      return {
        valid: false, blocks_checked: block.number, txs_checked: txsChecked,
        first_invalid: { number: block.number, reason: 'prev_hash no coincide con el bloque anterior' },
      };
    }
    const txs: ChainTxRecord[] = [];
    for (const id of block.tx_ids) {
      const t = txMap.get(id);
      if (!t) {
        return {
          valid: false, blocks_checked: block.number, txs_checked: txsChecked,
          first_invalid: { number: block.number, reason: `transacción ${id.slice(0, 8)}… eliminada del ledger` },
        };
      }
      txs.push(t);
    }
    const recomputed = computeBlockHash(block.number, block.prev_hash, txs);
    if (recomputed !== block.hash) {
      return {
        valid: false, blocks_checked: block.number, txs_checked: txsChecked,
        first_invalid: { number: block.number, reason: 'hash no coincide — contenido de transacciones alterado' },
      };
    }
    txsChecked += txs.length;
    expectedPrev = block.hash;
  }

  return { valid: true, blocks_checked: chain.length, txs_checked: txsChecked, first_invalid: null };
}

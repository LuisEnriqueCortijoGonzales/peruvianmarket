// Banco del casino — operaciones de balance seguras bajo concurrencia.
//
// Problemas que resuelve:
//  1. Doble gasto por doble-clic: dos requests leen el mismo balance y ambos
//     pasan la validación (read-check-write). → try_debit hace el chequeo y el
//     descuento en UNA operación SQL atómica.
//  2. Doble cobro de premios: dos cashouts concurrentes ven status='active' y
//     ambos pagan. → claimGame marca la partida con un UPDATE condicional; solo
//     el request que "gana" el claim paga.
//  3. Lost updates en créditos: add_to_balance incrementa de forma atómica.
//
// Todas las funciones tienen fallback read-modify-write si las funciones SQL
// aún no existen en la BD (menos seguro, pero funcional).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DebitResult {
  ok: boolean;
  newBalance: number;
  error?: string;
}

/** Descuenta `amount` si y solo si el balance alcanza. Atómico vía RPC. */
export async function debit(
  admin: SupabaseClient,
  address: string,
  amount: number,
): Promise<DebitResult> {
  const { data, error } = await admin.rpc('try_debit', {
    p_address: address,
    p_amount: amount,
  });

  if (!error && data && data.length > 0) {
    const row = data[0] as { ok: boolean; new_amount: number };
    return row.ok
      ? { ok: true, newBalance: Number(row.new_amount) }
      : { ok: false, newBalance: Number(row.new_amount ?? 0), error: 'Balance insuficiente' };
  }

  // Fallback (RPC no existe aún): read-check-write clásico
  const { data: bal } = await admin
    .from('balances').select('amount, nonce').eq('address', address).single();
  if (!bal || Number(bal.amount) < amount) {
    return { ok: false, newBalance: Number(bal?.amount ?? 0), error: 'Balance insuficiente' };
  }
  const newBalance = Math.round((Number(bal.amount) - amount) * 100) / 100;
  await admin.from('balances').update({
    amount: newBalance,
    nonce: (bal.nonce ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('address', address);
  return { ok: true, newBalance };
}

/** Acredita `amount` de forma atómica. Devuelve el balance nuevo si se conoce. */
export async function credit(
  admin: SupabaseClient,
  address: string,
  amount: number,
): Promise<number | null> {
  if (amount <= 0) return null;
  const { error } = await admin.rpc('add_to_balance', {
    p_address: address,
    p_delta: amount,
  });
  if (!error) {
    const { data } = await admin.from('balances').select('amount').eq('address', address).single();
    return data ? Number(data.amount) : null;
  }
  // Fallback
  const { data: bal } = await admin
    .from('balances').select('amount, nonce').eq('address', address).single();
  if (!bal) return null;
  const newBalance = Math.round((Number(bal.amount) + amount) * 100) / 100;
  await admin.from('balances').update({
    amount: newBalance,
    nonce: (bal.nonce ?? 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('address', address);
  return newBalance;
}

/**
 * Reclama una partida activa marcándola con `patch` (p.ej. status final y payout).
 * UPDATE condicional: solo devuelve true para el PRIMER request; cualquier
 * request concurrente encuentra 0 filas y debe abortar sin pagar.
 */
export async function claimGame(
  admin: SupabaseClient,
  table: string,
  gameId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data } = await admin
    .from(table)
    .update(patch)
    .eq('id', gameId)
    .eq('status', 'active')
    .select('id');
  return !!data && data.length > 0;
}

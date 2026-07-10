// Casino house accounting — routes won/lost CHC to the house wallet.
// Set CASINO_HOUSE_ADDRESS in .env.local to your oracle/admin wallet address
// so lost CHC flows directly into that wallet for market liquidity.
import type { SupabaseClient } from '@supabase/supabase-js';

export const HOUSE_ADDR = process.env.CASINO_HOUSE_ADDRESS ?? 'CASINO_HOUSE';

/**
 * Adjust the house wallet balance by `delta` CHC.
 * Positive delta = house gains (player lost).
 * Negative delta = house pays out (player won).
 */
export async function adjustHouse(
  admin: SupabaseClient,
  delta: number,
): Promise<void> {
  if (Math.abs(delta) < 0.001) return; // skip dust
  const roundedDelta = Math.round(delta * 100) / 100;
  // Atomic increment — avoids race conditions when multiple games run concurrently
  await admin.rpc('add_to_balance', { p_address: HOUSE_ADDR, p_delta: roundedDelta });
}

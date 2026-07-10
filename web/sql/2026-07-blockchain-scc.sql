-- ============================================================
-- Migración: blockchain real + SuperChamoCoins + transferencias
-- Ejecutar en Supabase SQL Editor (una sola vez)
-- ============================================================

-- 1. Cadena de bloques real (hash chaining SHA-256)
CREATE TABLE IF NOT EXISTS blocks (
  number     INTEGER PRIMARY KEY,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL,
  tx_ids     JSONB NOT NULL,
  tx_count   INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_tx_unsealed
  ON transactions (created_at)
  WHERE block_number IS NULL;

-- 2. SuperChamoCoins (SCC) — saldo por wallet
ALTER TABLE balances ADD COLUMN IF NOT EXISTS scc NUMERIC DEFAULT 0;

-- 3. Incremento atómico de balances (usado por transferencias y casa del casino)
CREATE OR REPLACE FUNCTION add_to_balance(p_address TEXT, p_delta DECIMAL)
RETURNS void AS $$
BEGIN
  INSERT INTO balances (address, amount, updated_at)
  VALUES (p_address, GREATEST(0, p_delta), NOW())
  ON CONFLICT (address) DO UPDATE
    SET amount = GREATEST(0, balances.amount + p_delta),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- 4. Débito atómico check-and-deduct: descuenta solo si el balance alcanza.
--    Elimina el doble gasto por requests concurrentes (doble-clic en apostar).
CREATE OR REPLACE FUNCTION try_debit(p_address TEXT, p_amount DECIMAL)
RETURNS TABLE(ok BOOLEAN, new_amount DECIMAL) AS $$
DECLARE
  v_new DECIMAL;
BEGIN
  UPDATE balances
     SET amount = ROUND((amount - p_amount)::numeric, 2),
         nonce = COALESCE(nonce, 0) + 1,
         updated_at = NOW()
   WHERE address = p_address AND amount >= p_amount
   RETURNING amount INTO v_new;

  IF FOUND THEN
    RETURN QUERY SELECT TRUE, v_new;
  ELSE
    RETURN QUERY SELECT FALSE, COALESCE((SELECT b.amount FROM balances b WHERE b.address = p_address), 0::DECIMAL);
  END IF;
END;
$$ LANGUAGE plpgsql;

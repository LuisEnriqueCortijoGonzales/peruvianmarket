-- ============================================================
-- Mercados P2P privados (términos cifrados ECDH + AES-GCM)
-- Ejecutar en Supabase SQL Editor
-- ============================================================
CREATE TABLE IF NOT EXISTS p2p_markets (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_address      TEXT NOT NULL,
  opponent_address     TEXT NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,       -- depósito de CADA parte
  ciphertext           TEXT NOT NULL,                -- términos cifrados (solo las partes pueden leer)
  terms_hash           TEXT NOT NULL,                -- SHA-256 del ciphertext: ancla de ambas firmas
  deadline             TIMESTAMPTZ NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|active|resolved|disputed|cancelled
  create_sig           TEXT NOT NULL,                -- firma ECDSA del creador (P2P_CREATE)
  accept_sig           TEXT,                          -- firma ECDSA del retado (P2P_ACCEPT)
  verdict_creator      TEXT,                          -- 'creator' | 'opponent'
  verdict_creator_sig  TEXT,
  verdict_opponent     TEXT,
  verdict_opponent_sig TEXT,
  winner_address       TEXT,
  oracle_sig           TEXT,                          -- firma Ed25519 si resolvió el oráculo
  oracle_ts            BIGINT,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_p2p_parties ON p2p_markets (creator_address, opponent_address);
CREATE INDEX IF NOT EXISTS idx_p2p_oracle ON p2p_markets (deadline) WHERE status IN ('active','disputed');

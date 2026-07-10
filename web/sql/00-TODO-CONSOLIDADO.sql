-- ============================================================================
-- MIGRACIÓN CONSOLIDADA — PeruvianMarket
-- Ejecutar este ÚNICO archivo en el SQL Editor de Supabase.
-- Es idempotente: se puede correr varias veces sin romper nada.
-- Incluye todo lo necesario para casino, blockchain, SCC, Pokémon y P2P.
-- ============================================================================

-- ── Funciones atómicas de balance (usadas por todo el casino, P2P y Pokémon) ─
CREATE OR REPLACE FUNCTION add_to_balance(p_address TEXT, p_delta DECIMAL)
RETURNS void AS $$
BEGIN
  INSERT INTO balances (address, amount, updated_at)
  VALUES (p_address, GREATEST(0, p_delta), NOW())
  ON CONFLICT (address) DO UPDATE
    SET amount = GREATEST(0, balances.amount + p_delta), updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION try_debit(p_address TEXT, p_amount DECIMAL)
RETURNS TABLE(ok BOOLEAN, new_amount DECIMAL) AS $$
DECLARE v_new DECIMAL;
BEGIN
  UPDATE balances
     SET amount = ROUND((amount - p_amount)::numeric, 2),
         nonce = COALESCE(nonce, 0) + 1, updated_at = NOW()
   WHERE address = p_address AND amount >= p_amount
   RETURNING amount INTO v_new;
  IF FOUND THEN RETURN QUERY SELECT TRUE, v_new;
  ELSE RETURN QUERY SELECT FALSE, COALESCE((SELECT b.amount FROM balances b WHERE b.address = p_address), 0::DECIMAL);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Blockchain (hash chaining) + SuperChamoCoins ────────────────────────────
CREATE TABLE IF NOT EXISTS blocks (
  number INTEGER PRIMARY KEY, prev_hash TEXT NOT NULL, hash TEXT NOT NULL,
  tx_ids JSONB NOT NULL, tx_count INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_tx_unsealed ON transactions (created_at) WHERE block_number IS NULL;
ALTER TABLE balances ADD COLUMN IF NOT EXISTS scc NUMERIC DEFAULT 0;

-- ── Casino: settings + Minas + La Gallina (pista) ───────────────────────────
CREATE TABLE IF NOT EXISTS casino_settings (
  key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mines_games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, address TEXT NOT NULL,
  bet DECIMAL(12,2) NOT NULL, mines_count INTEGER NOT NULL, mine_positions JSONB NOT NULL,
  revealed_safe JSONB NOT NULL DEFAULT '[]', house_edge DECIMAL(6,4) NOT NULL DEFAULT 0.05,
  status TEXT NOT NULL DEFAULT 'active', payout DECIMAL(12,2), created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mines_active ON mines_games (address) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS chicken_games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, address TEXT NOT NULL,
  bet DECIMAL(12,2) NOT NULL, step INTEGER NOT NULL DEFAULT 0,
  survival_rate DECIMAL(6,4) NOT NULL DEFAULT 0.75, house_edge DECIMAL(6,4) NOT NULL DEFAULT 0.05,
  risk TEXT NOT NULL DEFAULT 'medio', status TEXT NOT NULL DEFAULT 'active',
  payout DECIMAL(12,2), created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS step INTEGER DEFAULT 0;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS survival_rate DECIMAL(6,4) DEFAULT 0.75;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS house_edge DECIMAL(6,4) DEFAULT 0.05;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS risk TEXT DEFAULT 'medio';
CREATE INDEX IF NOT EXISTS idx_chicken_active ON chicken_games (address) WHERE status = 'active';

-- Slots: columna house_edge (solo si la tabla ya existe — no aborta el script)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'slots_config') THEN
    ALTER TABLE slots_config ADD COLUMN IF NOT EXISTS house_edge DECIMAL(6,2) DEFAULT 8;
  END IF;
END $$;

-- ── Pokémon (batallas + equipos + apuestas de espectadores) ─────────────────
CREATE TABLE IF NOT EXISTS pokemon_battles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, creator_address TEXT NOT NULL,
  opponent_address TEXT, wager DECIMAL(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'waiting',
  winner_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Modos de juego (Random / Equipos / Bot) + dificultad del bot
ALTER TABLE pokemon_battles ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'pvp_random';
ALTER TABLE pokemon_battles ADD COLUMN IF NOT EXISTS bot_level TEXT;
CREATE INDEX IF NOT EXISTS idx_pkmn_waiting ON pokemon_battles (created_at) WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS pokemon_teams (
  address TEXT PRIMARY KEY, slots JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pokemon_side_bets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, battle_id UUID NOT NULL, address TEXT NOT NULL,
  side TEXT NOT NULL, amount DECIMAL(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (battle_id, address)
);
CREATE INDEX IF NOT EXISTS idx_sidebets_battle ON pokemon_side_bets (battle_id) WHERE status = 'open';

-- ── Mercados P2P privados (ECDH + AES-GCM) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS p2p_markets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY, creator_address TEXT NOT NULL,
  opponent_address TEXT NOT NULL, amount DECIMAL(12,2) NOT NULL, ciphertext TEXT NOT NULL,
  terms_hash TEXT NOT NULL, deadline TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  create_sig TEXT NOT NULL, accept_sig TEXT, verdict_creator TEXT, verdict_creator_sig TEXT,
  verdict_opponent TEXT, verdict_opponent_sig TEXT, winner_address TEXT,
  oracle_sig TEXT, oracle_ts BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_p2p_parties ON p2p_markets (creator_address, opponent_address);

-- ============================================================================
-- FIN — al terminar sin errores, toda la app está lista.
-- ============================================================================

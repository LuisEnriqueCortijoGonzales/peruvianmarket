-- ============================================================
-- Batallas Pokémon con apuestas — ejecutar en Supabase SQL Editor
-- ============================================================
CREATE TABLE IF NOT EXISTS pokemon_battles (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_address  TEXT NOT NULL,
  opponent_address TEXT,
  wager            DECIMAL(12,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'waiting',  -- waiting | active | finished | cancelled
  winner_address   TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pkmn_waiting ON pokemon_battles (created_at) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_pkmn_by_player ON pokemon_battles (creator_address, opponent_address) WHERE status IN ('waiting','active');

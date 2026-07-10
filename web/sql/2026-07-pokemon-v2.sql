-- ============================================================
-- Pokémon v2: modos de juego, bot, equipos y apuestas laterales
-- Ejecutar en Supabase SQL Editor (después del SQL v1 de pokemon)
-- ============================================================

-- Modos + dificultad del bot en las batallas
ALTER TABLE pokemon_battles ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'pvp_random';
ALTER TABLE pokemon_battles ADD COLUMN IF NOT EXISTS bot_level TEXT;

-- Equipos del Team Builder (uno por wallet)
CREATE TABLE IF NOT EXISTS pokemon_teams (
  address    TEXT PRIMARY KEY,
  slots      JSONB NOT NULL,          -- [{species, ability, item, moves[]} × 6]
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Apuestas laterales de espectadores (parimutuel, rake 5%)
CREATE TABLE IF NOT EXISTS pokemon_side_bets (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  battle_id  UUID NOT NULL,
  address    TEXT NOT NULL,
  side       TEXT NOT NULL,           -- p1 (creador) | p2 (retador)
  amount     DECIMAL(12,2) NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',  -- open | settled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (battle_id, address)
);
CREATE INDEX IF NOT EXISTS idx_sidebets_battle ON pokemon_side_bets (battle_id) WHERE status = 'open';

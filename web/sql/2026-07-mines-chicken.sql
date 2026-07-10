-- ============================================================
-- Tablas de juegos: Minas + La Gallina (versión pista)
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Minas 5×5
CREATE TABLE IF NOT EXISTS mines_games (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address        TEXT NOT NULL,
  bet            DECIMAL(12,2) NOT NULL,
  mines_count    INTEGER NOT NULL,
  mine_positions JSONB NOT NULL,        -- solo server-side, nunca viaja al cliente
  revealed_safe  JSONB NOT NULL DEFAULT '[]',
  house_edge     DECIMAL(6,4) NOT NULL DEFAULT 0.05,
  status         TEXT NOT NULL DEFAULT 'active',  -- active | cashed_out | hit_mine
  payout         DECIMAL(12,2),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mines_active ON mines_games (address) WHERE status = 'active';

-- La Gallina — pista (por si la tabla vieja del diseño anterior no tiene estas columnas)
CREATE TABLE IF NOT EXISTS chicken_games (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address       TEXT NOT NULL,
  bet           DECIMAL(12,2) NOT NULL,
  step          INTEGER NOT NULL DEFAULT 0,
  survival_rate DECIMAL(6,4) NOT NULL DEFAULT 0.75,
  house_edge    DECIMAL(6,4) NOT NULL DEFAULT 0.05,
  risk          TEXT NOT NULL DEFAULT 'medio',
  status        TEXT NOT NULL DEFAULT 'active',  -- active | cashed_out | hit
  payout        DECIMAL(12,2),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- Si la tabla ya existía del diseño anterior, agregar las columnas nuevas:
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS step          INTEGER DEFAULT 0;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS survival_rate DECIMAL(6,4) DEFAULT 0.75;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS house_edge    DECIMAL(6,4) DEFAULT 0.05;
ALTER TABLE chicken_games ADD COLUMN IF NOT EXISTS risk          TEXT DEFAULT 'medio';
CREATE INDEX IF NOT EXISTS idx_chicken_active ON chicken_games (address) WHERE status = 'active';

-- Settings de casino (clave-valor JSONB) — por si tampoco existe
CREATE TABLE IF NOT EXISTS casino_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

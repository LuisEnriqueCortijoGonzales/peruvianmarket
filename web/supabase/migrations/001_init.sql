-- PeruvianMarket — Esquema inicial de base de datos
-- Ejecutar en Supabase SQL Editor: https://supabase.com/dashboard/project/<id>/sql

-- ============================================================
-- EXTENSIONES
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- PERFILES DE USUARIO (extiende auth.users de Supabase)
-- ============================================================
create table public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  username    text,
  avatar_url  text,
  created_at  timestamptz default now() not null
);

alter table public.profiles enable row level security;

create policy "Perfiles visibles por todos"
  on public.profiles for select using (true);

create policy "Usuario puede insertar su propio perfil"
  on public.profiles for insert with check ((select auth.uid()) = id);

create policy "Usuario puede actualizar su propio perfil"
  on public.profiles for update using ((select auth.uid()) = id);

-- Trigger: crea perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- WALLETS CRYPTO (SECP256K1 — estilo Bitcoin)
-- ============================================================
create table public.wallets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade unique not null,
  address     text unique not null,
  public_key  text not null,
  created_at  timestamptz default now() not null
);

alter table public.wallets enable row level security;

create policy "Wallets visibles por todos"
  on public.wallets for select using (true);

create policy "Usuario inserta su propia wallet"
  on public.wallets for insert with check ((select auth.uid()) = user_id);

-- ============================================================
-- BALANCES (saldo en PEN — token nativo)
-- ============================================================
create table public.balances (
  address     text primary key,
  amount      decimal(18, 8) not null default 0 check (amount >= 0),
  nonce       bigint not null default 0,
  updated_at  timestamptz default now() not null
);

alter table public.balances enable row level security;

create policy "Balances visibles por todos"
  on public.balances for select using (true);

-- ============================================================
-- MERCADOS DE PREDICCIÓN
-- ============================================================
create table public.markets (
  id               uuid primary key default gen_random_uuid(),
  question         text not null,
  description      text,
  creator_address  text not null,
  yes_reserve      decimal(18, 8) not null default 100 check (yes_reserve > 0),
  no_reserve       decimal(18, 8) not null default 100 check (no_reserve > 0),
  status           text not null default 'open',
  resolution       text,
  category         text not null default 'general',
  end_date         timestamptz,
  created_at       timestamptz default now() not null,
  resolved_at      timestamptz,

  constraint valid_status     check (status in ('open', 'resolved', 'cancelled')),
  constraint valid_resolution check (resolution in ('YES', 'NO') or resolution is null)
);

alter table public.markets enable row level security;

create policy "Mercados visibles por todos"
  on public.markets for select using (true);

-- ============================================================
-- POSICIONES (shares YES/NO por dirección)
-- ============================================================
create table public.positions (
  address     text not null,
  market_id   uuid not null references public.markets(id) on delete cascade,
  yes_shares  decimal(18, 8) not null default 0 check (yes_shares >= 0),
  no_shares   decimal(18, 8) not null default 0 check (no_shares >= 0),
  updated_at  timestamptz default now() not null,
  primary key (address, market_id)
);

alter table public.positions enable row level security;

create policy "Posiciones visibles por todos"
  on public.positions for select using (true);

-- ============================================================
-- TRANSACCIONES (ledger de auditoría)
-- ============================================================
create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  type          text not null,
  from_address  text,
  to_address    text,
  market_id     uuid references public.markets(id),
  amount        decimal(18, 8),
  outcome       text,
  shares        decimal(18, 8),
  signature     text,
  nonce         bigint,
  status        text not null default 'confirmed',
  created_at    timestamptz default now() not null
);

alter table public.transactions enable row level security;

create policy "Transacciones visibles por todos"
  on public.transactions for select using (true);

-- ============================================================
-- FAUCET CLAIMS (un claim por dirección)
-- ============================================================
create table public.faucet_claims (
  address     text primary key,
  claimed_at  timestamptz default now() not null
);

alter table public.faucet_claims enable row level security;

create policy "Faucet claims visibles por todos"
  on public.faucet_claims for select using (true);

-- ============================================================
-- TAREAS DE GANANCIAS (página earn)
-- ============================================================
create table public.earn_tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  description  text,
  reward_pen   decimal(18, 8) not null default 10 check (reward_pen > 0),
  task_type    text not null,
  requirements jsonb,
  is_active    boolean not null default true,
  icon         text,
  created_at   timestamptz default now() not null
);

alter table public.earn_tasks enable row level security;

create policy "Earn tasks visibles por todos"
  on public.earn_tasks for select using (true);

-- ============================================================
-- COMPLETACIONES DE TAREAS
-- ============================================================
create table public.task_completions (
  user_id      uuid references public.profiles(id) on delete cascade,
  task_id      uuid references public.earn_tasks(id) on delete cascade,
  completed_at timestamptz default now() not null,
  reward_paid  decimal(18, 8),
  primary key  (user_id, task_id)
);

alter table public.task_completions enable row level security;

create policy "Usuario ve sus propias completaciones"
  on public.task_completions for select
  using ((select auth.uid()) = user_id);

-- ============================================================
-- DATOS INICIALES — Tareas de Ganancias
-- ============================================================
insert into public.earn_tasks (title, description, reward_pen, task_type, requirements, icon) values
  ('Primer Paso',       'Reclama tus primeros 100 PEN del faucet',             50,  'faucet',        '{"action": "claim_faucet"}',    '🚰'),
  ('Primera Apuesta',   'Realiza tu primera apuesta en cualquier mercado',      25,  'trade',         '{"min_trades": 1}',             '🎯'),
  ('Crea tu Mercado',   'Crea tu primer mercado de predicción',                 50,  'create_market', '{"min_markets": 1}',            '📊'),
  ('Predictor Activo',  'Realiza 5 apuestas en diferentes mercados',           100,  'trade',         '{"min_trades": 5}',             '🔥'),
  ('Inversor Serio',    'Realiza 10 apuestas en total',                        200,  'trade',         '{"min_trades": 10}',            '💼'),
  ('Creador de Élite',  'Crea 3 mercados de predicción',                       150,  'create_market', '{"min_markets": 3}',            '🏆'),
  ('Transfiere PEN',    'Realiza una transferencia a otro usuario',              25,  'transfer',      '{"min_transfers": 1}',          '💸'),
  ('Oráculo del Mercado','Resuelve un mercado que creaste',                    100,  'resolve',       '{"min_resolved": 1}',           '🔮');

-- ============================================================
-- FUNCIONES AUXILIARES
-- ============================================================

-- Función para obtener estadísticas de una dirección
create or replace function public.get_address_stats(p_address text)
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'balance',        coalesce((select amount from public.balances where address = p_address), 0),
    'nonce',          coalesce((select nonce from public.balances where address = p_address), 0),
    'has_faucet',     exists(select 1 from public.faucet_claims where address = p_address),
    'trade_count',    (select count(*) from public.transactions
                       where from_address = p_address and type in ('BUY', 'SELL')),
    'market_count',   (select count(*) from public.markets
                       where creator_address = p_address)
  );
$$;

-- ============================================================
-- MERCADOS DE EJEMPLO (descomenta para poblar con datos iniciales)
-- ============================================================
-- insert into public.markets (question, description, creator_address, yes_reserve, no_reserve, category) values
--   ('¿Perú clasificará al Mundial 2026?', 'La selección peruana de fútbol tiene que clasificar a través de las eliminatorias sudamericanas.', 'P_SYSTEM', 200, 200, 'deportes'),
--   ('¿Bitcoin superará los $100,000 antes de 2026?', 'El precio de BTC en USD superará la barrera psicológica de $100,000.', 'P_SYSTEM', 150, 150, 'crypto'),
--   ('¿UTEC tendrá clases presenciales todo el 2025?', 'La universidad UTEC mantendrá modalidad presencial sin interrupciones durante 2025.', 'P_SYSTEM', 100, 100, 'educacion');

-- PeruvianMarket — Migración 002: Sistema de Admins y Probabilidades Ponderadas
-- Ejecutar DESPUÉS de 001_init.sql en: https://supabase.com/dashboard/project/<id>/sql

-- ============================================================
-- COLUMNA ADMIN EN PERFILES
-- ============================================================
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- ============================================================
-- CAMPOS ADMIN EN MERCADOS
-- ============================================================
alter table public.markets
  add column if not exists admin_probability numeric(6,4),   -- P_real del admin (0.0000 – 1.0000)
  add column if not exists admin_confidence  numeric(14,2) not null default 100, -- C: peso de confianza en PEN
  add column if not exists creator_user_id   uuid references auth.users(id);    -- link al usuario auth

-- Restricción: admin_probability debe estar entre 0 y 1
alter table public.markets
  drop constraint if exists valid_admin_probability;
alter table public.markets
  add constraint valid_admin_probability
  check (admin_probability is null or (admin_probability > 0 and admin_probability < 1));

-- ============================================================
-- POLÍTICA RLS: admins pueden insertar mercados directamente
-- ============================================================
drop policy if exists "admins pueden crear mercados" on public.markets;
create policy "admins pueden crear mercados"
  on public.markets for insert
  with check (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid())
      and is_admin = true
    )
  );

-- Admins pueden actualizar reservas del AMM (ajuste de probabilidad)
drop policy if exists "admins pueden actualizar mercados" on public.markets;
create policy "admins pueden actualizar mercados"
  on public.markets for update
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid())
      and is_admin = true
    )
  );

-- ============================================================
-- FUNCIÓN: Volumen total de un mercado
-- ============================================================
create or replace function public.get_market_volume(p_market_id uuid)
returns numeric language sql stable security definer as $$
  select coalesce(sum(abs(amount)), 0)
  from public.transactions
  where market_id = p_market_id
    and type in ('BUY', 'SELL')
    and status = 'confirmed';
$$;

-- ============================================================
-- FUNCIÓN: Probabilidad ponderada (creencia popular + estimado admin)
--
--   P_blend = (V × P_market + C × P_admin) / (V + C)
--
--   Donde:
--     V        = volumen de trades en PEN (descubrimiento de precio colectivo)
--     C        = confianza admin en PEN   (peso del estimado experto)
--     P_market = precio implícito del AMM  = no_reserve / (yes_reserve + no_reserve)
--     P_admin  = estimado del admin        (0–1)
-- ============================================================
create or replace function public.blended_probability(
  p_yes_reserve    numeric,
  p_no_reserve     numeric,
  p_admin_prob     numeric,
  p_confidence     numeric,
  p_market_id      uuid default null
)
returns numeric language plpgsql stable security definer as $$
declare
  v_p_market numeric;
  v_volume   numeric;
begin
  -- Precio de mercado implícito del AMM
  v_p_market := p_no_reserve / (p_yes_reserve + p_no_reserve);

  -- Si no hay estimado admin, devolver precio de mercado
  if p_admin_prob is null then
    return v_p_market;
  end if;

  -- Volumen total de trades
  v_volume := coalesce(public.get_market_volume(p_market_id), 0);

  -- Fórmula de ponderación bayesiana
  return (v_volume * v_p_market + p_confidence * p_admin_prob) / (v_volume + p_confidence);
end;
$$;

-- ============================================================
-- PARA HACERTE ADMIN: ejecuta esto en el SQL Editor de Supabase
-- después de registrarte, reemplaza tu email:
--
--   update public.profiles
--   set is_admin = true
--   where id = (
--     select id from auth.users where email = 'tu@email.com'
--   );
-- ============================================================

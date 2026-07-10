import type { SupabaseClient } from '@supabase/supabase-js';

export interface ChickenSettings {
  bajo: number; medio: number; alto: number; extremo: number; house_edge: number;
}
export interface MinesSettings    { house_edge: number }
export interface CrashSettings    { house_edge: number }
export interface RouletteSettings { house_edge: number }
export interface BlackjackSettings { bj_payout: number; house_edge: number }
export interface SlotsSettings    { rtp: number }
export interface ScratchSettings  { rtp: number }

type SettingsMap = {
  chicken:   ChickenSettings;
  mines:     MinesSettings;
  crash:     CrashSettings;
  roulette:  RouletteSettings;
  blackjack: BlackjackSettings;
  slots:     SlotsSettings;
  scratch:   ScratchSettings;
};

export const CASINO_DEFAULTS: SettingsMap = {
  chicken:   { bajo: 0.85, medio: 0.75, alto: 0.60, extremo: 0.45, house_edge: 0.05 },
  mines:     { house_edge: 0.05 },
  crash:     { house_edge: 0.03 },
  roulette:  { house_edge: 0.027 },
  blackjack: { bj_payout: 1.5, house_edge: 0.005 },
  slots:     { rtp: 0.96 },
  scratch:   { rtp: 0.915 },
};

// Cache in-memory con TTL: evita un round-trip a Supabase por cada acción de
// juego. El proceso Next.js es único (PM2 fork), así que el cache es coherente;
// setCasinoSettings lo invalida al guardar desde el panel admin.
const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map<string, { value: unknown; expires: number }>();

export async function getCasinoSettings<K extends keyof SettingsMap>(
  admin: SupabaseClient,
  key: K,
): Promise<SettingsMap[K]> {
  const cached = settingsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value as SettingsMap[K];

  let result: SettingsMap[K] = CASINO_DEFAULTS[key];
  try {
    const { data } = await admin.from('casino_settings').select('value').eq('key', key).single();
    if (data?.value) result = { ...CASINO_DEFAULTS[key], ...(data.value as SettingsMap[K]) };
  } catch { /* table may not exist yet — fall back to defaults */ }

  settingsCache.set(key, { value: result, expires: Date.now() + SETTINGS_TTL_MS });
  return result;
}

export async function setCasinoSettings<K extends keyof SettingsMap>(
  admin: SupabaseClient,
  key: K,
  value: Partial<SettingsMap[K]>,
): Promise<void> {
  settingsCache.delete(key); // leer el valor persistido, no el cacheado
  const current = await getCasinoSettings(admin, key);
  const merged = { ...current, ...value };
  await admin.from('casino_settings').upsert({ key, value: merged, updated_at: new Date().toISOString() });
  settingsCache.set(key, { value: merged, expires: Date.now() + SETTINGS_TTL_MS });
}

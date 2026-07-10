// Motor de batallas Pokémon (Showdown) con apuestas de CHC.
//
// Modos:
//  - pvp_random: 1v1 equipos aleatorios Gen 9 · el ganador se lleva el pot
//  - pvp_custom: 1v1 con equipos creados por los jugadores (gen9customgame)
//  - bot:        vs la máquina con 3 dificultades · paga multiplicador
//
// Extra: stream de espectadores + apuestas laterales parimutuel (se liquidan
// junto con la batalla), y detección de shinies en la UI.
import { BattleStreams, Teams, Dex } from '@pkmn/sim';
import type { PokemonSet } from '@pkmn/sim';
import { TeamGenerators } from '@pkmn/randoms';
import type { SupabaseClient } from '@supabase/supabase-js';
import { credit } from './casino-bank';
import { adjustHouse } from './casino-house';

Teams.setGeneratorFactory(TeamGenerators);

export const TURN_TIMEOUT_MS = 120_000;
export const SIDEBET_MAX_TURN = 5;      // apuestas de espectadores hasta el turno 5
export const SIDEBET_RAKE = 0.05;       // 5% del pool lateral para la casa

export type Side = 'p1' | 'p2';
export type BattleMode = 'pvp_random' | 'pvp_custom' | 'bot';
export type BotLevel = 'facil' | 'medio' | 'dificil';

export const BOT_PAYOUTS: Record<BotLevel, number> = {
  facil: 1.5,
  medio: 2.2,
  dificil: 3.5,
};

interface SideState {
  address: string;
  name: string;
  log: string[];
  request: unknown | null;
  pendingSince: number | null;
}

interface ReqMove { id: string; move: string; pp: number; disabled?: boolean }
interface BotRequest {
  active?: { moves: ReqMove[] }[];
  side?: { pokemon: { condition: string; active: boolean; details: string }[] };
  forceSwitch?: boolean[];
  wait?: boolean;
}

export class ServerBattle {
  readonly id: string;
  readonly mode: BattleMode;
  readonly botLevel: BotLevel | null;
  readonly sides: Record<Side, SideState>;
  spectatorLog: string[] = [];
  turn = 0;
  ended = false;
  winnerName: string | null = null;
  tie = false;
  private botEnemySpecies: string | null = null;
  private streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());

  constructor(opts: {
    id: string;
    mode: BattleMode;
    botLevel?: BotLevel;
    p1: { address: string; name: string; team?: string };
    p2: { address: string; name: string; team?: string };
  }) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.botLevel = opts.botLevel ?? null;
    this.sides = {
      p1: { address: opts.p1.address, name: opts.p1.name, log: [], request: null, pendingSince: null },
      p2: { address: opts.p2.address, name: opts.p2.name, log: [], request: null, pendingSince: null },
    };
    void this.consume('p1');
    void this.consume('p2');
    void this.consumeSpectator();
    void this.consumeOmniscient();

    const format = opts.mode === 'pvp_custom' ? 'gen9customgame' : 'gen9randombattle';
    const p1Opts: Record<string, unknown> = { name: opts.p1.name };
    const p2Opts: Record<string, unknown> = { name: opts.p2.name };
    if (opts.p1.team) p1Opts.team = opts.p1.team;
    if (opts.p2.team) p2Opts.team = opts.p2.team;

    void this.streams.omniscient.write(
      `>start {"formatid":"${format}"}\n` +
      `>player p1 ${JSON.stringify(p1Opts)}\n` +
      `>player p2 ${JSON.stringify(p2Opts)}`,
    );
  }

  private async consume(side: Side) {
    try {
      for await (const chunk of this.streams[side]) {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('|request|')) {
            try {
              const req = JSON.parse(line.slice('|request|'.length));
              this.sides[side].request = req;
              this.sides[side].pendingSince = req?.wait ? null : Date.now();
              // La máquina juega el lado p2
              if (side === 'p2' && this.botLevel && !req?.wait) {
                setTimeout(() => this.botChoose(req as BotRequest), 1200);
              }
            } catch { /* ignorar */ }
          } else if (line.startsWith('|error|')) {
            this.sides[side].pendingSince = Date.now();
            this.sides[side].log.push(line);
            if (side === 'p2' && this.botLevel) this.choose('p2', 'default');
          } else if (line.trim()) {
            this.sides[side].log.push(line);
            // El bot memoriza al rival activo para calcular efectividades
            if (side === 'p2' && this.botLevel && (line.startsWith('|switch|p1a') || line.startsWith('|drag|p1a'))) {
              this.botEnemySpecies = line.split('|')[3]?.split(',')[0] ?? null;
            }
          }
        }
      }
    } catch { /* stream cerrado */ }
  }

  private async consumeSpectator() {
    try {
      for await (const chunk of this.streams.spectator) {
        for (const line of chunk.split('\n')) {
          if (line.trim()) this.spectatorLog.push(line);
        }
      }
    } catch { /* stream cerrado */ }
  }

  private async consumeOmniscient() {
    try {
      for await (const chunk of this.streams.omniscient) {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('|turn|')) this.turn = Number(line.slice('|turn|'.length)) || this.turn;
          else if (line.startsWith('|win|')) {
            this.ended = true;
            this.winnerName = line.slice('|win|'.length).trim();
            void onBattleEnded(this);
          } else if (line.startsWith('|tie')) {
            this.ended = true;
            this.tie = true;
            void onBattleEnded(this);
          }
        }
      }
    } catch { /* stream cerrado */ }
  }

  // ── IA del bot ──────────────────────────────────────────────────────────────
  private botChoose(req: BotRequest): void {
    if (this.ended) return;
    try {
      if (req.forceSwitch?.[0]) {
        this.choose('p2', `switch ${this.botPickSwitch(req)}`);
        return;
      }
      const moves = req.active?.[0]?.moves ?? [];
      const usable = moves.map((m, i) => ({ ...m, slot: i + 1 })).filter(m => !m.disabled && m.pp > 0);
      if (usable.length === 0) { this.choose('p2', 'default'); return; }

      if (this.botLevel === 'facil') {
        this.choose('p2', `move ${usable[Math.floor(Math.random() * usable.length)].slot}`);
        return;
      }

      // medio/dificil: maximizar poder × efectividad × STAB
      const myDetails = req.side?.pokemon.find(p => p.active)?.details ?? '';
      const mySpecies = myDetails.split(',')[0];
      const scored = usable.map(m => ({ slot: m.slot, score: this.scoreMove(m.id, mySpecies) }));
      scored.sort((a, b) => b.score - a.score);

      const useBest = this.botLevel === 'dificil' || Math.random() < 0.6;
      const pick = useBest ? scored[0] : scored[Math.floor(Math.random() * scored.length)];
      this.choose('p2', `move ${pick.slot}`);
    } catch {
      this.choose('p2', 'default');
    }
  }

  private scoreMove(moveId: string, mySpecies: string): number {
    try {
      const move = Dex.moves.get(moveId);
      if (!move.exists || move.category === 'Status') return 5; // los de estado valen poco pero no cero
      let score = move.basePower || 40;
      const myTypes = Dex.species.get(mySpecies)?.types ?? [];
      if (myTypes.includes(move.type)) score *= 1.5; // STAB
      if (this.botEnemySpecies) {
        const enemyTypes = Dex.species.get(this.botEnemySpecies)?.types ?? [];
        if (enemyTypes.length) {
          if (!Dex.getImmunity(move.type, enemyTypes)) return 0;
          score *= Math.pow(2, Dex.getEffectiveness(move.type, enemyTypes));
        }
      }
      return score * (0.9 + Math.random() * 0.2); // jitter para no ser 100% predecible
    } catch { return 10; }
  }

  private botPickSwitch(req: BotRequest): number {
    const team = req.side?.pokemon ?? [];
    const options = team
      .map((p, i) => ({ slot: i + 1, active: p.active, pct: condPct(p.condition) }))
      .filter(o => !o.active && o.pct > 0);
    if (options.length === 0) return 2;
    if (this.botLevel === 'facil') return options[Math.floor(Math.random() * options.length)].slot;
    options.sort((a, b) => b.pct - a.pct); // el más sano
    return options[0].slot;
  }

  // ── Acciones ────────────────────────────────────────────────────────────────
  choose(side: Side, choice: string): void {
    this.sides[side].pendingSince = null;
    void this.streams.omniscient.write(`>${side} ${choice}`);
  }

  forfeit(side: Side): void {
    const other: Side = side === 'p1' ? 'p2' : 'p1';
    this.ended = true;
    this.winnerName = this.sides[other].name;
    void this.streams.omniscient.write(`>forcewin ${other}`);
    void onBattleEnded(this);
  }

  sideOf(address: string): Side | null {
    if (this.sides.p1.address === address) return 'p1';
    if (this.sides.p2.address === address) return 'p2';
    return null;
  }

  winnerAddress(): string | null {
    if (!this.winnerName) return null;
    if (this.sides.p1.name === this.winnerName) return this.sides.p1.address;
    if (this.sides.p2.name === this.winnerName) return this.sides.p2.address;
    return null;
  }
}

function condPct(cond: string): number {
  if (!cond || cond.includes('fnt')) return 0;
  const [cur, max] = cond.split(' ')[0].split('/').map(Number);
  return max ? (cur / max) * 100 : 0;
}

// ── Equipos custom → formato packed del sim ───────────────────────────────────
export interface TeamSlotInput {
  species: string;
  ability: string;
  item: string;
  moves: string[];
}

export function packTeam(slots: TeamSlotInput[]): string {
  const sets: PokemonSet[] = slots.map(s => ({
    name: s.species,
    species: s.species,
    item: s.item ?? '',
    ability: s.ability ?? '',
    moves: (s.moves ?? []).filter(Boolean).slice(0, 4),
    nature: 'Serious',
    gender: '',
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 100,
  }));
  return Teams.pack(sets);
}

// ── Registro en memoria ───────────────────────────────────────────────────────
const registry: Map<string, ServerBattle> =
  ((globalThis as Record<string, unknown>).__pkmnBattles as Map<string, ServerBattle>) ??
  new Map<string, ServerBattle>();
(globalThis as Record<string, unknown>).__pkmnBattles = registry;

export function getBattle(id: string): ServerBattle | undefined {
  return registry.get(id);
}

export function startBattle(opts: ConstructorParameters<typeof ServerBattle>[0]): ServerBattle {
  const battle = new ServerBattle(opts);
  registry.set(opts.id, battle);
  return battle;
}

export function dropBattle(id: string): void {
  registry.delete(id);
}

// ── Liquidación (batalla principal + apuestas laterales) ─────────────────────
let adminFactory: (() => SupabaseClient) | null = null;
export function setAdminFactory(f: () => SupabaseClient): void {
  adminFactory = f;
}

export async function settleBattle(
  admin: SupabaseClient,
  battleId: string,
  winnerAddress: string | null, // null = empate/reembolso
): Promise<boolean> {
  const { data: claimed } = await admin
    .from('pokemon_battles')
    .update({ status: 'finished', winner_address: winnerAddress, updated_at: new Date().toISOString() })
    .eq('id', battleId)
    .eq('status', 'active')
    .select('wager, creator_address, opponent_address, mode, bot_level');

  if (!claimed || claimed.length === 0) return false;

  const row = claimed[0] as {
    wager: number; creator_address: string; opponent_address: string | null;
    mode: BattleMode | null; bot_level: BotLevel | null;
  };
  const wager = Number(row.wager);
  const mode: BattleMode = row.mode ?? 'pvp_random';

  if (mode === 'bot') {
    // La casa ya recibió la apuesta al crear; si el jugador gana, paga mult×
    if (winnerAddress && winnerAddress !== 'BOT') {
      const mult = BOT_PAYOUTS[row.bot_level ?? 'facil'] ?? 1.5;
      const prize = Math.round(wager * mult * 100) / 100;
      await credit(admin, winnerAddress, prize);
      await adjustHouse(admin, -prize);
    } else if (!winnerAddress) {
      // Empate/reembolso vs bot: devolver la apuesta
      await credit(admin, row.creator_address, wager);
      await adjustHouse(admin, -wager);
    }
  } else if (winnerAddress) {
    await credit(admin, winnerAddress, wager * 2);
    try {
      await admin.from('transactions').insert({
        type: 'CLAIM', from_address: 'POKEMON', to_address: winnerAddress,
        amount: wager * 2, status: 'confirmed',
      });
    } catch { /* non-critical */ }
  } else if (row.opponent_address) {
    await credit(admin, row.creator_address, wager);
    await credit(admin, row.opponent_address, wager);
  }

  await settleSideBets(admin, battleId, winnerAddress, row.creator_address, row.opponent_address);
  dropBattle(battleId);
  return true;
}

/** Apuestas de espectadores: parimutuel con 5% de rake para la casa. */
async function settleSideBets(
  admin: SupabaseClient,
  battleId: string,
  winnerAddress: string | null,
  creator: string,
  opponent: string | null,
): Promise<void> {
  try {
    const { data: bets } = await admin
      .from('pokemon_side_bets')
      .select('id, address, side, amount')
      .eq('battle_id', battleId)
      .eq('status', 'open');
    if (!bets || bets.length === 0) return;

    // Marcar liquidadas primero (claim colectivo — evita doble pago)
    const ids = bets.map(b => b.id);
    const { data: locked } = await admin
      .from('pokemon_side_bets')
      .update({ status: 'settled' })
      .in('id', ids)
      .eq('status', 'open')
      .select('id');
    if (!locked || locked.length === 0) return;

    const winnerSide: Side | null =
      winnerAddress === null ? null : winnerAddress === creator ? 'p1' : winnerAddress === opponent ? 'p2' : 'p2';

    if (winnerSide === null) {
      // Batalla reembolsada → reembolsar todas las apuestas laterales
      for (const b of bets) await credit(admin, b.address, Number(b.amount));
      return;
    }

    const winPool = bets.filter(b => b.side === winnerSide).reduce((s, b) => s + Number(b.amount), 0);
    const losePool = bets.filter(b => b.side !== winnerSide).reduce((s, b) => s + Number(b.amount), 0);

    if (winPool === 0) {
      await adjustHouse(admin, losePool); // nadie acertó: la casa se queda el pool
      return;
    }
    if (losePool === 0) {
      // Sin contraparte: reembolso
      for (const b of bets) await credit(admin, b.address, Number(b.amount));
      return;
    }

    const distributable = losePool * (1 - SIDEBET_RAKE);
    await adjustHouse(admin, losePool - distributable);
    for (const b of bets) {
      if (b.side !== winnerSide) continue;
      const stake = Number(b.amount);
      const payout = Math.round((stake + (stake / winPool) * distributable) * 100) / 100;
      await credit(admin, b.address, payout);
    }
  } catch { /* best-effort: nunca bloquear la liquidación principal */ }
}

async function onBattleEnded(battle: ServerBattle): Promise<void> {
  if (!adminFactory) return;
  try {
    const admin = adminFactory();
    await settleBattle(admin, battle.id, battle.tie ? null : battle.winnerAddress());
  } catch { /* /state reintentará */ }
}

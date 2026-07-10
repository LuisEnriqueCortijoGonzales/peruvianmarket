'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { Loader2, Swords, Flag, Timer, Trophy, X, Bot, Users, Shuffle, Eye, Hammer } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Mode = 'pvp_random' | 'pvp_custom' | 'bot';
type BotLevel = 'facil' | 'medio' | 'dificil';

interface OpenChallenge { id: string; creator_address: string; wager: number; mode: Mode; created_at: string }
interface MyBattle { id: string; creator_address: string; opponent_address: string | null; wager: number; status: string; mode: Mode }
interface LiveBattle { id: string; creator_address: string; opponent_address: string; wager: number; mode: Mode; turn: number; bets_open: boolean }

interface ReqMove { move: string; id: string; pp: number; maxpp: number; disabled?: boolean }
interface ReqPokemon { ident: string; details: string; condition: string; active: boolean }
interface BattleRequest {
  active?: { moves: ReqMove[] }[];
  side?: { pokemon: ReqPokemon[] };
  forceSwitch?: boolean[];
  wait?: boolean;
}

interface PokeVisual { species: string; nick: string; hpPct: number; status: string; fainted: boolean; shiny: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────
const short = (a: string | null) => a ? (a === 'BOT' ? '🤖 BOT' : `${a.slice(0, 6)}…${a.slice(-4)}`) : '—';
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sprite = (species: string, back: boolean, shiny: boolean) =>
  `https://play.pokemonshowdown.com/sprites/gen5${back ? '-back' : ''}${shiny ? '-shiny' : ''}/${toID(species)}.png`;

function parseCondition(cond: string): { pct: number; status: string; fainted: boolean } {
  if (!cond || cond.includes('fnt')) return { pct: 0, status: '', fainted: true };
  const [hp, status = ''] = cond.split(' ');
  const [cur, max] = hp.split('/').map(Number);
  return { pct: max ? Math.round((cur / max) * 100) : 0, status, fainted: false };
}

const CHIPS = [10, 50, 100, 500, 2000];
const BOT_INFO: Record<BotLevel, { label: string; mult: string; desc: string }> = {
  facil:   { label: '😴 Fácil',   mult: '1.5×', desc: 'juega al azar' },
  medio:   { label: '⚔️ Medio',   mult: '2.2×', desc: 'busca golpes efectivos' },
  dificil: { label: '💀 Difícil', mult: '3.5×', desc: 'maximiza daño siempre' },
};
const MODE_BADGE: Record<Mode, string> = { pvp_random: '🎲 Random', pvp_custom: '🛠️ Equipos', bot: '🤖 Bot' };

// ── Página ────────────────────────────────────────────────────────────────────
export default function PokemonPage() {
  const { balance, refresh } = useWallet();
  const [view, setView] = useState<'lobby' | 'battle' | 'spectate'>('lobby');
  const [battleId, setBattleId] = useState<string | null>(null);
  const [wagerAmount, setWagerAmount] = useState(10);
  const [mode, setMode] = useState<Mode>('pvp_random');
  const [botLevel, setBotLevel] = useState<BotLevel>('facil');

  const [open, setOpen] = useState<OpenChallenge[]>([]);
  const [live, setLive] = useState<LiveBattle[]>([]);
  const [mine, setMine] = useState<MyBattle | null>(null);
  const [myAddress, setMyAddress] = useState('');
  const [lobbyLoading, setLobbyLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLobby = useCallback(async () => {
    try {
      const [lr, vr] = await Promise.all([
        fetch('/api/pokemon/lobby').then(r => r.json()),
        fetch('/api/pokemon/live').then(r => r.json()),
      ]);
      if (lr.success) {
        setOpen(lr.data.open);
        setMine(lr.data.mine);
        setMyAddress(lr.data.my_address);
        if (lr.data.mine?.status === 'active') {
          setBattleId(lr.data.mine.id);
          setView('battle');
        }
      }
      if (vr.success) setLive(vr.data);
    } catch { /* silent */ }
    setLobbyLoading(false);
  }, []);

  useEffect(() => {
    loadLobby();
    if (view !== 'lobby') return;
    const id = setInterval(loadLobby, 5000);
    return () => clearInterval(id);
  }, [view, loadLobby]);

  async function createChallenge() {
    setBusy(true); setError(null);
    const r = await fetch('/api/pokemon/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wager: wagerAmount, mode, bot_level: botLevel }),
    });
    const d = await r.json();
    if (!d.success) setError(d.error);
    else {
      await refresh();
      if (d.data.started) { setBattleId(d.data.battle_id); setView('battle'); }
      else await loadLobby();
    }
    setBusy(false);
  }

  async function cancelChallenge(id: string) {
    setBusy(true);
    await fetch('/api/pokemon/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battle_id: id }),
    });
    await refresh(); await loadLobby();
    setBusy(false);
  }

  async function joinChallenge(id: string) {
    setBusy(true); setError(null);
    const r = await fetch('/api/pokemon/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battle_id: id }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); await loadLobby(); }
    else { await refresh(); setBattleId(id); setView('battle'); }
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-3 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">⚔️ Pokémon Showdown</h1>
            <p className="text-cream/40 text-xs mt-0.5">Batallas Gen 9 apostando CHC</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance !== null ? `${balance.toFixed(2)} CHC` : '—'}</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-sm px-3 py-2">{error}</div>
        )}

        {view === 'lobby' && (
          <LobbyView
            open={open} live={live} mine={mine} loading={lobbyLoading} busy={busy}
            wagerAmount={wagerAmount} setWagerAmount={setWagerAmount} balance={balance}
            mode={mode} setMode={setMode} botLevel={botLevel} setBotLevel={setBotLevel}
            onCreate={createChallenge} onCancel={cancelChallenge} onJoin={joinChallenge}
            onResume={(id) => { setBattleId(id); setView('battle'); }}
            onSpectate={(id) => { setBattleId(id); setView('spectate'); }}
          />
        )}
        {view === 'battle' && battleId && (
          <BattleView battleId={battleId} myAddress={myAddress}
            onExit={() => { setView('lobby'); setBattleId(null); refresh(); loadLobby(); }} />
        )}
        {view === 'spectate' && battleId && (
          <SpectateView battleId={battleId} balance={balance}
            onExit={() => { setView('lobby'); setBattleId(null); refresh(); loadLobby(); }} />
        )}
      </main>
    </div>
  );
}

// ── Lobby ─────────────────────────────────────────────────────────────────────
function LobbyView({ open, live, mine, loading, busy, wagerAmount, setWagerAmount, balance, mode, setMode, botLevel, setBotLevel, onCreate, onCancel, onJoin, onResume, onSpectate }: {
  open: OpenChallenge[]; live: LiveBattle[]; mine: MyBattle | null; loading: boolean; busy: boolean;
  wagerAmount: number; setWagerAmount: (v: number) => void; balance: number | null;
  mode: Mode; setMode: (m: Mode) => void; botLevel: BotLevel; setBotLevel: (b: BotLevel) => void;
  onCreate: () => void; onCancel: (id: string) => void; onJoin: (id: string) => void;
  onResume: (id: string) => void; onSpectate: (id: string) => void;
}) {
  if (loading) return <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin text-cream/30" /></div>;

  return (
    <div className="space-y-4">
      {/* Mi reto / batalla */}
      {mine && mine.status === 'waiting' && (
        <div className="rounded-2xl border border-mustard/30 bg-mustard/5 p-4 flex items-center justify-between">
          <div>
            <p className="text-cream font-semibold text-sm">Tu reto {MODE_BADGE[mine.mode] ?? ''} está publicado</p>
            <p className="text-cream/40 text-xs mt-0.5">Apuesta: <span className="text-mustard font-mono">{Number(mine.wager).toFixed(2)} CHC</span> · esperando rival…</p>
          </div>
          <button onClick={() => onCancel(mine.id)} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50">
            <X size={12} /> Cancelar
          </button>
        </div>
      )}
      {mine && mine.status === 'active' && (
        <button onClick={() => onResume(mine.id)}
          className="w-full rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-left hover:bg-emerald-500/15 transition-all">
          <p className="text-emerald-400 font-bold text-sm flex items-center gap-2"><Swords size={14} /> ¡Batalla en curso!</p>
          <p className="text-cream/40 text-xs mt-0.5">Clic para volver al combate</p>
        </button>
      )}

      {/* Crear */}
      {!mine && (
        <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-cream font-semibold text-sm">Nueva batalla</h2>
            <Link href="/casino/pokemon/teams"
              className="flex items-center gap-1.5 text-xs font-semibold text-purple-300 hover:text-purple-200 transition-colors">
              <Hammer size={12} /> Team Builder
            </Link>
          </div>

          {/* Modo */}
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { m: 'pvp_random' as Mode, icon: Shuffle, label: 'Random 1v1', desc: 'equipos aleatorios' },
              { m: 'pvp_custom' as Mode, icon: Users, label: 'Equipos 1v1', desc: 'tu equipo vs el suyo' },
              { m: 'bot' as Mode, icon: Bot, label: 'vs Máquina', desc: 'paga por dificultad' },
            ]).map(({ m, icon: Icon, label, desc }) => (
              <button key={m} onClick={() => setMode(m)}
                className={`py-2.5 px-2 rounded-xl border text-center transition-all ${
                  mode === m ? 'border-terracotta bg-terracotta/15 text-cream' : 'border-cream/10 bg-ink text-cream/50 hover:border-cream/25'
                }`}>
                <Icon size={16} className="mx-auto mb-1" />
                <p className="text-xs font-bold">{label}</p>
                <p className="text-[9px] opacity-60">{desc}</p>
              </button>
            ))}
          </div>

          {/* Dificultad bot */}
          {mode === 'bot' && (
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(BOT_INFO) as BotLevel[]).map(lv => (
                <button key={lv} onClick={() => setBotLevel(lv)}
                  className={`py-2 px-2 rounded-xl border text-center transition-all ${
                    botLevel === lv ? 'border-mustard bg-mustard/15 text-cream' : 'border-cream/10 bg-ink text-cream/50 hover:border-cream/25'
                  }`}>
                  <p className="text-xs font-bold">{BOT_INFO[lv].label}</p>
                  <p className="text-mustard text-sm font-black font-mono">{BOT_INFO[lv].mult}</p>
                  <p className="text-[9px] opacity-60">{BOT_INFO[lv].desc}</p>
                </button>
              ))}
            </div>
          )}

          {/* Apuesta */}
          <div className="flex gap-1.5 flex-wrap">
            {mode === 'bot' && (
              <button onClick={() => setWagerAmount(0)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                  wagerAmount === 0 ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-ink border-emerald-500/30 text-emerald-400 hover:border-emerald-400/60'
                }`}>
                🎓 GRATIS
              </button>
            )}
            {CHIPS.map(c => (
              <button key={c} onClick={() => setWagerAmount(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                  wagerAmount === c ? 'bg-terracotta border-terracotta text-cream' : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                }`}>
                {c >= 1000 ? `${c / 1000}K` : c}
              </button>
            ))}
            <CustomBetInput bet={wagerAmount} setBet={setWagerAmount} />
          </div>

          <button onClick={onCreate}
            disabled={busy || (wagerAmount > 0 && (!balance || balance < wagerAmount)) || (wagerAmount === 0 && mode !== 'bot')}
            className="w-full py-3 rounded-xl font-bold bg-terracotta hover:bg-terracotta/80 text-cream transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
            {mode === 'bot'
              ? wagerAmount === 0
                ? '🎓 ¡Batalla de práctica! — gratis'
                : `¡Pelear! — gana ${(wagerAmount * parseFloat(BOT_INFO[botLevel].mult)).toFixed(0)} CHC`
              : `Publicar reto — ${wagerAmount.toLocaleString()} CHC`}
          </button>
          <p className="text-[10px] text-cream/25 text-center">
            {mode === 'pvp_custom'
              ? 'Ambos jugadores necesitan un equipo guardado en el Team Builder'
              : mode === 'bot'
              ? wagerAmount === 0
                ? 'Modo práctica: sin apuesta ni premio — ideal para aprender'
                : `Si pierdes, la casa se queda tu apuesta · si ganas cobras ${BOT_INFO[botLevel].mult}`
              : 'Equipos aleatorios de 6 Pokémon (Gen 9) · el ganador se lleva el pot'}
          </p>
        </div>
      )}

      {/* Retos abiertos */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-cream/40 uppercase tracking-wider">Retos abiertos</p>
        {open.length === 0 ? (
          <div className="text-center py-6 text-cream/25 text-sm rounded-2xl border border-cream/5">No hay retos abiertos</div>
        ) : (
          open.map(c => (
            <div key={c.id} className="rounded-xl border border-cream/10 bg-ink-soft px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-cream/80 text-sm font-mono">{short(c.creator_address)}
                  <span className="ml-2 text-[10px] text-cream/40">{MODE_BADGE[c.mode] ?? ''}</span>
                </p>
                <p className="text-mustard text-xs font-mono font-bold">{Number(c.wager).toFixed(2)} CHC</p>
              </div>
              <button onClick={() => onJoin(c.id)} disabled={busy || !balance || balance < Number(c.wager)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all disabled:opacity-40">
                ⚔️ Aceptar
              </button>
            </div>
          ))
        )}
      </div>

      {/* En vivo — espectar y apostar */}
      {live.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-cream/40 uppercase tracking-wider flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Batallas en vivo
          </p>
          {live.map(b => (
            <button key={b.id} onClick={() => onSpectate(b.id)}
              className="w-full rounded-xl border border-cream/10 bg-ink-soft px-4 py-3 flex items-center justify-between hover:border-purple-400/40 transition-all text-left">
              <div>
                <p className="text-cream/80 text-sm font-mono">{short(b.creator_address)} <span className="text-cream/30">vs</span> {short(b.opponent_address)}</p>
                <p className="text-cream/40 text-xs">Turno {b.turn} · pot {(Number(b.wager) * 2).toFixed(0)} CHC
                  {b.bets_open && <span className="ml-2 text-emerald-400 font-semibold">apuestas abiertas</span>}
                </p>
              </div>
              <Eye size={16} className="text-purple-300 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Parser compartido de protocolo ────────────────────────────────────────────
function useProtocolParser(perspective: 'p1' | 'p2') {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [myMon, setMyMon] = useState<PokeVisual | null>(null);
  const [oppMon, setOppMon] = useState<PokeVisual | null>(null);
  const [turn, setTurn] = useState(0);
  const perspectiveRef = useRef(perspective);
  perspectiveRef.current = perspective;

  const ingest = useCallback((lines: string[]) => {
    const pretty: string[] = [];
    for (const line of lines) {
      const parts = line.split('|');
      const cmd = parts[1];
      const isMine = (ref: string) => ref?.startsWith(`${perspectiveRef.current}a`);
      const nickOf = (ref: string) => ref?.split(': ')[1] ?? '';

      if (cmd === 'turn') { setTurn(Number(parts[2])); pretty.push(`— Turno ${parts[2]} —`); }
      else if (cmd === 'switch' || cmd === 'drag') {
        const details = parts[3] ?? '';
        const species = details.split(',')[0];
        const shiny = details.includes('shiny');
        const cond = parseCondition(parts[4] ?? '100/100');
        const vis: PokeVisual = { species, nick: nickOf(parts[2]), hpPct: cond.pct, status: cond.status, fainted: false, shiny };
        if (isMine(parts[2])) setMyMon(vis); else setOppMon(vis);
        pretty.push(`${isMine(parts[2]) ? '🟢' : '🔴'} ¡Adelante, ${species}!${shiny ? ' ✨SHINY✨' : ''}`);
      }
      else if (cmd === 'move') pretty.push(`${isMine(parts[2]) ? '🟢' : '🔴'} ${nickOf(parts[2])} usó ${parts[3]}`);
      else if (cmd === '-damage' || cmd === '-heal') {
        const cond = parseCondition(parts[3] ?? '');
        const setter = isMine(parts[2]) ? setMyMon : setOppMon;
        setter(m => m ? { ...m, hpPct: cond.pct, status: cond.status, fainted: cond.fainted } : m);
      }
      else if (cmd === 'faint') {
        const setter = isMine(parts[2]) ? setMyMon : setOppMon;
        setter(m => m ? { ...m, hpPct: 0, fainted: true } : m);
        pretty.push(`💀 ${nickOf(parts[2])} se debilitó`);
      }
      else if (cmd === '-status') pretty.push(`${nickOf(parts[2])} sufre ${parts[3]}`);
      else if (cmd === '-crit') pretty.push('¡Golpe crítico!');
      else if (cmd === '-supereffective') pretty.push('¡Es súper efectivo!');
      else if (cmd === '-resisted') pretty.push('No es muy efectivo…');
      else if (cmd === '-miss') pretty.push('¡Falló!');
      else if (cmd === 'win') pretty.push(`🏆 Ganador: ${short(parts[2])}`);
      else if (cmd === 'error') pretty.push(`⚠ ${parts[2] ?? 'Elección inválida'}`);
    }
    if (pretty.length) setLogLines(prev => [...prev.slice(-120), ...pretty]);
  }, []);

  return { logLines, myMon, oppMon, turn, ingest };
}

// ── Batalla (jugador) ─────────────────────────────────────────────────────────
function BattleView({ battleId, myAddress, onExit }: {
  battleId: string; myAddress: string; onExit: () => void;
}) {
  const [request, setRequest] = useState<BattleRequest | null>(null);
  const [myPending, setMyPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [prize, setPrize] = useState(0);
  const [modeInfo, setModeInfo] = useState<Mode>('pvp_random');
  const [timeoutClaimable, setTimeoutClaimable] = useState(false);
  const [oppPendingMs, setOppPendingMs] = useState(0);
  const [sending, setSending] = useState(false);
  const [side, setSide] = useState<'p1' | 'p2'>('p1');
  const seqRef = useRef(0);
  const logBox = useRef<HTMLDivElement | null>(null);
  const { logLines, myMon, oppMon, turn, ingest } = useProtocolParser(side);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/pokemon/state?battle_id=${battleId}&since=${seqRef.current}`);
      const d = await r.json();
      if (!d.success) return;
      const s = d.data;
      if (typeof s.prize === 'number') setPrize(s.prize);
      if (s.mode) setModeInfo(s.mode);
      if (s.status === 'finished' || s.status === 'cancelled') {
        setEnded(true);
        setWinner(s.winner_address ?? null);
        return;
      }
      if (s.side) setSide(s.side);
      if (typeof s.log_seq === 'number') { ingest(s.log ?? []); seqRef.current = s.log_seq; }
      setRequest(s.request ?? null);
      setMyPending(!!s.my_pending);
      setTimeoutClaimable(!!s.timeout_claimable);
      setOppPendingMs(Number(s.opponent_pending_ms ?? 0));
      if (s.winner_address) { setEnded(true); setWinner(s.winner_address); }
    } catch { /* silent */ }
  }, [battleId, ingest]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => { logBox.current?.scrollTo({ top: logBox.current.scrollHeight }); }, [logLines]);

  async function send(choice: string) {
    setSending(true);
    await fetch('/api/pokemon/move', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battle_id: battleId, choice }),
    });
    setMyPending(false);
    setSending(false);
    setTimeout(poll, 400);
  }

  async function forfeit(claimTimeout: boolean) {
    if (!claimTimeout && !confirm('¿Rendirte? Pierdes tu apuesta.')) return;
    await fetch('/api/pokemon/forfeit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battle_id: battleId, claim_timeout: claimTimeout }),
    });
    setTimeout(poll, 400);
  }

  const moves = request?.active?.[0]?.moves ?? [];
  const team = request?.side?.pokemon ?? [];
  const mustSwitch = !!request?.forceSwitch?.[0];
  const iWon = ended && winner === myAddress;

  if (ended) {
    return (
      <div className="rounded-2xl border border-cream/10 bg-ink-soft p-8 text-center space-y-4">
        <p className="text-5xl">{winner === null ? '🤝' : iWon ? '🏆' : '💀'}</p>
        <h2 className={`text-2xl font-black ${winner === null ? 'text-cream/60' : iWon ? 'text-mustard' : 'text-red-400'}`}>
          {winner === null ? 'Empate — apuesta devuelta'
            : iWon ? (prize > 0 ? `¡GANASTE ${prize.toFixed(2)} CHC!` : '🎓 ¡Ganaste la práctica!')
            : modeInfo === 'bot' ? 'La máquina te venció' : 'Perdiste la batalla'}
        </h2>
        <button onClick={onExit} className="btn-primary px-8">Volver al lobby</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <BattleField myMon={myMon} oppMon={oppMon} turn={turn} headerRight={`Premio: ${prize.toFixed(0)} CHC`} />
      <LogPane logBox={logBox} logLines={logLines} />

      {myPending && !mustSwitch && moves.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {moves.map((m, i) => (
            <button key={m.id} onClick={() => send(`move ${i + 1}`)} disabled={sending || m.disabled}
              className="py-3 px-3 rounded-xl font-bold text-sm bg-terracotta/20 border border-terracotta/40 text-cream hover:bg-terracotta/35 transition-all disabled:opacity-30 text-left">
              {m.move}
              <span className="block text-[10px] font-normal text-cream/40">PP {m.pp}/{m.maxpp}</span>
            </button>
          ))}
        </div>
      )}

      {myPending && team.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-cream/30 uppercase tracking-wider">
            {mustSwitch ? '¡Elige tu siguiente Pokémon!' : 'Cambiar Pokémon'}
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {team.map((p, i) => {
              const cond = parseCondition(p.condition);
              const species = p.details.split(',')[0];
              const shiny = p.details.includes('shiny');
              const usable = !p.active && !cond.fainted;
              return (
                <button key={p.ident + i} onClick={() => usable && send(`switch ${i + 1}`)}
                  disabled={sending || !usable}
                  title={`${species} ${cond.fainted ? '(debilitado)' : `${cond.pct}%`}`}
                  className={`relative w-12 h-12 rounded-lg border transition-all ${
                    p.active ? 'border-mustard/60 bg-mustard/10'
                    : cond.fainted ? 'border-cream/5 opacity-25'
                    : 'border-cream/15 bg-ink hover:border-emerald-400/50'
                  }`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sprite(species, false, shiny)} alt={species} className="w-full h-full object-contain" style={{ imageRendering: 'pixelated' }}
                    onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <span className="absolute bottom-0 left-0 right-0 h-1 rounded-b-lg bg-ink overflow-hidden">
                    <span className={`block h-full ${cond.pct > 50 ? 'bg-emerald-400' : cond.pct > 20 ? 'bg-yellow-400' : 'bg-red-500'}`}
                      style={{ width: `${cond.pct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!myPending && (
        <div className="rounded-xl border border-cream/10 bg-ink-soft py-3 text-center text-cream/40 text-sm flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Esperando al rival… {oppPendingMs > 10000 && `(${Math.floor(oppPendingMs / 1000)}s)`}
        </div>
      )}

      <div className="flex gap-2">
        {timeoutClaimable && (
          <button onClick={() => forfeit(true)}
            className="flex-1 py-2 rounded-lg text-sm font-bold bg-mustard/20 text-mustard border border-mustard/40 hover:bg-mustard/30 transition-all flex items-center justify-center gap-1.5">
            <Trophy size={13} /> Reclamar victoria (rival inactivo)
          </button>
        )}
        <button onClick={() => forfeit(false)}
          className="px-4 py-2 rounded-lg text-xs font-semibold border border-red-500/25 text-red-400/70 hover:bg-red-500/10 transition-all flex items-center gap-1.5">
          <Flag size={11} /> Rendirse
        </button>
        {!timeoutClaimable && oppPendingMs > 60000 && (
          <span className="flex items-center gap-1 text-[10px] text-cream/25 font-mono">
            <Timer size={10} /> reclamo a los 120s
          </span>
        )}
      </div>
    </div>
  );
}

// ── Espectador + apuestas laterales ───────────────────────────────────────────
function SpectateView({ battleId, balance, onExit }: {
  battleId: string; balance: number | null; onExit: () => void;
}) {
  const [status, setStatus] = useState('active');
  const [winner, setWinner] = useState<string | null>(null);
  const [creator, setCreator] = useState('');
  const [opponent, setOpponent] = useState('');
  const [pools, setPools] = useState({ p1: 0, p2: 0 });
  const [betsOpen, setBetsOpen] = useState(false);
  const [myBet, setMyBet] = useState<{ side: string; amount: number } | null>(null);
  const [betSide, setBetSide] = useState<'p1' | 'p2'>('p1');
  const [betAmount, setBetAmount] = useState(10);
  const [betting, setBetting] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const logBox = useRef<HTMLDivElement | null>(null);
  const { logLines, myMon, oppMon, turn, ingest } = useProtocolParser('p1');

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/pokemon/spectate?battle_id=${battleId}&since=${seqRef.current}`);
      const d = await r.json();
      if (!d.success) return;
      const s = d.data;
      setStatus(s.status);
      setWinner(s.winner_address ?? null);
      setCreator(s.creator);
      setOpponent(s.opponent ?? '');
      setPools({ p1: Number(s.pool_p1 ?? 0), p2: Number(s.pool_p2 ?? 0) });
      setBetsOpen(!!s.bets_open);
      setMyBet(s.my_bet ?? null);
      if (typeof s.log_seq === 'number') { ingest(s.log ?? []); seqRef.current = s.log_seq; }
    } catch { /* silent */ }
  }, [battleId, ingest]);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => { logBox.current?.scrollTo({ top: logBox.current.scrollHeight }); }, [logLines]);

  async function placeBet() {
    setBetting(true); setBetError(null);
    const r = await fetch('/api/pokemon/sidebet', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battle_id: battleId, side: betSide, amount: betAmount }),
    });
    const d = await r.json();
    if (!d.success) setBetError(d.error);
    else await poll();
    setBetting(false);
  }

  const totalPool = pools.p1 + pools.p2;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-cream/60 text-sm font-mono flex items-center gap-2">
          <Eye size={13} className="text-purple-300" />
          {short(creator)} <span className="text-cream/25">vs</span> {short(opponent)}
        </p>
        <button onClick={onExit} className="text-xs text-cream/40 hover:text-cream transition-colors">← Salir</button>
      </div>

      <BattleField myMon={myMon} oppMon={oppMon} turn={turn}
        headerRight={totalPool > 0 ? `Pool lateral: ${totalPool.toFixed(0)} CHC` : 'Sin apuestas laterales aún'} />
      <LogPane logBox={logBox} logLines={logLines} />

      {status === 'finished' ? (
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 text-center">
          <p className="text-mustard font-bold">🏆 Ganó {short(winner)}</p>
          <p className="text-cream/40 text-xs mt-1">Las apuestas laterales ya fueron liquidadas en tu wallet</p>
        </div>
      ) : myBet ? (
        <div className="rounded-xl border border-purple-400/30 bg-purple-500/10 p-3 text-center text-sm">
          <p className="text-purple-300">Apostaste <b className="font-mono">{Number(myBet.amount).toFixed(2)} CHC</b> a {short(myBet.side === 'p1' ? creator : opponent)}</p>
          <p className="text-cream/30 text-[10px] mt-1">Pool {short(creator)}: {pools.p1.toFixed(0)} · Pool {short(opponent)}: {pools.p2.toFixed(0)} · rake 5%</p>
        </div>
      ) : betsOpen ? (
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 space-y-2">
          <p className="text-xs font-semibold text-cream/50 uppercase tracking-wider">🎰 ¿Quién gana? (cierra en turno 5)</p>
          {betError && <p className="text-red-400 text-xs">{betError}</p>}
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setBetSide('p1')}
              className={`py-2 rounded-lg text-xs font-bold border transition-all ${betSide === 'p1' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-cream/10 text-cream/50'}`}>
              {short(creator)}<span className="block text-[9px] font-mono opacity-60">pool {pools.p1.toFixed(0)}</span>
            </button>
            <button onClick={() => setBetSide('p2')}
              className={`py-2 rounded-lg text-xs font-bold border transition-all ${betSide === 'p2' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-cream/10 text-cream/50'}`}>
              {short(opponent)}<span className="block text-[9px] font-mono opacity-60">pool {pools.p2.toFixed(0)}</span>
            </button>
          </div>
          <div className="flex gap-1.5 items-center">
            {[5, 10, 50, 100].map(c => (
              <button key={c} onClick={() => setBetAmount(c)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${betAmount === c ? 'bg-terracotta border-terracotta text-cream' : 'bg-ink border-cream/10 text-cream/50'}`}>
                {c}
              </button>
            ))}
            <CustomBetInput bet={betAmount} setBet={setBetAmount} />
          </div>
          <button onClick={placeBet} disabled={betting || !balance || balance < betAmount}
            className="w-full py-2 rounded-lg text-sm font-bold bg-purple-500/25 text-purple-200 border border-purple-400/40 hover:bg-purple-500/40 transition-all disabled:opacity-40">
            {betting ? '…' : `Apostar ${betAmount} CHC`}
          </button>
        </div>
      ) : (
        <p className="text-center text-cream/25 text-xs">Apuestas cerradas (turno {turn} &gt; 5) — solo espectando</p>
      )}
    </div>
  );
}

// ── Piezas compartidas ────────────────────────────────────────────────────────
function BattleField({ myMon, oppMon, turn, headerRight }: {
  myMon: PokeVisual | null; oppMon: PokeVisual | null; turn: number; headerRight: string;
}) {
  return (
    <div className="rounded-2xl border border-cream/10 bg-gradient-to-b from-emerald-950/40 to-ink-soft p-4 relative overflow-hidden">
      <div className="flex justify-between text-[10px] text-cream/30 font-mono mb-2">
        <span>Turno {turn}</span>
        <span className="text-mustard font-bold">{headerRight}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 items-end min-h-[180px]">
        <div className="order-2 flex flex-col items-center gap-1">
          {oppMon && (
            <>
              <HpBar mon={oppMon} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sprite(oppMon.species, false, oppMon.shiny)} alt={oppMon.species}
                className={`w-24 h-24 object-contain ${oppMon.fainted ? 'opacity-20 grayscale' : ''}`}
                style={{ imageRendering: 'pixelated' }}
                onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
            </>
          )}
        </div>
        <div className="order-1 flex flex-col items-center gap-1 self-end">
          {myMon && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sprite(myMon.species, true, myMon.shiny)} alt={myMon.species}
                className={`w-28 h-28 object-contain ${myMon.fainted ? 'opacity-20 grayscale' : ''}`}
                style={{ imageRendering: 'pixelated' }}
                onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
              <HpBar mon={myMon} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LogPane({ logBox, logLines }: { logBox: React.MutableRefObject<HTMLDivElement | null>; logLines: string[] }) {
  return (
    <div ref={el => { logBox.current = el; }} className="rounded-xl border border-cream/10 bg-ink-soft px-3 py-2 h-32 overflow-y-auto text-xs text-cream/60 font-mono space-y-0.5">
      {logLines.length === 0
        ? <p className="text-cream/25">Preparando la batalla…</p>
        : logLines.map((l, i) => <p key={i} className={l.includes('SHINY') ? 'text-yellow-300 font-bold' : ''}>{l}</p>)}
    </div>
  );
}

function HpBar({ mon }: { mon: PokeVisual }) {
  return (
    <div className="w-32">
      <div className="flex justify-between text-[10px] text-cream/50 mb-0.5">
        <span className="font-semibold truncate">{mon.shiny && '✨'}{mon.species}</span>
        <span className="font-mono">{mon.hpPct}%{mon.status && ` ${mon.status}`}</span>
      </div>
      <div className="h-1.5 bg-ink rounded-full overflow-hidden border border-cream/10">
        <div className={`h-full rounded-full transition-all duration-500 ${
          mon.hpPct > 50 ? 'bg-emerald-400' : mon.hpPct > 20 ? 'bg-yellow-400' : 'bg-red-500'
        }`} style={{ width: `${mon.hpPct}%` }} />
      </div>
    </div>
  );
}

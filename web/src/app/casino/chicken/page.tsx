'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { RISK_LEVELS, getMultiplier, type RiskLevel } from '@/lib/chicken';
import { Loader2 } from 'lucide-react';

// ── Lane cell in the road track ───────────────────────────────────────────────
type LaneStatus = 'future' | 'safe' | 'current' | 'hit';

function Lane({ status, mult, lane }: { status: LaneStatus; mult?: number; lane: number }) {
  const base = 'relative flex flex-col items-center justify-center rounded-xl border-2 transition-all duration-300 select-none shrink-0';
  const W = 'w-[60px] h-[72px] sm:w-[68px] sm:h-[80px]';

  const styles: Record<LaneStatus, string> = {
    future:  'bg-ink-soft border-cream/10',
    safe:    'bg-market-yes/15 border-market-yes/50 shadow-lg shadow-market-yes/20',
    current: 'bg-mustard/15 border-mustard/60 shadow-lg shadow-mustard/30 scale-110 z-10',
    hit:     'bg-red-500/20 border-red-500/70 shadow-lg shadow-red-500/30 scale-110 z-10',
  };

  const emoji: Record<LaneStatus, string> = {
    future:  '🚧',
    safe:    '✅',
    current: '🐔',
    hit:     '🚛',
  };

  return (
    <div className={`${base} ${W} ${styles[status]}`}>
      <span className="text-2xl leading-none">{emoji[status]}</span>
      {status === 'safe' && mult !== undefined && (
        <span className="text-[9px] font-bold text-market-yes mt-0.5">{mult.toFixed(2)}×</span>
      )}
      {status === 'future' && (
        <span className="text-[9px] text-cream/20 mt-0.5">C{lane}</span>
      )}
      {status === 'current' && mult !== undefined && (
        <span className="text-[9px] font-bold text-mustard mt-0.5">{mult.toFixed(2)}×</span>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'active' | 'acting' | 'done';

interface GameState {
  gameId: string;
  bet: number;
  step: number;
  survivalRate: number;
  houseEdge: number;
  risk: RiskLevel;
  hit: boolean;
  payout: number;
  netChange: number;
}

const BET_CHIPS = [5, 25, 100, 500, 2000, 10000];
const FUTURE_LANES = 5; // how many upcoming lanes to show

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ChickenPage() {
  const { balance, refresh } = useWallet();
  const trackRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase]   = useState<Phase>('idle');
  const [bet, setBet]       = useState(25);
  const [risk, setRisk]     = useState<RiskLevel>('medio');
  const [game, setGame]     = useState<GameState | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // Current multiplier & payout derived from game state
  const curMult  = game ? getMultiplier(game.step, game.survivalRate, game.houseEdge) : 1;
  const nextMult = game ? getMultiplier(game.step + 1, game.survivalRate, game.houseEdge) : getMultiplier(1, RISK_LEVELS[risk].survivalRate);
  const potential = game ? Math.round(game.bet * curMult * 100) / 100 : 0;

  // Scroll track to end when step changes
  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.scrollLeft = trackRef.current.scrollWidth;
    }
  }, [game?.step]);

  // Resume active game on mount
  useEffect(() => {
    fetch('/api/casino/chicken/start')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setGame({
            gameId: d.data.id,
            bet: d.data.bet,
            step: d.data.step,
            survivalRate: d.data.survival_rate,
            houseEdge: d.data.house_edge,
            risk: d.data.risk,
            hit: false,
            payout: 0,
            netChange: 0,
          });
          setPhase('active');
        }
      }).catch(() => {});
  }, []);

  async function startGame() {
    setError(null);
    setPhase('acting');
    const r = await fetch('/api/casino/chicken/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet, risk }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('idle'); return; }
    setGame({
      gameId: d.data.game_id,
      bet: d.data.bet,
      step: 0,
      survivalRate: d.data.survival_rate,
      houseEdge: d.data.house_edge,
      risk: d.data.risk,
      hit: false,
      payout: 0,
      netChange: 0,
    });
    setPhase('active');
    refresh();
  }

  const advance = useCallback(async () => {
    if (!game || phase !== 'active') return;
    setPhase('acting');
    const r = await fetch('/api/casino/chicken/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: game.gameId }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('active'); return; }

    if (d.data.hit) {
      setGame(prev => prev ? { ...prev, step: prev.step, hit: true, payout: 0, netChange: d.data.net_change } : null);
      setPhase('done');
      refresh();
      return;
    }

    setGame(prev => prev ? { ...prev, step: d.data.step } : null);
    setPhase('active');
  }, [game, phase, refresh]);

  async function cashout() {
    if (!game || phase !== 'active' || game.step === 0) return;
    setPhase('acting');
    const r = await fetch('/api/casino/chicken/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: game.gameId }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('active'); return; }
    setGame(prev => prev ? { ...prev, payout: d.data.payout, netChange: d.data.net_change, hit: false } : null);
    setPhase('done');
    refresh();
  }

  function reset() { setGame(null); setPhase('idle'); setError(null); }

  // Build the visible lane array: past lanes + current marker + future lanes
  const lanes: { lane: number; status: LaneStatus; mult?: number }[] = [];
  if (game) {
    // Completed lanes (show last 6 to save space)
    const startLane = Math.max(1, game.step - 5);
    for (let i = startLane; i <= game.step; i++) {
      const s: LaneStatus = i < game.step ? 'safe' : game.hit ? 'hit' : 'current';
      lanes.push({ lane: i, status: s, mult: getMultiplier(i, game.survivalRate, game.houseEdge) });
    }
    // Future lanes (only shown if game is still active)
    if (!game.hit) {
      for (let i = game.step + 1; i <= game.step + FUTURE_LANES; i++) {
        lanes.push({ lane: i, status: 'future' });
      }
    }
  }

  const riskInfo = RISK_LEVELS[risk];
  const activeRisk = game ? RISK_LEVELS[game.risk] : riskInfo;

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-xl mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">🐔 La Gallina</h1>
            <p className="text-cream/40 text-xs mt-0.5">Avanza por la pista · cobra antes de que te atropellen</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
        </div>

        {/* Road track */}
        {game && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3 overflow-hidden">
            {/* Lane strip */}
            <div
              ref={trackRef}
              className="flex gap-2 overflow-x-auto pb-1 scroll-smooth"
              style={{ scrollbarWidth: 'none' }}
            >
              {/* Start flag */}
              <div className="shrink-0 flex flex-col items-center justify-center w-10 text-cream/20 text-xl">
                🏁
              </div>
              {lanes.map(({ lane, status, mult }) => (
                <Lane key={lane} lane={lane} status={status} mult={mult} />
              ))}
              {/* Infinity sign */}
              {!game.hit && (
                <div className="shrink-0 flex flex-col items-center justify-center w-10 text-cream/20 text-xl">
                  ∞
                </div>
              )}
            </div>

            {/* Stats */}
            {!game.hit && (
              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-cream/5">
                <div className="text-center">
                  <p className="text-[10px] text-cream/30 uppercase tracking-wider">Multiplicador</p>
                  <p className="text-lg font-black text-mustard">{curMult.toFixed(2)}×</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-cream/30 uppercase tracking-wider">Cobrar ahora</p>
                  <p className={`text-lg font-black ${game.step > 0 ? 'text-market-yes' : 'text-cream/30'}`}>
                    {game.step > 0 ? potential.toFixed(2) : '—'}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-cream/30 uppercase tracking-wider">Siguiente</p>
                  <p className="text-lg font-black text-cream/50">{nextMult.toFixed(2)}×</p>
                </div>
              </div>
            )}

            {/* Risk badge */}
            <div className="flex items-center gap-2 text-xs text-cream/30">
              <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${activeRisk.bg} ${activeRisk.color}`}>
                Riesgo {activeRisk.label}
              </span>
              <span>·</span>
              <span>{Math.round(game.survivalRate * 100)}% de supervivencia por carril</span>
              <span>·</span>
              <span>Carril {game.step}</span>
            </div>
          </div>
        )}

        {/* Game-over overlay */}
        {phase === 'done' && game && (
          <div className={`rounded-2xl p-5 text-center border ${
            game.hit ? 'bg-red-500/10 border-red-500/30' : 'bg-market-yes/10 border-market-yes/30'
          }`}>
            <p className="text-4xl mb-2">{game.hit ? '🚛' : '💰'}</p>
            <p className={`text-xl font-black ${game.hit ? 'text-red-400' : 'text-market-yes'}`}>
              {game.hit ? '¡Te atropellaron en el carril ' + game.step + '!' : `¡Cobraste en el carril ${game.step}!`}
            </p>
            <p className={`text-2xl font-bold font-mono mt-2 ${game.netChange >= 0 ? 'text-market-yes' : 'text-red-400'}`}>
              {game.netChange >= 0 ? '+' : ''}{game.netChange.toFixed(2)} CHC
            </p>
            {!game.hit && game.payout > 0 && (
              <p className="text-xs text-cream/30 mt-1">
                {game.bet.toFixed(2)} CHC × {curMult.toFixed(2)}× = {game.payout.toFixed(2)} CHC
              </p>
            )}
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Action buttons — active game */}
        {(phase === 'active' || phase === 'acting') && game && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={advance}
              disabled={phase === 'acting'}
              className="py-4 rounded-xl font-bold text-lg bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-terracotta/20"
            >
              {phase === 'acting'
                ? <Loader2 size={20} className="animate-spin" />
                : '▶ Avanzar'
              }
            </button>
            <button
              onClick={cashout}
              disabled={phase === 'acting' || game.step === 0}
              className="py-4 rounded-xl font-bold text-lg bg-market-yes hover:bg-market-yes/80 text-ink transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-market-yes/20"
            >
              {game.step === 0 ? '🌾 Avanza primero' : `💰 Cobrar ${potential.toFixed(0)} CHC`}
            </button>
          </div>
        )}

        {/* New game button */}
        {phase === 'done' && (
          <button onClick={reset}
            className="w-full py-3 rounded-xl font-bold bg-ink-soft hover:bg-ink-muted border border-cream/10 text-cream transition-all active:scale-95">
            ↩ Nueva partida
          </button>
        )}

        {/* Setup — idle */}
        {phase === 'idle' && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-4">

            {/* Risk selector */}
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Nivel de riesgo</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.entries(RISK_LEVELS) as [RiskLevel, typeof RISK_LEVELS[RiskLevel]][]).map(([key, info]) => (
                  <button key={key} onClick={() => setRisk(key)}
                    className={`py-2 rounded-lg text-xs font-bold border transition-all text-center ${
                      risk === key
                        ? `${info.bg} ${info.color} ${info.border}`
                        : 'bg-ink border-cream/10 text-cream/50 hover:border-cream/30'
                    }`}>
                    {info.label}
                    <br />
                    <span className="text-[10px] font-normal opacity-70">{Math.round(info.survivalRate * 100)}%</span>
                  </button>
                ))}
              </div>
              {/* Multiplier preview */}
              <div className="flex items-center justify-between text-xs text-cream/30 px-1">
                {[1, 2, 3, 5, 8].map(s => (
                  <span key={s}>
                    C{s}: <span className={`font-bold ${riskInfo.color}`}>{getMultiplier(s, riskInfo.survivalRate).toFixed(2)}×</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Bet selector */}
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Apuesta</p>
              <div className="flex gap-1.5 flex-wrap">
                {BET_CHIPS.map(c => (
                  <button key={c} onClick={() => setBet(c)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                      bet === c
                        ? 'bg-terracotta border-terracotta text-cream'
                        : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                    }`}>
                    {c >= 1000 ? `${c / 1000}K` : c}
                  </button>
                ))}
                {balance !== null && balance > 0 && (
                  <button onClick={() => setBet(Math.floor(balance))}
                    className="px-3 py-1.5 rounded-lg text-sm font-bold border border-red-800/40 bg-ink text-red-400 hover:border-red-600/60 transition-all">
                    ALL IN
                  </button>
                )}
                  <CustomBetInput bet={bet} setBet={setBet} />
              </div>
            </div>

            <button onClick={startGame} disabled={!balance || balance < bet}
              className="w-full py-4 rounded-xl font-bold text-lg bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-terracotta/20">
              🐔 JUGAR — {bet.toLocaleString()} CHC
            </button>
          </div>
        )}

        {/* Rules */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/30 space-y-1">
          <p className="font-semibold text-cream/20 uppercase tracking-wider">Cómo jugar</p>
          <p>La gallina avanza por la pista carril a carril. Cada carril tiene una probabilidad de que aparezca un camión. Cobra cuando quieras para asegurar tus ganancias.</p>
          <p className="text-cream/15">Ventaja de casa ≈ 5% · multiplicadores crecen geométricamente</p>
        </div>

      </main>
    </div>
  );
}

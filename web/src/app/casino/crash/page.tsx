'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { Loader2, TrendingUp } from 'lucide-react';

const K = 0.08; // growth constant — matches server

function multAt(elapsedMs: number) { return Math.exp((elapsedMs / 1000) * K); }
function crashTime(crashAt: number) { return (Math.log(crashAt) / K) * 1000; } // ms until crash

type GameState = 'idle' | 'betting' | 'active' | 'cashed_out' | 'crashed';

interface HistoryItem { multiplier_at_cashout: number; status: string; payout: number; bet: number }

const CHIPS      = [1, 5, 25, 100, 500, 2000, 10000];
const AUTO_OPTS  = [1.5, 2, 3, 5, 10, 20];

export default function CrashPage() {
  const { balance, refresh } = useWallet();

  const [bet, setBet]               = useState(1);
  const [autoCashout, setAutoCashout] = useState<number | null>(null);
  const [gameState, setGameState]   = useState<GameState>('idle');
  const [multiplier, setMultiplier] = useState(1.00);
  const [crashAt, setCrashAt]       = useState<number | null>(null);
  const [payout, setPayout]         = useState<number | null>(null);
  const [history, setHistory]       = useState<HistoryItem[]>([]);
  const [error, setError]           = useState<string | null>(null);
  const [activeBet, setActiveBet]   = useState(0);

  const gameIdRef    = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);   // Date.now() reference
  const tickRef      = useRef<NodeJS.Timeout | null>(null);
  const pollRef      = useRef<NodeJS.Timeout | null>(null);
  const autoCashRef  = useRef<number | null>(null);
  const stateRef     = useRef<GameState>('idle');

  stateRef.current   = gameState;
  autoCashRef.current = autoCashout;

  function stopAll() {
    if (tickRef.current)  { clearInterval(tickRef.current);  tickRef.current = null; }
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current = null; }
  }
  useEffect(() => () => stopAll(), []);

  // Load history on mount
  useEffect(() => {
    fetch('/api/casino/crash/status', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.success) setHistory(d.data); })
      .catch(() => {});
    // Also check for in-progress game
    fetch('/api/casino/crash/status')
      .then(r => r.json())
      .then(d => {
        if (!d.success || !d.data.active) return;
        const { game_id, started_at, bet: b } = d.data;
        gameIdRef.current = game_id;
        startedAtRef.current = Date.now() - (Date.now() - new Date(started_at).getTime());
        setActiveBet(b);
        setGameState('active');
        startTick();
        startPoll();
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCrash = useCallback((at: number) => {
    stopAll();
    setCrashAt(at);
    setMultiplier(at);
    setGameState('crashed');
    refresh();
    fetch('/api/casino/crash/status', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d.success) setHistory(d.data); });
  }, [refresh]);

  const doCashout = useCallback(async () => {
    if (stateRef.current !== 'active' || !gameIdRef.current) return;
    stopAll();
    try {
      const res = await fetch('/api/casino/crash/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: gameIdRef.current }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error); setGameState('idle'); return; }
      if (data.data.crashed) {
        handleCrash(data.data.crash_at);
      } else {
        setPayout(data.data.payout);
        setMultiplier(data.data.multiplier);
        setGameState('cashed_out');
        refresh();
        fetch('/api/casino/crash/status', { method: 'POST' })
          .then(r => r.json())
          .then(d => { if (d.success) setHistory(d.data); });
      }
    } catch { setError('Error de conexión'); setGameState('idle'); }
  }, [handleCrash, refresh]);

  function startTick() {
    tickRef.current = setInterval(() => {
      if (!startedAtRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      const m = multAt(elapsed);
      setMultiplier(Math.round(m * 100) / 100);
      // Auto cashout
      if (autoCashRef.current && m >= autoCashRef.current && stateRef.current === 'active') {
        doCashout();
      }
    }, 50);
  }

  function startPoll() {
    pollRef.current = setInterval(async () => {
      if (stateRef.current !== 'active') return;
      try {
        const res  = await fetch('/api/casino/crash/status');
        const data = await res.json();
        if (!data.success) return;
        if (!data.data.active && data.data.crashed) {
          handleCrash(data.data.crash_at);
        }
      } catch { /* ignore */ }
    }, 2500);
  }

  async function startGame() {
    setError(null);
    setGameState('betting');
    setCrashAt(null);
    setPayout(null);
    setMultiplier(1.00);
    try {
      const res = await fetch('/api/casino/crash/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bet }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error); setGameState('idle'); return; }
      gameIdRef.current   = data.data.game_id;
      startedAtRef.current = Date.now() - (Date.now() - new Date(data.data.started_at).getTime());
      setActiveBet(data.data.bet);
      setGameState('active');
      startTick();
      startPoll();
      refresh();
    } catch { setError('Error de conexión'); setGameState('idle'); }
  }

  function reset() { stopAll(); setGameState('idle'); setMultiplier(1.00); setCrashAt(null); setPayout(null); }

  // Airplane position (0-90% of bar)
  const planeX = Math.min(90, ((multiplier - 1) / 9) * 90);
  const planeY = Math.min(70, ((multiplier - 1) / 9) * 70); // rises up too

  const multColor = gameState === 'crashed'
    ? 'text-red-400'
    : gameState === 'cashed_out'
    ? 'text-market-yes'
    : multiplier >= 5 ? 'text-yellow-300' : multiplier >= 2 ? 'text-emerald-300' : 'text-cream';

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-lg mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">✈️ El Avión</h1>
            <p className="text-cream/40 text-xs mt-0.5">Cobra antes que explote</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">
              {balance !== null ? `${balance.toFixed(2)} CHC` : '—'}
            </p>
          </div>
        </div>

        {/* Game screen */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft overflow-hidden">
          {/* Multiplier display */}
          <div className="flex items-center justify-center py-8 relative">
            {gameState === 'idle' || gameState === 'betting' ? (
              <div className="text-center space-y-1">
                <p className="text-5xl font-black text-cream/20">✈️</p>
                <p className="text-cream/30 text-sm">
                  {gameState === 'betting' ? 'Esperando...' : 'Haz tu apuesta'}
                </p>
              </div>
            ) : (
              <div className="text-center">
                <p className={`text-6xl font-black transition-colors duration-200 ${multColor}`}>
                  {multiplier.toFixed(2)}×
                </p>
                {gameState === 'crashed' && (
                  <p className="text-red-400 font-bold text-lg mt-1 animate-fade-in">💥 BOOM!</p>
                )}
                {gameState === 'cashed_out' && payout !== null && (
                  <p className="text-market-yes font-bold text-lg mt-1 animate-fade-in">
                    +{(payout - activeBet).toFixed(2)} CHC ganaste
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Runway / flight path */}
          <div className="relative h-20 bg-ink mx-3 mb-3 rounded-xl overflow-hidden border border-cream/5">
            {/* Grid lines */}
            <div className="absolute inset-0 grid grid-cols-4 pointer-events-none">
              {[1,2,3].map(i => (
                <div key={i} className="border-r border-cream/5 h-full" style={{ gridColumn: i }} />
              ))}
            </div>
            {/* Trajectory line */}
            {gameState === 'active' && (
              <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <line
                  x1="5%" y1="85%"
                  x2={`${planeX + 2}%`} y2={`${85 - planeY}%`}
                  stroke="rgb(74 222 128 / 0.4)" strokeWidth="2" strokeDasharray="4 3"
                />
              </svg>
            )}
            {/* Airplane */}
            {(gameState === 'active' || gameState === 'cashed_out' || gameState === 'crashed') && (
              <div
                className={`absolute text-2xl transition-all duration-100 ${
                  gameState === 'crashed' ? 'animate-ping' : ''
                }`}
                style={{ left: `${planeX}%`, bottom: `${10 + planeY * 0.7}%` }}>
                {gameState === 'crashed' ? '💥' : '✈️'}
              </div>
            )}
            {(gameState === 'idle' || gameState === 'betting') && (
              <div className="absolute left-[5%] bottom-[15%] text-2xl text-cream/20">✈️</div>
            )}
          </div>
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Bet controls — only when idle/result */}
        {(gameState === 'idle' || gameState === 'betting' || gameState === 'cashed_out' || gameState === 'crashed') && (
          <div className="space-y-3 rounded-2xl border border-cream/10 bg-ink-soft p-4">
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Apuesta</p>
              <div className="flex gap-1.5 flex-wrap">
                {CHIPS.map(c => (
                  <button key={c} onClick={() => setBet(c)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                      bet === c
                        ? 'bg-terracotta border-terracotta text-cream'
                        : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                    }`}>
                    {c >= 1000 ? `${c/1000}K` : c}
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

            <div className="space-y-2">
              <p className="text-xs text-cream/40">
                Auto-cobrar en <span className="text-mustard">{autoCashout ? `${autoCashout}×` : 'manual'}</span>
              </p>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setAutoCashout(null)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                    autoCashout === null
                      ? 'bg-ink-muted border-mustard text-mustard'
                      : 'bg-ink border-cream/10 text-cream/40 hover:border-cream/20'
                  }`}>
                  Manual
                </button>
                {AUTO_OPTS.map(x => (
                  <button key={x} onClick={() => setAutoCashout(x)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                      autoCashout === x
                        ? 'bg-ink-muted border-mustard text-mustard'
                        : 'bg-ink border-cream/10 text-cream/40 hover:border-cream/20'
                    }`}>
                    {x}×
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={gameState === 'idle' ? startGame : reset}
              disabled={gameState === 'betting' || !balance || balance < bet}
              className="w-full py-4 rounded-xl font-bold text-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-terracotta hover:bg-terracotta-light text-cream shadow-lg shadow-terracotta/30">
              {gameState === 'betting' ? (
                <><Loader2 size={20} className="animate-spin" /> Iniciando...</>
              ) : gameState === 'idle' ? (
                <>✈️ APOSTAR {bet} CHC</>
              ) : (
                <>Jugar de nuevo</>
              )}
            </button>
          </div>
        )}

        {/* Active game — cash out button */}
        {gameState === 'active' && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-cream/40">Apuesta activa</span>
              <span className="text-mustard font-mono font-bold">{activeBet.toFixed(2)} CHC</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-cream/40">Si cobras ahora</span>
              <span className="text-market-yes font-mono font-bold">
                {(activeBet * multiplier).toFixed(2)} CHC
              </span>
            </div>
            {autoCashout && (
              <div className="flex justify-between text-sm">
                <span className="text-cream/40">Auto-cobro a</span>
                <span className="text-mustard/70 font-mono">{autoCashout}× = {(activeBet * autoCashout).toFixed(2)} CHC</span>
              </div>
            )}
            <button
              onClick={doCashout}
              className="w-full py-4 rounded-xl font-black text-lg bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg shadow-emerald-500/30 transition-all active:scale-95 flex items-center justify-center gap-2">
              <TrendingUp size={20} />
              COBRAR {(activeBet * multiplier).toFixed(2)} CHC
            </button>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-cream/30 uppercase tracking-wider font-semibold px-1">Historial reciente</p>
            <div className="flex gap-1.5 flex-wrap">
              {history.map((h, i) => {
                const crashed = h.status === 'crashed';
                const m = h.multiplier_at_cashout ?? 1;
                return (
                  <div key={i} className={[
                    'px-2.5 py-1 rounded-lg border text-xs font-bold font-mono',
                    crashed
                      ? 'bg-red-500/10 border-red-500/30 text-red-400'
                      : m >= 5
                      ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-300'
                      : m >= 2
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-ink border-cream/10 text-cream/40',
                  ].join(' ')}>
                    {crashed ? '💥' : m >= 2 ? '🚀' : ''}{m.toFixed(2)}×
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/30 space-y-1">
          <p className="font-semibold text-cream/25 uppercase tracking-wider">Cómo jugar</p>
          <p>Apuesta CHC y observa cómo sube el multiplicador. Cobra antes de que el avión explote para ganar.</p>
          <p>El multiplicador sube gradualmente. El punto de explosión es aleatorio — a veces explota casi al inicio.</p>
          <p className="text-cream/20">Casa: 3% · PRNG verificable</p>
        </div>

      </main>
    </div>
  );
}

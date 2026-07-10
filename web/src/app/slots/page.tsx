'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { Loader2, Zap, Gift, Star, RotateCcw, Square } from 'lucide-react';

// ── Symbols ───────────────────────────────────────────────────────────────────
const SYM: Record<string, { emoji: string; label: string; val: string; color: string }> = {
  heart:   { emoji: '❤️',  label: 'Corazón',  val: '0.3×', color: 'text-red-400'      },
  apple:   { emoji: '🍎',  label: 'Manzana',  val: '0.5×', color: 'text-red-500'      },
  lemon:   { emoji: '🍋',  label: 'Limón',    val: '0.5×', color: 'text-yellow-300'   },
  orange:  { emoji: '🍊',  label: 'Naranja',  val: '1×',   color: 'text-orange-400'   },
  grape:   { emoji: '🍇',  label: 'Uvas',     val: '2×',   color: 'text-purple-400'   },
  candy:   { emoji: '🍬',  label: 'Caramelo', val: '4×',   color: 'text-pink-400'     },
  lolly:   { emoji: '🍭',  label: 'Paleta',   val: '7×',   color: 'text-cyan-400'     },
  gem:     { emoji: '💎',  label: 'Diamante', val: '20×',  color: 'text-blue-400'     },
  scatter: { emoji: '💰',  label: 'SCATTER',  val: 'FREE', color: 'text-mustard'      },
  bomb:    { emoji: '✨',  label: 'Bomba ×',  val: 'MULT', color: 'text-emerald-400'  },
};

const ALL_SYM_IDS = Object.keys(SYM);
function randomSym() { return ALL_SYM_IDS[Math.floor(Math.random() * ALL_SYM_IDS.length)]; }

const ROWS = 5, COLS = 6;
const INIT_GRID = Array.from({ length: ROWS }, (_, r) =>
  Array.from({ length: COLS }, (_, c) => {
    const s = ['heart','apple','lemon','orange','grape','candy','lolly','gem'];
    return s[(r * COLS + c) % s.length];
  })
);

// ── Types ─────────────────────────────────────────────────────────────────────
interface CascadeStep {
  grid: string[][];
  win_pos: number[];
  bomb_pos: number[];
  bomb_mult: number;
  t_mult: number;
  step_pay: number;
  wins: Array<{ sym: string; count: number; sym_mult: number }>;
}

interface SpinResult {
  steps: CascadeStep[];
  total_payout: number;
  bet: number;
  net_change: number;
  new_balance: number;
  free_spins_triggered: number;
  scatter_count: number;
  used_free_spin: boolean;
  free_spins_remaining: number;
}

type Phase = 'idle' | 'spinning' | 'show_win' | 'tumble_out' | 'tumble_in' | 'done';

// ── Cell ──────────────────────────────────────────────────────────────────────
function Cell({
  sym, isWin, isBomb, isTumbleOut, isNew, isSpinning,
}: {
  sym: string; isWin: boolean; isBomb: boolean;
  isTumbleOut: boolean; isNew: boolean; isSpinning: boolean;
}) {
  const s = SYM[sym] ?? SYM.heart;
  return (
    <div className={[
      'relative flex items-center justify-center rounded-xl border select-none',
      'w-[48px] h-[48px] sm:w-[56px] sm:h-[56px] md:w-[64px] md:h-[64px]',
      'transition-all duration-300',
      isWin
        ? 'border-yellow-400 bg-yellow-400/15 shadow-lg shadow-yellow-400/40 scale-110 z-10'
        : isBomb
        ? 'border-emerald-400 bg-emerald-400/15 shadow-lg shadow-emerald-400/40 scale-105 z-10'
        : 'border-cream/10 bg-ink-soft',
      isTumbleOut ? 'scale-0 opacity-0' : '',
      isNew ? 'animate-slide-up' : '',
      isSpinning ? 'opacity-40' : '',
    ].filter(Boolean).join(' ')}>
      <span className="text-2xl sm:text-3xl leading-none"
        style={{ filter: isSpinning ? 'blur(3px)' : 'none', transition: 'filter 0.1s' }}>
        {s.emoji}
      </span>
      {isWin && <div className="absolute inset-0 rounded-xl bg-yellow-400/10 animate-pulse pointer-events-none" />}
      {isBomb && <div className="absolute inset-0 rounded-xl bg-emerald-400/10 animate-pulse pointer-events-none" />}
    </div>
  );
}

const CHIPS    = [1, 5, 25, 100, 500, 1000, 5000];
const AUTO_OPT = [5, 10, 25, 50, 100];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SlotsPage() {
  const { balance, refresh } = useWallet();

  const [displayGrid, setDisplayGrid] = useState<string[][]>(INIT_GRID);
  const [phase, setPhase]             = useState<Phase>('idle');
  const [winSet, setWinSet]           = useState<Set<number>>(new Set());
  const [bombSet, setBombSet]         = useState<Set<number>>(new Set());
  const [newCells, setNewCells]       = useState<Set<number>>(new Set());
  const [tumbleOutSet, setTumbleOutSet] = useState<Set<number>>(new Set());
  const [multiplier, setMultiplier]   = useState(1);
  const [sessionWin, setSessionWin]   = useState(0);
  const [lastStepPay, setLastStepPay] = useState(0);
  const [bet, setBet]                 = useState(1);
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0);
  const [triggerMsg, setTriggerMsg]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [bigWin, setBigWin]           = useState(false);

  // Auto-spin state
  const [isAuto, setIsAuto]           = useState(false);
  const [autoTotal, setAutoTotal]     = useState(10);
  const [autoLeft, setAutoLeft]       = useState(0);
  const [autoSessionPL, setAutoSessionPL] = useState(0);

  // Refs
  const spinTimers      = useRef<NodeJS.Timeout[]>([]);
  const spinIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const spinStartRef    = useRef(0);
  const resultRef       = useRef<SpinResult | null>(null);

  // Auto-spin refs (mutable, readable inside callbacks)
  const autoRef         = useRef(false);
  const autoLeftRef     = useRef(0);
  const freeSpinsRef    = useRef(0);
  const betRef          = useRef(bet);
  const doSpinRef       = useRef<((isFree?: boolean) => void) | null>(null);
  const autoFastRef     = useRef(false);    // true while auto-spinning
  const autoPlRef       = useRef(0);        // running P&L for auto session

  // Keep betRef in sync
  useEffect(() => { betRef.current = bet; }, [bet]);

  function clearTimers() {
    spinTimers.current.forEach(clearTimeout);
    spinTimers.current = [];
    if (spinIntervalRef.current) { clearInterval(spinIntervalRef.current); spinIntervalRef.current = null; }
  }

  useEffect(() => () => {
    clearTimers();
    autoRef.current = false;
  }, []);

  // ── Cascade animator ───────────────────────────────────────────────────────
  const runCascade = useCallback((result: SpinResult, fast: boolean) => {
    const { steps } = result;
    let totalAcc = 0;
    let stepIdx = 0;
    const W = fast ? 500 : 1300;  // win highlight duration
    const TO = fast ? 180 : 500;  // tumble-out duration
    const TI = fast ? 120 : 600;  // tumble-in settle

    function nextStep() {
      const step = steps[stepIdx];
      if (!step || !step.win_pos.length) {
        // No more wins — cascade done
        setWinSet(new Set()); setBombSet(new Set());
        setTumbleOutSet(new Set()); setNewCells(new Set());
        setDisplayGrid(steps[steps.length - 1].grid);
        setPhase('done');
        setSessionWin(totalAcc);
        if (totalAcc >= result.bet * 10) setBigWin(true);
        refresh();

        // ── Auto-spin continuation ─────────────────────────
        if (autoRef.current) {
          autoPlRef.current += result.net_change;
          setAutoSessionPL(autoPlRef.current);

          if (autoLeftRef.current > 0) {
            autoLeftRef.current--;
            setAutoLeft(autoLeftRef.current);
            const delay = fast ? 100 : 300;
            const t = setTimeout(() => {
              if (autoRef.current && doSpinRef.current) {
                doSpinRef.current(freeSpinsRef.current > 0);
              }
            }, delay);
            spinTimers.current.push(t);
          } else {
            // All auto-spins done
            autoRef.current = false;
            setIsAuto(false);
            setAutoLeft(0);
          }
        }
        return;
      }

      // Show wins
      setDisplayGrid(step.grid);
      setWinSet(new Set(step.win_pos));
      setBombSet(new Set(step.bomb_pos));
      setMultiplier(step.t_mult);
      const stepPay = Math.round(step.step_pay * result.bet * 100) / 100;
      totalAcc += stepPay;
      setLastStepPay(stepPay);
      setPhase('show_win');

      const t1 = setTimeout(() => {
        setTumbleOutSet(new Set([...step.win_pos, ...step.bomb_pos]));
        setPhase('tumble_out');

        const t2 = setTimeout(() => {
          stepIdx++;
          const nextGrid = steps[stepIdx]?.grid ?? steps[steps.length - 1].grid;
          const added = new Set<number>();
          for (let c = 0; c < COLS; c++) {
            const removedInCol = [...step.win_pos, ...step.bomb_pos].filter(i => i % COLS === c).length;
            for (let r = 0; r < removedInCol; r++) added.add(r * COLS + c);
          }
          setNewCells(added);
          setWinSet(new Set()); setBombSet(new Set()); setTumbleOutSet(new Set());
          setDisplayGrid(nextGrid);
          setPhase('tumble_in');

          const t3 = setTimeout(() => {
            setNewCells(new Set());
            nextStep();
          }, TI);
          spinTimers.current.push(t3);
        }, TO);
        spinTimers.current.push(t2);
      }, W);
      spinTimers.current.push(t1);
    }

    nextStep();
  }, [refresh]);

  // ── Core spin ──────────────────────────────────────────────────────────────
  function doSpin(isFree = false) {
    if (phase !== 'idle' && phase !== 'done') return;
    const fast = autoFastRef.current;
    clearTimers();
    setError(null);
    setSessionWin(0);
    setLastStepPay(0);
    setBigWin(false);
    setWinSet(new Set()); setBombSet(new Set());
    setTumbleOutSet(new Set()); setNewCells(new Set());
    setMultiplier(1);
    setTriggerMsg(null);
    resultRef.current = null;
    spinStartRef.current = Date.now();
    setPhase('spinning');

    const minSpinMs = fast ? 400 : 1400;

    spinIntervalRef.current = setInterval(() => {
      setDisplayGrid(Array.from({ length: ROWS }, () => Array.from({ length: COLS }, randomSym)));
    }, fast ? 45 : 80);

    fetch('/api/slots/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet: betRef.current, is_free: isFree }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          setError(data.error);
          setPhase('idle');
          clearTimers();
          if (autoRef.current) { autoRef.current = false; setIsAuto(false); setAutoLeft(0); }
          return;
        }
        const result: SpinResult = data.data;
        resultRef.current = result;

        // Update free spins
        freeSpinsRef.current = result.free_spins_remaining;
        setFreeSpinsLeft(result.free_spins_remaining);
        if (result.free_spins_triggered > 0) {
          setTriggerMsg(`🎰 ¡${result.free_spins_triggered} GIROS GRATIS!`);
          setTimeout(() => setTriggerMsg(null), 3000);
        }

        const elapsed = Date.now() - spinStartRef.current;
        const wait = Math.max(0, minSpinMs - elapsed);

        const t = setTimeout(() => {
          if (spinIntervalRef.current) { clearInterval(spinIntervalRef.current); spinIntervalRef.current = null; }
          setDisplayGrid(result.steps[0].grid);
          setMultiplier(1);
          const revealT = setTimeout(() => runCascade(result, fast), fast ? 80 : 350);
          spinTimers.current.push(revealT);
        }, wait);
        spinTimers.current.push(t);
      })
      .catch(() => {
        setError('Error de conexión');
        setPhase('idle');
        clearTimers();
        if (autoRef.current) { autoRef.current = false; setIsAuto(false); setAutoLeft(0); }
      });
  }

  // Keep doSpinRef current (so runCascade can call it)
  doSpinRef.current = doSpin;

  // ── Auto-spin controls ─────────────────────────────────────────────────────
  function startAuto() {
    if (phase !== 'idle' && phase !== 'done') return;
    autoRef.current = true;
    autoFastRef.current = true;
    autoLeftRef.current = autoTotal - 1; // first spin counts as 1
    autoPlRef.current = 0;
    setAutoLeft(autoTotal - 1);
    setAutoSessionPL(0);
    setIsAuto(true);
    doSpin(freeSpinsRef.current > 0);
  }

  function stopAuto() {
    autoRef.current = false;
    autoFastRef.current = false;
    setIsAuto(false);
    setAutoLeft(0);
  }

  const isSpinning = phase === 'spinning';
  const isBusy = isSpinning || phase === 'show_win' || phase === 'tumble_out' || phase === 'tumble_in';
  const hasFreeSpins = freeSpinsLeft > 0;
  const spinsCompleted = isAuto ? autoTotal - autoLeft : 0;

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream flex items-center gap-2">🎰 ChamoSlots</h1>
            <p className="text-cream/40 text-xs mt-0.5">Sweet Bonanza · Cluster Pays · 6×5</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">
              {balance !== null ? `${balance.toFixed(2)} CHC` : '—'}
            </p>
          </div>
        </div>

        {/* Free spins banner */}
        {hasFreeSpins && (
          <div className="rounded-xl bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-400/30 px-4 py-2.5 flex items-center justify-between animate-pulse-slow">
            <span className="text-yellow-300 font-bold flex items-center gap-2">
              <Gift size={16} /> {freeSpinsLeft} Giros Gratis
            </span>
            <button onClick={() => { autoFastRef.current = false; doSpin(true); }} disabled={isBusy}
              className="text-xs bg-yellow-400 text-ink font-bold px-3 py-1 rounded-lg hover:bg-yellow-300 transition-all disabled:opacity-50">
              ¡Usar!
            </button>
          </div>
        )}

        {/* Trigger message */}
        {triggerMsg && (
          <div className="rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-400/30 px-4 py-3 text-center animate-fade-in">
            <p className="text-emerald-300 font-bold text-lg">{triggerMsg}</p>
          </div>
        )}

        {/* Big win */}
        {bigWin && !isAuto && (
          <div className="rounded-xl bg-gradient-to-r from-yellow-500/25 to-orange-500/25 border border-yellow-400/40 px-4 py-3 text-center animate-fade-in">
            <p className="text-yellow-300 font-bold text-xl">🏆 GRAN VICTORIA</p>
            <p className="text-yellow-400 font-mono text-lg">+{sessionWin.toFixed(2)} CHC</p>
          </div>
        )}

        {/* Multiplier + current win */}
        <div className="flex items-center justify-between px-1 h-7">
          <div className="flex items-center gap-2">
            {multiplier > 1 && (
              <span className="bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 font-bold text-sm px-3 py-0.5 rounded-full animate-pulse-slow">
                ×{multiplier}
              </span>
            )}
            {lastStepPay > 0 && phase !== 'idle' && (
              <span className="text-mustard font-bold font-mono text-sm">+{lastStepPay.toFixed(2)} CHC</span>
            )}
          </div>
          {sessionWin > 0 && phase === 'done' && !isAuto && (
            <span className="text-cream/50 text-sm">
              Total: <span className="text-mustard font-bold">+{sessionWin.toFixed(2)} CHC</span>
            </span>
          )}
        </div>

        {/* Grid */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft p-2 sm:p-3 overflow-hidden">
          <div className="grid grid-cols-6 gap-1 sm:gap-1.5">
            {displayGrid.map((row, r) =>
              row.map((sym, c) => {
                const idx = r * COLS + c;
                return (
                  <Cell key={`${r}-${c}`} sym={sym}
                    isWin={winSet.has(idx)} isBomb={bombSet.has(idx)}
                    isTumbleOut={tumbleOutSet.has(idx)} isNew={newCells.has(idx)}
                    isSpinning={isSpinning} />
                );
              })
            )}
          </div>
        </div>

        {/* Error */}
        {error && <p className="text-red-400 text-sm text-center animate-fade-in">{error}</p>}

        {/* Bet selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-cream/40">Apuesta por giro</p>
            <p className="text-xs text-cream/40">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {CHIPS.map(c => (
              <button key={c} onClick={() => setBet(c)} disabled={isBusy || isAuto}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all disabled:opacity-40 ${
                  bet === c
                    ? 'bg-terracotta text-cream border-terracotta'
                    : 'bg-ink-soft text-cream/60 border-cream/10 hover:border-cream/30'
                }`}>
                {c >= 1000 ? `${c/1000}K` : c}
              </button>
            ))}
            {balance !== null && balance > 0 && (
              <button onClick={() => setBet(Math.floor(balance))}
                disabled={isBusy || isAuto}
                className="px-3 py-1.5 rounded-lg text-sm font-bold border border-red-800/40 bg-ink-soft text-red-400 hover:border-red-600/60 transition-all disabled:opacity-40">
                ALL IN
              </button>
            )}
            <CustomBetInput bet={bet} setBet={setBet} disabled={isBusy || isAuto} />
          </div>
        </div>

        {/* Spin button */}
        <button
          onClick={() => { autoFastRef.current = false; doSpin(false); }}
          disabled={isBusy || isAuto || !balance || balance < bet}
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            isBusy || isAuto
              ? 'bg-ink-soft text-cream/40 border border-cream/10'
              : 'bg-terracotta hover:bg-terracotta-light text-cream shadow-lg shadow-terracotta/30'
          }`}>
          {isBusy && !isAuto ? (
            <><Loader2 size={20} className="animate-spin" /> Girando...</>
          ) : (
            <><Zap size={20} /> GIRAR — {bet} CHC</>
          )}
        </button>

        {/* ── Auto-spin ── */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-cream flex items-center gap-2">
              <RotateCcw size={15} className="text-terracotta" />
              Autogiros
            </span>
            {isAuto && (
              <span className="text-xs font-mono text-cream/50">
                {spinsCompleted} / {autoTotal} completados
              </span>
            )}
          </div>

          {/* Count selector */}
          <div className="flex gap-1.5 flex-wrap">
            {AUTO_OPT.map(n => (
              <button key={n} onClick={() => setAutoTotal(n)} disabled={isAuto || isBusy}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all disabled:opacity-40 ${
                  autoTotal === n
                    ? 'bg-mustard/20 border-mustard/50 text-mustard'
                    : 'border-cream/15 text-cream/50 hover:border-cream/30 hover:text-cream'
                }`}>
                {n}×
              </button>
            ))}
          </div>

          {/* Progress bar */}
          {isAuto && (
            <div className="space-y-1.5">
              <div className="h-2 bg-ink rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-terracotta to-mustard rounded-full transition-all duration-300"
                  style={{ width: `${(spinsCompleted / autoTotal) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-cream/40">
                  {autoLeft > 0 ? `${autoLeft} restantes` : 'Terminando...'}
                </span>
                <span className={autoSessionPL >= 0 ? 'text-market-yes' : 'text-market-no'}>
                  {autoSessionPL >= 0 ? '+' : ''}{autoSessionPL.toFixed(2)} CHC
                </span>
              </div>
            </div>
          )}

          {/* Start / Stop */}
          {isAuto ? (
            <button onClick={stopAuto}
              className="w-full py-3 rounded-xl font-bold text-sm border-2 border-red-500 text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center gap-2">
              <Square size={15} fill="currentColor" />
              Detener autogiro
            </button>
          ) : (
            <button
              onClick={startAuto}
              disabled={isBusy || !balance || balance < bet}
              className="w-full py-3 rounded-xl font-bold text-sm bg-mustard/10 border border-mustard/30 text-mustard hover:bg-mustard/20 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
              <RotateCcw size={15} />
              {autoTotal} autogiros × {bet} CHC
              <span className="text-mustard/50 font-normal text-xs ml-1">
                (máx {(autoTotal * bet).toFixed(1)} CHC)
              </span>
            </button>
          )}
        </div>

        {/* Paytable */}
        <details className="group">
          <summary className="cursor-pointer text-xs text-cream/30 hover:text-cream/50 flex items-center gap-1.5 transition-colors">
            <Star size={11} /> Ver tabla de pagos
          </summary>
          <div className="mt-3 rounded-xl border border-cream/10 bg-ink-soft p-3 space-y-3">
            <p className="text-[10px] text-cream/30 uppercase tracking-wider font-semibold">Símbolos (valor × apuesta)</p>
            <div className="grid grid-cols-4 gap-2">
              {['heart','apple','lemon','orange','grape','candy','lolly','gem'].map(id => {
                const s = SYM[id];
                return (
                  <div key={id} className="flex items-center gap-1.5">
                    <span className="text-xl">{s.emoji}</span>
                    <div>
                      <p className={`text-[10px] font-bold ${s.color}`}>{s.val}</p>
                      <p className="text-[9px] text-cream/25">{s.label}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-cream/5 pt-2 space-y-1.5">
              <p className="text-[10px] text-cream/30 uppercase tracking-wider font-semibold">Clusters y multiplicadores</p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px] text-cream/50">
                <p>8+ = 1× símbolo</p>
                <p>10+ = 2× símbolo</p>
                <p>12+ = 5× símbolo</p>
                <p>15+ = 10× símbolo</p>
                <p>20+ = 30× símbolo</p>
                <p>25+ = 100× símbolo</p>
              </div>
              <div className="flex gap-4 text-[10px] text-cream/50 pt-1">
                <span>💰 4+ = giros gratis (10-15)</span>
                <span>✨ bomba = multiplica ganancias</span>
              </div>
            </div>
          </div>
        </details>

      </main>
    </div>
  );
}

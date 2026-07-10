'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { Loader2, Trash2 } from 'lucide-react';

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
type BetType = 'number'|'red'|'black'|'even'|'odd'|'low'|'high'|'dozen1'|'dozen2'|'dozen3';
type BetMap = Partial<Record<string, number>>;

const ROW1 = [3,6,9,12,15,18,21,24,27,30,33,36];
const ROW2 = [2,5,8,11,14,17,20,23,26,29,32,35];
const ROW3 = [1,4,7,10,13,16,19,22,25,28,31,34];

const CHIPS = [1, 5, 25, 100, 500, 2000, 10000] as const;

function numColor(n: number) { return n === 0 ? 'green' : RED.has(n) ? 'red' : 'black'; }

function betKey(type: BetType, value?: number) {
  return value !== undefined ? `number_${value}` : type;
}

interface BetResult {
  type: BetType; value?: number; amount: number;
  win: boolean; multiplier: number; net_change: number;
}

// ── Chip overlay ─────────────────────────────────────────────────────────────
function ChipOverlay({ amount }: { amount: number }) {
  const label = amount >= 1000 ? `${(amount/1000).toFixed(amount>=10000?0:1)}K` : String(amount);
  return (
    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-yellow-400 text-[8px] font-black text-ink flex items-center justify-center shadow-lg ring-1 ring-yellow-200 z-10 leading-none">
      {label}
    </span>
  );
}

export default function RoulettePage() {
  const { balance, refresh } = useWallet();

  const [chipSize, setChipSize] = useState<number | 'allin'>(5);
  const [betMap, setBetMap]     = useState<BetMap>({});
  const [phase, setPhase]       = useState<'idle'|'spinning'|'result'>('idle');
  const [display, setDisplay]   = useState(7);
  const [spinResult, setSpinResult] = useState<{
    result: number; color: string; bets: BetResult[]; total_net_change: number; new_balance: number;
  } | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const intervalRef  = useRef<NodeJS.Timeout | null>(null);
  const pendingRef   = useRef<typeof spinResult | null>(null);

  const effectiveChip = chipSize === 'allin'
    ? Math.floor((balance ?? 0) * 100) / 100
    : chipSize;

  const totalBet = Object.values(betMap).reduce<number>((s, v) => s + (v ?? 0), 0);

  function placeChip(key: string) {
    if (phase !== 'idle' && phase !== 'result') return;
    if (effectiveChip <= 0) return;
    setBetMap(prev => ({ ...prev, [key]: Math.round(((prev[key] ?? 0) + effectiveChip) * 100) / 100 }));
  }
  function removeKey(key: string) { setBetMap(prev => { const n = { ...prev }; delete n[key]; return n; }); }
  function clearAll()              { setBetMap({}); }

  function betOn(key: string) { return betMap[key] ?? 0; }

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const finishSpin = useCallback(() => {
    stopInterval();
    if (pendingRef.current) {
      setDisplay(pendingRef.current.result);
      setSpinResult(pendingRef.current);
      refresh();
    }
    setPhase('result');
  }, [refresh, stopInterval]);

  async function spin() {
    if (phase !== 'idle' && phase !== 'result') return;
    if (totalBet <= 0) { setError('Coloca al menos una apuesta'); return; }
    setError(null);
    setSpinResult(null);
    pendingRef.current = null;
    setPhase('spinning');

    const bets = Object.entries(betMap).map(([key, amount]) => {
      const [type, valStr] = key.split('_');
      return { type: type as BetType, value: valStr ? parseInt(valStr) : undefined, amount: amount! };
    });

    const spinStart = Date.now();
    intervalRef.current = setInterval(() => { setDisplay(Math.floor(Math.random() * 37)); }, 80);

    try {
      const res = await fetch('/api/casino/roulette', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bets }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error); stopInterval(); setPhase('idle'); return; }
      pendingRef.current = data.data;
      const remaining = Math.max(0, 2400 - (Date.now() - spinStart));
      setTimeout(finishSpin, remaining);
    } catch {
      setError('Error de conexión');
      stopInterval();
      setPhase('idle');
    }
  }

  useEffect(() => () => stopInterval(), [stopInterval]);

  const isSpinning = phase === 'spinning';
  const displayColor = numColor(display);

  function numCls(n: number) {
    const c = numColor(n);
    return c === 'red' ? 'bg-red-700 hover:bg-red-600 border-red-800 text-white'
         : c === 'green' ? 'bg-emerald-700 hover:bg-emerald-600 border-emerald-800 text-white'
         : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-900 text-white';
  }

  const displayBg = displayColor === 'red' ? 'bg-red-600' : displayColor === 'green' ? 'bg-emerald-600' : 'bg-neutral-800';

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-2 py-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h1 className="text-2xl font-bold text-cream">🎡 Ruleta</h1>
            <p className="text-cream/40 text-xs mt-0.5">Europea · 2.7% ventaja de casa · Multi-apuesta</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
        </div>

        {/* Wheel display */}
        <div className={`rounded-2xl border-4 p-6 flex flex-col items-center gap-2 transition-colors duration-300 ${
          isSpinning ? 'border-cream/10' : displayColor === 'red' ? 'border-red-500/40' : displayColor === 'green' ? 'border-emerald-500/40' : 'border-cream/10'
        } bg-ink-soft`}>
          <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 transition-all duration-150 ${displayBg} ${isSpinning ? 'animate-spin border-white/30' : 'border-white/10'}`}>
            <span className={`font-black text-5xl text-white ${isSpinning ? 'blur-[3px]' : ''}`}>{display}</span>
          </div>

          {phase === 'result' && spinResult && (
            <div className="w-full animate-fade-in mt-1 space-y-1.5">
              <p className="text-center text-lg font-bold text-cream">
                {spinResult.color === 'green' ? '🟢' : spinResult.color === 'red' ? '🔴' : '⚫'} {spinResult.result}
                {' '}
                <span className={spinResult.total_net_change >= 0 ? 'text-market-yes' : 'text-market-no'}>
                  {spinResult.total_net_change >= 0 ? '+' : ''}{spinResult.total_net_change.toFixed(2)} CHC
                </span>
              </p>
              {/* Individual bet results */}
              <div className="flex flex-wrap gap-1 justify-center">
                {spinResult.bets.map((b, i) => (
                  <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                    b.win ? 'bg-market-yes/10 border-market-yes/30 text-market-yes' : 'bg-market-no/10 border-market-no/30 text-market-no/60'
                  }`}>
                    {b.type === 'number' ? `Nº${b.value}` : b.type} {b.amount}→{b.win ? `+${(b.amount*b.multiplier).toFixed(1)}` : '−'}
                  </span>
                ))}
              </div>
            </div>
          )}
          {isSpinning && <p className="text-cream/40 text-sm animate-pulse">Girando...</p>}
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Roulette table */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft overflow-hidden">
          {/* 0 */}
          <div className="p-2 border-b border-cream/5">
            <button onClick={() => placeChip(betKey('number', 0))} disabled={isSpinning}
              className="relative w-full py-2 rounded-lg border-2 font-bold text-sm bg-emerald-700/50 border-emerald-600/40 text-emerald-300 hover:bg-emerald-700/70 transition-all disabled:opacity-40">
              0 — Verde (35:1)
              {betOn('number_0') > 0 && <ChipOverlay amount={betOn('number_0')} />}
            </button>
          </div>

          {/* Number grid */}
          <div className="p-2 space-y-0.5">
            {[ROW1, ROW2, ROW3].map((row, ri) => (
              <div key={ri} className="grid grid-cols-12 gap-0.5">
                {row.map(n => {
                  const key = `number_${n}`;
                  return (
                    <button key={n} onClick={() => placeChip(key)} disabled={isSpinning}
                      onContextMenu={e => { e.preventDefault(); removeKey(key); }}
                      className={`relative aspect-square rounded text-[10px] sm:text-xs font-bold border transition-all disabled:opacity-40 ${numCls(n)} ${betOn(key) > 0 ? 'ring-2 ring-yellow-400/60' : ''}`}>
                      {n}
                      {betOn(key) > 0 && <ChipOverlay amount={betOn(key)} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Dozens */}
          <div className="grid grid-cols-3 gap-0.5 p-2 pt-0">
            {(['dozen1','dozen2','dozen3'] as const).map((t, i) => {
              const labels = ['1–12','13–24','25–36'];
              return (
                <button key={t} onClick={() => placeChip(t)} disabled={isSpinning}
                  onContextMenu={e => { e.preventDefault(); removeKey(t); }}
                  className={`relative py-2 rounded-lg border font-semibold text-xs text-cream/70 border-cream/15 hover:border-cream/30 transition-all disabled:opacity-40 ${betOn(t) > 0 ? 'ring-1 ring-yellow-400/60 border-yellow-400/30 bg-yellow-400/5' : ''}`}>
                  {labels[i]} <span className="opacity-50">(2:1)</span>
                  {betOn(t) > 0 && <ChipOverlay amount={betOn(t)} />}
                </button>
              );
            })}
          </div>

          {/* Outside bets */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-0.5 p-2 pt-0">
            {([
              { key: 'low',   label: '1–18', sub: '1:1' },
              { key: 'even',  label: 'Par',  sub: '1:1' },
              { key: 'red',   label: 'Rojo', sub: '1:1', cls: 'text-red-400 border-red-800/30 hover:bg-red-700/20' },
              { key: 'black', label: 'Negro',sub: '1:1', cls: 'text-cream/80 border-neutral-700/30 hover:bg-neutral-700/20' },
              { key: 'odd',   label: 'Impar',sub: '1:1' },
              { key: 'high',  label: '19–36',sub: '1:1' },
            ] as { key: string; label: string; sub: string; cls?: string }[]).map(({ key, label, sub, cls = '' }) => (
              <button key={key} onClick={() => placeChip(key)} disabled={isSpinning}
                onContextMenu={e => { e.preventDefault(); removeKey(key); }}
                className={`relative py-2.5 rounded-lg border font-semibold text-xs border-cream/15 hover:border-cream/30 text-cream/70 transition-all disabled:opacity-40 ${cls} ${betOn(key) > 0 ? 'ring-1 ring-yellow-400/60 border-yellow-400/30 bg-yellow-400/5' : ''}`}>
                {label}<span className="block text-[9px] opacity-40">{sub}</span>
                {betOn(key) > 0 && <ChipOverlay amount={betOn(key)} />}
              </button>
            ))}
          </div>
        </div>

        {/* Tip */}
        <p className="text-center text-[10px] text-cream/20">Clic para colocar · Clic derecho para quitar</p>

        {/* Chip selector */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-cream/40">Ficha seleccionada</p>
            <span className="text-xs text-mustard font-semibold">
              Total: <span className="font-mono">{totalBet.toFixed(2)} CHC</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map(c => (
              <button key={c} onClick={() => setChipSize(c)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                  chipSize === c
                    ? 'bg-terracotta border-terracotta text-cream'
                    : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                }`}>
                {c >= 1000 ? `${c/1000}K` : c}
              </button>
            ))}
            <button onClick={() => setChipSize('allin')}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                chipSize === 'allin'
                  ? 'bg-red-600 border-red-500 text-white'
                  : 'bg-ink border-red-800/40 text-red-400 hover:border-red-600/60'
              }`}>
              ALL IN
            </button>
            <CustomBetInput
              bet={typeof chipSize === 'number' ? chipSize : 0}
              setBet={v => setChipSize(v)}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={clearAll} disabled={isSpinning || totalBet === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-cream/10 text-cream/40 hover:border-red-500/30 hover:text-red-400 transition-all disabled:opacity-30">
              <Trash2 size={12} /> Borrar todo
            </button>
            <button
              onClick={phase === 'result' ? () => { setPhase('idle'); setBetMap({}); } : spin}
              disabled={isSpinning || totalBet <= 0 || !balance || balance < totalBet}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-terracotta hover:bg-terracotta-light text-cream shadow-lg shadow-terracotta/30">
              {isSpinning ? (
                <><Loader2 size={16} className="animate-spin" /> Girando...</>
              ) : phase === 'result' ? (
                'Nueva ronda'
              ) : (
                `🎡 GIRAR — ${totalBet.toFixed(2)} CHC`
              )}
            </button>
          </div>
        </div>

        {/* Paytable */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/40 space-y-1">
          <p className="font-semibold text-cream/25 uppercase tracking-wider">Pagos</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            <span>Número exacto</span><span className="font-mono text-right">35:1</span>
            <span>Docena / Columna</span><span className="font-mono text-right">2:1</span>
            <span>Rojo / Negro / Par / Impar / 1-18 / 19-36</span><span className="font-mono text-right">1:1</span>
          </div>
          <p className="text-cream/20 text-[10px] pt-1">El 0 anula todas las apuestas externas y de paridad.</p>
        </div>

      </main>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { Loader2, RotateCcw } from 'lucide-react';

// ── Scratch Cell ──────────────────────────────────────────────────────────────
function ScratchCell({ symbol, forceReveal, onReveal, revealed }: {
  symbol: string;
  forceReveal: boolean;
  onReveal: () => void;
  revealed: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting  = useRef(false);
  const done      = useRef(false);

  // Draw the silver cover on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || revealed) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#8a9099');
    grad.addColorStop(0.4, '#bfc5ce');
    grad.addColorStop(0.6, '#d4dae2');
    grad.addColorStop(1, '#7e848d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Coin-texture lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    for (let y = 8; y < h; y += 12) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Label
    ctx.fillStyle = 'rgba(60,70,80,0.7)';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RASPAR', w / 2, h / 2);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Force-reveal: fade out canvas
  useEffect(() => {
    if (!forceReveal || done.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    done.current = true;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onReveal();
  }, [forceReveal, onReveal]);

  function eraseAt(x: number, y: number) {
    const canvas = canvasRef.current;
    if (!canvas || done.current) return;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Sample scratch % every few calls
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 16) { // sample 1/4 of pixels
      if (data[i] < 64) transparent++;
    }
    if (transparent / (data.length / 16) > 0.45) {
      done.current = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onReveal();
    }
  }

  function pos(e: React.MouseEvent | React.TouchEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  const SIZE = 90;

  return (
    <div className="relative select-none" style={{ width: SIZE, height: SIZE }}>
      {/* Symbol underneath */}
      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-amber-950/40 border border-amber-700/20 text-4xl">
        {symbol}
      </div>
      {/* Canvas overlay */}
      {!revealed && (
        <canvas
          ref={canvasRef}
          width={SIZE} height={SIZE}
          className="absolute inset-0 rounded-xl touch-none cursor-crosshair"
          onMouseDown={e => { painting.current = true; const p = pos(e); eraseAt(p.x, p.y); }}
          onMouseMove={e => { if (painting.current) { const p = pos(e); eraseAt(p.x, p.y); } }}
          onMouseUp={() => { painting.current = false; }}
          onMouseLeave={() => { painting.current = false; }}
          onTouchStart={e => { e.preventDefault(); painting.current = true; const p = pos(e); eraseAt(p.x, p.y); }}
          onTouchMove={e => { e.preventDefault(); if (painting.current) { const p = pos(e); eraseAt(p.x, p.y); } }}
          onTouchEnd={() => { painting.current = false; }}
        />
      )}
    </div>
  );
}

// ── Prize label display ───────────────────────────────────────────────────────
const TIER_COLORS: Record<string, string> = {
  loss: 'text-cream/40 bg-cream/5 border-cream/10',
  mini: 'text-market-yes bg-market-yes/10 border-market-yes/20',
  small: 'text-market-yes bg-market-yes/15 border-market-yes/30',
  medium: 'text-yellow-300 bg-yellow-400/10 border-yellow-400/20',
  large: 'text-yellow-300 bg-yellow-400/15 border-yellow-400/30',
  super: 'text-mustard bg-mustard/10 border-mustard/30',
  mega: 'text-mustard bg-mustard/15 border-mustard/40',
  jackpot: 'text-terracotta bg-terracotta/10 border-terracotta/30',
  ultra: 'text-terracotta bg-terracotta/15 border-terracotta/40',
};

// ── Page ──────────────────────────────────────────────────────────────────────
interface Ticket {
  symbols: string[];
  tierId: string;
  tierLabel: string;
  prizeMult: number;
  payout: number;
  netChange: number;
}

const BET_CHIPS = [5, 25, 100, 500, 1000, 5000];

export default function ScratchPage() {
  const { balance, refresh } = useWallet();

  const [bet, setBet]         = useState(25);
  const [ticket, setTicket]   = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [revealedCells, setRevealedCells] = useState<boolean[]>(Array(9).fill(false));
  const [forceReveal, setForceReveal]     = useState(false);
  const [showResult, setShowResult]       = useState(false);

  const allRevealed = revealedCells.every(Boolean);

  useEffect(() => {
    if (allRevealed && ticket && !showResult) {
      setTimeout(() => setShowResult(true), 200);
    }
  }, [allRevealed, ticket, showResult]);

  const handleReveal = useCallback((i: number) => {
    setRevealedCells(prev => {
      const next = [...prev];
      next[i] = true;
      return next;
    });
  }, []);

  async function buyTicket() {
    setError(null);
    setLoading(true);
    try {
      const r = await fetch('/api/casino/scratch/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bet }),
      });
      const d = await r.json();
      if (!d.success) { setError(d.error); return; }
      setTicket({
        symbols: d.data.symbols,
        tierId: d.data.tier_id,
        tierLabel: d.data.tier_label,
        prizeMult: d.data.prize_mult,
        payout: d.data.payout,
        netChange: d.data.net_change,
      });
      setRevealedCells(Array(9).fill(false));
      setForceReveal(false);
      setShowResult(false);
      refresh();
    } finally {
      setLoading(false);
    }
  }

  function revealAll() {
    setForceReveal(true);
    setRevealedCells(Array(9).fill(true));
  }

  function reset() {
    setTicket(null);
    setRevealedCells(Array(9).fill(false));
    setForceReveal(false);
    setShowResult(false);
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-lg mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">🎟️ Raspa y Gana</h1>
            <p className="text-cream/40 text-xs mt-0.5">Raspa las 9 casillas para revelar tu premio</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
        </div>

        {/* Ticket card */}
        {ticket ? (
          <div className="rounded-2xl border-2 border-mustard/20 bg-gradient-to-b from-amber-950/40 to-ink p-5 space-y-4">
            {/* Ticket header */}
            <div className="flex items-center justify-between border-b border-cream/10 pb-3">
              <div>
                <p className="text-xs text-cream/30 uppercase tracking-widest">Lotería ChameoCoin</p>
                <p className="text-sm font-bold text-mustard">Boleto #{Math.floor(Math.random() * 90000 + 10000)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-cream/30">Apuesta</p>
                <p className="text-sm font-bold text-cream">{bet} CHC</p>
              </div>
            </div>

            {/* 3×3 Scratch grid */}
            <div className="space-y-2">
              {[0, 3, 6].map(rowStart => (
                <div key={rowStart} className="flex justify-center gap-2">
                  {[0, 1, 2].map(col => {
                    const idx = rowStart + col;
                    return (
                      <ScratchCell
                        key={idx}
                        symbol={ticket.symbols[idx]}
                        revealed={revealedCells[idx]}
                        forceReveal={forceReveal}
                        onReveal={() => handleReveal(idx)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Reveal all button */}
            {!allRevealed && (
              <button onClick={revealAll}
                className="w-full py-2.5 rounded-xl text-sm font-bold border border-mustard/30 text-mustard hover:bg-mustard/10 transition-all">
                ✨ Revelar todo
              </button>
            )}

            {/* Result */}
            {showResult && (
              <div className={`rounded-xl p-4 text-center border animate-fade-in ${TIER_COLORS[ticket.tierId] ?? TIER_COLORS.loss}`}>
                <p className="text-lg font-black">{ticket.tierLabel}</p>
                {ticket.prizeMult > 0 && (
                  <p className="font-bold font-mono mt-0.5">{ticket.prizeMult}× → +{ticket.payout.toFixed(2)} CHC</p>
                )}
                <p className={`text-sm font-bold font-mono mt-1 ${ticket.netChange >= 0 ? '' : 'opacity-70'}`}>
                  {ticket.netChange >= 0 ? '+' : ''}{ticket.netChange.toFixed(2)} CHC
                </p>
              </div>
            )}

            {showResult && (
              <button onClick={reset}
                className="w-full py-3 rounded-xl font-bold bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 flex items-center justify-center gap-2">
                <RotateCcw size={16} /> Nuevo boleto
              </button>
            )}
          </div>
        ) : (
          /* Buy ticket UI */
          <div className="rounded-2xl border-2 border-dashed border-cream/10 p-8 text-center space-y-2">
            <p className="text-5xl">🎟️</p>
            <p className="text-cream/40 text-sm">Compra un boleto y raspa para descubrir tu premio</p>
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Buy controls */}
        {!ticket && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Precio del boleto</p>
              <div className="flex gap-1.5 flex-wrap">
                {BET_CHIPS.map(c => (
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
            <button onClick={buyTicket} disabled={loading || !balance || balance < bet}
              className="w-full py-4 rounded-xl font-bold text-lg bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-terracotta/20">
              {loading
                ? <><Loader2 size={20} className="animate-spin" /> Comprando...</>
                : `🎟️ COMPRAR BOLETO — ${bet.toLocaleString()} CHC`
              }
            </button>
          </div>
        )}

        {/* Prize table */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/30 space-y-1.5">
          <p className="font-semibold text-cream/20 uppercase tracking-wider">Tabla de premios (3 iguales en fila 1)</p>
          <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
            {[
              ['🐔 Gallina','1.5×'],['🌽 Maíz','2.5×'],['🥚 Huevo','5×'],
              ['⭐ Estrella','10×'],['🎰 Casino','25×'],['💎 Diamante','50×'],
              ['💎💎 Jackpot','100×'],['👑 Ultra','500×'],
            ].map(([sym, mult]) => (
              <><span key={sym}>{sym}</span><span className="text-right font-mono col-span-2">{mult}</span></>
            ))}
          </div>
          <p className="text-cream/15 pt-0.5">RTP ≈ 91.5%</p>
        </div>

      </main>
    </div>
  );
}

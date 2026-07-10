'use client';

import { useState, useEffect } from 'react';
import type { Market, MultiOutcome } from '@/lib/types';
import { Loader2, CheckCircle, AlertCircle, LogIn, Lock } from 'lucide-react';
import Link from 'next/link';

const OUTCOME_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

interface Props {
  market: Market;
  outcomes: MultiOutcome[];
  userAddress: string | null;
}

export default function MultiBettingForm({ market, outcomes, userAddress }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('10');
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (userAddress) {
      fetch(`/api/wallet/${userAddress}`)
        .then(r => r.json())
        .then(d => { if (d.success) setBalance(d.data.balance ?? 0); });
    }
  }, [userAddress]);

  if (!userAddress) {
    return (
      <div className="card space-y-4 text-center py-8">
        <Lock size={28} className="text-cream/20 mx-auto" />
        <p className="text-cream/50 text-sm">Inicia sesión para apostar</p>
        <Link href="/login" className="btn-primary inline-flex items-center gap-2 text-sm">
          <LogIn size={14} />
          Iniciar sesión
        </Link>
      </div>
    );
  }

  if (market.status !== 'open') {
    return (
      <div className="card text-center py-6">
        <p className="text-cream/40 text-sm">Mercado cerrado</p>
      </div>
    );
  }

  const selectedOutcome = outcomes.find(o => o.id === selected);
  const selectedIdx = outcomes.findIndex(o => o.id === selected);
  const selectedColor = selectedIdx >= 0 ? OUTCOME_COLORS[selectedIdx % OUTCOME_COLORS.length] : null;
  const amt = parseFloat(amount) || 0;
  // Pool includes seeds (they fund the initial odds) + all actual bets
  const totalPool = outcomes.reduce((s, o) => s + Number(o.seed) + o.total_bet, 0);
  const estimatedPayout = selectedOutcome && amt > 0
    ? amt * (totalPool + amt) * 0.98 / (Number(selectedOutcome.seed) + selectedOutcome.total_bet + amt)
    : null;

  async function handleBet() {
    if (!selected || !userAddress || amt <= 0) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/markets/${market.id}/multi-bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome_id: selected, address: userAddress, amount: amt }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg({ ok: true, text: `¡${amt} CHC apostados en "${selectedOutcome?.label}"! Nuevo saldo: ${data.data.new_balance.toFixed(2)} CHC` });
        setBalance(data.data.new_balance);
        setSelected(null);
        setAmount('10');
      } else {
        setMsg({ ok: false, text: data.error });
      }
    } catch {
      setMsg({ ok: false, text: 'Error de red, intenta de nuevo' });
    }
    setLoading(false);
  }

  const isDisabled = loading || !selected || amt <= 0 || (balance !== null && amt > balance);

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-cream">Apostar</h3>
        {balance !== null && (
          <span className="text-xs text-cream/40">
            Saldo: <span className="text-mustard font-bold">{balance.toFixed(2)} CHC</span>
          </span>
        )}
      </div>

      {/* Outcome selector — Polymarket style */}
      <div>
        <p className="text-[10px] font-semibold text-cream/30 uppercase tracking-widest mb-2.5">
          Elige una opción
        </p>
        <div className="space-y-1.5">
          {outcomes.map((o, i) => {
            const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
            const isSelected = selected === o.id;
            return (
              <button
                key={o.id}
                onClick={() => setSelected(o.id === selected ? null : o.id)}
                className="w-full rounded-xl border px-4 py-3 text-sm transition-all flex items-center gap-3 group"
                style={{
                  borderColor: isSelected ? `${color}70` : 'rgba(255,255,255,0.07)',
                  backgroundColor: isSelected ? `${color}18` : 'transparent',
                }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-110"
                  style={{ backgroundColor: color }}
                />
                <span className="flex-1 text-left font-semibold" style={{ color: isSelected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)' }}>
                  {o.label}
                </span>
                <span
                  className="font-bold tabular-nums text-sm"
                  style={{ color: isSelected ? color : 'rgba(255,255,255,0.35)' }}
                >
                  {(o.probability * 100).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount input */}
      <div>
        <p className="text-[10px] font-semibold text-cream/30 uppercase tracking-widest mb-2.5">
          Monto en CHC
        </p>
        <input
          type="number"
          min="1"
          max={balance ?? undefined}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input text-center text-xl font-bold font-mono py-3.5"
        />
        <div className="grid grid-cols-5 gap-1.5 mt-2">
          {[5, 10, 25, 50, 100].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                parseFloat(amount) === v
                  ? 'border-mustard/50 bg-mustard/10 text-mustard'
                  : 'border-cream/10 text-cream/30 hover:border-cream/25 hover:text-cream/60'
              }`}
            >
              +{v}
            </button>
          ))}
        </div>
      </div>

      {/* Payout estimate */}
      {selectedOutcome && estimatedPayout !== null && amt > 0 && (
        <div
          className="rounded-xl p-3.5 space-y-2.5 animate-fade-in"
          style={{
            backgroundColor: selectedColor ? `${selectedColor}10` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${selectedColor ? selectedColor + '25' : 'rgba(255,255,255,0.05)'}`,
          }}
        >
          <div className="flex justify-between items-center">
            <span className="text-cream/40 text-xs">Si gana {'"'}{selectedOutcome.label}{'"'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cream/50 text-sm">Pago potencial</span>
            <span className="font-bold text-market-yes text-lg">{estimatedPayout.toFixed(2)} CHC</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-cream/40 text-xs">Multiplicador</span>
            <span
              className="font-bold text-sm"
              style={{ color: selectedColor ?? '#f59e0b' }}
            >
              {(estimatedPayout / amt).toFixed(2)}x
            </span>
          </div>
        </div>
      )}

      {/* Message */}
      {msg && (
        <div className={`flex items-start gap-2 text-xs p-3 rounded-xl ${
          msg.ok
            ? 'bg-market-yes/10 text-market-yes border border-market-yes/20'
            : 'bg-market-no/10 text-market-no border border-market-no/20'
        }`}>
          {msg.ok ? <CheckCircle size={12} className="shrink-0 mt-0.5" /> : <AlertCircle size={12} className="shrink-0 mt-0.5" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleBet}
        disabled={isDisabled}
        className="w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
        style={selected && !isDisabled
          ? { backgroundColor: selectedColor!, color: 'white' }
          : { backgroundColor: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.25)' }
        }
      >
        {loading ? (
          <><Loader2 size={14} className="animate-spin" /> Apostando...</>
        ) : selected ? (
          `Apostar ${amt || 0} CHC`
        ) : (
          'Selecciona una opción'
        )}
      </button>
    </div>
  );
}

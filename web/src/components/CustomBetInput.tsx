'use client';

import { useState } from 'react';

/**
 * Input de monto personalizado para apuestas de casino.
 * Complementa los chips predefinidos: el usuario digita el monto exacto.
 */
export default function CustomBetInput({ bet, setBet, max = 1_000_000, disabled = false }: {
  bet: number;
  setBet: (v: number) => void;
  max?: number;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState('');

  function apply(value: string) {
    setRaw(value);
    const n = parseFloat(value);
    if (!isNaN(n) && n >= 1) setBet(Math.min(max, Math.floor(n * 100) / 100));
  }

  const active = raw !== '' && parseFloat(raw) === bet;

  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        min={1}
        max={max}
        step="any"
        value={raw}
        disabled={disabled}
        onChange={e => apply(e.target.value)}
        placeholder="Otro…"
        className={`w-28 px-3 py-1.5 pr-11 rounded-lg text-sm font-bold border bg-ink text-cream
          placeholder:text-cream/30 focus:outline-none transition-all disabled:opacity-50
          ${active ? 'border-terracotta' : 'border-cream/10 focus:border-cream/40'}`}
        style={{ colorScheme: 'dark' }}
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream/30 text-[10px] font-bold pointer-events-none">
        CHC
      </span>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { signTransaction, decryptPrivateKey } from '@/lib/crypto';
import { useWallet } from '@/lib/wallet-context';
import type { Market, MarketOutcome, TradeQuote } from '@/lib/types';
import { quoteBuy, calcPrices, formatPEN } from '@/lib/amm';
import { TrendingUp, TrendingDown, AlertCircle, Loader2, Lock, KeyRound } from 'lucide-react';
import Link from 'next/link';

interface Props {
  market: Market;
  onTradeComplete?: () => void;
}

export default function TradeForm({ market, onTradeComplete }: Props) {
  const { address, publicKey, balance, nonce, canSign, refresh } = useWallet();
  const [outcome, setOutcome] = useState<MarketOutcome>('YES');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const amt = parseFloat(amount);
    if (!isNaN(amt) && amt > 0) {
      const q = quoteBuy(market, outcome, amt);
      setQuote(q);
    } else {
      setQuote(null);
    }
  }, [amount, outcome, market]);

  async function handleTrade(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Ingresa un monto válido');
      return;
    }
    if (!address) {
      setError('No hay wallet configurada');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña para firmar');
      return;
    }

    setLoading(true);
    try {
      const encryptedKey = localStorage.getItem('pm_encrypted_key');
      if (!encryptedKey) throw new Error('Clave privada no encontrada. Importa tu wallet primero.');

      const privateKey = await decryptPrivateKey(encryptedKey, password);

      const txData = {
        type: 'BUY',
        from: address,
        market_id: market.id,
        outcome,
        amount: amt,
        nonce: nonce + 1,
        timestamp: Date.now(),
      };

      const signature = signTransaction(txData, privateKey);
      const pubKey = publicKey ?? '';

      const res = await fetch(`/api/markets/${market.id}/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...txData, signature, public_key: pubKey }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSuccess(
        `¡Compra exitosa! Recibiste ${data.data.shares_out.toFixed(4)} shares de ${outcome}`,
      );
      setAmount('');
      setPassword('');
      setQuote(null);
      await refresh();
      onTradeComplete?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al procesar';
      if (msg.includes('decrypt') || msg.toLowerCase().includes('operation')) {
        setError('Contraseña incorrecta');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const prices = calcPrices(market.yes_reserve, market.no_reserve);

  if (!address) {
    return (
      <div className="card text-center py-8">
        <Lock size={32} className="text-cream/30 mx-auto mb-3" />
        <p className="text-cream/50 text-sm">Inicia sesión para apostar</p>
      </div>
    );
  }

  if (!canSign) {
    return (
      <div className="card space-y-3 text-center py-6">
        <KeyRound size={28} className="text-mustard/60 mx-auto" />
        <p className="text-cream/70 text-sm font-medium">Importa tu wallet para apostar</p>
        <p className="text-cream/40 text-xs">
          Tu balance se lee de la blockchain automáticamente. Para firmar apuestas, necesitas importar tu archivo de backup.
        </p>
        <Link href="/setup" className="btn-secondary inline-flex text-sm">
          Importar wallet
        </Link>
      </div>
    );
  }

  if (market.status !== 'open') {
    return (
      <div className="card text-center py-6">
        <p className="text-cream/50 text-sm">Este mercado ya está resuelto</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-cream">Realizar apuesta</h3>

      {/* Outcome selector */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOutcome('YES')}
          className={`p-3 rounded-lg border-2 font-bold text-sm transition-all ${
            outcome === 'YES'
              ? 'border-market-yes bg-market-yes/20 text-market-yes'
              : 'border-cream/10 text-cream/40 hover:border-market-yes/30'
          }`}
        >
          <TrendingUp size={16} className="mx-auto mb-1" />
          SÍ — {(prices.yes * 100).toFixed(0)}¢
        </button>
        <button
          type="button"
          onClick={() => setOutcome('NO')}
          className={`p-3 rounded-lg border-2 font-bold text-sm transition-all ${
            outcome === 'NO'
              ? 'border-market-no bg-market-no/20 text-market-no'
              : 'border-cream/10 text-cream/40 hover:border-market-no/30'
          }`}
        >
          <TrendingDown size={16} className="mx-auto mb-1" />
          NO — {(prices.no * 100).toFixed(0)}¢
        </button>
      </div>

      <form onSubmit={handleTrade} className="space-y-3">
        {/* Amount */}
        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="label mb-0">Monto en CHC</label>
            {balance !== null && (
              <span className="text-xs text-cream/40">
                Balance: {formatPEN(balance)} CHC
              </span>
            )}
          </div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0.01"
              step="0.01"
              max={balance ?? undefined}
              className="input pr-16"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
              {balance && [
                { label: '25%', val: balance * 0.25 },
                { label: 'MAX', val: balance },
              ].map(({ label, val }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAmount(val.toFixed(2))}
                  className="text-xs text-cream/40 hover:text-cream px-1.5 py-0.5 rounded bg-ink-muted transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Quote */}
        {quote && (
          <div className="bg-ink rounded-lg p-3 space-y-1.5 text-sm animate-fade-in">
            <div className="flex justify-between items-center">
              <span className="text-cream/50">Si ganas, recibirás</span>
              <span className="text-market-yes font-bold text-base">
                {(parseFloat(amount) + quote.shares_out).toFixed(2)} CHC
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-cream/50">Ganancia neta</span>
              <span className="text-market-yes font-semibold">
                +{quote.shares_out.toFixed(2)} CHC
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-cream/50">Impacto de precio</span>
              <span className={quote.price_impact > 0.05 ? 'text-red-400' : 'text-cream/70'}>
                {(quote.price_impact * 100).toFixed(2)}%
              </span>
            </div>
            {quote.price_impact > 0.05 && (
              <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
                <AlertCircle size={12} />
                Alto impacto de precio — considera apostar menos
              </p>
            )}
          </div>
        )}

        {/* Password */}
        <div>
          <label className="label">Contraseña de wallet (para firmar)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Tu contraseña..."
            className="input"
          />
        </div>

        {/* Error / Success */}
        {error && (
          <p className="text-red-400 text-sm flex items-center gap-1.5 animate-fade-in">
            <AlertCircle size={14} />
            {error}
          </p>
        )}
        {success && (
          <p className="text-market-yes text-sm animate-fade-in">{success}</p>
        )}

        <button
          type="submit"
          disabled={loading || !amount || !password}
          className={`w-full font-semibold py-3 rounded-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            outcome === 'YES'
              ? 'bg-market-yes hover:bg-market-yes-dark text-white'
              : 'bg-market-no hover:bg-market-no-dark text-white'
          }`}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            `Apostar ${amount || '0'} CHC por ${outcome}`
          )}
        </button>
      </form>
    </div>
  );
}

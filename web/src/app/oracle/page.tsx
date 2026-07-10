'use client';

import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import { createClient } from '@/lib/supabase/client';
import { signTransaction, decryptPrivateKey } from '@/lib/crypto';
import { formatPEN } from '@/lib/utils';
import type { Market } from '@/lib/types';
import { calcPrices } from '@/lib/amm';
import { Scroll, CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useWallet } from '@/lib/wallet-context';

export default function OraclePage() {
  const { address, publicKey } = useWallet();
  const [myMarkets, setMyMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('YES');
  const [password, setPassword] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMyMarkets() {
      if (!address) return;
      const client = createClient();
      const { data } = await client
        .from('markets')
        .select('*')
        .eq('creator_address', address)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .returns<Market[]>();
      setMyMarkets(data ?? []);
      setLoading(false);
    }
    fetchMyMarkets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Pre-select from query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const marketId = params.get('market_id');
    if (marketId) setSelectedMarket(marketId);
  }, []);

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedMarket || !password) return;

    const encKey = localStorage.getItem('pm_encrypted_key');

    if (!address || !encKey) {
      setError('Importa tu wallet primero para firmar resoluciones');
      return;
    }

    setResolving(true);
    try {
      const privKey = await decryptPrivateKey(encKey, password);

      const txData = {
        type: 'RESOLVE',
        from: address,
        market_id: selectedMarket,
        outcome,
        nonce: Date.now(),
        timestamp: Date.now(),
      };

      const signature = signTransaction(txData as unknown as Record<string, unknown>, privKey);

      const res = await fetch('/api/oracle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...txData, signature, public_key: publicKey ?? '' }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSuccess(`¡Mercado resuelto exitosamente! Resultado: ${outcome}`);
      setMyMarkets((prev) => prev.filter((m) => m.id !== selectedMarket));
      setSelectedMarket('');
      setPassword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      setError(msg.toLowerCase().includes('operation') ? 'Contraseña incorrecta' : msg);
    } finally {
      setResolving(false);
    }
  }

  const market = myMarkets.find((m) => m.id === selectedMarket);

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
            <Scroll size={24} className="text-mustard" />
            Oráculo
          </h1>
          <p className="text-cream/50 text-sm mt-1">
            Resuelve los mercados que creaste con la firma del Oráculo
          </p>
        </div>

        {/* Oracle explanation */}
        <div className="card mb-6 bg-mustard/5 border-mustard/20">
          <h2 className="text-mustard font-semibold mb-2">¿Qué es el Oráculo?</h2>
          <p className="text-cream/60 text-sm leading-relaxed">
            El Oráculo es la entidad que certifica los resultados del mundo real en la blockchain.
            Como creador del mercado, tu firma actúa como el oráculo. Cuando resuelves un mercado,
            tu transacción es firmada criptográficamente con tu clave privada y el servidor del
            Oráculo la valida antes de distribuir las ganancias.
          </p>
        </div>

        {loading ? (
          <div className="card text-center py-10">
            <Loader2 size={24} className="animate-spin text-terracotta mx-auto" />
          </div>
        ) : myMarkets.length === 0 ? (
          <div className="card text-center py-10">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-cream/50">No tienes mercados abiertos para resolver</p>
          </div>
        ) : (
          <form onSubmit={handleResolve} className="card space-y-5">
            <h2 className="font-semibold text-cream">Resolver mercado</h2>

            {/* Market selector */}
            <div>
              <label className="label">Selecciona el mercado</label>
              <select
                value={selectedMarket}
                onChange={(e) => setSelectedMarket(e.target.value)}
                className="input"
              >
                <option value="">— Elige un mercado —</option>
                {myMarkets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.question.slice(0, 80)}
                  </option>
                ))}
              </select>
            </div>

            {/* Market preview */}
            {market && (
              <div className="bg-ink rounded-lg p-4 space-y-2 animate-fade-in">
                <p className="text-cream/80 font-medium text-sm">{market.question}</p>
                <div className="flex gap-4 text-xs text-cream/40">
                  {(() => {
                    const prices = calcPrices(market.yes_reserve, market.no_reserve);
                    return (
                      <>
                        <span className="text-market-yes">
                          SÍ: {(prices.yes * 100).toFixed(0)}¢
                        </span>
                        <span className="text-market-no">
                          NO: {(prices.no * 100).toFixed(0)}¢
                        </span>
                        <span>
                          Liquidez: {formatPEN(market.yes_reserve + market.no_reserve)} CHC
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Outcome */}
            <div>
              <label className="label">Resultado real</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setOutcome('YES')}
                  className={`p-4 rounded-lg border-2 font-bold transition-all ${
                    outcome === 'YES'
                      ? 'border-market-yes bg-market-yes/20 text-market-yes'
                      : 'border-cream/10 text-cream/40 hover:border-market-yes/30'
                  }`}
                >
                  <CheckCircle size={24} className="mx-auto mb-2" />
                  SÍ ocurrió
                </button>
                <button
                  type="button"
                  onClick={() => setOutcome('NO')}
                  className={`p-4 rounded-lg border-2 font-bold transition-all ${
                    outcome === 'NO'
                      ? 'border-market-no bg-market-no/20 text-market-no'
                      : 'border-cream/10 text-cream/40 hover:border-market-no/30'
                  }`}
                >
                  <XCircle size={24} className="mx-auto mb-2" />
                  NO ocurrió
                </button>
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="label">Contraseña de wallet (para firmar)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>

            {/* Messages */}
            {error && (
              <div className="flex items-center gap-2 text-market-no text-sm p-3 bg-market-no/10 border border-market-no/20 rounded-lg animate-fade-in">
                <AlertCircle size={14} />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 text-market-yes text-sm p-3 bg-market-yes/10 border border-market-yes/20 rounded-lg animate-fade-in">
                <CheckCircle size={14} />
                {success}
              </div>
            )}

            <div className="bg-market-no/10 border border-market-no/20 rounded-lg p-3">
              <p className="text-market-no/80 text-xs flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                Esta acción es irreversible. Una vez resuelto, el mercado no puede reabrirse.
                Asegúrate de que el resultado sea definitivo.
              </p>
            </div>

            <button
              type="submit"
              disabled={resolving || !selectedMarket || !password}
              className="btn-mustard w-full flex items-center justify-center gap-2"
            >
              {resolving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Scroll size={16} />
              )}
              {resolving ? 'Resolviendo...' : `Resolver como "${outcome}"`}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}

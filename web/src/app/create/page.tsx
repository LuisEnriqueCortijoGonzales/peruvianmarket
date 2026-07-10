'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import { signTransaction, decryptPrivateKey } from '@/lib/crypto';
import { useWallet } from '@/lib/wallet-context';
import { AlertCircle, Loader2, PlusCircle } from 'lucide-react';

const CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'deportes', label: '⚽ Deportes' },
  { value: 'politica', label: '🏛️ Política' },
  { value: 'crypto', label: '₿ Crypto' },
  { value: 'economia', label: '📈 Economía' },
  { value: 'entretenimiento', label: '🎬 Entretenimiento' },
  { value: 'ciencia', label: '🔬 Ciencia' },
  { value: 'educacion', label: '🎓 Educación' },
];

export default function CreateMarketPage() {
  const router = useRouter();
  const { address, publicKey } = useWallet();

  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [initialLiquidity, setInitialLiquidity] = useState('100');
  const [initialProbability, setInitialProbability] = useState('50');
  const [endDate, setEndDate] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yesReserve = 100 * (1 - parseFloat(initialProbability || '50') / 100);
  const noReserve = 100 * (parseFloat(initialProbability || '50') / 100);
  const yesPrice = noReserve / (yesReserve + noReserve);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!question.trim()) {
      setError('La pregunta es requerida');
      return;
    }
    if (!password) {
      setError('Ingresa tu contraseña para firmar la transacción');
      return;
    }

    const encKey = localStorage.getItem('pm_encrypted_key');

    if (!address || !encKey) {
      setError('Importa tu wallet primero para crear mercados');
      return;
    }

    const liquidity = parseFloat(initialLiquidity);
    if (isNaN(liquidity) || liquidity < 10) {
      setError('La liquidez inicial mínima es 10 PEN');
      return;
    }

    setLoading(true);
    try {
      const privKey = await decryptPrivateKey(encKey, password);

      // Fetch nonce
      const walletRes = await fetch(`/api/wallet/${address}`);
      const walletData = await walletRes.json();
      if (!walletData.success) throw new Error('Error al obtener nonce');
      const currentNonce = walletData.data.nonce;

      const prob = parseFloat(initialProbability) / 100;
      const txData = {
        type: 'CREATE_MARKET',
        from: address,
        question: question.trim(),
        description: description.trim() || null,
        category,
        initial_liquidity: liquidity,
        initial_probability: prob,
        end_date: endDate || null,
        nonce: currentNonce + 1,
        timestamp: Date.now(),
      };

      const signature = signTransaction(txData as unknown as Record<string, unknown>, privKey);

      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...txData, signature, public_key: publicKey ?? '' }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      router.push(`/markets/${data.data.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg.toLowerCase().includes('operation') ? 'Contraseña incorrecta' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
            <PlusCircle size={24} className="text-terracotta" />
            Crear Mercado
          </h1>
          <p className="text-cream/50 text-sm mt-1">
            Crea un mercado de predicción para que tus amigos apuesten
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Question */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-cream text-sm uppercase tracking-wide text-cream/40">
              Pregunta del mercado
            </h2>
            <div>
              <label className="label">Pregunta *</label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="¿Perú clasificará al Mundial 2026?"
                className="input resize-none h-20"
                maxLength={200}
              />
              <p className="text-cream/30 text-xs mt-1 text-right">{question.length}/200</p>
            </div>
            <div>
              <label className="label">Descripción (opcional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe el contexto y las condiciones de resolución..."
                className="input resize-none h-24"
                maxLength={1000}
              />
            </div>
            <div>
              <label className="label">Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="input"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Fecha límite (opcional)</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          {/* Market parameters */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-cream/40">
              Parámetros del mercado
            </h2>

            <div>
              <label className="label">Liquidez inicial (PEN)</label>
              <input
                type="number"
                value={initialLiquidity}
                onChange={(e) => setInitialLiquidity(e.target.value)}
                min="10"
                step="10"
                className="input"
              />
              <p className="text-cream/30 text-xs mt-1">
                Mínimo 10 PEN. Se descontará de tu balance.
              </p>
            </div>

            <div>
              <label className="label">
                Probabilidad inicial de SÍ: <span className="text-terracotta font-bold">{initialProbability}%</span>
              </label>
              <input
                type="range"
                value={initialProbability}
                onChange={(e) => setInitialProbability(e.target.value)}
                min="5"
                max="95"
                step="5"
                className="w-full accent-terracotta"
              />
              <div className="flex justify-between text-xs text-cream/30 mt-1">
                <span>5% (muy improbable)</span>
                <span>95% (muy probable)</span>
              </div>
            </div>

            {/* Preview */}
            <div className="bg-ink rounded-lg p-4 space-y-2">
              <p className="text-cream/50 text-xs font-semibold uppercase tracking-wide">
                Vista previa de precios iniciales
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-market-yes/10 border border-market-yes/20 rounded-lg">
                  <p className="text-market-yes text-2xl font-bold">
                    {(yesPrice * 100).toFixed(0)}¢
                  </p>
                  <p className="text-market-yes/60 text-xs">SÍ</p>
                </div>
                <div className="text-center p-3 bg-market-no/10 border border-market-no/20 rounded-lg">
                  <p className="text-market-no text-2xl font-bold">
                    {((1 - yesPrice) * 100).toFixed(0)}¢
                  </p>
                  <p className="text-market-no/60 text-xs">NO</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sign & submit */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-cream/40">
              Firmar transacción
            </h2>
            <div>
              <label className="label">Contraseña de wallet</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-market-no text-sm p-3 bg-market-no/10 border border-market-no/20 rounded-lg animate-fade-in">
                <AlertCircle size={14} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !question.trim() || !password}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <PlusCircle size={16} />
              )}
              {loading ? 'Creando mercado...' : 'Crear mercado'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

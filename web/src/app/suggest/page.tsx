'use client';

import { useState } from 'react';
import Navigation from '@/components/Navigation';
import { Lightbulb, Send, CheckCircle, ChevronDown } from 'lucide-react';

const CATEGORIES = [
  { value: 'general',        label: 'General' },
  { value: 'deportes',       label: 'Deportes' },
  { value: 'politica',       label: 'Política' },
  { value: 'crypto',         label: 'Crypto' },
  { value: 'economia',       label: 'Economía' },
  { value: 'entretenimiento',label: 'Entretenimiento' },
  { value: 'ciencia',        label: 'Ciencia' },
  { value: 'educacion',      label: 'Educación' },
];

export default function SuggestPage() {
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]     = useState('general');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [done, setDone]             = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, category }),
      });
      const d = await r.json();
      if (!d.success) { setError(d.error); return; }
      setDone(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-lg mx-auto px-4 py-8">

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-mustard/20 flex items-center justify-center">
            <Lightbulb size={20} className="text-mustard" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-cream">Sugerir mercado</h1>
            <p className="text-cream/40 text-xs mt-0.5">Los admins revisarán tu sugerencia y la crearán si es buena</p>
          </div>
        </div>

        {done ? (
          <div className="rounded-2xl border border-market-yes/30 bg-market-yes/10 p-8 text-center space-y-3">
            <CheckCircle size={40} className="text-market-yes mx-auto" />
            <p className="text-lg font-bold text-cream">¡Sugerencia enviada!</p>
            <p className="text-cream/50 text-sm">Los admins la revisarán pronto. Si la aprueban, el mercado aparecerá en la plataforma.</p>
            <button onClick={() => { setDone(false); setTitle(''); setDescription(''); setCategory('general'); }}
              className="mt-2 px-5 py-2.5 rounded-xl bg-terracotta hover:bg-terracotta-light text-cream font-semibold text-sm transition-all">
              Sugerir otro
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-2xl border border-cream/10 bg-ink-soft p-5 space-y-4">

              {/* Título */}
              <div className="space-y-1.5">
                <label className="text-xs text-cream/40 font-semibold uppercase tracking-wider">
                  Pregunta del mercado <span className="text-terracotta">*</span>
                </label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ej: ¿Perú clasifica al Mundial 2026?"
                  maxLength={140}
                  required
                  className="w-full bg-ink border border-cream/10 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream/20 focus:outline-none focus:border-mustard/50 transition-colors"
                />
                <p className="text-right text-xs text-cream/20">{title.length}/140</p>
              </div>

              {/* Categoría */}
              <div className="space-y-1.5">
                <label className="text-xs text-cream/40 font-semibold uppercase tracking-wider">Categoría</label>
                <div className="relative">
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full appearance-none bg-ink border border-cream/10 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-mustard/50 transition-colors pr-10"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/30 pointer-events-none" />
                </div>
              </div>

              {/* Descripción opcional */}
              <div className="space-y-1.5">
                <label className="text-xs text-cream/40 font-semibold uppercase tracking-wider">
                  Contexto <span className="text-cream/20 font-normal normal-case">(opcional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="¿Por qué es interesante este mercado? ¿Cuándo se resuelve?"
                  rows={3}
                  maxLength={500}
                  className="w-full bg-ink border border-cream/10 rounded-xl px-4 py-3 text-cream text-sm placeholder:text-cream/20 focus:outline-none focus:border-mustard/50 transition-colors resize-none"
                />
              </div>
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}

            <button type="submit" disabled={loading || title.trim().length < 5}
              className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-terracotta/20">
              <Send size={18} />
              {loading ? 'Enviando...' : 'Enviar sugerencia'}
            </button>
          </form>
        )}

        {/* Info */}
        <div className="mt-6 rounded-xl border border-cream/10 bg-ink-soft p-4 text-xs text-cream/30 space-y-1.5">
          <p className="font-semibold text-cream/20 uppercase tracking-wider">¿Cómo funciona?</p>
          <p>1. Envías tu sugerencia de mercado</p>
          <p>2. Los admins la revisan en su inbox</p>
          <p>3. Si la aprueban, crean el mercado y puedes apostar en él</p>
          <p>4. Si la rechazan, recibirás una nota explicando por qué</p>
        </div>

      </main>
    </div>
  );
}

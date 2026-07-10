'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { createClient } from '@/lib/supabase/client';
import { calcPrices } from '@/lib/amm';
import { formatPEN } from '@/lib/utils';
import type { Market, MarketCategory } from '@/lib/types';
import {
  ShieldCheck, Plus, Sliders, TrendingUp, TrendingDown,
  CheckCircle, XCircle, AlertCircle, Loader2, ChevronDown, ChevronUp, Trash2, List, Award,
  Lightbulb, CheckCheck, X, Settings,
} from 'lucide-react';

// ── Fórmula de probabilidad ponderada ────────────────────────────────────────
// P_blend = (V × P_market + C × P_admin) / (V + C)
// V = volumen de trades, C = confianza del admin
function calcBlend(pMarket: number, pAdmin: number, volume: number, confidence: number) {
  const denom = volume + confidence;
  if (denom === 0) return pAdmin;
  return (volume * pMarket + confidence * pAdmin) / denom;
}

// ── Tipos locales ─────────────────────────────────────────────────────────────
interface AdminMarket extends Market {
  volume?: number;
  localAdminProb?: number;
  localConfidence?: number;
}

type Tab = 'markets' | 'create' | 'create-multi' | 'tasks' | 'inbox' | 'config';

const CATEGORIES: MarketCategory[] = [
  'general', 'deportes', 'politica', 'crypto', 'economia', 'entretenimiento', 'ciencia', 'educacion',
];

// ── ProbBar: barra visual de probabilidades ───────────────────────────────────
function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className={`font-medium ${color}`}>{label}</span>
        <span className={`font-bold ${color}`}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-ink rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color.replace('text-', 'bg-')}`}
          style={{ width: `${(value * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}

// ── ProbPanel: panel de fórmula para un mercado ──────────────────────────────
function ProbPanel({ market, onApply }: {
  market: AdminMarket;
  onApply: (id: string, pAdmin: number, confidence: number, apply: boolean) => Promise<void>;
}) {
  const prices = calcPrices(market.yes_reserve, market.no_reserve);
  const pMarket = prices.yes;

  const [pAdmin, setPAdmin] = useState(market.localAdminProb ?? market.admin_probability ?? pMarket);
  const [confidence, setConfidence] = useState(market.localConfidence ?? market.admin_confidence ?? 100);
  const [volume] = useState(market.volume ?? 0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pBlend = calcBlend(pMarket, pAdmin, volume, confidence);

  async function handleSave(apply: boolean) {
    setSaving(true);
    setMsg(null);
    await onApply(market.id, pAdmin, confidence, apply);
    setMsg({ ok: true, text: apply ? `AMM ajustado → ${(pBlend * 100).toFixed(1)}%` : 'Parámetros guardados' });
    setSaving(false);
  }

  return (
    <div className="mt-4 space-y-4 border-t border-cream/10 pt-4">
      {/* Barras de probabilidad */}
      <div className="space-y-2.5">
        <ProbBar label="Mercado (AMM)" value={pMarket} color="text-mustard" />
        <ProbBar label="Tu estimado (admin)" value={pAdmin} color="text-terracotta" />
        <ProbBar label="Ponderada" value={pBlend} color="text-market-yes" />
      </div>

      {/* Fórmula con valores reales */}
      <div className="bg-ink rounded-lg p-3 text-xs font-mono text-cream/50 space-y-1">
        <p className="text-cream/30 text-[10px] uppercase tracking-wider mb-2">Fórmula</p>
        <p>P_blend = (V × P_mercado + C × P_admin) / (V + C)</p>
        <p className="text-cream/70">
          = ({volume.toFixed(0)} × {(pMarket * 100).toFixed(1)}% + {confidence.toFixed(0)} × {(pAdmin * 100).toFixed(1)}%) / ({volume.toFixed(0)} + {confidence.toFixed(0)})
        </p>
        <p className="text-market-yes font-bold">= {(pBlend * 100).toFixed(2)}%</p>
      </div>

      {/* Controles */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label text-xs">Tu estimado P_admin</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={1} max={99} value={Math.round(pAdmin * 100)}
              onChange={(e) => setPAdmin(Number(e.target.value) / 100)}
              className="flex-1 accent-terracotta"
            />
            <span className="text-cream text-sm font-bold w-10 text-right">
              {(pAdmin * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div>
          <label className="label text-xs">Confianza C (PEN)</label>
          <input
            type="number" min={1} max={100000} value={confidence}
            onChange={(e) => setConfidence(Math.max(1, Number(e.target.value)))}
            className="input text-sm py-1.5"
          />
          <p className="text-cream/30 text-[10px] mt-0.5">
            Volumen actual: {volume.toFixed(0)} CHC
          </p>
        </div>
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? 'text-market-yes' : 'text-market-no'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => handleSave(false)}
          disabled={saving}
          className="flex-1 py-2 text-xs font-semibold border border-cream/20 text-cream/70 rounded-lg hover:border-cream/40 transition-all"
        >
          Guardar parámetros
        </button>
        <button
          onClick={() => handleSave(true)}
          disabled={saving}
          className="flex-1 py-2 text-xs font-semibold bg-terracotta text-cream rounded-lg hover:bg-terracotta/80 transition-all flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Sliders size={12} />}
          Aplicar al AMM
        </button>
      </div>
    </div>
  );
}

// ── MarketCard ────────────────────────────────────────────────────────────────
function MarketCard({ market, onCancel, onApplyProb, onRefresh }: {
  market: AdminMarket;
  onCancel: (id: string) => void;
  onApplyProb: (id: string, pAdmin: number, confidence: number, apply: boolean) => Promise<void>;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isMulti = market.market_type === 'multi';
  const prices = isMulti ? { yes: 0, no: 0 } : calcPrices(market.yes_reserve, market.no_reserve);

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {isMulti && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-mustard/20 text-mustard font-semibold uppercase tracking-wider">Multi</span>
            )}
            <p className="text-cream font-medium text-sm leading-snug truncate">{market.question}</p>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {!isMulti && (
              <>
                <span className="text-market-yes text-xs font-bold">SÍ {(prices.yes * 100).toFixed(1)}¢</span>
                <span className="text-market-no text-xs font-bold">NO {(prices.no * 100).toFixed(1)}¢</span>
                <span className="text-cream/30 text-xs">
                  Liq: {formatPEN(market.yes_reserve + market.no_reserve)} CHC
                </span>
              </>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
              market.status === 'open' ? 'bg-market-yes/10 text-market-yes' :
              market.status === 'resolved' ? 'bg-mustard/10 text-mustard' :
              'bg-market-no/10 text-market-no'
            }`}>
              {market.status}
            </span>
            {!isMulti && market.admin_probability !== null && market.admin_probability !== undefined && (
              <span className="text-xs text-terracotta/70">
                Admin: {((market.admin_probability) * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {market.status === 'open' && (
            <button
              onClick={() => onCancel(market.id)}
              className="p-1.5 text-market-no/60 hover:text-market-no hover:bg-market-no/10 rounded-lg transition-all"
              title="Cancelar mercado"
            >
              <XCircle size={16} />
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-cream/40 hover:text-cream rounded-lg transition-all"
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        isMulti
          ? <ResolveMultiPanel market={market} onResolved={onRefresh} />
          : market.status === 'open' && (
              <>
                <ProbPanel market={market} onApply={onApplyProb} />
                <ResolveBinaryPanel market={market} onResolved={onRefresh} />
              </>
            )
      )}
    </div>
  );
}

// ── CreateMarketForm ──────────────────────────────────────────────────────────
function CreateMarketForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    question: '',
    description: '',
    category: 'general' as MarketCategory,
    end_date: '',
    initial_probability: 50,
    initial_liquidity: 1000,
    admin_confidence: 100,
  });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pAdmin = form.initial_probability / 100;
  const L = form.initial_liquidity;
  const yr = L * Math.sqrt((1 - pAdmin) / pAdmin);
  const nr = L * Math.sqrt(pAdmin / (1 - pAdmin));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.question.trim()) return;
    setLoading(true);
    setMsg(null);

    const res = await fetch('/api/admin/markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        initial_probability: pAdmin,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setMsg({ ok: true, text: `Mercado creado: "${data.data.question.slice(0, 50)}..."` });
      setForm({ question: '', description: '', category: 'general', end_date: '', initial_probability: 50, initial_liquidity: 1000, admin_confidence: 100 });
      onCreated();
    } else {
      setMsg({ ok: false, text: data.error });
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5">
      <h2 className="font-semibold text-cream flex items-center gap-2">
        <Plus size={18} className="text-terracotta" />
        Nuevo mercado
      </h2>

      <div>
        <label className="label">Pregunta del mercado *</label>
        <textarea
          value={form.question}
          onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="¿Ejemplo: La Selección Peruana clasificará al Mundial 2026?"
          className="input resize-none"
          rows={2}
          required
        />
      </div>

      <div>
        <label className="label">Descripción (opcional)</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Contexto adicional, fuente de resolución..."
          className="input resize-none text-sm"
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Categoría</label>
          <select
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as MarketCategory }))}
            className="input"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Fecha cierre</label>
          <input
            type="datetime-local"
            value={form.end_date}
            onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            className="input text-sm"
          />
        </div>
      </div>

      {/* Probabilidad inicial */}
      <div className="bg-ink rounded-xl p-4 space-y-4">
        <p className="text-cream/70 text-sm font-semibold">Configuración de probabilidad inicial</p>

        <div>
          <label className="label">Tu estimado (P_admin): {form.initial_probability}%</label>
          <input
            type="range" min={1} max={99} value={form.initial_probability}
            onChange={(e) => setForm((f) => ({ ...f, initial_probability: Number(e.target.value) }))}
            className="w-full accent-terracotta"
          />
          <div className="flex justify-between text-xs text-cream/30 mt-1">
            <span>1% — improbable</span>
            <span>50% — coin flip</span>
            <span>99% — casi seguro</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Liquidez inicial (PEN)</label>
            <input
              type="number" min={100} max={1000000} value={form.initial_liquidity}
              onChange={(e) => setForm((f) => ({ ...f, initial_liquidity: Math.max(100, Number(e.target.value)) }))}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="label">Confianza inicial C</label>
            <input
              type="number" min={1} max={100000} value={form.admin_confidence}
              onChange={(e) => setForm((f) => ({ ...f, admin_confidence: Math.max(1, Number(e.target.value)) }))}
              className="input text-sm"
            />
          </div>
        </div>

        {/* Preview de reservas */}
        <div className="bg-ink-soft rounded-lg p-3 text-xs font-mono text-cream/40 space-y-1">
          <p className="text-cream/30 text-[10px] uppercase tracking-wider">Reservas iniciales del AMM</p>
          <p>yes_reserve = {yr.toFixed(4)} CHC</p>
          <p>no_reserve  = {nr.toFixed(4)} CHC</p>
          <p className="text-market-yes">→ P(SÍ) = {(nr / (yr + nr) * 100).toFixed(2)}%</p>
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
          msg.ok ? 'bg-market-yes/10 border border-market-yes/20 text-market-yes' : 'bg-market-no/10 border border-market-no/20 text-market-no'
        }`}>
          {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !form.question.trim()}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        {loading ? 'Creando...' : 'Crear mercado'}
      </button>
    </form>
  );
}

// ── ResolveBinaryPanel ────────────────────────────────────────────────────────
function ResolveBinaryPanel({ market, onResolved }: { market: AdminMarket; onResolved: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleResolve(resolution: 'YES' | 'NO') {
    if (!confirm(`¿Resolver como "${resolution}"? Se distribuirán ganancias automáticamente.`)) return;
    setResolving(true);
    const res = await fetch('/api/admin/markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: market.id, resolution }),
    });
    const data = await res.json();
    if (data.success) {
      setMsg({ ok: true, text: `Resuelto como "${resolution}" · ${data.data.winners_paid} ganadores pagados` });
      onResolved();
    } else {
      setMsg({ ok: false, text: data.error });
    }
    setResolving(false);
  }

  return (
    <div className="mt-3 pt-3 border-t border-cream/10">
      <p className="text-[10px] text-cream/30 uppercase tracking-wider mb-2">Resolver mercado</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => handleResolve('YES')} disabled={resolving}
          className="py-2 text-sm font-bold rounded-lg bg-market-yes/15 text-market-yes hover:bg-market-yes/25 transition-all flex items-center justify-center gap-1.5">
          {resolving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={13} />}
          SÍ ganó
        </button>
        <button onClick={() => handleResolve('NO')} disabled={resolving}
          className="py-2 text-sm font-bold rounded-lg bg-market-no/15 text-market-no hover:bg-market-no/25 transition-all flex items-center justify-center gap-1.5">
          {resolving ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={13} />}
          NO ganó
        </button>
      </div>
      {msg && (
        <p className={`text-xs flex items-center gap-1.5 mt-2 ${msg.ok ? 'text-market-yes' : 'text-market-no'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ── OUTCOME_COLORS (same palette as MultiBettingForm) ────────────────────────
const ADMIN_OUTCOME_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

// ── MultiProbOverridePanel ────────────────────────────────────────────────────
function MultiProbOverridePanel({ market, outcomes, onSaved }: {
  market: AdminMarket;
  outcomes: { id: string; label: string; calc_probability: number; override: number | null }[];
  onSaved: () => void;
}) {
  const [probs, setProbs] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    outcomes.forEach(o => { init[o.id] = o.override !== null ? Math.round(o.override * 1000) / 10 : Math.round(o.calc_probability * 1000) / 10; });
    return init;
  });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);

  const total = Object.values(probs).reduce((s, v) => s + v, 0);
  const isValid = Math.abs(total - 100) < 0.5;

  function setProb(id: string, val: number) {
    setProbs(p => ({ ...p, [id]: Math.max(0.1, Math.min(99.9, val)) }));
  }

  function equalize() {
    const each = 100 / outcomes.length;
    const init: Record<string, number> = {};
    outcomes.forEach(o => { init[o.id] = Math.round(each * 10) / 10; });
    setProbs(init);
  }

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/admin/probability-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_id: market.id,
        overrides: outcomes.map(o => ({ outcome_id: o.id, probability: probs[o.id] / 100 })),
        note: note.trim() || undefined,
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.success) {
      setMsg({ ok: true, text: `Probabilidades oracle actualizadas. Snapshot guardado.` });
      setNote('');
      onSaved();
    } else {
      setMsg({ ok: false, text: data.error });
    }
  }

  async function handleClearOutcome(outcomeId: string) {
    setClearingId(outcomeId);
    await fetch('/api/admin/probability-snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_id: market.id,
        overrides: outcomes.map(o => ({
          outcome_id: o.id,
          probability: o.id === outcomeId ? o.calc_probability : (probs[o.id] / 100),
        })),
        note: 'Limpieza de override',
      }),
    });
    setClearingId(null);
    onSaved();
  }

  return (
    <div className="mt-3 pt-3 border-t border-cream/10 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-cream/30 uppercase tracking-wider">Probabilidades Oracle</p>
        <button onClick={equalize} className="text-[10px] text-cream/40 hover:text-cream transition-colors">
          Igualar
        </button>
      </div>

      <p className="text-cream/40 text-xs leading-relaxed">
        Establece las probabilidades reales (oracle). Se muestran en lugar de las calculadas por apuestas para evitar falsas expectativas cuando hay apuestas especulativas.
      </p>

      <div className="space-y-3">
        {outcomes.map((o, i) => {
          const color = ADMIN_OUTCOME_COLORS[i % ADMIN_OUTCOME_COLORS.length];
          const hasOverride = o.override !== null;
          return (
            <div key={o.id}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-cream/70 text-xs font-medium flex-1">{o.label}</span>
                {hasOverride && (
                  <button
                    onClick={() => handleClearOutcome(o.id)}
                    disabled={clearingId === o.id}
                    className="text-[10px] text-cream/30 hover:text-market-no transition-colors"
                  >
                    {clearingId === o.id ? '...' : 'limpiar'}
                  </button>
                )}
                <span className="text-cream/30 text-[10px] ml-1">
                  calc: {(o.calc_probability * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.1} max={99.9} step={0.1}
                  value={probs[o.id] ?? 0}
                  onChange={(e) => setProb(o.id, Number(e.target.value))}
                  className="flex-1"
                  style={{ accentColor: color }}
                />
                <div className="relative w-16 shrink-0">
                  <input
                    type="number"
                    min={0.1} max={99.9} step={0.1}
                    value={probs[o.id] ?? 0}
                    onChange={(e) => setProb(o.id, Number(e.target.value))}
                    className="input text-sm py-1 pr-5 text-right w-full"
                    style={{ colorScheme: 'dark' }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-cream/30 text-xs pointer-events-none">%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total indicator */}
      <div className={`text-xs font-bold flex items-center gap-1.5 ${isValid ? 'text-market-yes' : 'text-market-no'}`}>
        {isValid ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
        Total: {total.toFixed(1)}% {isValid ? '✓' : `(faltan ${(100 - total).toFixed(1)}%)`}
      </div>

      {/* Note */}
      <div>
        <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">
          Nota (opcional — aparece en el historial)
        </label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ej: apuestas especulativas en equipo con baja probabilidad real"
          className="input text-xs py-2"
          maxLength={200}
        />
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? 'text-market-yes' : 'text-market-no'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !isValid}
        className="w-full py-2 text-xs font-semibold bg-mustard/20 text-mustard rounded-lg hover:bg-mustard/30 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
      >
        {saving ? <Loader2 size={11} className="animate-spin" /> : <Sliders size={11} />}
        {saving ? 'Guardando...' : 'Aplicar probabilidades oracle'}
      </button>
    </div>
  );
}

// ── ResolveMultiPanel ─────────────────────────────────────────────────────────
function ResolveMultiPanel({ market, onResolved }: { market: AdminMarket; onResolved: () => void }) {
  const [outcomes, setOutcomes] = useState<{
    id: string; label: string; total_bet: number;
    calc_probability: number; override: number | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/multi-markets?market_id=${market.id}`);
    const data = await res.json();
    if (data.success) {
      setOutcomes(data.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.id]);

  async function handleResolve(outcome_id: string) {
    if (!confirm('¿Resolver este mercado? Esta acción pagará a los ganadores y no se puede deshacer.')) return;
    setResolving(true);
    const res = await fetch('/api/admin/multi-markets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: market.id, winning_outcome_id: outcome_id }),
    });
    const data = await res.json();
    if (data.success) {
      setMsg({ ok: true, text: `Resuelto. Ratio de pago: ${data.data.payout_ratio.toFixed(2)}x` });
      onResolved();
    } else {
      setMsg({ ok: false, text: data.error });
    }
    setResolving(false);
  }

  if (loading) return <div className="py-4 flex justify-center"><Loader2 size={16} className="animate-spin text-terracotta" /></div>;

  const totalPool = outcomes.reduce((s, o) => s + o.total_bet, 0);

  return (
    <div className="mt-4 space-y-4 border-t border-cream/10 pt-4">
      {/* Probability override panel (open markets only) */}
      {market.status === 'open' && outcomes.length > 0 && (
        <MultiProbOverridePanel market={market} outcomes={outcomes} onSaved={load} />
      )}

      {/* Resolve section */}
      <div className="pt-3 border-t border-cream/10">
        <p className="text-[10px] text-cream/30 uppercase tracking-wider mb-2">
          Pool total: <span className="text-mustard">{totalPool.toFixed(2)} CHC</span>
        </p>
        <div className="space-y-2">
          {outcomes.map((o, i) => {
            const color = ADMIN_OUTCOME_COLORS[i % ADMIN_OUTCOME_COLORS.length];
            const displayProb = o.override ?? o.calc_probability;
            const hasOverride = o.override !== null;
            return (
              <div key={o.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-cream/80 truncate">{o.label}</span>
                      {hasOverride && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-mustard/20 text-mustard font-bold">oracle</span>
                      )}
                    </div>
                    <span className="text-cream/40 shrink-0 ml-2">
                      {(displayProb * 100).toFixed(1)}%
                      {hasOverride && <span className="text-cream/25 ml-1">(bets: {(o.calc_probability * 100).toFixed(1)}%)</span>}
                    </span>
                  </div>
                  <div className="h-1.5 bg-ink rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(displayProb * 100).toFixed(1)}%`, backgroundColor: color + '99' }} />
                  </div>
                </div>
                {market.status === 'open' && (
                  <button
                    onClick={() => handleResolve(o.id)}
                    disabled={resolving}
                    className="shrink-0 px-2.5 py-1 text-xs font-semibold bg-market-yes/20 text-market-yes rounded-lg hover:bg-market-yes/30 transition-all"
                  >
                    {resolving ? <Loader2 size={10} className="animate-spin" /> : '✓ Ganó'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {msg && (
          <p className={`text-xs flex items-center gap-1.5 mt-2 ${msg.ok ? 'text-market-yes' : 'text-market-no'}`}>
            {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Palette for outcome colors ────────────────────────────────────────────────
const OUTCOME_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

// ── CreateMultiMarketForm ─────────────────────────────────────────────────────
type OutcomeRow = { label: string; prob: number };

function equalProbs(n: number): number[] {
  const base = Math.floor(100 / n);
  const rem = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? rem : 0));
}

function CreateMultiMarketForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    question: '', description: '',
    category: 'general' as MarketCategory,
    end_date: '', seed_pool: 250,
  });
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([
    { label: '', prob: 50 },
    { label: '', prob: 50 },
  ]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const totalProb = outcomes.reduce((s, o) => s + o.prob, 0);
  const probsValid = totalProb === 100;

  function equalize() {
    const probs = equalProbs(outcomes.length);
    setOutcomes(o => o.map((item, i) => ({ ...item, prob: probs[i] })));
  }

  function addOutcome() {
    if (outcomes.length >= 10) return;
    const next = [...outcomes, { label: '', prob: 0 }];
    const probs = equalProbs(next.length);
    setOutcomes(next.map((item, i) => ({ ...item, prob: probs[i] })));
  }

  function removeOutcome(idx: number) {
    if (outcomes.length <= 2) return;
    const filtered = outcomes.filter((_, j) => j !== idx);
    const probs = equalProbs(filtered.length);
    setOutcomes(filtered.map((item, i) => ({ ...item, prob: probs[i] })));
  }

  function setLabel(idx: number, label: string) {
    setOutcomes(o => o.map((item, i) => i === idx ? { ...item, label } : item));
  }

  function setProb(idx: number, raw: number) {
    const val = Math.max(1, Math.min(97, raw || 1));
    setOutcomes(o => o.map((item, i) => i === idx ? { ...item, prob: val } : item));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.question.trim() || outcomes.some(o => !o.label.trim()) || !probsValid) return;
    setLoading(true);
    setMsg(null);
    const res = await fetch('/api/admin/multi-markets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: form.question,
        description: form.description,
        category: form.category,
        end_date: form.end_date,
        outcomes: outcomes.map(o => ({ label: o.label, prob: o.prob })),
        seed_pool: form.seed_pool,
      }),
    });
    const data = await res.json();
    if (data.success) {
      setMsg({ ok: true, text: `Mercado multi creado con ${outcomes.length} opciones` });
      setForm({ question: '', description: '', category: 'general', end_date: '', seed_pool: 250 });
      setOutcomes([{ label: '', prob: 50 }, { label: '', prob: 50 }]);
      onCreated();
    } else {
      setMsg({ ok: false, text: data.error });
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-5">
      <h2 className="font-semibold text-cream flex items-center gap-2">
        <List size={18} className="text-mustard" />
        Nuevo mercado multi-opción
      </h2>

      <div>
        <label className="label">Pregunta del mercado *</label>
        <textarea
          value={form.question}
          onChange={(e) => setForm(f => ({ ...f, question: e.target.value }))}
          placeholder="¿Ej: ¿Quién ganará el Mundial 2026?"
          className="input resize-none" rows={2} required
        />
      </div>

      <div>
        <label className="label">Descripción (opcional)</label>
        <textarea
          value={form.description}
          onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
          className="input resize-none text-sm" rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Categoría</label>
          <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value as MarketCategory }))} className="input">
            {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fecha cierre</label>
          <input type="datetime-local" value={form.end_date} onChange={(e) => setForm(f => ({ ...f, end_date: e.target.value }))} className="input text-sm" />
        </div>
      </div>

      {/* Opciones con probabilidades */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="label mb-0">Opciones * ({outcomes.length}/10)</label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={equalize}
              className="text-xs text-cream/40 hover:text-cream transition-colors">
              Igualar
            </button>
            <button type="button" onClick={addOutcome} disabled={outcomes.length >= 10}
              className="text-xs text-mustard hover:text-mustard/80 flex items-center gap-1 disabled:opacity-40">
              <Plus size={12} /> Añadir
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {outcomes.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              {/* Color dot */}
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }}
              />
              {/* Label */}
              <input
                type="text" value={o.label} onChange={(e) => setLabel(i, e.target.value)}
                placeholder={i === 0 ? 'Ej: Argentina' : i === 1 ? 'Ej: Brasil' : `Opción ${i + 1}`}
                className="input flex-1 text-sm py-2" required
              />
              {/* Probability input */}
              <div className="relative shrink-0 w-20">
                <input
                  type="number" value={o.prob}
                  onChange={(e) => setProb(i, Number(e.target.value))}
                  min={1} max={97}
                  className="input text-sm py-2 pr-6 text-right w-full"
                  style={{ colorScheme: 'dark' }}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream/40 text-xs pointer-events-none">%</span>
              </div>
              {/* Delete */}
              {outcomes.length > 2 && (
                <button type="button" onClick={() => removeOutcome(i)}
                  className="p-1.5 text-market-no/50 hover:text-market-no shrink-0">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Distribution bar */}
        <div className="mt-3 h-3 rounded-full overflow-hidden flex gap-px bg-ink">
          {outcomes.map((o, i) => (
            <div
              key={i}
              className="h-full transition-all duration-300"
              style={{
                width: `${o.prob}%`,
                backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length],
                opacity: probsValid ? 1 : 0.5,
              }}
            />
          ))}
        </div>

        {/* Total indicator */}
        <div className="flex items-center justify-between mt-2">
          <div className="flex gap-3 flex-wrap">
            {outcomes.map((o, i) => (
              <span key={i} className="flex items-center gap-1 text-[11px] text-cream/50">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }} />
                {o.label || `Opción ${i + 1}`}: {o.prob}%
              </span>
            ))}
          </div>
          <span className={`text-xs font-bold shrink-0 ml-2 ${probsValid ? 'text-market-yes' : totalProb > 100 ? 'text-market-no' : 'text-mustard'}`}>
            {totalProb}% {probsValid ? '✓' : totalProb > 100 ? '↑ excede' : '↓ faltan ' + (100 - totalProb) + '%'}
          </span>
        </div>
      </div>

      {/* Info parimutuel */}
      <div className="bg-ink rounded-xl p-3 text-xs text-cream/40 space-y-1">
        <p className="text-cream/60 font-semibold text-[11px] uppercase tracking-wider">Sistema parimutuel</p>
        <p>
          Pool seed total:{' '}
          <span className="text-mustard">{form.seed_pool} CHC</span>
          {' · '}distribuido según probabilidades
        </p>
        {outcomes.map((o, i) => (
          <p key={i} style={{ color: OUTCOME_COLORS[i % OUTCOME_COLORS.length] + 'cc' }}>
            {o.label || `Opción ${i + 1}`}: seed = {((o.prob / 100) * form.seed_pool).toFixed(1)} CHC
          </p>
        ))}
        <p className="pt-1 border-t border-cream/10 text-cream/30">Al resolver: pago = (pool_total × 98%) / pool_ganador</p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${msg.ok ? 'bg-market-yes/10 border border-market-yes/20 text-market-yes' : 'bg-market-no/10 border border-market-no/20 text-market-no'}`}>
          {msg.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          {msg.text}
        </div>
      )}

      {!probsValid && (
        <p className="text-xs text-mustard/80 flex items-center gap-1.5">
          <AlertCircle size={12} />
          Las probabilidades deben sumar exactamente 100% (ahora: {totalProb}%)
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !form.question.trim() || outcomes.some(o => !o.label.trim()) || !probsValid}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <List size={16} />}
        {loading ? 'Creando...' : `Crear mercado con ${outcomes.length} opciones`}
      </button>
    </form>
  );
}

// ── TasksPanel ────────────────────────────────────────────────────────────────
interface AdminTask {
  id: string; title: string; description: string | null;
  reward_pen: number; task_type: string; is_active: boolean; icon: string | null;
}

interface MiningCfg { rate_per_click: number; cooldown_seconds: number; is_active: boolean; }

function TasksPanel() {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [localRewards, setLocalRewards] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [mining, setMining] = useState<MiningCfg | null>(null);
  const [localRate, setLocalRate] = useState(0.01);
  const [localCooldown, setLocalCooldown] = useState(2);
  const [savingMining, setSavingMining] = useState(false);
  const [miningMsg, setMiningMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadMining() {
    const res = await fetch('/api/admin/mining');
    const data = await res.json();
    if (data.success) {
      setMining(data.data);
      setLocalRate(Number(data.data.rate_per_click));
      setLocalCooldown(Number(data.data.cooldown_seconds));
    }
  }

  async function saveMining() {
    setSavingMining(true);
    setMiningMsg(null);
    const res = await fetch('/api/admin/mining', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rate_per_click: localRate, cooldown_seconds: localCooldown }),
    });
    const data = await res.json();
    setSavingMining(false);
    if (data.success) {
      setMiningMsg({ ok: true, text: `Guardado: ${localRate} CHC/clic · ${localCooldown}s cooldown` });
      await loadMining();
    } else {
      setMiningMsg({ ok: false, text: data.error });
    }
  }

  async function toggleMining() {
    if (!mining) return;
    const res = await fetch('/api/admin/mining', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !mining.is_active }),
    });
    const data = await res.json();
    if (data.success) await loadMining();
  }

  async function load() {
    setLoading(true);
    const res = await fetch('/api/admin/tasks');
    const data = await res.json();
    if (data.success) {
      setTasks(data.data);
      const init: Record<string, number> = {};
      data.data.forEach((t: AdminTask) => { init[t.id] = t.reward_pen; });
      setLocalRewards(init);
    }
    setLoading(false);
  }

  useEffect(() => { load(); loadMining(); }, []);

  async function saveReward(taskId: string) {
    setSaving(taskId);
    setMsg(null);
    const res = await fetch('/api/admin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, reward_pen: localRewards[taskId] ?? 0 }),
    });
    const data = await res.json();
    setSaving(null);
    if (data.success) {
      setMsg({ ok: true, text: `Recompensa actualizada a ${localRewards[taskId]} CHC` });
      await load();
    } else {
      setMsg({ ok: false, text: data.error });
    }
  }

  async function toggleActive(taskId: string, current: boolean) {
    await fetch('/api/admin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, is_active: !current }),
    });
    await load();
  }

  if (loading) return <div className="card text-center py-12"><Loader2 size={24} className="animate-spin text-terracotta mx-auto" /></div>;

  return (
    <div className="space-y-4">
      <div className="card bg-mustard/5 border-mustard/20 space-y-1.5">
        <p className="text-mustard text-sm font-semibold flex items-center gap-2">
          <Award size={14} />
          Control de recompensas
        </p>
        <p className="text-cream/50 text-xs leading-relaxed">
          Mantén las recompensas bajas para controlar la inflación de CHC. Las tareas desactivadas no aparecen para los usuarios.
        </p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 text-xs p-3 rounded-lg ${msg.ok ? 'bg-market-yes/10 border border-market-yes/20 text-market-yes' : 'bg-market-no/10 border border-market-no/20 text-market-no'}`}>
          {msg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
          {msg.text}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="card text-center py-8 text-cream/40 text-sm">No hay tareas configuradas en la base de datos.</div>
      ) : (
        tasks.map(task => (
          <div key={task.id} className={`card transition-opacity ${task.is_active ? '' : 'opacity-50'}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{task.icon ?? '🎯'}</span>
                <div>
                  <p className="text-cream text-sm font-semibold">{task.title}</p>
                  <p className="text-cream/40 text-xs">{task.task_type} · {task.description}</p>
                </div>
              </div>
              <button
                onClick={() => toggleActive(task.id, task.is_active)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold border transition-all ${
                  task.is_active
                    ? 'bg-market-yes/10 text-market-yes border-market-yes/30 hover:bg-market-no/10 hover:text-market-no hover:border-market-no/30'
                    : 'bg-ink text-cream/30 border-cream/10 hover:bg-market-yes/10 hover:text-market-yes hover:border-market-yes/30'
                }`}
              >
                {task.is_active ? 'Activa' : 'Inactiva'}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-cream/40 shrink-0">Recompensa:</label>
              <div className="relative flex-1 max-w-[120px]">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={localRewards[task.id] ?? task.reward_pen}
                  onChange={e => setLocalRewards(r => ({ ...r, [task.id]: Math.max(0, Number(e.target.value)) }))}
                  className="input text-sm py-1.5 pr-10 w-full"
                  style={{ colorScheme: 'dark' }}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream/30 text-xs pointer-events-none">CHC</span>
              </div>
              <button
                onClick={() => saveReward(task.id)}
                disabled={saving === task.id || localRewards[task.id] === task.reward_pen}
                className="px-3 py-1.5 text-xs font-semibold bg-mustard/20 text-mustard rounded-lg hover:bg-mustard/30 transition-all disabled:opacity-40 flex items-center gap-1.5"
              >
                {saving === task.id ? <Loader2 size={11} className="animate-spin" /> : null}
                Guardar
              </button>
              <span className="text-cream/25 text-[10px]">actual: {task.reward_pen} CHC</span>
            </div>
          </div>
        ))
      )}

      {/* ── Mining config ── */}
      <div className="card border-terracotta/20 bg-terracotta/5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-terracotta font-semibold text-sm flex items-center gap-2">
            <span>⛏️</span> Configuración de Minería
          </p>
          {mining && (
            <button
              onClick={toggleMining}
              className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-all ${
                mining.is_active
                  ? 'bg-market-yes/10 text-market-yes border-market-yes/30 hover:bg-market-no/10 hover:text-market-no hover:border-market-no/30'
                  : 'bg-ink text-cream/30 border-cream/10 hover:bg-market-yes/10 hover:text-market-yes hover:border-market-yes/30'
              }`}
            >
              {mining.is_active ? 'Activa' : 'Pausada'}
            </button>
          )}
        </div>

        <p className="text-cream/40 text-xs leading-relaxed">
          Controla cuántos CHC gana un usuario por cada clic y cuánto tiempo debe esperar entre clics. Valores bajos evitan inflación.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-cream/40 block mb-1">CHC por clic</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                max={100}
                step={0.001}
                value={localRate}
                onChange={e => setLocalRate(Math.max(0, Number(e.target.value)))}
                className="input text-sm py-1.5 pr-12 w-full"
                style={{ colorScheme: 'dark' }}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream/30 text-xs pointer-events-none">CHC</span>
            </div>
          </div>
          <div>
            <label className="text-xs text-cream/40 block mb-1">Cooldown (segundos)</label>
            <div className="relative">
              <input
                type="number"
                min={1}
                max={3600}
                step={1}
                value={localCooldown}
                onChange={e => setLocalCooldown(Math.max(1, Number(e.target.value)))}
                className="input text-sm py-1.5 pr-6 w-full"
                style={{ colorScheme: 'dark' }}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-cream/30 text-xs pointer-events-none">s</span>
            </div>
          </div>
        </div>

        {miningMsg && (
          <p className={`text-xs flex items-center gap-1.5 ${miningMsg.ok ? 'text-market-yes' : 'text-market-no'}`}>
            {miningMsg.ok ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
            {miningMsg.text}
          </p>
        )}

        <button
          onClick={saveMining}
          disabled={savingMining}
          className="w-full py-2 text-xs font-semibold bg-terracotta/20 text-terracotta rounded-lg hover:bg-terracotta/30 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          {savingMining ? <Loader2 size={11} className="animate-spin" /> : null}
          Guardar configuración de minería
        </button>

        <p className="text-cream/25 text-[10px] text-center">
          SQL necesario si es la primera vez: ver instrucciones en el panel
        </p>
      </div>
    </div>
  );
}

// ── P2POraclePanel — resolver mercados P2P disputados o vencidos ─────────────
interface P2PCase {
  id: string; creator_address: string; opponent_address: string;
  amount: number; deadline: string; verdict_creator: string | null; verdict_opponent: string | null;
}

function P2POraclePanel() {
  const [disputed, setDisputed] = useState<P2PCase[]>([]);
  const [expired, setExpired] = useState<P2PCase[]>([]);
  const [loadingP2P, setLoadingP2P] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [p2pMsg, setP2pMsg] = useState<string | null>(null);

  const loadCases = useCallback(async () => {
    const r = await fetch('/api/admin/p2p');
    const d = await r.json();
    if (d.success) { setDisputed(d.data.disputed); setExpired(d.data.expired); }
    setLoadingP2P(false);
  }, []);

  useEffect(() => { loadCases(); }, [loadCases]);

  async function resolve(id: string, winner: 'creator' | 'opponent') {
    if (!confirm(`¿Resolver a favor de ${winner === 'creator' ? 'CREADOR' : 'RETADO'}? Se firma con Ed25519 y se paga el pot.`)) return;
    setResolving(id);
    const r = await fetch('/api/admin/p2p', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: id, winner }),
    });
    const d = await r.json();
    setP2pMsg(d.success ? `✓ Resuelto y firmado por el oráculo` : `Error: ${d.error}`);
    setResolving(null);
    await loadCases();
  }

  const Case = ({ c, tag }: { c: P2PCase; tag: string }) => (
    <div className="rounded-xl border border-cream/10 bg-ink p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-cream/70">
          {c.creator_address.slice(0, 6)}… vs {c.opponent_address.slice(0, 6)}…
        </span>
        <span className="text-mustard font-mono font-bold">{(Number(c.amount) * 2).toFixed(0)} CHC</span>
      </div>
      <p className="text-[10px] text-cream/30 font-mono">
        {tag} · veredictos: creador={c.verdict_creator ?? '—'} / retado={c.verdict_opponent ?? '—'}
      </p>
      <div className="flex gap-2">
        <button onClick={() => resolve(c.id, 'creator')} disabled={resolving === c.id}
          className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-market-yes/15 text-market-yes hover:bg-market-yes/25 transition-all disabled:opacity-40">
          Gana creador
        </button>
        <button onClick={() => resolve(c.id, 'opponent')} disabled={resolving === c.id}
          className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-mustard/15 text-mustard hover:bg-mustard/25 transition-all disabled:opacity-40">
          Gana retado
        </button>
      </div>
    </div>
  );

  if (loadingP2P) return null;
  if (disputed.length === 0 && expired.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-500/25 bg-red-500/5 p-4 space-y-3 mb-4">
      <h3 className="font-semibold text-cream text-sm flex items-center gap-2">
        ⚖️ Oráculo P2P — {disputed.length + expired.length} caso(s) requieren intervención
      </h3>
      {p2pMsg && <p className={`text-xs ${p2pMsg.startsWith('✓') ? 'text-market-yes' : 'text-red-400'}`}>{p2pMsg}</p>}
      {disputed.map(c => <Case key={c.id} c={c} tag="EN DISPUTA (veredictos en conflicto)" />)}
      {expired.map(c => <Case key={c.id} c={c} tag="VENCIDO sin resolución" />)}
      <p className="text-[10px] text-cream/25">Cada resolución se firma con la llave Ed25519 del oráculo y queda auditable en el mercado.</p>
    </div>
  );
}

// ── SuggestionsInbox ─────────────────────────────────────────────────────────
interface Suggestion {
  id: string;
  user_id: string;
  username: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

// ── CasinoConfigPanel ─────────────────────────────────────────────────────────
interface SlotsCfg {
  is_active: boolean; win_rate: number; fs_win_rate: number;
  max_mult: number; min_bet: number; max_bet: number; house_edge: number;
}
interface CasinoLocal {
  chicken:   { bajo: number; medio: number; alto: number; extremo: number; house_edge: number };
  mines:     { house_edge: number };
  crash:     { house_edge: number };
  roulette:  { house_edge: number };
  blackjack: { bj_payout: number; house_edge: number };
  scratch:   { rtp: number };
}

const CASINO_CLIENT_DEFAULTS: CasinoLocal = {
  chicken:   { bajo: 0.85, medio: 0.75, alto: 0.60, extremo: 0.45, house_edge: 0.05 },
  mines:     { house_edge: 0.05 },
  crash:     { house_edge: 0.03 },
  roulette:  { house_edge: 0.027 },
  blackjack: { bj_payout: 1.5, house_edge: 0.005 },
  scratch:   { rtp: 0.915 },
};
const SLOTS_DEFAULTS: SlotsCfg = {
  is_active: true, win_rate: 30, fs_win_rate: 60, max_mult: 100, min_bet: 1, max_bet: 100, house_edge: 8,
};

function SliderRow({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const display = fmt ? fmt(value) : `${(value * 100).toFixed(1)}%`;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-cream/60">{label}</span>
        <span className="font-bold text-mustard font-mono">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-terracotta h-1.5 cursor-pointer" />
    </div>
  );
}

function CasinoConfigPanel() {
  const [casinoLocal, setCasinoLocal] = useState<CasinoLocal | null>(null);
  const [slotsLocal, setSlotsLocal]   = useState<SlotsCfg>(SLOTS_DEFAULTS);
  const [loaded, setLoaded]           = useState(false);
  const [savingGame, setSavingGame]   = useState<string | null>(null);
  const [msgs, setMsgs]               = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/casino-settings').then(r => r.json()),
      fetch('/api/admin/slots').then(r => r.json()),
    ]).then(([casino, slots]) => {
      setCasinoLocal(casino.success ? (casino.data as CasinoLocal) : CASINO_CLIENT_DEFAULTS);
      if (slots.success) setSlotsLocal(slots.data as SlotsCfg);
      setLoaded(true);
    });
  }, []);

  function flashMsg(game: string, ok: boolean, text: string) {
    setMsgs(prev => ({ ...prev, [game]: { ok, text } }));
    setTimeout(() => setMsgs(prev => { const n = { ...prev }; delete n[game]; return n; }), 4000);
  }

  function patchCasino<G extends keyof CasinoLocal>(game: G, key: string, val: number) {
    setCasinoLocal(prev => prev ? { ...prev, [game]: { ...prev[game], [key]: val } } : prev);
  }

  async function saveCasino(game: keyof CasinoLocal) {
    if (!casinoLocal) return;
    setSavingGame(game);
    const r = await fetch('/api/admin/casino-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, settings: casinoLocal[game] }),
    });
    const d = await r.json();
    flashMsg(game, d.success, d.success ? 'Guardado' : d.error);
    setSavingGame(null);
  }

  async function resetCasino(game: keyof CasinoLocal) {
    const defaults = CASINO_CLIENT_DEFAULTS[game];
    setCasinoLocal(prev => prev ? { ...prev, [game]: { ...defaults } } : prev);
    setSavingGame(game);
    const r = await fetch('/api/admin/casino-settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game, settings: defaults }),
    });
    const d = await r.json();
    flashMsg(game, d.success, d.success ? 'Restaurado a defaults' : d.error);
    setSavingGame(null);
  }

  async function saveSlots() {
    setSavingGame('slots');
    const r = await fetch('/api/admin/slots', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slotsLocal),
    });
    const d = await r.json();
    if (d.success) setSlotsLocal(d.data as SlotsCfg);
    flashMsg('slots', d.success, d.success ? 'Guardado' : d.error);
    setSavingGame(null);
  }

  async function resetSlots() {
    setSlotsLocal(SLOTS_DEFAULTS);
    setSavingGame('slots');
    const r = await fetch('/api/admin/slots', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SLOTS_DEFAULTS),
    });
    const d = await r.json();
    flashMsg('slots', d.success, d.success ? 'Restaurado a defaults' : d.error);
    setSavingGame(null);
  }

  if (!loaded) return <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-cream/30" /></div>;
  if (!casinoLocal) return <p className="text-center text-cream/30 py-12">Error cargando ajustes</p>;

  function GameActions({ game, onSave, onReset }: { game: string; onSave: () => void; onReset: () => void }) {
    return (
      <div className="space-y-2 pt-1">
        {msgs[game] && (
          <p className={`text-xs flex items-center gap-1.5 ${msgs[game].ok ? 'text-market-yes' : 'text-red-400'}`}>
            {msgs[game].ok ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
            {msgs[game].text}
          </p>
        )}
        <div className="flex gap-2">
          <button onClick={onSave} disabled={savingGame === game}
            className="flex-1 py-1.5 text-xs font-bold bg-terracotta/20 hover:bg-terracotta/30 text-terracotta rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-1">
            {savingGame === game ? <Loader2 size={11} className="animate-spin" /> : null}
            Guardar
          </button>
          <button onClick={onReset} disabled={savingGame === game}
            className="px-3 py-1.5 text-xs font-semibold border border-cream/15 text-cream/40 hover:text-cream hover:border-cream/30 rounded-lg transition-all disabled:opacity-50">
            ↺ Defaults
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card bg-terracotta/5 border-terracotta/20 space-y-1">
        <p className="text-terracotta font-semibold text-sm flex items-center gap-2">
          <Settings size={14} />
          Configuración del Casino
        </p>
        <p className="text-cream/40 text-xs">Controla house edge, RTP y parámetros de cada juego. Los cambios aplican desde la siguiente partida.</p>
      </div>

      {/* ── Slots ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-cream text-sm">🎰 Tragamonedas</h3>
          <button onClick={() => setSlotsLocal(l => ({ ...l, is_active: !l.is_active }))}
            className={`text-xs px-2.5 py-1 rounded-full font-semibold border transition-all ${
              slotsLocal.is_active ? 'bg-market-yes/10 text-market-yes border-market-yes/30' : 'bg-ink text-cream/30 border-cream/10'
            }`}>
            {slotsLocal.is_active ? 'Activo' : 'Pausado'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <SliderRow label="Win rate" value={slotsLocal.win_rate / 100} min={0} max={1} step={0.005}
            onChange={v => setSlotsLocal(l => ({ ...l, win_rate: Math.round(v * 1000) / 10 }))} />
          <SliderRow label="Win rate giros gratis" value={slotsLocal.fs_win_rate / 100} min={0} max={1} step={0.005}
            onChange={v => setSlotsLocal(l => ({ ...l, fs_win_rate: Math.round(v * 1000) / 10 }))} />
        </div>
        <SliderRow label="House edge" value={slotsLocal.house_edge / 100} min={0.01} max={0.5} step={0.005}
          onChange={v => setSlotsLocal(l => ({ ...l, house_edge: Math.round(v * 1000) / 10 }))} />
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: 'Mult. máx.', key: 'max_mult' as const, unit: '×', min: 1, max: 1000 },
            { label: 'Ap. mín.', key: 'min_bet' as const, unit: 'CHC', min: 0.5, max: 100 },
            { label: 'Ap. máx.', key: 'max_bet' as const, unit: 'CHC', min: 1, max: 10000 },
          ] as const).map(({ label, key, unit, min, max }) => (
            <div key={key}>
              <label className="text-[10px] text-cream/30 block mb-1">{label}</label>
              <div className="relative">
                <input type="number" min={min} max={max} value={slotsLocal[key] as number}
                  onChange={e => setSlotsLocal(l => ({ ...l, [key]: Number(e.target.value) }))}
                  className="input text-xs py-1.5 w-full" style={{ colorScheme: 'dark', paddingRight: '1.75rem' }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-cream/25 text-[10px] pointer-events-none">{unit}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-cream/20">House edge: {slotsLocal.house_edge}% · Payouts reducidos por ese factor en cada spin</p>
        <GameActions game="slots" onSave={saveSlots} onReset={resetSlots} />
      </div>

      {/* ── Crash ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">💥 El Avión (Crash)</h3>
        <SliderRow label="Ventaja de casa" value={casinoLocal.crash.house_edge} min={0.01} max={0.15} step={0.005}
          onChange={v => patchCasino('crash', 'house_edge', v)} />
        <p className="text-[10px] text-cream/20">
          RTP: {((1 - casinoLocal.crash.house_edge) * 100).toFixed(1)}% · Crashes instantáneos a 1.00×: {(casinoLocal.crash.house_edge * 100).toFixed(1)}%
        </p>
        <GameActions game="crash" onSave={() => saveCasino('crash')} onReset={() => resetCasino('crash')} />
      </div>

      {/* ── Ruleta ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">🎡 Ruleta</h3>
        <SliderRow label="Ventaja extra de casa" value={casinoLocal.roulette.house_edge} min={0} max={0.15} step={0.001}
          onChange={v => patchCasino('roulette', 'house_edge', v)} />
        <p className="text-[10px] text-cream/20">
          Edge natural (cero europeo): 2.70% · Extra: {(casinoLocal.roulette.house_edge * 100).toFixed(2)}% · Total ≈ {(2.70 + casinoLocal.roulette.house_edge * 100).toFixed(2)}%
        </p>
        <GameActions game="roulette" onSave={() => saveCasino('roulette')} onReset={() => resetCasino('roulette')} />
      </div>

      {/* ── Blackjack ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">🂡 Blackjack</h3>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-cream/60">Pago Blackjack natural</span>
            <span className="font-bold text-mustard font-mono">
              {casinoLocal.blackjack.bj_payout >= 1.5 ? '3:2' : casinoLocal.blackjack.bj_payout >= 1.2 ? '6:5' : `${casinoLocal.blackjack.bj_payout}:1`}
              {' '}({casinoLocal.blackjack.bj_payout.toFixed(2)}×)
            </span>
          </div>
          <input type="range" min={1} max={2} step={0.05} value={casinoLocal.blackjack.bj_payout}
            onChange={e => patchCasino('blackjack', 'bj_payout', parseFloat(e.target.value))}
            className="w-full accent-terracotta h-1.5 cursor-pointer" />
          <div className="flex justify-between text-[10px] text-cream/20 mt-0.5">
            <span>1:1</span><span>6:5 (1.2)</span><span>3:2 (std)</span><span>2:1</span>
          </div>
        </div>
        <SliderRow label="Ventaja extra de casa" value={casinoLocal.blackjack.house_edge} min={0} max={0.1} step={0.001}
          onChange={v => patchCasino('blackjack', 'house_edge', v)} />
        <p className="text-[10px] text-cream/20">
          Edge básico con estrategia óptima: ~0.5% · Bajar bj_payout a 1.2 (6:5) añade ~1.4% al edge
        </p>
        <GameActions game="blackjack" onSave={() => saveCasino('blackjack')} onReset={() => resetCasino('blackjack')} />
      </div>

      {/* ── La Gallina ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">🐔 La Gallina (pista)</h3>
        <SliderRow label="Ventaja de casa" value={casinoLocal.chicken.house_edge} min={0.01} max={0.15} step={0.005}
          onChange={v => patchCasino('chicken', 'house_edge', v)} />
        <div className="border-t border-cream/5 pt-2 space-y-2">
          <p className="text-[10px] text-cream/30 uppercase tracking-wider">Prob. supervivencia por carril (↑ más fácil = menor mult.)</p>
          <SliderRow label="🟢 Bajo" value={casinoLocal.chicken.bajo} min={0.5} max={0.97} step={0.01}
            onChange={v => patchCasino('chicken', 'bajo', v)} />
          <SliderRow label="🟡 Medio" value={casinoLocal.chicken.medio} min={0.4} max={0.92} step={0.01}
            onChange={v => patchCasino('chicken', 'medio', v)} />
          <SliderRow label="🟠 Alto" value={casinoLocal.chicken.alto} min={0.3} max={0.85} step={0.01}
            onChange={v => patchCasino('chicken', 'alto', v)} />
          <SliderRow label="🔴 Extremo" value={casinoLocal.chicken.extremo} min={0.15} max={0.75} step={0.01}
            onChange={v => patchCasino('chicken', 'extremo', v)} />
        </div>
        <p className="text-[10px] text-cream/20">
          C5 Bajo: {((1 - casinoLocal.chicken.house_edge) * Math.pow(1 / casinoLocal.chicken.bajo, 5)).toFixed(2)}× ·
          C5 Extremo: {((1 - casinoLocal.chicken.house_edge) * Math.pow(1 / casinoLocal.chicken.extremo, 5)).toFixed(2)}×
        </p>
        <GameActions game="chicken" onSave={() => saveCasino('chicken')} onReset={() => resetCasino('chicken')} />
      </div>

      {/* ── Minas ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">💣 Minas</h3>
        <SliderRow label="Ventaja de casa" value={casinoLocal.mines.house_edge} min={0.01} max={0.15} step={0.005}
          onChange={v => patchCasino('mines', 'house_edge', v)} />
        <p className="text-[10px] text-cream/20">
          RTP: {((1 - casinoLocal.mines.house_edge) * 100).toFixed(1)}% · Fórmula hipergeométrica — más minas = multiplicadores más altos
        </p>
        <GameActions game="mines" onSave={() => saveCasino('mines')} onReset={() => resetCasino('mines')} />
      </div>

      {/* ── Scratch ── */}
      <div className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
        <h3 className="font-semibold text-cream text-sm">🎟️ Raspa y Gana</h3>
        <SliderRow label="RTP objetivo" value={casinoLocal.scratch.rtp} min={0.5} max={0.99} step={0.005}
          onChange={v => patchCasino('scratch', 'rtp', v)} />
        <p className="text-[10px] text-cream/20">
          Escala los premios por {(casinoLocal.scratch.rtp / 0.915).toFixed(3)}× sobre la tabla base ·
          RTP = {(casinoLocal.scratch.rtp * 100).toFixed(1)}%
        </p>
        <GameActions game="scratch" onSave={() => saveCasino('scratch')} onReset={() => resetCasino('scratch')} />
      </div>
    </div>
  );
}

function SuggestionsInbox() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [view, setView]               = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading]         = useState(true);
  const [noteMap, setNoteMap]         = useState<Record<string, string>>({});
  const [acting, setActing]           = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    const r = await fetch(`/api/suggestions?status=${status}`);
    const d = await r.json();
    setSuggestions(d.success ? d.data : []);
    setLoading(false);
  }, []);

  useEffect(() => { load(view); }, [view, load]);

  async function act(id: string, status: 'approved' | 'rejected') {
    setActing(id);
    await fetch('/api/suggestions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, admin_note: noteMap[id] ?? null }),
    });
    setSuggestions(prev => prev.filter(s => s.id !== id));
    setActing(null);
  }

  const CATEGORY_LABELS: Record<string, string> = {
    general: 'General', deportes: 'Deportes', politica: 'Política', crypto: 'Crypto',
    economia: 'Economía', entretenimiento: 'Entretenimiento', ciencia: 'Ciencia', educacion: 'Educación',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-ink rounded-xl p-1">
        {(['pending', 'approved', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setView(s)}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all capitalize ${
              view === s
                ? s === 'pending' ? 'bg-mustard text-ink' : s === 'approved' ? 'bg-market-yes/30 text-market-yes' : 'bg-market-no/30 text-market-no'
                : 'text-cream/40 hover:text-cream'
            }`}>
            {s === 'pending' ? 'Pendientes' : s === 'approved' ? 'Aprobadas' : 'Rechazadas'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-cream/30" /></div>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-10 text-cream/30 space-y-2">
          <Lightbulb size={32} className="mx-auto opacity-30" />
          <p className="text-sm">{view === 'pending' ? 'No hay sugerencias pendientes' : 'Sin registros'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map(s => (
            <div key={s.id} className="rounded-xl border border-cream/10 bg-ink-soft p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="text-cream font-semibold text-sm leading-snug">{s.title}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-cream/30">por @{s.username}</span>
                    <span className="px-1.5 py-0.5 rounded bg-ink text-[10px] text-cream/40 font-medium">
                      {CATEGORY_LABELS[s.category] ?? s.category}
                    </span>
                    <span className="text-[10px] text-cream/20">
                      {new Date(s.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>
                  {s.description && (
                    <p className="text-xs text-cream/40 leading-relaxed pt-0.5">{s.description}</p>
                  )}
                </div>
                {view !== 'pending' && (
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    s.status === 'approved' ? 'bg-market-yes/20 text-market-yes' : 'bg-market-no/20 text-market-no'
                  }`}>
                    {s.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                  </span>
                )}
              </div>

              {view === 'pending' && (
                <>
                  <input
                    value={noteMap[s.id] ?? ''}
                    onChange={e => setNoteMap(prev => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="Nota para el usuario (opcional)"
                    className="w-full bg-ink border border-cream/10 rounded-lg px-3 py-2 text-xs text-cream placeholder:text-cream/20 focus:outline-none focus:border-mustard/40"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => act(s.id, 'approved')} disabled={acting === s.id}
                      className="flex-1 py-2 rounded-lg bg-market-yes/20 hover:bg-market-yes/30 text-market-yes text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50">
                      {acting === s.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={14} />}
                      Aprobar
                    </button>
                    <button onClick={() => act(s.id, 'rejected')} disabled={acting === s.id}
                      className="flex-1 py-2 rounded-lg bg-market-no/20 hover:bg-market-no/30 text-market-no text-xs font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50">
                      {acting === s.id ? <Loader2 size={12} className="animate-spin" /> : <X size={14} />}
                      Rechazar
                    </button>
                  </div>
                </>
              )}
              {view !== 'pending' && s.admin_note && (
                <p className="text-xs text-cream/30 italic border-t border-cream/5 pt-2">&ldquo;{s.admin_note}&rdquo;</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AdminPage ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('markets');
  const [markets, setMarkets] = useState<AdminMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [pendingCount, setPendingCount] = useState(0);

  const loadMarkets = useCallback(async () => {
    const client = createClient();
    const query = client
      .from('markets')
      .select('*')
      .order('created_at', { ascending: false });

    if (filter === 'open') query.eq('status', 'open');

    const { data } = await query.returns<Market[]>();
    setMarkets(data ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    loadMarkets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    fetch('/api/suggestions?status=pending')
      .then(r => r.json())
      .then(d => { if (d.success) setPendingCount(d.data.length); })
      .catch(() => {});
  }, [tab]);

  async function handleCancel(marketId: string) {
    if (!confirm('¿Cancelar este mercado? Esta acción no se puede deshacer.')) return;
    const res = await fetch('/api/admin/markets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId }),
    });
    if ((await res.json()).success) {
      setMarkets((prev) => prev.map((m) => m.id === marketId ? { ...m, status: 'cancelled' } : m));
    }
  }

  async function handleApplyProb(marketId: string, pAdmin: number, confidence: number, apply: boolean) {
    const res = await fetch('/api/admin/probability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, admin_probability: pAdmin, admin_confidence: confidence, apply }),
    });
    const data = await res.json();
    if (data.success && apply) {
      await loadMarkets();
    }
  }

  const openCount = markets.filter((m) => m.status === 'open').length;

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
              <ShieldCheck size={24} className="text-terracotta" />
              Panel Admin
            </h1>
            <p className="text-cream/40 text-sm mt-0.5">
              Gestiona mercados y ajusta probabilidades ponderadas
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-mustard">{openCount}</p>
            <p className="text-cream/40 text-xs">mercados abiertos</p>
          </div>
        </div>

        {/* Explicación de la fórmula */}
        <div className="card mb-6 bg-terracotta/5 border-terracotta/20 space-y-2">
          <h2 className="text-terracotta font-semibold text-sm flex items-center gap-2">
            <Sliders size={14} />
            Fórmula de probabilidad ponderada
          </h2>
          <p className="text-cream/60 text-xs leading-relaxed">
            <strong className="text-cream/80">P_blend = (V × P_mercado + C × P_admin) / (V + C)</strong>
          </p>
          <div className="grid grid-cols-2 gap-x-4 text-xs text-cream/50">
            <p><span className="text-mustard">V</span> = Volumen de trades (sabiduría colectiva)</p>
            <p><span className="text-terracotta">C</span> = Confianza admin (peso experto)</p>
            <p className="flex items-center gap-1 mt-1">
              <TrendingUp size={10} className="text-market-yes" />
              <span>Si V {'>'} C → el mercado domina</span>
            </p>
            <p className="flex items-center gap-1 mt-1">
              <TrendingDown size={10} className="text-market-no" />
              <span>Si C {'>'} V → el admin domina</span>
            </p>
          </div>
        </div>

        {/* Tabs — row 1: main */}
        <div className="flex gap-1 bg-ink-soft rounded-xl p-1 mb-2">
          <button onClick={() => setTab('markets')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
              tab === 'markets' ? 'bg-terracotta text-cream' : 'text-cream/50 hover:text-cream'
            }`}>
            Mercados ({markets.length})
          </button>
          <button onClick={() => setTab('create')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'create' ? 'bg-terracotta text-cream' : 'text-cream/50 hover:text-cream'
            }`}>
            <Plus size={14} />
            Crear Sí/No
          </button>
          <button onClick={() => setTab('create-multi')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'create-multi' ? 'bg-mustard text-ink' : 'text-cream/50 hover:text-cream'
            }`}>
            <List size={14} />
            Multi-opción
          </button>
          <button onClick={() => setTab('tasks')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'tasks' ? 'bg-mustard text-ink' : 'text-cream/50 hover:text-cream'
            }`}>
            <Award size={14} />
            Tareas
          </button>
        </div>
        {/* Tabs — row 2: secondary */}
        <div className="flex gap-1 bg-ink-soft rounded-xl p-1 mb-6">
          <button onClick={() => setTab('inbox')}
            className={`relative flex-1 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'inbox' ? 'bg-mustard text-ink' : 'text-cream/50 hover:text-cream'
            }`}>
            <Lightbulb size={14} />
            Inbox
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-terracotta text-cream text-[10px] font-black rounded-full flex items-center justify-center">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <button onClick={() => setTab('config')}
            className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              tab === 'config' ? 'bg-cream/10 text-cream' : 'text-cream/50 hover:text-cream'
            }`}>
            <Settings size={14} />
            Config
          </button>
        </div>

        {tab === 'markets' && (
          <div className="space-y-3">
            {/* Filtro */}
            <div className="flex gap-2 mb-4">
              {(['open', 'all'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                    filter === f
                      ? 'bg-mustard/20 text-mustard border border-mustard/40'
                      : 'text-cream/40 border border-cream/10 hover:border-cream/20'
                  }`}
                >
                  {f === 'open' ? 'Abiertos' : 'Todos'}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="card text-center py-12">
                <Loader2 size={24} className="animate-spin text-terracotta mx-auto" />
              </div>
            ) : markets.length === 0 ? (
              <div className="card text-center py-12">
                <p className="text-4xl mb-3">📊</p>
                <p className="text-cream/50">No hay mercados. Crea el primero.</p>
              </div>
            ) : (
              markets.map((m) => (
                <MarketCard
                  key={m.id}
                  market={m}
                  onCancel={handleCancel}
                  onApplyProb={handleApplyProb}
                  onRefresh={loadMarkets}
                />
              ))
            )}
          </div>
        )}

        {tab === 'create' && (
          <CreateMarketForm onCreated={() => { setTab('markets'); loadMarkets(); }} />
        )}

        {tab === 'create-multi' && (
          <CreateMultiMarketForm onCreated={() => { setTab('markets'); loadMarkets(); }} />
        )}

        {tab === 'tasks' && <TasksPanel />}

        {tab === 'inbox' && <SuggestionsInbox />}

        {tab === 'config' && (
          <>
            <P2POraclePanel />
            <CasinoConfigPanel />
          </>
        )}
      </main>
    </div>
  );
}

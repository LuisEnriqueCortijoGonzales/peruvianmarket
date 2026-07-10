'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import { Loader2, Search, Save, Trash2, ArrowLeft, CheckCircle, AlertCircle } from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface SpeciesLite { id: string; name: string; types: string[]; num: number }
interface DexMove { id: string; name: string; type: string; power: number; category: string }
interface SlotData { species: string; ability: string; item: string; moves: string[] }

const EMPTY_SLOT: SlotData = { species: '', ability: '', item: '', moves: [] };

const ITEMS = [
  '', 'Leftovers', 'Choice Band', 'Choice Scarf', 'Choice Specs', 'Life Orb',
  'Focus Sash', 'Assault Vest', 'Heavy-Duty Boots', 'Rocky Helmet', 'Sitrus Berry',
  'Expert Belt', 'Eviolite', 'Black Sludge', 'Air Balloon', 'Scope Lens',
  'Light Clay', 'Weakness Policy', 'Booster Energy', 'Covert Cloak',
];

const TYPE_COLOR: Record<string, string> = {
  Normal: '#A8A77A', Fire: '#EE8130', Water: '#6390F0', Electric: '#F7D02C',
  Grass: '#7AC74C', Ice: '#96D9D6', Fighting: '#C22E28', Poison: '#A33EA1',
  Ground: '#E2BF65', Flying: '#A98FF3', Psychic: '#F95587', Bug: '#A6B91A',
  Rock: '#B6A136', Ghost: '#735797', Dragon: '#6F35FC', Dark: '#705746',
  Steel: '#B7B7CE', Fairy: '#D685AD',
};

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const spriteUrl = (species: string) =>
  `https://play.pokemonshowdown.com/sprites/gen5/${toID(species)}.png`;

// ── Página ────────────────────────────────────────────────────────────────────
export default function TeamBuilderPage() {
  const [slots, setSlots] = useState<SlotData[]>(Array(6).fill(EMPTY_SLOT));
  const [editing, setEditing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/pokemon/teams').then(r => r.json()).then(d => {
      if (d.success && d.data?.slots) {
        const loaded = d.data.slots as SlotData[];
        setSlots([...loaded, ...Array(Math.max(0, 6 - loaded.length)).fill(EMPTY_SLOT)].slice(0, 6));
      }
    }).finally(() => setLoading(false));
  }, []);

  const complete = slots.filter(s => s.species && s.moves.filter(Boolean).length >= 1).length;

  async function saveTeam() {
    setSaving(true); setMsg(null);
    const r = await fetch('/api/pokemon/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slots }),
    });
    const d = await r.json();
    setMsg(d.success ? { ok: true, text: '¡Equipo guardado! Ya puedes jugar Equipos 1v1' } : { ok: false, text: d.error });
    setSaving(false);
  }

  function updateSlot(i: number, data: SlotData) {
    setSlots(prev => prev.map((s, j) => j === i ? data : s));
  }
  function clearSlot(i: number) {
    updateSlot(i, EMPTY_SLOT);
    if (editing === i) setEditing(null);
  }

  if (loading) return (
    <div className="min-h-screen bg-ink"><Navigation />
      <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-cream/30" /></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-3 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/casino/pokemon" className="text-xs text-cream/40 hover:text-cream flex items-center gap-1 mb-1">
              <ArrowLeft size={11} /> Volver a batallas
            </Link>
            <h1 className="text-2xl font-bold text-cream">🛠️ Team Builder</h1>
            <p className="text-cream/40 text-xs mt-0.5">Arma tu equipo de 6 para el modo Equipos 1v1</p>
          </div>
          <button onClick={saveTeam} disabled={saving || complete < 6}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Guardar
          </button>
        </div>

        {msg && (
          <p className={`text-sm flex items-center gap-1.5 ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {msg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />} {msg.text}
          </p>
        )}
        <p className="text-xs text-cream/30">{complete}/6 slots completos (cada uno necesita especie + al menos 1 movimiento)</p>

        {/* Slots */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {slots.map((s, i) => (
            <button key={i} onClick={() => setEditing(editing === i ? null : i)}
              className={`relative aspect-square rounded-xl border transition-all ${
                editing === i ? 'border-terracotta bg-terracotta/10'
                : s.species ? 'border-emerald-500/30 bg-ink-soft'
                : 'border-dashed border-cream/15 bg-ink hover:border-cream/30'
              }`}>
              {s.species ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={spriteUrl(s.species)} alt={s.species} className="w-full h-full object-contain p-1"
                    style={{ imageRendering: 'pixelated' }}
                    onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                  <span className="absolute bottom-0.5 left-0 right-0 text-[8px] text-cream/60 truncate px-1">{s.species}</span>
                </>
              ) : (
                <span className="text-cream/20 text-2xl">+</span>
              )}
            </button>
          ))}
        </div>

        {/* Editor del slot */}
        {editing !== null && (
          <SlotEditor
            key={editing}
            slot={slots[editing]}
            index={editing}
            onChange={(d) => updateSlot(editing, d)}
            onClear={() => clearSlot(editing)}
          />
        )}
      </main>
    </div>
  );
}

// ── Editor de un slot ─────────────────────────────────────────────────────────
function SlotEditor({ slot, index, onChange, onClear }: {
  slot: SlotData; index: number; onChange: (d: SlotData) => void; onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SpeciesLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [detail, setDetail] = useState<{ abilities: string[]; moves: DexMove[]; types: string[] } | null>(null);
  const [moveFilter, setMoveFilter] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDetail = useCallback(async (species: string) => {
    const r = await fetch(`/api/pokemon/dex?species=${encodeURIComponent(toID(species))}`);
    const d = await r.json();
    if (d.success) setDetail(d.data);
  }, []);

  useEffect(() => {
    if (slot.species) loadDetail(slot.species);
  }, [slot.species, loadDetail]);

  function search(q: string) {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      const r = await fetch(`/api/pokemon/dex?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (d.success) setResults(d.data);
      setSearching(false);
    }, 300);
  }

  function pickSpecies(s: SpeciesLite) {
    onChange({ species: s.name, ability: '', item: '', moves: [] });
    setQuery(''); setResults([]); setDetail(null); setMoveFilter('');
  }

  function toggleMove(name: string) {
    const has = slot.moves.includes(name);
    if (has) onChange({ ...slot, moves: slot.moves.filter(m => m !== name) });
    else if (slot.moves.length < 4) onChange({ ...slot, moves: [...slot.moves, name] });
  }

  const filteredMoves = (detail?.moves ?? [])
    .filter(m => !moveFilter || m.name.toLowerCase().includes(moveFilter.toLowerCase()))
    .slice(0, 40);

  return (
    <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-cream font-semibold text-sm">Slot {index + 1}{slot.species && ` — ${slot.species}`}</h3>
        {slot.species && (
          <button onClick={onClear} className="text-red-400/60 hover:text-red-400 transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Búsqueda de especie */}
      {!slot.species && (
        <div className="space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/30" />
            <input value={query} onChange={e => search(e.target.value)} placeholder="Buscar Pokémon… (ej. Garchomp)"
              className="w-full bg-ink border border-cream/10 rounded-lg pl-9 pr-3 py-2 text-sm text-cream placeholder:text-cream/25 focus:outline-none focus:border-terracotta/50" />
          </div>
          {searching && <Loader2 size={14} className="animate-spin text-cream/30 mx-auto" />}
          <div className="grid grid-cols-2 gap-1.5">
            {results.map(s => (
              <button key={s.id} onClick={() => pickSpecies(s)}
                className="flex items-center gap-2 rounded-lg border border-cream/10 bg-ink px-2 py-1.5 hover:border-emerald-400/40 transition-all text-left">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={spriteUrl(s.name)} alt="" className="w-8 h-8 object-contain" style={{ imageRendering: 'pixelated' }}
                  onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                <div className="min-w-0">
                  <p className="text-cream/80 text-xs font-semibold truncate">{s.name}</p>
                  <div className="flex gap-1">
                    {s.types.map(t => (
                      <span key={t} className="text-[8px] px-1 rounded font-bold text-white" style={{ backgroundColor: TYPE_COLOR[t] ?? '#666' }}>{t}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Config del Pokémon elegido */}
      {slot.species && detail && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Habilidad</label>
              <select value={slot.ability} onChange={e => onChange({ ...slot, ability: e.target.value })}
                className="w-full bg-ink border border-cream/10 rounded-lg px-2 py-1.5 text-sm text-cream focus:outline-none">
                <option value="">(cualquiera)</option>
                {detail.abilities.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Objeto</label>
              <select value={slot.item} onChange={e => onChange({ ...slot, item: e.target.value })}
                className="w-full bg-ink border border-cream/10 rounded-lg px-2 py-1.5 text-sm text-cream focus:outline-none">
                {ITEMS.map(it => <option key={it} value={it}>{it || '(sin objeto)'}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-cream/30 uppercase tracking-wider">
                Movimientos ({slot.moves.length}/4) — del learnset legal
              </label>
              <input value={moveFilter} onChange={e => setMoveFilter(e.target.value)} placeholder="filtrar…"
                className="w-24 bg-ink border border-cream/10 rounded px-2 py-0.5 text-[11px] text-cream placeholder:text-cream/20 focus:outline-none" />
            </div>
            {slot.moves.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-2">
                {slot.moves.map(m => (
                  <button key={m} onClick={() => toggleMove(m)}
                    className="px-2 py-1 rounded-lg text-[11px] font-bold bg-terracotta/25 border border-terracotta/50 text-cream hover:bg-red-500/20">
                    {m} ×
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-44 overflow-y-auto rounded-lg border border-cream/5 divide-y divide-cream/5">
              {filteredMoves.map(m => {
                const selected = slot.moves.includes(m.name);
                return (
                  <button key={m.id} onClick={() => toggleMove(m.name)}
                    disabled={!selected && slot.moves.length >= 4}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 text-xs transition-colors ${
                      selected ? 'bg-terracotta/15 text-cream' : 'text-cream/60 hover:bg-cream/5 disabled:opacity-30'
                    }`}>
                    <span className="flex items-center gap-2">
                      <span className="text-[8px] px-1 rounded font-bold text-white w-12 text-center" style={{ backgroundColor: TYPE_COLOR[m.type] ?? '#666' }}>{m.type}</span>
                      {m.name}
                    </span>
                    <span className="font-mono text-[10px] text-cream/30">{m.category === 'Status' ? '—' : m.power || '?'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      {slot.species && !detail && <Loader2 size={16} className="animate-spin text-cream/30 mx-auto" />}
    </div>
  );
}

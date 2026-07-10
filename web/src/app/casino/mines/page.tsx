'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { getMultiplier, nextMultiplier, MINES_N, MINES_OPTIONS, type MinesOption } from '@/lib/mines';
import { Loader2 } from 'lucide-react';

// ── Cell ──────────────────────────────────────────────────────────────────────
type CellState = 'hidden' | 'safe' | 'mine_hit' | 'mine_other';

function Cell({ state, onClick, disabled }: {
  state: CellState;
  onClick: () => void;
  disabled: boolean;
}) {
  const styles: Record<CellState, string> = {
    hidden:     'bg-ink-soft border-cream/10 hover:border-mustard/60 hover:bg-mustard/5 active:scale-95',
    safe:       'bg-market-yes/15 border-market-yes/60 shadow-market-yes/20 shadow-lg cursor-default scale-105',
    mine_hit:   'bg-red-500/25 border-red-500 shadow-red-500/40 shadow-lg scale-110 z-10',
    mine_other: 'bg-red-900/20 border-red-900/30 cursor-default opacity-60',
  };
  const emoji: Record<CellState, string> = {
    hidden:     '',
    safe:       '💎',
    mine_hit:   '💣',
    mine_other: '💣',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || state !== 'hidden'}
      className={`
        relative flex items-center justify-center rounded-xl border-2 text-xl
        transition-all duration-200 select-none
        w-[50px] h-[50px] sm:w-[58px] sm:h-[58px]
        disabled:cursor-not-allowed
        ${styles[state]}
      `}
    >
      {emoji[state] ? (
        <span>{emoji[state]}</span>
      ) : (
        <span className="w-full h-full rounded-lg bg-cream/5" />
      )}
    </button>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'active' | 'acting' | 'done';

interface GameState {
  gameId: string;
  bet: number;
  minesCount: number;
  houseEdge: number;
  revealedSafe: number[];
  minePositions: number[] | null;
  hitMine: boolean;
  payout: number;
  netChange: number;
}

const BET_CHIPS = [5, 25, 100, 500, 2000, 10000];

// Preview: first-pick multiplier per mine count
const PREVIEW_PICKS = [1, 3, 5] as const;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MinesPage() {
  const { balance, refresh } = useWallet();

  const [phase, setPhase]   = useState<Phase>('idle');
  const [bet, setBet]       = useState(25);
  const [mines, setMines]   = useState<MinesOption>(3);
  const [game, setGame]     = useState<GameState | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // Resume active game on mount
  useEffect(() => {
    fetch('/api/casino/mines/start')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setGame({
            gameId: d.data.id,
            bet: d.data.bet,
            minesCount: d.data.mines_count,
            houseEdge: d.data.house_edge,
            revealedSafe: d.data.revealed_safe,
            minePositions: null,
            hitMine: false,
            payout: 0,
            netChange: 0,
          });
          setPhase('active');
        }
      }).catch(() => {});
  }, []);

  // Build cell states
  function cellStates(): CellState[] {
    return Array.from({ length: MINES_N }, (_, i) => {
      if (!game) return 'hidden';
      if (game.revealedSafe.includes(i)) return 'safe';
      if (game.minePositions) {
        if (game.minePositions.includes(i) && game.hitMine && !game.revealedSafe.includes(i)) return 'mine_hit';
        if (game.minePositions.includes(i)) return 'mine_other';
      }
      return 'hidden';
    });
  }

  const curMult   = game ? getMultiplier(game.minesCount, game.revealedSafe.length, game.houseEdge) : 1;
  const nextMult  = game ? nextMultiplier(game.minesCount, game.revealedSafe.length, game.houseEdge) : getMultiplier(mines, 1);
  const potential = game ? Math.round(game.bet * curMult * 100) / 100 : 0;

  async function startGame() {
    setError(null);
    setPhase('acting');
    const r = await fetch('/api/casino/mines/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet, mines }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('idle'); return; }
    setGame({
      gameId: d.data.game_id,
      bet: d.data.bet,
      minesCount: d.data.mines_count,
      houseEdge: d.data.house_edge,
      revealedSafe: [],
      minePositions: null,
      hitMine: false,
      payout: 0,
      netChange: 0,
    });
    setPhase('active');
    refresh();
  }

  const pick = useCallback(async (cell: number) => {
    if (!game || phase !== 'active') return;
    setPhase('acting');
    const r = await fetch('/api/casino/mines/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: game.gameId, cell }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('active'); return; }

    if (d.data.is_mine) {
      setGame(prev => prev ? {
        ...prev,
        minePositions: d.data.mine_positions,
        hitMine: true,
        netChange: d.data.net_change,
      } : null);
      setPhase('done');
      refresh();
      return;
    }

    setGame(prev => prev ? {
      ...prev,
      revealedSafe: d.data.revealed_safe,
      ...(d.data.auto_cashout ? {
        minePositions: d.data.mine_positions,
        payout: d.data.payout,
        netChange: d.data.net_change,
      } : {}),
    } : null);
    setPhase(d.data.auto_cashout ? 'done' : 'active');
    if (d.data.auto_cashout) refresh();
  }, [game, phase, refresh]);

  async function cashout() {
    if (!game || phase !== 'active' || game.revealedSafe.length === 0) return;
    setPhase('acting');
    const r = await fetch('/api/casino/mines/cashout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: game.gameId }),
    });
    const d = await r.json();
    if (!d.success) { setError(d.error); setPhase('active'); return; }
    setGame(prev => prev ? {
      ...prev,
      minePositions: d.data.mine_positions,
      payout: d.data.payout,
      netChange: d.data.net_change,
    } : null);
    setPhase('done');
    refresh();
  }

  function reset() { setGame(null); setPhase('idle'); setError(null); }

  const cells = cellStates();

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-xl mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">💣 Minas</h1>
            <p className="text-cream/40 text-xs mt-0.5">Revela diamantes · evita las bombas · cobra cuando quieras</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
        </div>

        {/* Stats strip */}
        {game && (phase === 'active' || phase === 'acting' || phase === 'done') && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-ink-soft border border-cream/10 p-3 text-center">
              <p className="text-[10px] text-cream/30 uppercase tracking-wider">Multiplicador</p>
              <p className="text-lg font-black text-mustard">{curMult.toFixed(2)}×</p>
            </div>
            <div className="rounded-xl bg-ink-soft border border-cream/10 p-3 text-center">
              <p className="text-[10px] text-cream/30 uppercase tracking-wider">Cobrar ahora</p>
              <p className={`text-lg font-black ${game.revealedSafe.length > 0 ? 'text-market-yes' : 'text-cream/20'}`}>
                {game.revealedSafe.length > 0 ? potential.toFixed(2) : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-ink-soft border border-cream/10 p-3 text-center">
              <p className="text-[10px] text-cream/30 uppercase tracking-wider">Siguiente</p>
              <p className="text-lg font-black text-cream/50">{nextMult.toFixed(2)}×</p>
            </div>
          </div>
        )}

        {/* 5×5 Grid */}
        <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4">
          <div className="grid grid-cols-5 gap-1.5 justify-items-center">
            {cells.map((state, i) => (
              <Cell
                key={i}
                state={state}
                onClick={() => pick(i)}
                disabled={phase !== 'active'}
              />
            ))}
          </div>

          {/* Info row */}
          {game && (phase === 'active' || phase === 'acting') && (
            <div className="flex items-center justify-between text-xs text-cream/30 mt-3 px-1">
              <span>💣 {game.minesCount} {game.minesCount === 1 ? 'mina' : 'minas'}</span>
              <span>💎 {game.revealedSafe.length} revelados</span>
              <span>🔲 {MINES_N - game.minesCount - game.revealedSafe.length} seguros restantes</span>
            </div>
          )}

          {/* Game-over result */}
          {phase === 'done' && game && (
            <div className={`mt-4 rounded-xl p-4 text-center border ${
              game.hitMine
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-market-yes/10 border-market-yes/30'
            }`}>
              <p className={`text-xl font-black ${game.hitMine ? 'text-red-400' : 'text-market-yes'}`}>
                {game.hitMine ? '💣 ¡Boom! Pisaste una mina' : '💰 ¡Cobraste a tiempo!'}
              </p>
              <p className={`text-2xl font-bold font-mono mt-1 ${game.netChange >= 0 ? 'text-market-yes' : 'text-red-400'}`}>
                {game.netChange >= 0 ? '+' : ''}{game.netChange.toFixed(2)} CHC
              </p>
              {!game.hitMine && game.payout > 0 && (
                <p className="text-xs text-cream/30 mt-0.5">
                  {game.bet.toFixed(2)} × {curMult.toFixed(2)}× = {game.payout.toFixed(2)} CHC
                </p>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Cashout button */}
        {(phase === 'active' || phase === 'acting') && game && (
          <button
            onClick={cashout}
            disabled={phase === 'acting' || game.revealedSafe.length === 0}
            className="w-full py-4 rounded-xl font-bold text-lg bg-market-yes hover:bg-market-yes/80 text-ink transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-market-yes/20"
          >
            {phase === 'acting'
              ? <><Loader2 size={20} className="animate-spin" /> Procesando...</>
              : game.revealedSafe.length === 0
              ? '🔲 Revela una celda primero'
              : `💰 COBRAR — ${potential.toFixed(2)} CHC`
            }
          </button>
        )}

        {/* New game */}
        {phase === 'done' && (
          <button onClick={reset}
            className="w-full py-3 rounded-xl font-bold bg-ink-soft hover:bg-ink-muted border border-cream/10 text-cream transition-all active:scale-95">
            ↩ Nueva partida
          </button>
        )}

        {/* Setup — idle */}
        {phase === 'idle' && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-4">

            {/* Mine selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-cream/40">Número de minas</p>
                <p className="text-xs text-mustard font-bold">
                  {mines} 💣 · {MINES_N - mines} 💎 seguros
                </p>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {MINES_OPTIONS.map(m => (
                  <button key={m} onClick={() => setMines(m)}
                    className={`py-1.5 rounded-lg text-sm font-bold border transition-all ${
                      mines === m
                        ? 'bg-terracotta border-terracotta text-cream'
                        : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Multiplier preview table */}
              <div className="rounded-xl bg-ink border border-cream/5 p-3">
                <p className="text-[10px] text-cream/20 uppercase tracking-wider mb-2">Multiplicadores con {mines} minas</p>
                <div className="flex items-center justify-between">
                  {PREVIEW_PICKS.map(k => {
                    const safeCells = MINES_N - mines;
                    if (k > safeCells) return null;
                    const m = getMultiplier(mines, k);
                    return (
                      <div key={k} className="text-center">
                        <p className="text-[10px] text-cream/30">{k} reveal{k > 1 ? 's' : ''}</p>
                        <p className="text-sm font-black text-mustard">{m.toFixed(2)}×</p>
                        <p className="text-[9px] text-cream/20">~{(m * bet).toFixed(0)} CHC</p>
                      </div>
                    );
                  })}
                  {/* Max payout (all safe) */}
                  {(() => {
                    const safeCells = MINES_N - mines;
                    const maxMult = getMultiplier(mines, safeCells);
                    return (
                      <div className="text-center">
                        <p className="text-[10px] text-cream/30">Max ({safeCells})</p>
                        <p className="text-sm font-black text-terracotta">
                          {maxMult > 9999 ? '∞' : `${maxMult.toFixed(1)}×`}
                        </p>
                        <p className="text-[9px] text-cream/20">
                          {maxMult > 9999 ? '—' : `~${(maxMult * bet).toFixed(0)} CHC`}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Bet selector */}
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Apuesta</p>
              <div className="flex gap-1.5 flex-wrap">
                {BET_CHIPS.map(c => (
                  <button key={c} onClick={() => setBet(c)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all ${
                      bet === c
                        ? 'bg-terracotta border-terracotta text-cream'
                        : 'bg-ink border-cream/10 text-cream/60 hover:border-cream/30'
                    }`}>
                    {c >= 1000 ? `${c / 1000}K` : c}
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

            <button onClick={startGame} disabled={!balance || balance < bet}
              className="w-full py-4 rounded-xl font-bold text-lg bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-terracotta/20">
              💣 JUGAR — {bet.toLocaleString()} CHC
            </button>
          </div>
        )}

        {/* Rules */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/30 space-y-1">
          <p className="font-semibold text-cream/20 uppercase tracking-wider">Cómo jugar</p>
          <p>Elige cuántas minas esconder entre 25 celdas. Haz clic para revelar diamantes 💎. Más minas = mayor multiplicador por reveal, pero más riesgo. Cobra antes de pisar una bomba.</p>
          <p className="text-cream/15">Ventaja de casa ≈ 5% · fórmula hipergeométrica</p>
        </div>

      </main>
    </div>
  );
}

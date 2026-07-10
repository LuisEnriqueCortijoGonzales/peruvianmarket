'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import CustomBetInput from '@/components/CustomBetInput';
import { useWallet } from '@/lib/wallet-context';
import { handTotal, resultLabel } from '@/lib/blackjack';
import { Loader2 } from 'lucide-react';

// ── Card component ────────────────────────────────────────────────────────────
const SUIT_CHAR: Record<string, string> = { h: '♥', d: '♦', c: '♣', s: '♠' };

function Card({ card, hidden = false, small = false }: { card: string; hidden?: boolean; small?: boolean }) {
  const sz = small ? 'w-12 h-[68px] text-[10px]' : 'w-16 h-[90px] text-sm';
  if (hidden) return (
    <div className={`${sz} rounded-lg border-2 border-blue-900/60 bg-gradient-to-br from-blue-900 to-indigo-900 flex items-center justify-center shadow-xl`}>
      <span className="text-2xl opacity-60">🂠</span>
    </div>
  );
  const rank = card[0], suit = card[1];
  const isRed = suit === 'h' || suit === 'd';
  const displayRank = rank === 'T' ? '10' : rank;
  return (
    <div className={`${sz} rounded-lg border-2 border-gray-200 bg-white flex flex-col p-1 shadow-xl select-none ${isRed ? 'text-red-600' : 'text-gray-900'}`}>
      <div className="font-black leading-none">{displayRank}</div>
      <div className="text-[10px] leading-none">{SUIT_CHAR[suit]}</div>
      <div className="flex-1 flex items-center justify-center text-xl">{SUIT_CHAR[suit]}</div>
    </div>
  );
}

function HandDisplay({ cards, hidden = false, label, total }: { cards: string[]; hidden?: boolean; label: string; total?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-cream/40 font-semibold uppercase tracking-wider">{label}</span>
        {total !== undefined && (
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            total > 21 ? 'bg-red-500/20 text-red-400' : total === 21 ? 'bg-yellow-400/20 text-yellow-300' : 'bg-ink text-cream/60'
          }`}>
            {total > 21 ? `${total} — Bust` : total}
          </span>
        )}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {cards.map((c, i) => <Card key={i} card={c} hidden={hidden && i > 0} />)}
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type BJPhase = 'idle' | 'dealing' | 'player_turn' | 'acting' | 'done';

interface GameState {
  gameId: string;
  playerHand: string[];
  dealerVisible: string[];
  dealerHand: string[] | null;
  bet: number;
  doubled: boolean;
  result: string | null;
  payout: number;
}

const BET_CHIPS = [5, 25, 100, 500, 1000, 5000, 25000];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BlackjackPage() {
  const { balance, refresh } = useWallet();

  const [phase, setPhase]   = useState<BJPhase>('idle');
  const [bet, setBet]       = useState(25);
  const [game, setGame]     = useState<GameState | null>(null);
  const [error, setError]   = useState<string | null>(null);

  // Resume active game on load
  useEffect(() => {
    fetch('/api/casino/blackjack/deal')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          const g = d.data;
          setGame({
            gameId: g.id, playerHand: g.player_hand,
            dealerVisible: [g.dealer_hand[0]], dealerHand: null,
            bet: g.bet, doubled: g.doubled, result: null, payout: 0,
          });
          setPhase('player_turn');
        }
      })
      .catch(() => {});
  }, []);

  const playerTotal = game ? handTotal(game.playerHand) : 0;
  const dealerTotal = game?.dealerHand ? handTotal(game.dealerHand) : null;
  const canDouble   = phase === 'player_turn' && game?.playerHand.length === 2 && !game.doubled && (balance ?? 0) >= (game?.bet ?? 0);

  async function apiPost(path: string, body?: object) {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.json();
  }

  const deal = useCallback(async () => {
    setError(null);
    setPhase('dealing');
    const d = await apiPost('/api/casino/blackjack/deal', { bet });
    if (!d.success) { setError(d.error); setPhase('idle'); return; }
    const g = d.data;
    setGame({
      gameId: g.game_id, playerHand: g.player_hand,
      dealerVisible: g.dealer_visible, dealerHand: g.dealer_hand,
      bet: g.bet, doubled: false, result: g.result, payout: g.payout ?? 0,
    });
    setPhase(g.status === 'done' ? 'done' : 'player_turn');
    if (g.status === 'done') refresh();
  }, [bet, refresh]);

  const hit = useCallback(async () => {
    if (!game || phase !== 'player_turn') return;
    setPhase('acting');
    const d = await apiPost('/api/casino/blackjack/hit', { game_id: game.gameId });
    if (!d.success) { setError(d.error); setPhase('player_turn'); return; }
    setGame(prev => prev ? { ...prev, playerHand: d.data.player_hand, dealerHand: d.data.dealer_hand, result: d.data.result, payout: d.data.payout } : null);
    setPhase(d.data.status === 'done' ? 'done' : 'player_turn');
    if (d.data.status === 'done') refresh();
  }, [game, phase, refresh]);

  const stand = useCallback(async () => {
    if (!game || phase !== 'player_turn') return;
    setPhase('acting');
    const d = await apiPost('/api/casino/blackjack/stand', { game_id: game.gameId });
    if (!d.success) { setError(d.error); setPhase('player_turn'); return; }
    setGame(prev => prev ? { ...prev, dealerHand: d.data.dealer_hand, result: d.data.result, payout: d.data.payout } : null);
    setPhase('done');
    refresh();
  }, [game, phase, refresh]);

  const double = useCallback(async () => {
    if (!game || !canDouble) return;
    setPhase('acting');
    const d = await apiPost('/api/casino/blackjack/double', { game_id: game.gameId });
    if (!d.success) { setError(d.error); setPhase('player_turn'); return; }
    setGame(prev => prev ? { ...prev, playerHand: d.data.player_hand, dealerHand: d.data.dealer_hand, doubled: true, result: d.data.result, payout: d.data.payout } : null);
    setPhase('done');
    refresh();
  }, [game, canDouble, refresh]);

  function reset() { setGame(null); setPhase('idle'); setError(null); }

  const netChange = game && phase === 'done'
    ? game.payout - game.bet * (game.doubled ? 2 : 1)
    : null;

  const resultText = game?.result ? resultLabel(game.result as Parameters<typeof resultLabel>[0]) : null;

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-lg mx-auto px-3 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream">♠ Blackjack</h1>
            <p className="text-cream/40 text-xs mt-0.5">21 · Dealer planta en 17 · BJ paga 3:2</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-cream/40">Balance</p>
            <p className="text-mustard font-bold font-mono">{balance?.toFixed(2) ?? '—'} CHC</p>
          </div>
        </div>

        {/* Game table */}
        <div className="rounded-2xl border border-cream/10 bg-gradient-to-b from-emerald-950/60 to-ink-soft p-5 space-y-5 min-h-[320px]">

          {/* Dealer area */}
          <div className="space-y-2">
            {phase === 'idle' || phase === 'dealing' ? (
              <div className="flex items-center gap-2 h-[96px]">
                {phase === 'dealing' ? (
                  <Loader2 size={24} className="animate-spin text-cream/30" />
                ) : (
                  <span className="text-cream/15 text-sm">Esperando nueva ronda...</span>
                )}
              </div>
            ) : game ? (
              <HandDisplay
                cards={phase === 'done' ? (game.dealerHand ?? game.dealerVisible) : game.dealerVisible}
                hidden={phase !== 'done' && (game.dealerHand === null)}
                label="Dealer"
                total={phase === 'done' && game.dealerHand ? dealerTotal ?? undefined : undefined}
              />
            ) : null}
          </div>

          {/* Divider */}
          <div className="border-t border-cream/5" />

          {/* Player area */}
          {game && (
            <div className="space-y-2">
              <HandDisplay
                cards={game.playerHand}
                label={`Tu mano${game.doubled ? ' (doblada)' : ''}`}
                total={playerTotal}
              />
            </div>
          )}

          {/* Result overlay */}
          {phase === 'done' && game && resultText && (
            <div className={`rounded-xl p-4 text-center animate-fade-in border ${
              game.result === 'player_bj' ? 'bg-yellow-500/15 border-yellow-400/40' :
              game.result === 'player_win' ? 'bg-market-yes/15 border-market-yes/30' :
              game.result === 'push' ? 'bg-cream/5 border-cream/15' :
              'bg-market-no/15 border-market-no/30'
            }`}>
              <p className={`font-black text-xl ${
                game.result?.includes('player') && game.result !== 'player_bj' ? 'text-market-yes' :
                game.result === 'player_bj' ? 'text-yellow-300' :
                game.result === 'push' ? 'text-cream' : 'text-market-no'
              }`}>{resultText}</p>
              {netChange !== null && (
                <p className={`text-lg font-bold font-mono mt-1 ${netChange >= 0 ? 'text-market-yes' : 'text-market-no'}`}>
                  {netChange >= 0 ? '+' : ''}{netChange.toFixed(2)} CHC
                </p>
              )}
              {game.doubled && <p className="text-xs text-cream/30 mt-0.5">Apuesta doblada × {(game.bet * 2).toFixed(2)} CHC</p>}
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {/* Action buttons — during player's turn */}
        {phase === 'player_turn' && (
          <div className="grid grid-cols-3 gap-2">
            <button onClick={hit}
              className="py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all active:scale-95 shadow-lg">
              +1 HIT
            </button>
            <button onClick={stand}
              className="py-3 rounded-xl font-bold bg-terracotta hover:bg-terracotta-light text-cream transition-all active:scale-95 shadow-lg">
              STAND ✋
            </button>
            <button onClick={double} disabled={!canDouble}
              className="py-3 rounded-xl font-bold bg-yellow-600 hover:bg-yellow-500 text-white transition-all active:scale-95 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed">
              ×2 DBL
            </button>
          </div>
        )}
        {phase === 'acting' && (
          <div className="flex items-center justify-center py-3">
            <Loader2 size={24} className="animate-spin text-cream/40" />
          </div>
        )}

        {/* Bet controls — idle / done */}
        {(phase === 'idle' || phase === 'done') && (
          <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
            <div className="space-y-2">
              <p className="text-xs text-cream/40">Apuesta</p>
              <div className="flex flex-wrap gap-1.5">
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
            <button
              onClick={phase === 'done' ? reset : deal}
              disabled={!balance || balance < bet}
              className="w-full py-4 rounded-xl font-bold text-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 bg-terracotta hover:bg-terracotta-light text-cream shadow-lg shadow-terracotta/30">
              {phase === 'done' ? (
                '↩ Nueva mano'
              ) : (
                `♠ REPARTIR — ${bet.toLocaleString()} CHC`
              )}
            </button>
          </div>
        )}

        {/* Rules */}
        <div className="rounded-xl border border-cream/10 bg-ink-soft p-3 text-xs text-cream/30 space-y-1">
          <p className="font-semibold text-cream/20 uppercase tracking-wider">Reglas</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Blackjack (21 en 2 cartas)</span><span className="text-right font-mono">3:2</span>
            <span>Victoria normal</span><span className="text-right font-mono">1:1</span>
            <span>Empate</span><span className="text-right font-mono">devuelve apuesta</span>
            <span>Doblar (2 cartas)</span><span className="text-right font-mono">× apuesta</span>
          </div>
          <p className="text-cream/15 pt-1">Dealer planta en 17. Mazo continuo (infinite shoe). Ventaja de casa ≈ 0.5%.</p>
        </div>

      </main>
    </div>
  );
}

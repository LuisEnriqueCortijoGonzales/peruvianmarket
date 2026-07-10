'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { Loader2, Activity, ShieldCheck, ShieldAlert } from 'lucide-react';

interface ChainTx {
  id: string;
  type: string;
  from_address: string | null;
  to_address: string | null;
  amount: number | null;
  market_id: string | null;
  created_at: string;
  status: string;
}

interface Block {
  number: number;
  hash: string;
  timestamp: string | null;
  tx_count: number;
  transactions: ChainTx[];
}

interface ChainStats {
  total_transactions: number;
  total_wallets: number;
  total_volume: number;
  latest_block: number;
}

const TX_STYLE: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  MINE:          { icon: '⛏️', label: 'MINE',    color: 'text-yellow-400',  bg: 'bg-yellow-400/10 border-yellow-400/20' },
  BUY:           { icon: '📈', label: 'BUY',     color: 'text-blue-400',    bg: 'bg-blue-400/10 border-blue-400/20' },
  SELL:          { icon: '📉', label: 'SELL',    color: 'text-purple-400',  bg: 'bg-purple-400/10 border-purple-400/20' },
  FAUCET:        { icon: '💧', label: 'FAUCET',  color: 'text-cyan-400',    bg: 'bg-cyan-400/10 border-cyan-400/20' },
  TRANSFER:      { icon: '↔️', label: 'XFER',    color: 'text-cream/60',    bg: 'bg-cream/5 border-cream/10' },
  RESOLVE:       { icon: '⚖️', label: 'RESOLVE', color: 'text-orange-400',  bg: 'bg-orange-400/10 border-orange-400/20' },
  CLAIM:         { icon: '🏆', label: 'CLAIM',   color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/20' },
  CREATE_MARKET: { icon: '🏛️', label: 'CREATE',  color: 'text-terracotta',  bg: 'bg-terracotta/10 border-terracotta/20' },
};

const FALLBACK_TX = { icon: '⚡', label: 'TX', color: 'text-cream/50', bg: 'bg-cream/5 border-cream/10' };

function addr(a: string | null) {
  if (!a) return '—';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ago(ts: string) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 5)    return 'ahora';
  if (s < 60)   return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function BlockCard({ block, fresh }: { block: Block; fresh: boolean }) {
  return (
    <div className={`shrink-0 w-44 rounded-2xl border p-3.5 space-y-2.5 transition-all duration-500
      ${fresh
        ? 'border-emerald-500/60 bg-emerald-500/5 shadow-xl shadow-emerald-500/10'
        : 'border-cream/10 bg-ink-soft'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-bold font-mono ${fresh ? 'text-emerald-400' : 'text-cream/50'}`}>
          #{block.number}
        </span>
        {fresh && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
      </div>
      <p className="text-[10px] font-mono text-cream/25 truncate">{block.hash}</p>
      <div className="flex flex-wrap gap-1">
        {block.transactions.slice(0, 5).map(tx => {
          const s = TX_STYLE[tx.type] ?? FALLBACK_TX;
          return (
            <span key={tx.id} title={tx.type}
              className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${s.color} ${s.bg}`}>
              {s.icon}
            </span>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-cream/30 font-mono">
        <span>{block.tx_count} tx</span>
        {block.timestamp && <span>{ago(block.timestamp)}</span>}
      </div>
    </div>
  );
}

function TxRow({ tx, flash }: { tx: ChainTx; flash: boolean }) {
  const s = TX_STYLE[tx.type] ?? FALLBACK_TX;
  return (
    <div className={`grid grid-cols-[80px_1fr_auto_52px] gap-3 items-center py-2.5 px-4
      border-b border-cream/5 last:border-0
      ${flash ? 'animate-fade-in bg-emerald-500/5' : ''}
    `}>
      {/* Type badge */}
      <span className={`text-center text-[10px] px-1.5 py-1 rounded-lg border font-bold truncate ${s.color} ${s.bg}`}>
        {s.icon} {s.label}
      </span>

      {/* Addresses */}
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 text-xs font-mono">
          {tx.from_address && (
            <code className="text-cream/50">{addr(tx.from_address)}</code>
          )}
          {tx.to_address && tx.to_address !== tx.from_address && (
            <>
              <span className="text-cream/20 text-[10px]">→</span>
              <code className="text-cream/50">{addr(tx.to_address)}</code>
            </>
          )}
        </div>
        {tx.market_id && (
          <p className="text-cream/20 text-[10px] font-mono">mkt:{tx.market_id.slice(0, 8)}</p>
        )}
      </div>

      {/* Amount */}
      <span className={`text-sm font-bold font-mono tabular-nums ${Number(tx.amount) > 0 ? 'text-mustard' : 'text-cream/40'}`}>
        {tx.amount != null
          ? `${Number(tx.amount) > 0 ? '+' : ''}${Number(tx.amount).toFixed(2)}`
          : '—'
        }
      </span>

      {/* Time */}
      <span className="text-cream/25 text-xs text-right font-mono">{ago(tx.created_at)}</span>
    </div>
  );
}

export default function BlockchainPage() {
  const [txs, setTxs]         = useState<ChainTx[]>([]);
  const [blocks, setBlocks]   = useState<Block[]>([]);
  const [stats, setStats]     = useState<ChainStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const lastTop = useRef<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<{
    valid: boolean; blocks_checked: number; txs_checked: number;
    first_invalid: { number: number; reason: string } | null;
  } | null>(null);

  async function handleVerify() {
    setVerifying(true);
    setVerdict(null);
    try {
      const res = await fetch('/api/blockchain/verify');
      const json = await res.json();
      if (json.success) setVerdict(json.data);
    } catch { /* silent */ }
    setVerifying(false);
  }

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch('/api/blockchain');
      const json = await res.json();
      if (!json.success) return;

      const { transactions, blocks: blks, stats: st } = json.data as {
        transactions: ChainTx[];
        blocks: Block[];
        stats: ChainStats;
      };

      // Detect which ids are new since last poll
      if (lastTop.current && transactions.length > 0) {
        const cutIdx = transactions.findIndex(t => t.id === lastTop.current);
        if (cutIdx > 0) {
          const ids = new Set(transactions.slice(0, cutIdx).map(t => t.id));
          setFreshIds(ids);
          setTimeout(() => setFreshIds(new Set()), 2500);
        }
      }
      if (transactions.length > 0) lastTop.current = transactions[0].id;

      setTxs(transactions);
      setBlocks(blks);
      setStats(st);
      setLastUpdate(new Date());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-cream flex items-center gap-2.5">
              <Activity size={22} className="text-emerald-400" />
              Blockchain Explorer
            </h1>
            <p className="text-cream/40 text-sm mt-1">Red CHCoin · Peruvian Prediction Market</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-cream/30 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live</span>
            {lastUpdate && (
              <span className="font-mono">{lastUpdate.toLocaleTimeString('es-PE')}</span>
            )}
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: '⚡', value: stats.total_transactions.toLocaleString('es-PE'), label: 'Transacciones' },
              { icon: '💰', value: `${Number(stats.total_volume).toLocaleString('es-PE', { maximumFractionDigits: 1 })} CHC`, label: 'Volumen total' },
              { icon: '👛', value: stats.total_wallets.toLocaleString(), label: 'Wallets' },
              { icon: '🧱', value: `#${stats.latest_block.toLocaleString()}`, label: 'Último bloque' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-cream/10 bg-ink-soft px-4 py-3 text-center space-y-1">
                <p className="text-xl">{s.icon}</p>
                <p className="text-lg font-bold text-cream font-mono tabular-nums">{s.value}</p>
                <p className="text-xs text-cream/40">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chain visualization */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-cream/40 uppercase tracking-wider">
              Cadena de bloques
            </p>
            <div className="flex items-center gap-3">
              {verdict && (
                <span className={`flex items-center gap-1.5 text-xs font-mono ${verdict.valid ? 'text-emerald-400' : 'text-red-400'}`}>
                  {verdict.valid ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
                  {verdict.valid
                    ? `Íntegra · ${verdict.blocks_checked} bloques · ${verdict.txs_checked} tx verificadas`
                    : `Rota en bloque #${verdict.first_invalid?.number}: ${verdict.first_invalid?.reason}`}
                </span>
              )}
              <button
                onClick={handleVerify}
                disabled={verifying}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-all disabled:opacity-50"
              >
                {verifying ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={13} />}
                Verificar cadena
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-emerald-400" />
            </div>
          ) : blocks.length === 0 ? (
            <p className="text-cream/30 text-sm text-center py-6">Sin bloques aún</p>
          ) : (
            <div className="overflow-x-auto pb-3 -mx-4 px-4">
              <div className="flex items-center gap-0 min-w-max">
                {/* Genesis indicator */}
                <div className="flex flex-col items-center mr-2 text-cream/20 text-[10px] font-mono">
                  <div className="w-8 h-0.5 bg-gradient-to-r from-transparent to-emerald-500/30" />
                  <span className="mt-1">GEN</span>
                </div>

                {/* Blocks — reversed so newest is on the right */}
                {[...blocks].reverse().map((block, i, arr) => {
                  const isLatest = i === arr.length - 1;
                  return (
                    <div key={block.number} className="flex items-center">
                      {/* Chain link */}
                      <div className="flex flex-col items-center w-8">
                        <div className={`w-full h-0.5 ${isLatest ? 'bg-emerald-500/60' : 'bg-cream/10'}`} />
                        <div className={`w-1.5 h-1.5 rounded-full mt-px ${isLatest ? 'bg-emerald-400 animate-pulse' : 'bg-cream/10'}`} />
                      </div>
                      <BlockCard block={block} fresh={isLatest} />
                    </div>
                  );
                })}

                {/* Pending block indicator */}
                <div className="flex items-center ml-0">
                  <div className="flex flex-col items-center w-8">
                    <div className="w-full h-0.5 bg-emerald-500/30 animate-pulse" />
                  </div>
                  <div className="w-44 h-[120px] rounded-2xl border-2 border-dashed border-emerald-500/20 flex flex-col items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400/40 animate-pulse" />
                    <p className="text-emerald-400/40 text-[10px] font-mono">próximo bloque</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Transaction feed */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-cream/40 uppercase tracking-wider flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Transacciones recientes
            </p>
            <span className="text-cream/25 text-xs font-mono">{txs.length} entradas</span>
          </div>

          <div className="rounded-2xl border border-cream/10 bg-ink-soft overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[80px_1fr_auto_52px] gap-3 px-4 py-2 border-b border-cream/5 text-[10px] text-cream/25 uppercase tracking-wider font-semibold">
              <span>Tipo</span>
              <span>Dirección</span>
              <span>CHC</span>
              <span className="text-right">Hace</span>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={20} className="animate-spin text-terracotta" />
              </div>
            ) : txs.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <p className="text-3xl">⛓️</p>
                <p className="text-cream/30 text-sm">El mempool está vacío</p>
              </div>
            ) : (
              txs.map(tx => (
                <TxRow key={tx.id} tx={tx} flash={freshIds.has(tx.id)} />
              ))
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { useWallet } from '@/lib/wallet-context';
import { signTransaction, decryptPrivateKey } from '@/lib/crypto';
import { formatPEN, formatDateTime, shortAddress } from '@/lib/utils';
import type { Transaction } from '@/lib/types';
import { calcPrices } from '@/lib/amm';
import Link from 'next/link';
import {
  Wallet,
  Copy,
  CheckCircle,
  Droplets,
  Send,
  AlertCircle,
  Loader2,
  RefreshCw,
  KeyRound,
  X,
  Trash2,
} from 'lucide-react';

export default function WalletPage() {
  const { address, publicKey, balance, scc, nonce, hasFaucet, positions, canSign, loading, refresh } = useWallet();

  const [txHistory, setTxHistory] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Load dismissed positions from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wallet_dismissed_positions');
      if (saved) setDismissed(new Set(JSON.parse(saved) as string[]));
    } catch { /* ignore */ }
  }, []);

  function dismissPosition(marketId: string) {
    setDismissed(prev => {
      const next = new Set(prev).add(marketId);
      localStorage.setItem('wallet_dismissed_positions', JSON.stringify([...next]));
      return next;
    });
  }

  function dismissAllResolved() {
    const resolvedIds = positions
      .filter(p => p.market?.status !== 'open')
      .map(p => p.market_id);
    setDismissed(prev => {
      const next = new Set([...prev, ...resolvedIds]);
      localStorage.setItem('wallet_dismissed_positions', JSON.stringify([...next]));
      return next;
    });
  }

  const [faucetLoading, setFaucetLoading] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [toAddress, setToAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [txPassword, setTxPassword] = useState('');

  const fetchTransactions = useCallback(async () => {
    if (!address) return;
    setTxLoading(true);
    try {
      const res = await fetch(`/api/wallet/${address}/transactions`);
      const data = res.ok ? await res.json() : null;
      if (data?.success) setTxHistory(data.data ?? []);
    } catch { /* ignore */ }
    finally { setTxLoading(false); }
  }, [address]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  async function handleRefresh() {
    await refresh();
    await fetchTransactions();
  }

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function claimFaucet() {
    if (!address) return;
    setFaucetLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wallet/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccessMsg('¡Recibiste 100 CHC del faucet!');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setFaucetLoading(false);
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (!address || !toAddress || !transferAmount || !txPassword) return;

    const amt = parseFloat(transferAmount);
    if (isNaN(amt) || amt <= 0) { setError('Monto inválido'); return; }

    setTransferLoading(true);
    try {
      const encKey = localStorage.getItem('pm_encrypted_key');
      if (!encKey) throw new Error('Clave privada no encontrada. Importa tu wallet primero.');
      const privKey = await decryptPrivateKey(encKey, txPassword);

      // El nonce cambia con cada juego/operación server-side: pedir el actual
      // justo antes de firmar evita el error "Nonce inválido" por estado viejo.
      let freshNonce = nonce;
      try {
        const meRes = await fetch('/api/wallet/me');
        const me = await meRes.json();
        if (me.success && typeof me.data?.nonce === 'number') freshNonce = me.data.nonce;
      } catch { /* fallback al nonce del contexto */ }

      const txData = {
        type: 'TRANSFER',
        from: address,
        to: toAddress,
        amount: amt,
        nonce: freshNonce + 1,
        timestamp: Date.now(),
      };

      const signature = signTransaction(txData, privKey);

      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...txData, signature, public_key: publicKey ?? '' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSuccessMsg(`Transferiste ${formatPEN(amt)} CHC a ${shortAddress(toAddress)}`);
      setToAddress('');
      setTransferAmount('');
      setTxPassword('');
      await refresh();
      await fetchTransactions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error';
      setError(msg.toLowerCase().includes('operation') ? 'Contraseña incorrecta' : msg);
    } finally {
      setTransferLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-ink">
        <Navigation />
        <div className="flex items-center justify-center h-64">
          <Loader2 size={24} className="animate-spin text-cream/30" />
        </div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="min-h-screen bg-ink">
        <Navigation />
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
          <Wallet size={40} className="text-cream/20 mx-auto" />
          <p className="text-cream/50">No tienes una wallet configurada.</p>
          <Link href="/setup" className="btn-primary inline-flex">
            Configurar wallet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
            <Wallet size={24} className="text-terracotta" />
            Mi Wallet
          </h1>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 rounded-lg border border-cream/10 text-cream/50 hover:text-cream hover:border-cream/20 transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Balance card */}
        <div className="card bg-gradient-to-br from-ink-soft to-ink border-terracotta/20">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-cream/50 text-sm mb-1">Balance</p>
              <p className="text-4xl font-bold text-cream">
                {balance !== null ? formatPEN(balance) : '—'}{' '}
                <span className="text-terracotta text-2xl">CHC</span>
              </p>
              {scc > 0 && (
                <p className="text-lg font-bold text-purple-300 mt-1">
                  ⚡ {scc.toFixed(4)} <span className="text-sm">SCC</span>
                  <span className="text-purple-300/40 text-xs font-normal ml-1.5">SuperChamoCoins</span>
                </p>
              )}
            </div>
            <button
              onClick={claimFaucet}
              disabled={hasFaucet || faucetLoading}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              {faucetLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Droplets size={14} />
              )}
              {hasFaucet ? 'Faucet reclamado' : 'Reclamar 100 CHC'}
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-cream/10">
            <p className="text-cream/40 text-xs mb-1.5">Dirección</p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-mustard text-sm truncate flex-1">{address}</code>
              <button
                onClick={copyAddress}
                className="p-1.5 rounded-lg bg-ink hover:bg-ink-muted border border-cream/10 transition-colors shrink-0"
              >
                {copied ? (
                  <CheckCircle size={14} className="text-market-yes" />
                ) : (
                  <Copy size={14} className="text-cream/40" />
                )}
              </button>
            </div>
            <p className="text-cream/30 text-xs mt-1">Nonce: {nonce}</p>
          </div>
        </div>

        {/* Import prompt when canSign is false */}
        {!canSign && (
          <div className="bg-mustard/10 border border-mustard/30 rounded-xl p-4 flex items-start gap-3">
            <KeyRound size={18} className="text-mustard shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-cream/80 text-sm font-medium">
                Necesitas importar tu wallet para firmar transacciones
              </p>
              <p className="text-cream/50 text-xs">
                Tu balance y dirección se leen directamente de la blockchain. Para transferir o apostar, importa tu archivo de backup para habilitar la firma criptográfica.
              </p>
              <Link href="/setup" className="inline-flex items-center gap-1.5 text-xs text-mustard hover:text-mustard/80 font-medium underline underline-offset-2">
                Importar wallet →
              </Link>
            </div>
          </div>
        )}

        {/* Messages */}
        {error && (
          <div className="bg-market-no/10 border border-market-no/30 rounded-lg p-3 flex items-center gap-2 text-sm text-market-no animate-fade-in">
            <AlertCircle size={14} />
            {error}
          </div>
        )}
        {successMsg && (
          <div className="bg-market-yes/10 border border-market-yes/30 rounded-lg p-3 flex items-center gap-2 text-sm text-market-yes animate-fade-in">
            <CheckCircle size={14} />
            {successMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Transfer */}
          <div className="card space-y-4">
            <h2 className="font-semibold text-cream flex items-center gap-2">
              <Send size={16} className="text-terracotta" />
              Transferir CHC
            </h2>
            {canSign ? (
              <form onSubmit={handleTransfer} className="space-y-3">
                <div>
                  <label className="label">Dirección destino</label>
                  <input
                    type="text"
                    value={toAddress}
                    onChange={(e) => setToAddress(e.target.value)}
                    placeholder="P..."
                    className="input font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="label">Monto (CHC)</label>
                  <input
                    type="number"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Contraseña de wallet</label>
                  <input
                    type="password"
                    value={txPassword}
                    onChange={(e) => setTxPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input"
                  />
                </div>
                <button
                  type="submit"
                  disabled={transferLoading || !toAddress || !transferAmount || !txPassword}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  {transferLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Enviar
                </button>
              </form>
            ) : (
              <div className="text-center py-6 space-y-2">
                <KeyRound size={28} className="text-cream/20 mx-auto" />
                <p className="text-cream/40 text-sm">Importa tu wallet para transferir</p>
                <Link href="/setup" className="btn-secondary inline-flex text-sm">
                  Importar wallet
                </Link>
              </div>
            )}
          </div>

          {/* Positions */}
          <div className="card">
            {(() => {
              const visible = positions.filter(p => !dismissed.has(p.market_id));
              const hasResolved = visible.some(p => p.market?.status !== 'open');
              return (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-cream">Mis posiciones</h2>
                    {hasResolved && (
                      <button
                        onClick={dismissAllResolved}
                        className="flex items-center gap-1.5 text-xs text-cream/30 hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                        Limpiar resueltos
                      </button>
                    )}
                  </div>
                  {visible.length === 0 ? (
                    <p className="text-cream/30 text-sm text-center py-8">
                      Sin posiciones activas. ¡Apuesta en algún mercado!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {visible.map((pos) => {
                        const isResolved = pos.market?.status === 'resolved';
                        const isCancelled = pos.market?.status === 'cancelled';
                        const isDone = isResolved || isCancelled;
                        const resolution = pos.market?.resolution;

                        // Determine win/loss
                        const userWon = isResolved && (
                          (resolution === 'YES' && pos.yes_shares > 0) ||
                          (resolution === 'NO'  && pos.no_shares  > 0)
                        );
                        const userLost = isResolved && (
                          (resolution === 'YES' && pos.yes_shares === 0 && pos.no_shares > 0) ||
                          (resolution === 'NO'  && pos.no_shares  === 0 && pos.yes_shares > 0)
                        );
                        const winningSh = userWon
                          ? (resolution === 'YES' ? pos.yes_shares : pos.no_shares)
                          : 0;
                        const losingSh = userLost
                          ? (resolution === 'YES' ? pos.no_shares : pos.yes_shares)
                          : 0;

                        // Live value for open markets
                        const yesVal = pos.market
                          ? pos.yes_shares * calcPrices(pos.market.yes_reserve, pos.market.no_reserve).yes
                          : pos.yes_shares;
                        const noVal = pos.market
                          ? pos.no_shares * calcPrices(pos.market.yes_reserve, pos.market.no_reserve).no
                          : pos.no_shares;

                        const borderCls = userWon
                          ? 'border-market-yes/30 bg-market-yes/5'
                          : userLost
                          ? 'border-market-no/30 bg-market-no/5'
                          : isCancelled
                          ? 'border-cream/10 bg-ink'
                          : 'border-cream/5 bg-ink';

                        return (
                          <div key={pos.market_id} className={`p-3 rounded-lg border space-y-2 relative ${borderCls}`}>
                            {/* Dismiss button — only for resolved/cancelled */}
                            {isDone && (
                              <button
                                onClick={() => dismissPosition(pos.market_id)}
                                className="absolute top-2 right-2 p-0.5 rounded text-cream/20 hover:text-cream/60 transition-colors"
                                title="Ocultar"
                              >
                                <X size={12} />
                              </button>
                            )}

                            {/* Market question */}
                            {pos.market && (
                              <a
                                href={`/markets/${pos.market_id}`}
                                className="block text-xs text-cream/50 hover:text-cream/80 font-medium pr-5 transition-colors leading-snug"
                              >
                                📊 {pos.market.question}
                              </a>
                            )}

                            {/* Status badge */}
                            {isResolved && (
                              <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                                userWon
                                  ? 'bg-market-yes/20 text-market-yes'
                                  : userLost
                                  ? 'bg-market-no/20 text-market-no'
                                  : 'bg-cream/10 text-cream/40'
                              }`}>
                                {userWon && <>✓ Ganaste · +{formatPEN(winningSh)} CHC</>}
                                {userLost && <>✗ Perdiste · {formatPEN(losingSh)} shares expirados</>}
                                {!userWon && !userLost && `Resuelto: ${resolution}`}
                              </div>
                            )}
                            {isCancelled && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-cream/10 text-cream/40">
                                Cancelado
                              </span>
                            )}

                            {/* Shares / live value */}
                            {!isDone && (
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                {pos.yes_shares > 0 && (
                                  <p className="text-market-yes text-sm">
                                    SÍ: {pos.yes_shares.toFixed(4)} (~{formatPEN(yesVal)} CHC)
                                  </p>
                                )}
                                {pos.no_shares > 0 && (
                                  <p className="text-market-no text-sm">
                                    NO: {pos.no_shares.toFixed(4)} (~{formatPEN(noVal)} CHC)
                                  </p>
                                )}
                              </div>
                            )}
                            {isDone && !userWon && !userLost && (
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                                {pos.yes_shares > 0 && (
                                  <p className="text-cream/30 text-sm">SÍ: {pos.yes_shares.toFixed(4)} shares</p>
                                )}
                                {pos.no_shares > 0 && (
                                  <p className="text-cream/30 text-sm">NO: {pos.no_shares.toFixed(4)} shares</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Transaction history */}
        <div className="card">
          <h2 className="font-semibold text-cream mb-4">Historial de transacciones</h2>
          {txLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin text-cream/30" />
            </div>
          ) : txHistory.length === 0 ? (
            <p className="text-cream/30 text-sm text-center py-8">Sin transacciones aún</p>
          ) : (
            <div className="space-y-2">
              {txHistory.map((tx) => {
                // Determine sign: CLAIM/MINE/FAUCET/SELL always positive;
                // BUY/CREATE_MARKET always negative; TRANSFER by direction.
                const ALWAYS_IN  = ['CLAIM', 'MINE', 'FAUCET', 'SELL'];
                const ALWAYS_OUT = ['BUY', 'CREATE_MARKET'];
                const isIn = ALWAYS_IN.includes(tx.type)
                  ? true
                  : ALWAYS_OUT.includes(tx.type)
                  ? false
                  : tx.to_address === address;

                // Casino destinations (slots/crash/roulette) — show game label for CLAIM
                const casinoDest: Record<string, string> = {
                  SLOTS: 'Slots', CRASH: 'El Avión', ROULETTE: 'Ruleta', BLACKJACK: 'Blackjack',
                };
                const casinoLabel = tx.to_address ? casinoDest[tx.to_address] : null;

                const label = (() => {
                  switch (tx.type) {
                    case 'FAUCET':        return '🚰 Faucet';
                    case 'MINE':          return '⛏️ Minado';
                    case 'TRANSFER':      return '💸 Transferencia';
                    case 'BUY':           return tx.outcome ? `📈 Compra ${tx.outcome}` : casinoLabel ? `🎰 ${casinoLabel} — pérdida` : '📈 Compra';
                    case 'SELL':          return tx.outcome ? `📉 Venta ${tx.outcome}` : '📉 Venta';
                    case 'CREATE_MARKET': return '📊 Creó mercado';
                    case 'RESOLVE':       return `🔮 Resolvió: ${tx.outcome ?? 'mercado'}`;
                    case 'CLAIM':         return casinoLabel ? `🎰 ${casinoLabel} — ganancia` : '💰 Cobró ganancias';
                    default:              return tx.type;
                  }
                })();

                return (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between py-2.5 border-b border-cream/5 last:border-0"
                  >
                    <div>
                      <p className="text-cream/80 text-sm font-medium">{label}</p>
                      <p className="text-cream/30 text-xs">{formatDateTime(tx.created_at)}</p>
                    </div>
                    {tx.amount && (
                      <p className={`font-mono text-sm font-semibold ${isIn ? 'text-market-yes' : 'text-cream/60'}`}>
                        {isIn ? '+' : '-'}{formatPEN(tx.amount)} CHC
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

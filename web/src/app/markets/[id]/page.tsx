import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import Navigation from '@/components/Navigation';
import TradeForm from '@/components/TradeForm';
import MultiBettingForm from '@/components/MultiBettingForm';
import MultiProbabilityChart from '@/components/MultiProbabilityChart';
import type { Market, Position, Transaction, MultiOutcome } from '@/lib/types';
import { calcPrices, formatPEN } from '@/lib/amm';
import { categoryLabel, categoryColor, formatDateTime, shortAddress } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, User, CheckCircle, XCircle, ShieldCheck, Sliders } from 'lucide-react';

const OUTCOME_COLORS = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

export const revalidate = 10;

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: market } = await supabase
    .from('markets')
    .select('*')
    .eq('id', id)
    .single<Market>();

  if (!market) notFound();

  const prices = calcPrices(market.yes_reserve, market.no_reserve);
  const liquidity = market.yes_reserve + market.no_reserve;

  // Fetch user position
  const { data: { user } } = await supabase.auth.getUser();
  let userPosition: Position | null = null;
  let userAddress: string | null = null;

  if (user) {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .single();

    if (wallet) {
      userAddress = wallet.address;
      const { data: pos } = await supabase
        .from('positions')
        .select('*')
        .eq('address', wallet.address)
        .eq('market_id', id)
        .single<Position>();
      userPosition = pos;
    }
  }

  // Fetch recent transactions for this market
  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .eq('market_id', id)
    .in('type', ['BUY', 'SELL', 'RESOLVE', 'CLAIM'])
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<Transaction[]>();

  const admin = createAdminSupabaseClient();

  // For multi markets: fetch outcomes with bet totals (admin bypasses RLS)
  let multiOutcomes: MultiOutcome[] = [];
  if (market.market_type === 'multi') {
    const { data: outs } = await admin
      .from('market_outcomes')
      .select('*')
      .eq('market_id', id)
      .order('display_order');
    const { data: bets } = await admin
      .from('outcome_bets')
      .select('outcome_id, amount')
      .eq('market_id', id);

    if (outs) {
      const betsByOutcome: Record<string, number> = {};
      (bets ?? []).forEach((b: { outcome_id: string; amount: number }) => {
        betsByOutcome[b.outcome_id] = (betsByOutcome[b.outcome_id] ?? 0) + Number(b.amount);
      });
      const totalPool = outs.reduce((s, o) => s + Number(o.seed) + (betsByOutcome[o.id] ?? 0), 0);
      multiOutcomes = outs.map(o => {
        const totalBet = betsByOutcome[o.id] ?? 0;
        const calcProb = totalPool > 0 ? (Number(o.seed) + totalBet) / totalPool : 1 / outs.length;
        const override = (o as Record<string, unknown>).probability_override as number | null ?? null;
        return {
          ...o,
          total_bet: totalBet,
          probability_override: override,
          calc_probability: calcProb,
          probability: override ?? calcProb,
        };
      });
    }
  }

  const isCreator = userAddress && market.creator_address === userAddress;

  // Fetch oracle public key (public info — shown to everyone)
  const { data: creatorWallet } = await admin
    .from('wallets')
    .select('public_key')
    .eq('address', market.creator_address)
    .maybeSingle();
  const oraclePublicKey: string | null = creatorWallet?.public_key ?? null;

  // Check if current viewer is admin (for the shortcut link)
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle();
    isAdmin = profile?.is_admin ?? false;
  }

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link
          href="/markets"
          className="inline-flex items-center gap-2 text-cream/50 hover:text-cream text-sm mb-6 transition-colors"
        >
          <ArrowLeft size={15} />
          Volver a mercados
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: market info */}
          <div className="lg:col-span-2 space-y-5">
            {/* Header */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className={`badge ${categoryColor(market.category)}`}>
                  {categoryLabel(market.category)}
                </span>
                <span
                  className={`badge ${
                    market.status === 'open'
                      ? 'bg-market-yes/20 text-market-yes'
                      : 'bg-ink-muted text-cream/40'
                  }`}
                >
                  {market.status === 'open' ? '● Abierto' : '◉ Resuelto'}
                </span>
                {isCreator && (
                  <span className="badge bg-mustard/20 text-mustard">Tu mercado</span>
                )}
              </div>
              <h1 className="text-xl font-bold text-cream mb-2">{market.question}</h1>
              {market.description && (
                <p className="text-cream/60 text-sm leading-relaxed">{market.description}</p>
              )}
              <div className="flex flex-wrap gap-4 mt-4 text-xs text-cream/40">
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {shortAddress(market.creator_address)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {formatDateTime(market.created_at)}
                </span>
              </div>
            </div>

            {/* Oracle section — visible to everyone */}
            <div className="rounded-2xl border border-cream/10 bg-ink-soft overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-cream/5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={15} className="text-mustard shrink-0" />
                  <span className="font-semibold text-cream text-sm">Oracle</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-mustard/15 text-mustard font-bold uppercase tracking-wider">
                    verificador
                  </span>
                </div>
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 text-xs text-terracotta hover:text-terracotta/80 transition-colors font-semibold"
                  >
                    <Sliders size={12} />
                    Panel Admin
                  </Link>
                )}
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <p className="text-cream/40 text-xs leading-relaxed">
                  Este mercado es verificado y resuelto por la siguiente clave pública. Puedes confirmar su identidad antes de apostar.
                </p>
                <div className="bg-ink rounded-xl p-3">
                  <p className="text-[10px] text-cream/30 uppercase tracking-widest mb-1.5">Clave pública</p>
                  <p className="font-mono text-xs text-cream/70 break-all leading-relaxed">
                    {oraclePublicKey ?? market.creator_address}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-cream/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-market-yes animate-pulse" />
                  Dirección oracle: <span className="font-mono text-cream/50">{market.creator_address}</span>
                </div>
              </div>
            </div>

            {/* Price info – Binary */}
            {market.market_type !== 'multi' && market.status === 'open' && (
              <div className="card space-y-4">
                <h2 className="font-semibold text-cream">Precios actuales</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-market-yes/10 border border-market-yes/30 rounded-lg p-4 text-center">
                    <p className="text-market-yes text-3xl font-bold">{(prices.yes * 100).toFixed(0)}¢</p>
                    <p className="text-market-yes/70 text-sm mt-1">SÍ</p>
                    <p className="text-cream/30 text-xs mt-2">{market.yes_reserve.toFixed(2)} en pool</p>
                  </div>
                  <div className="bg-market-no/10 border border-market-no/30 rounded-lg p-4 text-center">
                    <p className="text-market-no text-3xl font-bold">{(prices.no * 100).toFixed(0)}¢</p>
                    <p className="text-market-no/70 text-sm mt-1">NO</p>
                    <p className="text-cream/30 text-xs mt-2">{market.no_reserve.toFixed(2)} en pool</p>
                  </div>
                </div>
                <div className="w-full h-3 bg-ink rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-market-yes to-market-yes-dark rounded-full transition-all" style={{ width: `${prices.yes * 100}%` }} />
                </div>
                <div className="flex justify-between text-xs text-cream/40">
                  <span>Liquidez total: {formatPEN(liquidity)} CHC</span>
                  <span>Fee: 2%</span>
                </div>
              </div>
            )}

            {/* Multi-outcome probability display — Polymarket style */}
            {market.market_type === 'multi' && (
              <div className="overflow-hidden rounded-2xl border border-cream/10 bg-ink-soft">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-cream/5">
                  <h2 className="font-semibold text-cream">Opciones</h2>
                  <span className="text-xs text-cream/30">2% fee al resolver</span>
                </div>

                {/* Probability time-series chart */}
                <div className="border-b border-cream/5 pt-3 pb-1">
                  <MultiProbabilityChart
                    marketId={id}
                    outcomes={multiOutcomes.map(o => ({
                      id: o.id,
                      label: o.label,
                      probability: o.probability,
                    }))}
                  />
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 pb-3 mt-1">
                    {multiOutcomes.map((o, i) => (
                      <span key={o.id} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }}
                        />
                        <span className="font-semibold" style={{ color: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }}>
                          {(o.probability * 100).toFixed(1)}%
                        </span>
                        <span className="text-cream/35">{o.label}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Outcome rows */}
                <div className="divide-y divide-cream/5">
                  {multiOutcomes.map((o, i) => {
                    const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
                    const hasOverride = o.probability_override !== null;
                    const pct = o.probability * 100;
                    return (
                      <div key={o.id} className="px-5 py-4 flex items-center gap-4">
                        {/* Label */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className={`font-semibold text-sm ${o.is_winner ? 'text-market-yes' : 'text-cream/90'}`}>
                              {o.is_winner && <span className="text-market-yes mr-1">✓</span>}
                              {o.label}
                            </span>
                            {hasOverride && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-mustard/20 text-mustard font-bold uppercase tracking-wider">
                                oracle
                              </span>
                            )}
                          </div>
                          {/* Gradient bar */}
                          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${color}18` }}>
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${pct.toFixed(2)}%`,
                                background: `linear-gradient(90deg, ${color} 0%, ${color}bb 100%)`,
                                boxShadow: `0 0 8px ${color}50`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Percentage */}
                        <div className="text-right shrink-0 w-16">
                          <p className="font-bold text-xl tabular-nums leading-none" style={{ color }}>
                            {pct.toFixed(1)}%
                          </p>
                          {hasOverride && (
                            <p className="text-cream/25 text-[10px] tabular-nums mt-1">
                              bets: {(o.calc_probability * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer */}
                {market.status === 'resolved' && market.resolved_at && (
                  <div className="px-5 py-3 border-t border-cream/5 flex items-center gap-2 text-xs text-cream/30">
                    <CheckCircle size={11} className="text-market-yes" />
                    Resuelto {formatDateTime(market.resolved_at)}
                  </div>
                )}
              </div>
            )}

            {/* Binary resolved */}
            {market.market_type !== 'multi' && market.status !== 'open' && (
              <div className="card">
                <h2 className="font-semibold text-cream mb-3">Resultado</h2>
                <div className={`flex items-center gap-3 p-4 rounded-lg ${market.resolution === 'YES' ? 'bg-market-yes/10 border border-market-yes/30' : 'bg-market-no/10 border border-market-no/30'}`}>
                  {market.resolution === 'YES' ? <CheckCircle size={28} className="text-market-yes" /> : <XCircle size={28} className="text-market-no" />}
                  <div>
                    <p className={`text-xl font-bold ${market.resolution === 'YES' ? 'text-market-yes' : 'text-market-no'}`}>
                      {market.resolution === 'YES' ? 'SÍ ganó' : 'NO ganó'}
                    </p>
                    {market.resolved_at && (
                      <p className="text-cream/40 text-xs">Resuelto {formatDateTime(market.resolved_at)}</p>
                    )}
                  </div>
                </div>
                {userPosition && (
                  <div className="mt-3 p-3 bg-ink rounded-lg text-sm">
                    <p className="text-cream/60 mb-1">Tu posición:</p>
                    <div className="flex gap-4">
                      {userPosition.yes_shares > 0 && (
                        <span className={market.resolution === 'YES' ? 'text-market-yes' : 'text-cream/30 line-through'}>
                          SÍ: {userPosition.yes_shares.toFixed(4)} shares
                        </span>
                      )}
                      {userPosition.no_shares > 0 && (
                        <span className={market.resolution === 'NO' ? 'text-market-yes' : 'text-cream/30 line-through'}>
                          NO: {userPosition.no_shares.toFixed(4)} shares
                        </span>
                      )}
                    </div>
                    {market.resolution === 'YES' && userPosition.yes_shares > 0 && (
                      <p className="text-market-yes text-xs mt-1">Ganaste: {formatPEN(userPosition.yes_shares)} CHC</p>
                    )}
                    {market.resolution === 'NO' && userPosition.no_shares > 0 && (
                      <p className="text-market-yes text-xs mt-1">Ganaste: {formatPEN(userPosition.no_shares)} CHC</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Oracle resolve (only creator, only open markets) */}
            {isCreator && market.status === 'open' && (
              <div className="card border-mustard/20">
                <h3 className="font-semibold text-cream mb-3">Resolver mercado (Oráculo)</h3>
                <p className="text-cream/50 text-sm mb-4">
                  Como creador, puedes resolver este mercado cuando el resultado sea conocido.
                </p>
                <Link
                  href={`/oracle?market_id=${market.id}`}
                  className="btn-mustard inline-flex items-center gap-2"
                >
                  Ir al Oráculo
                </Link>
              </div>
            )}

            {/* Transaction history */}
            {txs && txs.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-cream mb-4">Actividad reciente</h3>
                <div className="space-y-2">
                  {txs.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between py-2 border-b border-cream/5 last:border-0"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            tx.type === 'BUY'
                              ? tx.outcome === 'YES'
                                ? 'bg-market-yes'
                                : 'bg-market-no'
                              : tx.type === 'RESOLVE'
                              ? 'bg-mustard'
                              : 'bg-cream/30'
                          }`}
                        />
                        <div>
                          <p className="text-cream/80 text-sm">
                            {tx.type === 'BUY' && `Compra ${tx.outcome}`}
                            {tx.type === 'SELL' && `Venta ${tx.outcome}`}
                            {tx.type === 'RESOLVE' && `Resuelto: ${tx.outcome}`}
                            {tx.type === 'CLAIM' && 'Cobro de ganancias'}
                          </p>
                          <p className="text-cream/30 text-xs">
                            {shortAddress(tx.from_address ?? '')} · {formatDateTime(tx.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        {tx.amount && (
                          <p className="text-cream/60 text-sm font-mono">
                            {formatPEN(tx.amount)} CHC
                          </p>
                        )}
                        {tx.shares && (
                          <p className="text-cream/30 text-xs">
                            {tx.shares.toFixed(4)} shares
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: trade form */}
          <div className="lg:col-span-1">
            <div className="sticky top-20">
              {market.market_type === 'multi'
                ? <MultiBettingForm market={market} outcomes={multiOutcomes} userAddress={userAddress} />
                : (
                  <>
                    <TradeForm market={market} />
                    {userPosition && (userPosition.yes_shares > 0 || userPosition.no_shares > 0) && (
                      <div className="card mt-4">
                        <h3 className="font-semibold text-cream mb-3 text-sm">Tu posición</h3>
                        <div className="space-y-2">
                          {userPosition.yes_shares > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-cream/50">Shares SÍ</span>
                              <span className="text-market-yes font-mono">{userPosition.yes_shares.toFixed(4)}</span>
                            </div>
                          )}
                          {userPosition.no_shares > 0 && (
                            <div className="flex justify-between text-sm">
                              <span className="text-cream/50">Shares NO</span>
                              <span className="text-market-no font-mono">{userPosition.no_shares.toFixed(4)}</span>
                            </div>
                          )}
                          {market.status === 'open' && (
                            <div className="flex justify-between text-sm pt-1 border-t border-cream/10">
                              <span className="text-cream/50">Valor actual</span>
                              <span className="text-mustard font-mono">
                                {formatPEN(userPosition.yes_shares * prices.yes + userPosition.no_shares * prices.no)} CHC
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              }
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

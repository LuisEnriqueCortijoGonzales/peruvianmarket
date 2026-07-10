import Link from 'next/link';
import type { Market } from '@/lib/types';
import { calcPrices, formatPEN } from '@/lib/amm';
import { categoryLabel, categoryColor, formatDate } from '@/lib/utils';
import { Users, Clock, TrendingUp } from 'lucide-react';

interface Props {
  market: Market;
  userPosition?: { yes_shares: number; no_shares: number } | null;
}

export default function MarketCard({ market, userPosition }: Props) {
  const isMulti = market.market_type === 'multi';
  const prices = isMulti ? { yes: 0.5, no: 0.5 } : calcPrices(market.yes_reserve, market.no_reserve);
  const yesP = prices.yes;
  const noP = prices.no;
  const liquidity = market.yes_reserve + market.no_reserve;

  const hasPosition =
    !isMulti && userPosition &&
    (userPosition.yes_shares > 0 || userPosition.no_shares > 0);

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block card hover:border-cream/20 transition-all duration-200 hover:bg-ink-muted/50 group animate-fade-in"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`badge text-xs ${categoryColor(market.category)}`}>
              {categoryLabel(market.category)}
            </span>
            {isMulti && (
              <span className="badge bg-mustard/20 text-mustard text-[10px] uppercase tracking-wider">Multi</span>
            )}
            {!isMulti && market.status === 'resolved' && (
              <span className={`badge ${market.resolution === 'YES' ? 'bg-market-yes/20 text-market-yes' : 'bg-market-no/20 text-market-no'}`}>
                {market.resolution === 'YES' ? '✓ SÍ' : '✗ NO'}
              </span>
            )}
            {isMulti && market.status === 'resolved' && (
              <span className="badge bg-mustard/10 text-mustard">Resuelto</span>
            )}
            {hasPosition && (
              <span className="badge bg-mustard/20 text-mustard">Tu posición</span>
            )}
          </div>
          <h3 className="text-cream font-semibold text-base leading-snug group-hover:text-white transition-colors line-clamp-2">
            {market.question}
          </h3>
        </div>
      </div>

      {/* Multi-outcome bar (equal slices) */}
      {isMulti && market.status === 'open' && (
        <div className="space-y-1.5">
          <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
            <div className="flex-1 bg-mustard/50" />
            <div className="flex-1 bg-mustard/70" />
            <div className="flex-1 bg-mustard/40" />
          </div>
          <p className="text-xs text-cream/40 flex items-center gap-1">
            <TrendingUp size={11} />
            Mercado multi-opción · sistema parimutuel
          </p>
        </div>
      )}

      {/* Binary price bar */}
      {!isMulti && market.status === 'open' && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm font-semibold">
            <span className="text-market-yes">SÍ {(yesP * 100).toFixed(0)}¢</span>
            <span className="text-market-no">NO {(noP * 100).toFixed(0)}¢</span>
          </div>
          <div className="w-full h-2 bg-ink rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-market-yes to-market-yes-dark rounded-full transition-all duration-500"
              style={{ width: `${yesP * 100}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-xs text-cream/40 mt-1">
            <span className="flex items-center gap-1">
              <TrendingUp size={11} />
              {formatPEN(liquidity)} CHC liquidez
            </span>
            {market.end_date && (
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {formatDate(market.end_date)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Binary resolved */}
      {!isMulti && market.status !== 'open' && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-cream/40">Resuelto:</span>
          <span className={`font-bold ${market.resolution === 'YES' ? 'text-market-yes' : 'text-market-no'}`}>
            {market.resolution === 'YES' ? '✓ SÍ ganó' : '✗ NO ganó'}
          </span>
          {market.resolved_at && (
            <span className="text-cream/30 text-xs ml-auto">{formatDate(market.resolved_at)}</span>
          )}
        </div>
      )}

      {/* User position */}
      {hasPosition && (
        <div className="mt-3 pt-3 border-t border-cream/5 flex gap-4 text-xs">
          {userPosition!.yes_shares > 0 && (
            <span className="text-market-yes">SÍ: {userPosition!.yes_shares.toFixed(2)} shares</span>
          )}
          {userPosition!.no_shares > 0 && (
            <span className="text-market-no">NO: {userPosition!.no_shares.toFixed(2)} shares</span>
          )}
        </div>
      )}
    </Link>
  );
}

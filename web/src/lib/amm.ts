import type { Market, MarketOutcome, TradeQuote } from './types';

const FEE_RATE = 0.02;

export function calcPrices(yesReserve: number, noReserve: number) {
  const total = yesReserve + noReserve;
  return {
    yes: noReserve / total,
    no: yesReserve / total,
  };
}

export function quoteBuy(
  market: Pick<Market, 'yes_reserve' | 'no_reserve'>,
  outcome: MarketOutcome,
  amountIn: number,
): TradeQuote {
  const { yes_reserve: yr, no_reserve: nr } = market;
  const k = yr * nr;

  const amountAfterFee = amountIn * (1 - FEE_RATE);
  const feeAmount = amountIn * FEE_RATE;
  const halfFee = feeAmount / 2;

  let sharesOut: number;
  let newYr: number;
  let newNr: number;

  if (outcome === 'YES') {
    // Add PEN to YES pool, receive YES shares
    const newNrAfter = nr + amountAfterFee + halfFee;
    const newYrAfter = k / (newNrAfter);
    sharesOut = yr + halfFee - newYrAfter;
    newYr = newYrAfter;
    newNr = newNrAfter;
  } else {
    const newYrAfter = yr + amountAfterFee + halfFee;
    const newNrAfter = k / newYrAfter;
    sharesOut = nr + halfFee - newNrAfter;
    newYr = newYrAfter;
    newNr = newNrAfter;
  }

  const oldPrice = calcPrices(yr, nr);
  const newPrice = calcPrices(newYr, newNr);
  const currentPrice = outcome === 'YES' ? oldPrice.yes : oldPrice.no;
  const priceAfter = outcome === 'YES' ? newPrice.yes : newPrice.no;
  const priceImpact = Math.abs(priceAfter - currentPrice) / currentPrice;

  return {
    outcome,
    amount_in: amountIn,
    shares_out: Math.max(0, sharesOut),
    price_per_share: sharesOut > 0 ? amountIn / sharesOut : 0,
    price_impact: priceImpact,
    new_yes_price: newPrice.yes,
    new_no_price: newPrice.no,
  };
}

export function quoteSell(
  market: Pick<Market, 'yes_reserve' | 'no_reserve'>,
  outcome: MarketOutcome,
  sharesIn: number,
): { penOut: number; new_yes_price: number; new_no_price: number } {
  const { yes_reserve: yr, no_reserve: nr } = market;
  const k = yr * nr;

  let penOut: number;
  let newYr: number;
  let newNr: number;

  if (outcome === 'YES') {
    const newYrAfter = yr + sharesIn;
    const newNrAfter = k / newYrAfter;
    penOut = nr - newNrAfter;
    newYr = newYrAfter;
    newNr = newNrAfter;
  } else {
    const newNrAfter = nr + sharesIn;
    const newYrAfter = k / newNrAfter;
    penOut = yr - newYrAfter;
    newYr = newYrAfter;
    newNr = newNrAfter;
  }

  const afterFee = penOut * (1 - FEE_RATE);
  const newPrice = calcPrices(newYr, newNr);

  return {
    penOut: Math.max(0, afterFee),
    new_yes_price: newPrice.yes,
    new_no_price: newPrice.no,
  };
}

export function applyBuy(
  yesReserve: number,
  noReserve: number,
  outcome: MarketOutcome,
  amountIn: number,
): { newYesReserve: number; newNoReserve: number; sharesOut: number } {
  const quote = quoteBuy(
    { yes_reserve: yesReserve, no_reserve: noReserve },
    outcome,
    amountIn,
  );
  const k = yesReserve * noReserve;
  const amountAfterFee = amountIn * (1 - FEE_RATE);
  const halfFee = (amountIn * FEE_RATE) / 2;

  if (outcome === 'YES') {
    const newNr = noReserve + amountAfterFee + halfFee;
    const newYr = k / newNr;
    return { newYesReserve: newYr, newNoReserve: newNr, sharesOut: quote.shares_out };
  } else {
    const newYr = yesReserve + amountAfterFee + halfFee;
    const newNr = k / newYr;
    return { newYesReserve: newYr, newNoReserve: newNr, sharesOut: quote.shares_out };
  }
}

export function applySell(
  yesReserve: number,
  noReserve: number,
  outcome: MarketOutcome,
  sharesIn: number,
): { newYesReserve: number; newNoReserve: number; penOut: number } {
  const result = quoteSell(
    { yes_reserve: yesReserve, no_reserve: noReserve },
    outcome,
    sharesIn,
  );
  const k = yesReserve * noReserve;

  if (outcome === 'YES') {
    const newYr = yesReserve + sharesIn;
    const newNr = k / newYr;
    return { newYesReserve: newYr, newNoReserve: newNr, penOut: result.penOut };
  } else {
    const newNr = noReserve + sharesIn;
    const newYr = k / newNr;
    return { newYesReserve: newYr, newNoReserve: newNr, penOut: result.penOut };
  }
}

export function formatPrice(price: number): string {
  return `${(price * 100).toFixed(1)}¢`;
}

export function formatPEN(amount: number): string {
  return amount.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

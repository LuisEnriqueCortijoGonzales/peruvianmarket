// Blackjack — continuous shuffle machine (infinite shoe), same odds as large multi-deck shoe.
// Dealer stands on soft 17. Blackjack pays 3:2. No insurance, no split.
export type Card = string; // rank[0] + suit[1]: 'Ah', 'Td', '7c', 'Ks'
export type BJResult = 'player_bj' | 'player_win' | 'dealer_bj' | 'dealer_win' | 'push';

const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
const SUITS = ['h','d','c','s'] as const;

export function randomCard(): Card {
  return RANKS[Math.floor(Math.random() * 13)] + SUITS[Math.floor(Math.random() * 4)];
}

export function cardNum(card: Card): number {
  const r = card[0];
  if ('TJQK'.includes(r)) return 10;
  if (r === 'A')          return 11;
  return parseInt(r);
}

export function handTotal(cards: Card[]): number {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardNum(c); if (c[0] === 'A') aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export const isNatural = (cards: Card[]) => cards.length === 2 && handTotal(cards) === 21;

// Dealer draws cards until reaching hard/soft 17
export function dealerDraw(hand: Card[]): Card[] {
  const h = [...hand];
  while (handTotal(h) < 17) h.push(randomCard());
  return h;
}

export function resolve(p: Card[], d: Card[]): BJResult {
  const pBJ = isNatural(p), dBJ = isNatural(d);
  if (pBJ && dBJ) return 'push';
  if (pBJ)        return 'player_bj';
  if (dBJ)        return 'dealer_bj';
  const pv = handTotal(p), dv = handTotal(d);
  if (pv > 21)    return 'dealer_win';
  if (dv > 21)    return 'player_win';
  return pv > dv ? 'player_win' : pv < dv ? 'dealer_win' : 'push';
}

// Payout = CHC returned to player balance (0 if they lose, ≥bet if they win/push)
// bjPayout: profit ratio for natural BJ (1.5 = 3:2, 1.2 = 6:5)
// houseEdge: fractional reduction on winning payouts (0 = no extra edge)
export function payout(result: BJResult, bet: number, bjPayout = 1.5, houseEdge = 0): number {
  const edge = 1 - Math.max(0, Math.min(0.5, houseEdge));
  switch (result) {
    case 'player_bj':  return Math.round(bet * (1 + bjPayout) * edge * 100) / 100;
    case 'player_win': return Math.round(bet * 2 * edge * 100) / 100;
    case 'push':       return bet; // push always returns original
    case 'dealer_bj':
    case 'dealer_win': return 0;
  }
}

export function resultLabel(r: BJResult, bjPayout = 1.5): string {
  const bjLabel = bjPayout >= 1.5 ? '3:2' : bjPayout >= 1.2 ? '6:5' : `${bjPayout}:1`;
  switch (r) {
    case 'player_bj':  return `♠ ¡BLACKJACK! ${bjLabel}`;
    case 'player_win': return '¡GANASTE!';
    case 'push':       return 'EMPATE — apuesta devuelta';
    case 'dealer_bj':  return 'Blackjack del dealer';
    case 'dealer_win': return 'Dealer gana';
  }
}

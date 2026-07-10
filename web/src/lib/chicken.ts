// La Gallina — road/track lane game
// Chicken advances through lanes. Each lane has a survival roll.
// Multiplier grows geometrically: mult(k) = (1 - edge) / survivalRate^k

export const RISK_LEVELS = {
  bajo:    { label: 'Bajo',    survivalRate: 0.85, color: 'text-market-yes', bg: 'bg-market-yes/20',  border: 'border-market-yes/40' },
  medio:   { label: 'Medio',  survivalRate: 0.75, color: 'text-yellow-300',  bg: 'bg-yellow-400/20', border: 'border-yellow-400/40' },
  alto:    { label: 'Alto',   survivalRate: 0.60, color: 'text-mustard',     bg: 'bg-mustard/20',    border: 'border-mustard/40' },
  extremo: { label: 'Extremo',survivalRate: 0.45, color: 'text-red-400',     bg: 'bg-red-500/20',    border: 'border-red-500/40' },
} as const;

export type RiskLevel = keyof typeof RISK_LEVELS;
export const HOUSE_EDGE_DEFAULT = 0.05;

// Multiplier after surviving `step` lanes
export function getMultiplier(step: number, survivalRate: number, houseEdge = HOUSE_EDGE_DEFAULT): number {
  if (step === 0) return 1;
  return Math.round(Math.pow(1 / survivalRate, step) * (1 - houseEdge) * 10000) / 10000;
}

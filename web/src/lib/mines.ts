// Mines (Minas) — 5×5 grid, configurable mine count.
// Multiplier uses the hypergeometric distribution:
//   mult(k) = ∏(i=0..k-1) (n-i)/(n-m-i)  × (1 - houseEdge)
// where n=25 cells, m=mines, k=safe reveals.

export const MINES_N = 25;
export const MINES_OPTIONS = [1, 2, 3, 5, 8, 12, 20, 24] as const;
export type MinesOption = typeof MINES_OPTIONS[number];
export const HOUSE_EDGE_DEFAULT = 0.05;

export function getMultiplier(minesCount: number, safeRevealed: number, houseEdge = HOUSE_EDGE_DEFAULT): number {
  if (safeRevealed === 0) return 1;
  const n = MINES_N, m = minesCount;
  let mult = 1;
  for (let i = 0; i < safeRevealed; i++) {
    mult *= (n - i) / (n - m - i);
  }
  return Math.round(mult * (1 - houseEdge) * 10000) / 10000;
}

export function nextMultiplier(minesCount: number, safeRevealed: number, houseEdge = HOUSE_EDGE_DEFAULT): number {
  return getMultiplier(minesCount, safeRevealed + 1, houseEdge);
}

export function generateMinePositions(count: number): number[] {
  const arr = Array.from({ length: MINES_N }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

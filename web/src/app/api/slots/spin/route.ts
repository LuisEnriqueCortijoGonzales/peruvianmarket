// Slots — house edge applied via `house_edge` config field (default 8%).
// All payouts are reduced by house_edge%. Lost CHC goes to the house wallet.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { cookies } from 'next/headers';

const ROWS = 5, COLS = 6, TOTAL = 30;

const SYMS = [
  { id: 'heart',   v: 0.3,  w: 35 },
  { id: 'apple',   v: 0.5,  w: 28 },
  { id: 'lemon',   v: 0.5,  w: 25 },
  { id: 'orange',  v: 1,    w: 20 },
  { id: 'grape',   v: 2,    w: 14 },
  { id: 'candy',   v: 4,    w: 9  },
  { id: 'lolly',   v: 7,    w: 6  },
  { id: 'gem',     v: 20,   w: 2  },
  { id: 'scatter', v: 0,    w: 4  },
  { id: 'bomb',    v: 0,    w: 5  },
] as const;

type AnySymDef = { id: string; v: number; w: number };
const REG = (SYMS as unknown as AnySymDef[]).filter(s => s.id !== 'scatter' && s.id !== 'bomb');
const ALL = SYMS as unknown as AnySymDef[];

function wpick(pool: AnySymDef[]): string {
  let r = Math.random() * pool.reduce((s, x) => s + x.w, 0);
  for (const x of pool) { r -= x.w; if (r <= 0) return x.id; }
  return pool[pool.length - 1].id;
}

function flat2grid(f: string[]): string[][] {
  return Array.from({ length: ROWS }, (_, r) => f.slice(r * COLS, (r + 1) * COLS));
}

function findClusters(g: string[][]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  g.flat().forEach((s, i) => {
    if (s === 'scatter' || s === 'bomb') return;
    if (!m.has(s)) m.set(s, []);
    m.get(s)!.push(i);
  });
  for (const [k, v] of m) if (v.length < 8) m.delete(k);
  return m;
}

function clMult(n: number): number {
  if (n >= 25) return 100; if (n >= 20) return 30; if (n >= 15) return 10;
  if (n >= 12) return 5;   if (n >= 10) return 2;  return 1;
}

function gravity(g: string[][], rm: number[]): string[][] {
  const rs = new Set(rm);
  const flat = g.flat();
  const out = Array.from({ length: ROWS }, () => new Array<string>(COLS).fill(''));
  for (let c = 0; c < COLS; c++) {
    const keep = Array.from({ length: ROWS }, (_, r) => r * COLS + c)
      .filter(i => !rs.has(i))
      .map(i => flat[i]);
    const fill = Array.from({ length: ROWS - keep.length }, () => wpick(REG));
    const col = [...fill, ...keep];
    for (let r = 0; r < ROWS; r++) out[r][c] = col[r];
  }
  return out;
}

export interface CascadeStep {
  grid: string[][];
  win_pos: number[];
  bomb_pos: number[];
  bomb_mult: number;
  t_mult: number;
  step_pay: number;
  wins: Array<{ sym: string; count: number; sym_mult: number }>;
}

function simulate(g: string[][], maxM: number): CascadeStep[] {
  const steps: CascadeStep[] = [];
  let cur = g.map(r => [...r]);
  let tM = 1;

  for (let it = 0; it < 15; it++) {
    const cl = findClusters(cur);
    if (!cl.size) break;

    const wins: CascadeStep['wins'] = [];
    const wp: number[] = [];
    for (const [sym, pos] of cl) {
      const def = ALL.find(s => s.id === sym)!;
      const sm = clMult(pos.length);
      wins.push({ sym, count: pos.length, sym_mult: sm });
      wp.push(...pos);
    }

    // Bombs adjacent to any win position
    const wset = new Set(wp);
    const bp: number[] = [];
    cur.flat().forEach((s, i) => {
      if (s !== 'bomb') return;
      const rr = Math.floor(i / COLS), cc = i % COLS;
      const adj = [-1, 0, 1].flatMap(dr => [-1, 0, 1].map(dc => (rr + dr) * COLS + (cc + dc)))
        .filter(x => x >= 0 && x < TOTAL && x !== i);
      if (adj.some(x => wset.has(x))) bp.push(i);
    });
    const bm = bp.reduce((s) => s + 2 + Math.floor(Math.random() * 4), 0);
    const em = Math.min(tM + bm, maxM);

    const basePay = wins.reduce((s, w) => {
      const def = ALL.find(x => x.id === w.sym)!;
      return s + def.v * w.sym_mult;
    }, 0) * em;

    steps.push({ grid: cur.map(r => [...r]), win_pos: wp, bomb_pos: bp, bomb_mult: bm, t_mult: em, step_pay: basePay, wins });
    cur = gravity(cur, [...wp, ...bp]);
    tM = Math.min(em + 1, maxM);
  }

  steps.push({ grid: cur.map(r => [...r]), win_pos: [], bomb_pos: [], bomb_mult: 0, t_mult: tM, step_pay: 0, wins: [] });
  return steps;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function winGrid(): string[][] {
  const n = Math.random() < 0.35 ? 2 : 1;
  const pool = REG.map(s => ({ ...s, w: Math.max(1, 12 - Math.floor(s.v)) }));
  const chosen: string[] = [];
  while (chosen.length < n) {
    const s = wpick(pool);
    if (!chosen.includes(s)) chosen.push(s);
  }
  const f: string[] = [];
  for (const sym of chosen) {
    const cnt = 8 + Math.floor(Math.random() * 9);
    for (let i = 0; i < cnt; i++) f.push(sym);
  }
  while (f.length < TOTAL) f.push(wpick(ALL));
  return flat2grid(shuffle(f).slice(0, TOTAL));
}

function loseGrid(): string[][] {
  for (let a = 0; a < 300; a++) {
    const f = Array.from({ length: TOTAL }, () => wpick(ALL));
    const g = flat2grid(f);
    if (!findClusters(g).size) return g;
  }
  const lo = ['heart', 'apple', 'lemon', 'orange', 'grape', 'heart'];
  const f = shuffle(Array.from({ length: TOTAL }, (_, i) => lo[i % lo.length]));
  const cnt: Record<string, number> = {};
  for (const s of f) cnt[s] = (cnt[s] ?? 0) + 1;
  for (const s of Object.keys(cnt)) {
    while ((cnt[s] ?? 0) >= 8) {
      const idx = f.lastIndexOf(s);
      const repl = lo.find(l => l !== s) ?? 'heart';
      f[idx] = repl; cnt[s]--; cnt[repl] = (cnt[repl] ?? 0) + 1;
    }
  }
  return flat2grid(f);
}

export async function POST(req: NextRequest) {
  try {
    const cs = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cs.getAll(),
          setAll: (list: { name: string; value: string; options: CookieOptions }[]) =>
            list.forEach(({ name, value, options }) => cs.set(name, value, options)),
        },
      },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const bet = Math.max(0.5, parseFloat(body.bet ?? '1'));
    const isFreeReq: boolean = !!body.is_free;

    const admin = createAdminSupabaseClient();

    const [cfgRes, walletRes] = await Promise.all([
      admin.from('slots_config').select('*').eq('id', 1).single(),
      admin.from('wallets').select('address').eq('user_id', user.id).single(),
    ]);

    const cfg = cfgRes.data;
    const C = {
      win_rate:    Number(cfg?.win_rate    ?? 35),
      max_mult:    Number(cfg?.max_mult    ?? 100),
      min_bet:     Number(cfg?.min_bet     ?? 1),
      max_bet:     Number(cfg?.max_bet     ?? 50000),
      fs_win_rate: Number(cfg?.fs_win_rate ?? 55),
      house_edge:  Number(cfg?.house_edge  ?? 8),   // % taken from every payout
      active:      cfg?.is_active          ?? true,
    };

    if (!C.active) return NextResponse.json({ success: false, error: 'Tragamonedas desactivada' }, { status: 400 });

    const wallet = walletRes.data;
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: bal } = await admin.from('balances').select('amount, nonce').eq('address', wallet.address).single();
    if (!bal) return NextResponse.json({ success: false, error: 'Sin balance' }, { status: 400 });

    // Check free spins
    let usingFS = false;
    let fsData: { spins_remaining: number } | null = null;
    if (isFreeReq) {
      const { data: fs } = await admin.from('slots_free_spins').select('spins_remaining').eq('address', wallet.address).single();
      if (fs && fs.spins_remaining > 0) {
        usingFS = true;
        fsData = fs;
      }
    }

    const actualBet = usingFS ? 0 : bet;
    let debitedBalance = Number(bal.amount);

    if (usingFS && fsData) {
      // Decremento condicional: dos requests simultáneos no pueden gastar el
      // mismo giro gratis (solo el primero encuentra el contador sin cambiar)
      const { data: fsUpdated } = await admin.from('slots_free_spins').update({
        spins_remaining: fsData.spins_remaining - 1,
        updated_at: new Date().toISOString(),
      }).eq('address', wallet.address)
        .eq('spins_remaining', fsData.spins_remaining)
        .select('spins_remaining');
      if (!fsUpdated || fsUpdated.length === 0)
        return NextResponse.json({ success: false, error: 'Giro gratis ya usado — reintenta' }, { status: 409 });
    } else {
      if (bet < C.min_bet || bet > C.max_bet)
        return NextResponse.json({ success: false, error: `Apuesta entre ${C.min_bet} y ${C.max_bet} CHC` }, { status: 400 });
      // Débito atómico de la apuesta
      const debitRes = await debit(admin, wallet.address, bet);
      if (!debitRes.ok)
        return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });
      debitedBalance = debitRes.newBalance;
    }

    // Generate grid
    const winRate = usingFS ? C.fs_win_rate : C.win_rate;
    const shouldWin = Math.random() * 100 < winRate;
    const grid = shouldWin ? winGrid() : loseGrid();

    // Scatters → free spins
    const scatterCnt = grid.flat().filter(s => s === 'scatter').length;
    const fsTriggered = scatterCnt >= 6 ? 15 : scatterCnt >= 5 ? 12 : scatterCnt >= 4 ? 10 : 0;

    // Cascade
    const steps = simulate(grid, C.max_mult);
    const totalBase = steps.reduce((s, step) => s + step.step_pay, 0);
    const payBet = usingFS ? bet : actualBet; // free spins pay at requested bet rate

    // Apply house edge: reduce payout by house_edge% (e.g. 8% → player gets 92% of base win)
    const houseMultiplier = 1 - Math.max(0, Math.min(50, C.house_edge)) / 100;
    const totalPay = Math.round(totalBase * payBet * houseMultiplier * 100) / 100;
    const netChange = totalPay - actualBet;

    // Acreditar el premio (la apuesta ya fue debitada atómicamente)
    let newBal = debitedBalance;
    if (totalPay > 0) {
      const credited = await credit(admin, wallet.address, totalPay);
      newBal = credited ?? Math.round((debitedBalance + totalPay) * 100) / 100;
    }

    // House accounting: receives bet, pays payout. Net = actualBet - totalPay.
    // On a losing spin: house gets +actualBet (totalPay=0).
    // On a winning spin: house gets actualBet - totalPay (could be negative if big win).
    await adjustHouse(admin, actualBet - totalPay);

    // Record free spins if triggered
    if (fsTriggered > 0) {
      await admin.from('slots_free_spins').upsert({
        address: wallet.address,
        spins_remaining: fsTriggered,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address' });
    }

    // Transaction record (best-effort)
    try {
      await admin.from('transactions').insert({
        type: totalPay > actualBet ? 'CLAIM' : 'BUY',
        from_address: wallet.address,
        to_address: 'SLOTS',
        amount: Math.max(totalPay, actualBet),
        status: 'confirmed',
      });
    } catch { /* non-critical */ }

    const { data: remainFs } = await admin.from('slots_free_spins')
      .select('spins_remaining').eq('address', wallet.address).single();

    return NextResponse.json({
      success: true,
      data: {
        steps,
        total_payout: totalPay,
        bet: payBet,
        net_change: netChange,
        new_balance: Math.max(0, newBal),
        free_spins_triggered: fsTriggered,
        scatter_count: scatterCnt,
        used_free_spin: usingFS,
        free_spins_remaining: remainFs?.spins_remaining ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

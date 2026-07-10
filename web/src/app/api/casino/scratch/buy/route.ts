// Scratch card — instant-win lottery.
// Prize probabilities scale with configurable RTP from casino_settings.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { getCasinoSettings } from '@/lib/casino-settings';
import { cookies } from 'next/headers';

// Base tier table at 91.5% RTP (probability of each prize)
const BASE_RTP = 0.915;
const BASE_TIERS = [
  { id: 'mini',    mult: 1.5,  prob: 0.200,  label: 'Mini Premio',         sym: '🐔' },
  { id: 'small',   mult: 2.5,  prob: 0.060,  label: 'Premio Pequeño',      sym: '🌽' },
  { id: 'medium',  mult: 5,    prob: 0.025,  label: '¡Premio Mediano!',    sym: '🥚' },
  { id: 'large',   mult: 10,   prob: 0.010,  label: '¡Premio Grande!',     sym: '⭐' },
  { id: 'super',   mult: 25,   prob: 0.003,  label: '¡SÚPER PREMIO!',      sym: '🎰' },
  { id: 'mega',    mult: 50,   prob: 0.0015, label: '✨ MEGA PREMIO ✨',   sym: '💎' },
  { id: 'jackpot', mult: 100,  prob: 0.0004, label: '🎉 JACKPOT 🎉',      sym: '💎' },
  { id: 'ultra',   mult: 500,  prob: 0.0001, label: '👑 ULTRA JACKPOT 👑', sym: '💎' },
];

// Scales win probabilities to match target RTP, adjusting loss probability accordingly
function buildTiers(targetRtp: number) {
  const scale = Math.max(0.1, Math.min(2.0, targetRtp / BASE_RTP));
  const winTiers = BASE_TIERS.map(t => ({ ...t, prob: t.prob * scale }));
  const winSum   = winTiers.reduce((s, t) => s + t.prob, 0);
  const lossTier = { id: 'loss', mult: 0, prob: Math.max(0.001, 1 - winSum), label: '¡Mala suerte!', sym: '' };
  return [lossTier, ...winTiers];
}

function pickTier(tiers: ReturnType<typeof buildTiers>) {
  let r = Math.random();
  for (const tier of tiers) {
    if (r < tier.prob) return tier;
    r -= tier.prob;
  }
  return tiers[0];
}

const ALL_SYMS = ['🐔', '🌽', '🥚', '🦆', '⭐', '🔔', '🎰', '💰'];

function diffSym(exclude: string): string {
  const opts = ALL_SYMS.filter(s => s !== exclude);
  return opts[Math.floor(Math.random() * opts.length)];
}

function makeGrid(tierId: string, tierSym: string): string[] {
  // Row 0 always has the match (for winning tiers), rows 1-2 have no match
  const lossRow = (): string[] => {
    const a = ALL_SYMS[Math.floor(Math.random() * ALL_SYMS.length)];
    const b = diffSym(a); // guaranteed ≠ a → no triple match
    const c = ALL_SYMS[Math.floor(Math.random() * ALL_SYMS.length)];
    return [a, b, c];
  };

  if (tierId === 'loss') return [...lossRow(), ...lossRow(), ...lossRow()];

  // Winning: row 0 matches, rows 1-2 don't
  return [tierSym, tierSym, tierSym, ...lossRow(), ...lossRow()];
}

export async function POST(req: NextRequest) {
  try {
    const cs = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const bet = parseFloat(body.bet ?? '10');
    if (isNaN(bet) || bet < 1)   return NextResponse.json({ success: false, error: 'Mínimo 1 CHC' }, { status: 400 });
    if (bet > 1000000)              return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    // Débito atómico de la apuesta; luego se acredita el premio (si hay)
    const debitRes = await debit(admin, wallet.address, bet);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });

    const cfg = await getCasinoSettings(admin, 'scratch');
    const tiers = buildTiers(cfg.rtp);
    const tier = pickTier(tiers);
    const payout = Math.round(bet * tier.mult * 100) / 100;
    const symbols = makeGrid(tier.id, tier.sym);
    const netChange = Math.round((payout - bet) * 100) / 100;

    let newBal = debitRes.newBalance;
    if (payout > 0) {
      const credited = await credit(admin, wallet.address, payout);
      if (credited !== null) newBal = credited;
      else newBal = Math.round((debitRes.newBalance + payout) * 100) / 100;
    }

    // House receives bet, pays out payout
    await adjustHouse(admin, bet - payout);

    try {
      await admin.from('scratch_tickets').insert({
        address: wallet.address, bet, symbols, prize_mult: tier.mult,
        status: 'done', payout,
      });
    } catch { /* non-critical — table may not exist yet */ }

    return NextResponse.json({
      success: true,
      data: { symbols, tier_id: tier.id, tier_label: tier.label, prize_mult: tier.mult, payout, net_change: netChange, new_balance: newBal },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

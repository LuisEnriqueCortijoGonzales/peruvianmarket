import { NextResponse } from 'next/server';
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server';

const DEFAULTS = { rate_per_click: 0.01, cooldown_seconds: 2, is_active: true };

// SuperChamoCoins: minado desbloqueado al superar 5M CHC
const SCC_UNLOCK_THRESHOLD = 5_000_000;
const SCC_PER_CLICK = 0.001;

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin.from('mining_config').select('rate_per_click, cooldown_seconds, is_active').eq('id', 1).single();
    return NextResponse.json({ success: true, data: data ?? DEFAULTS });
  } catch {
    return NextResponse.json({ success: true, data: DEFAULTS });
  }
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const admin = createAdminSupabaseClient();

    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet configurada' }, { status: 400 });
    const { address } = wallet;

    // Get mining config (fallback to defaults if table missing)
    let config = DEFAULTS;
    try {
      const { data } = await admin.from('mining_config').select('*').eq('id', 1).single();
      if (data) config = data;
    } catch { /* table may not exist yet */ }

    if (!config.is_active) {
      return NextResponse.json({ success: false, error: 'Minería desactivada por el admin' }, { status: 403 });
    }

    const cooldownMs = config.cooldown_seconds * 1000;

    // Rate-limit: check last click in mining_log
    try {
      const { data: lastLog } = await admin
        .from('mining_log')
        .select('created_at')
        .eq('address', address)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastLog) {
        const elapsed = Date.now() - new Date(lastLog.created_at).getTime();
        if (elapsed < cooldownMs) {
          return NextResponse.json(
            { success: false, error: 'Cooldown activo', wait_ms: cooldownMs - elapsed },
            { status: 429 },
          );
        }
      }
    } catch { /* mining_log table may not exist yet */ }

    // Award CHC (+ SCC si el minado súper está desbloqueado)
    const { data: balance } = await admin
      .from('balances')
      .select('*')
      .eq('address', address)
      .single();

    const current = Number(balance?.amount ?? 0);
    const reward = Number(config.rate_per_click);

    const sccUnlocked = current >= SCC_UNLOCK_THRESHOLD;
    const currentScc = Number(balance?.scc ?? 0);
    const sccReward = sccUnlocked ? SCC_PER_CLICK : 0;

    const { error: updErr } = await admin.from('balances').update({
      amount: current + reward,
      scc: Math.round((currentScc + sccReward) * 10000) / 10000,
      nonce: (balance?.nonce ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('address', address);

    if (updErr) {
      // Columna scc aún no existe: otorgar solo CHC
      await admin.from('balances').update({
        amount: current + reward,
        nonce: (balance?.nonce ?? 0) + 1,
        updated_at: new Date().toISOString(),
      }).eq('address', address);
    }

    // Log click (ignore if table doesn't exist)
    try {
      await admin.from('mining_log').insert({ address, amount: reward });
    } catch { /* ignore */ }

    // Record transaction (ignore if type not allowed)
    try {
      await admin.from('transactions').insert({
        type: 'MINE',
        from_address: address,
        amount: reward,
        status: 'confirmed',
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      success: true,
      data: {
        reward,
        new_balance: current + reward,
        scc_unlocked: sccUnlocked,
        scc_reward: sccReward,
        scc_balance: Math.round((currentScc + sccReward) * 10000) / 10000,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

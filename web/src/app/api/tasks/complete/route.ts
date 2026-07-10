import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import type { EarnTask } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { task_id, user_id, address } = await request.json();

    if (!task_id || !user_id || !address) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    // Verify authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== user_id) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Check if already completed
    const { data: existing } = await admin
      .from('task_completions')
      .select('task_id')
      .eq('user_id', user_id)
      .eq('task_id', task_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Tarea ya completada' },
        { status: 400 },
      );
    }

    // Get task details
    const { data: task } = await admin
      .from('earn_tasks')
      .select('*')
      .eq('id', task_id)
      .eq('is_active', true)
      .single<EarnTask>();

    if (!task) {
      return NextResponse.json({ success: false, error: 'Tarea no encontrada' }, { status: 404 });
    }

    // Verify wallet belongs to user
    const { data: wallet } = await admin
      .from('wallets')
      .select('address')
      .eq('user_id', user_id)
      .eq('address', address)
      .single();

    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet no encontrada' }, { status: 401 });
    }

    // Verify task requirements
    const fulfilled = await verifyTaskRequirements(admin, task, address, user_id);
    if (!fulfilled) {
      return NextResponse.json(
        { success: false, error: 'No cumples los requisitos de esta tarea aún' },
        { status: 400 },
      );
    }

    // Grant reward
    const { data: bal } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', address)
      .single();

    const currentBalance = bal?.amount ?? 0;
    const currentNonce = bal?.nonce ?? 0;

    await admin.from('balances').upsert({
      address,
      amount: currentBalance + task.reward_pen,
      nonce: currentNonce + 1,
      updated_at: new Date().toISOString(),
    });

    // Record completion
    await admin.from('task_completions').insert({
      user_id,
      task_id,
      reward_paid: task.reward_pen,
    });

    // Record transaction
    await admin.from('transactions').insert({
      type: 'FAUCET',
      to_address: address,
      amount: task.reward_pen,
      status: 'confirmed',
    });

    return NextResponse.json({
      success: true,
      data: { reward: task.reward_pen, new_balance: currentBalance + task.reward_pen },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

async function verifyTaskRequirements(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  task: EarnTask,
  address: string,
  userId: string,
): Promise<boolean> {
  const req = task.requirements as Record<string, number | string> | null;
  if (!req) return true;

  switch (task.task_type) {
    case 'faucet': {
      const { data } = await admin
        .from('faucet_claims')
        .select('address')
        .eq('address', address)
        .maybeSingle();
      return !!data;
    }

    case 'trade': {
      const minTrades = req.min_trades as number;
      const { count } = await admin
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('from_address', address)
        .in('type', ['BUY', 'SELL']);
      return (count ?? 0) >= minTrades;
    }

    case 'create_market': {
      const minMarkets = req.min_markets as number;
      const { count } = await admin
        .from('markets')
        .select('*', { count: 'exact', head: true })
        .eq('creator_address', address);
      return (count ?? 0) >= minMarkets;
    }

    case 'transfer': {
      const minTransfers = req.min_transfers as number;
      const { count } = await admin
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('from_address', address)
        .eq('type', 'TRANSFER');
      return (count ?? 0) >= minTransfers;
    }

    case 'resolve': {
      const minResolved = req.min_resolved as number;
      const { count } = await admin
        .from('markets')
        .select('*', { count: 'exact', head: true })
        .eq('creator_address', address)
        .eq('status', 'resolved');
      return (count ?? 0) >= minResolved;
    }

    default:
      return true;
  }
}

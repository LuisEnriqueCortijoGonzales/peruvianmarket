import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';

const FAUCET_AMOUNT = 100;

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();
    if (!address) {
      return NextResponse.json({ success: false, error: 'Dirección requerida' }, { status: 400 });
    }

    // Verify authentication
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Verify wallet belongs to user
    const { data: wallet } = await admin
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .eq('address', address)
      .single();

    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet no encontrada' }, { status: 401 });
    }

    // Check if faucet already claimed
    const { data: existingClaim } = await admin
      .from('faucet_claims')
      .select('address')
      .eq('address', address)
      .maybeSingle();

    if (existingClaim) {
      return NextResponse.json(
        { success: false, error: 'El faucet ya fue reclamado para esta dirección' },
        { status: 400 },
      );
    }

    // Get current balance
    const { data: balance } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', address)
      .single();

    const currentBalance = balance?.amount ?? 0;
    const currentNonce = balance?.nonce ?? 0;

    // Credit faucet amount (upsert ensures balance row always exists)
    const { error: balErr } = await admin
      .from('balances')
      .upsert({
        address,
        amount: currentBalance + FAUCET_AMOUNT,
        nonce: currentNonce + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'address' });

    if (balErr) throw new Error(`Error acreditando balance: ${balErr.message}`);

    // Mark as claimed
    await admin.from('faucet_claims').insert({ address });

    // Record transaction
    await admin.from('transactions').insert({
      type: 'FAUCET',
      to_address: address,
      amount: FAUCET_AMOUNT,
      status: 'confirmed',
    });

    return NextResponse.json({
      success: true,
      data: { amount: FAUCET_AMOUNT, new_balance: currentBalance + FAUCET_AMOUNT },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json();
    if (!address) {
      return NextResponse.json({ success: false, error: 'Dirección requerida' }, { status: 400 });
    }

    // Verify the user is authenticated
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    }

    // Verify this address belongs to the user
    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .eq('address', address)
      .single();

    if (!wallet) {
      return NextResponse.json({ success: false, error: 'Wallet no encontrada' }, { status: 401 });
    }

    // Create initial balance (0 PEN)
    await admin
      .from('balances')
      .upsert({ address, amount: 0, nonce: 0 }, { onConflict: 'address', ignoreDuplicates: true });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

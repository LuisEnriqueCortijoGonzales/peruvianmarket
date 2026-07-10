import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { verifySignature } from '@/lib/crypto';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, to, amount, nonce, signature, public_key, timestamp } = body;

    if (!from || !to || !amount || !signature || !public_key) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    if (from === to) {
      return NextResponse.json({ success: false, error: 'No puedes transferirte a ti mismo' }, { status: 400 });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ success: false, error: 'Monto inválido' }, { status: 400 });
    }

    // Verify signature
    const txData: Record<string, unknown> = {
      type: 'TRANSFER',
      from,
      to,
      amount: amountNum,
      nonce,
      timestamp,
    };

    if (!verifySignature(txData, signature, public_key)) {
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Verify sender wallet
    const { data: walletData } = await admin
      .from('wallets')
      .select('address')
      .eq('address', from)
      .eq('public_key', public_key)
      .single();

    if (!walletData) {
      return NextResponse.json({ success: false, error: 'Wallet no autorizada' }, { status: 401 });
    }

    // Get sender balance
    const { data: senderBalance } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', from)
      .single();

    const currentBalance = senderBalance?.amount ?? 0;
    const currentNonce = senderBalance?.nonce ?? 0;

    if (currentBalance < amountNum) {
      return NextResponse.json(
        { success: false, error: `Saldo insuficiente: ${currentBalance.toFixed(2)} PEN` },
        { status: 400 },
      );
    }

    if (nonce !== currentNonce + 1) {
      return NextResponse.json({ success: false, error: 'Nonce inválido' }, { status: 400 });
    }

    // Verify recipient exists
    const { data: recipientBalance } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', to)
      .single();

    if (!recipientBalance) {
      return NextResponse.json(
        { success: false, error: 'Dirección destinataria no encontrada en la plataforma' },
        { status: 404 },
      );
    }

    // Débito con lock optimista: solo aplica si el nonce no cambió entre la
    // lectura y la escritura (otra operación concurrente lo invalidaría).
    const { data: debited } = await admin
      .from('balances')
      .update({
        amount: Math.round((currentBalance - amountNum) * 100) / 100,
        nonce: currentNonce + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('address', from)
      .eq('nonce', currentNonce)
      .select('address');

    if (!debited || debited.length === 0) {
      return NextResponse.json(
        { success: false, error: 'La cuenta cambió durante la operación. Intenta de nuevo.' },
        { status: 409 },
      );
    }

    // Crédito atómico al receptor (RPC evita lost updates concurrentes)
    const { error: creditErr } = await admin.rpc('add_to_balance', {
      p_address: to,
      p_delta: amountNum,
    });
    if (creditErr) {
      // Fallback si la función SQL aún no existe
      await admin.from('balances').update({
        amount: Math.round((recipientBalance.amount + amountNum) * 100) / 100,
        updated_at: new Date().toISOString(),
      }).eq('address', to);
    }

    // Record transaction
    await admin.from('transactions').insert({
      type: 'TRANSFER',
      from_address: from,
      to_address: to,
      amount: amountNum,
      signature,
      nonce,
    });

    return NextResponse.json({
      success: true,
      data: { from, to, amount: amountNum },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

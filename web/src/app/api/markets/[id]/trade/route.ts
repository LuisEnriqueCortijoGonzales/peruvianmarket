import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { verifySignature } from '@/lib/crypto';
import { applyBuy } from '@/lib/amm';
import type { Market } from '@/lib/types';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { from, outcome, amount, nonce, signature, public_key, timestamp } = body;

    if (!from || !outcome || !amount || !signature || !public_key) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    if (!['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ success: false, error: 'Outcome inválido' }, { status: 400 });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ success: false, error: 'Monto inválido' }, { status: 400 });
    }

    // Verify signature
    const txData: Record<string, unknown> = {
      type: 'BUY',
      from,
      market_id: id,
      outcome,
      amount: amountNum,
      nonce,
      timestamp,
    };

    if (!verifySignature(txData, signature, public_key)) {
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Verify wallet
    const { data: walletData } = await admin
      .from('wallets')
      .select('address')
      .eq('address', from)
      .eq('public_key', public_key)
      .single();

    if (!walletData) {
      return NextResponse.json({ success: false, error: 'Wallet no autorizada' }, { status: 401 });
    }

    // Get market
    const { data: market } = await admin
      .from('markets')
      .select('*')
      .eq('id', id)
      .single<Market>();

    if (!market) {
      return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    }

    if (market.status !== 'open') {
      return NextResponse.json({ success: false, error: 'El mercado está cerrado' }, { status: 400 });
    }

    // Get balance
    const { data: balance } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', from)
      .single();

    const currentBalance = balance?.amount ?? 0;
    const currentNonce = balance?.nonce ?? 0;

    if (currentBalance < amountNum) {
      return NextResponse.json(
        { success: false, error: `Saldo insuficiente: ${currentBalance.toFixed(2)} CHC` },
        { status: 400 },
      );
    }

    if (nonce !== currentNonce + 1) {
      return NextResponse.json({ success: false, error: 'Nonce inválido' }, { status: 400 });
    }

    // Apply AMM trade
    const { newYesReserve, newNoReserve, sharesOut } = applyBuy(
      market.yes_reserve,
      market.no_reserve,
      outcome,
      amountNum,
    );

    if (sharesOut <= 0) {
      return NextResponse.json({ success: false, error: 'Monto demasiado pequeño' }, { status: 400 });
    }

    // Update market reserves
    await admin
      .from('markets')
      .update({
        yes_reserve: newYesReserve,
        no_reserve: newNoReserve,
      })
      .eq('id', id);

    // Update balance
    await admin
      .from('balances')
      .update({
        amount: currentBalance - amountNum,
        nonce: currentNonce + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('address', from);

    // Update position (upsert)
    const { data: existingPos } = await admin
      .from('positions')
      .select('yes_shares, no_shares')
      .eq('address', from)
      .eq('market_id', id)
      .single();

    const newYesShares = (existingPos?.yes_shares ?? 0) + (outcome === 'YES' ? sharesOut : 0);
    const newNoShares = (existingPos?.no_shares ?? 0) + (outcome === 'NO' ? sharesOut : 0);

    await admin
      .from('positions')
      .upsert({
        address: from,
        market_id: id,
        yes_shares: newYesShares,
        no_shares: newNoShares,
        updated_at: new Date().toISOString(),
      });

    // Record transaction
    await admin.from('transactions').insert({
      type: 'BUY',
      from_address: from,
      market_id: id,
      amount: amountNum,
      outcome,
      shares: sharesOut,
      signature,
      nonce,
    });

    return NextResponse.json({
      success: true,
      data: {
        shares_out: sharesOut,
        new_yes_reserve: newYesReserve,
        new_no_reserve: newNoReserve,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

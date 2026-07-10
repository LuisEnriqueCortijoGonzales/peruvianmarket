import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { verifySignature } from '@/lib/crypto';
import { signResolution } from '@/lib/oracle';
import type { Market } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { from, market_id, outcome, nonce, signature, public_key, timestamp } = body;

    if (!from || !market_id || !outcome || !signature || !public_key) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    if (!['YES', 'NO'].includes(outcome)) {
      return NextResponse.json({ success: false, error: 'Outcome inválido' }, { status: 400 });
    }

    // Verify SECP256K1 signature from the resolver
    const txData: Record<string, unknown> = {
      type: 'RESOLVE',
      from,
      market_id,
      outcome,
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
      .eq('id', market_id)
      .single<Market>();

    if (!market) {
      return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    }

    if (market.status !== 'open') {
      return NextResponse.json({ success: false, error: 'El mercado ya fue resuelto' }, { status: 400 });
    }

    if (market.creator_address !== from) {
      return NextResponse.json(
        { success: false, error: 'Solo el creador del mercado puede resolverlo' },
        { status: 403 },
      );
    }

    // Oracle signs the resolution for auditability
    const resolutionTimestamp = Date.now();
    let oracleSignature: string | null = null;
    try {
      oracleSignature = await signResolution(market_id, outcome, resolutionTimestamp);
    } catch {
      // Oracle key not configured — proceed without oracle sig in dev
    }

    // Resolve the market
    await admin
      .from('markets')
      .update({
        status: 'resolved',
        resolution: outcome,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', market_id);

    // Distribute winnings to holders of winning shares
    const winningOutcome = outcome as 'YES' | 'NO';

    const { data: positions } = await admin
      .from('positions')
      .select('*')
      .eq('market_id', market_id)
      .returns<{ address: string; yes_shares: number; no_shares: number }[]>();

    if (positions && positions.length > 0) {
      for (const pos of positions) {
        const winningShares =
          winningOutcome === 'YES' ? pos.yes_shares : pos.no_shares;

        if (winningShares > 0) {
          // 1 winning share = 1 PEN
          const { data: bal } = await admin
            .from('balances')
            .select('amount')
            .eq('address', pos.address)
            .single();

          const currentBalance = bal?.amount ?? 0;
          await admin
            .from('balances')
            .upsert({
              address: pos.address,
              amount: currentBalance + winningShares,
              updated_at: new Date().toISOString(),
            });

          // Record claim transaction
          await admin.from('transactions').insert({
            type: 'CLAIM',
            from_address: market_id,
            to_address: pos.address,
            market_id,
            amount: winningShares,
            outcome: winningOutcome,
          });
        }
      }
    }

    // Record resolve transaction
    await admin.from('transactions').insert({
      type: 'RESOLVE',
      from_address: from,
      market_id,
      outcome,
      signature: oracleSignature ?? signature,
      nonce,
    });

    return NextResponse.json({
      success: true,
      data: {
        market_id,
        outcome,
        oracle_signature: oracleSignature,
        resolved_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

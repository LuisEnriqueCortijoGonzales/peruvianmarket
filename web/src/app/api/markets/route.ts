import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createClient } from '@/lib/supabase/server';
import { verifySignature } from '@/lib/crypto';
import { calcPrices } from '@/lib/amm';
import type { Market } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminSupabaseClient();
    const { searchParams } = new URL(request.url);

    let query = supabase
      .from('markets')
      .select('*')
      .order('created_at', { ascending: false });

    const status = searchParams.get('status');
    if (status) query = query.eq('status', status);

    const category = searchParams.get('category');
    if (category) query = query.eq('category', category);

    const { data, error } = await query.returns<Market[]>();
    if (error) throw error;

    const enriched = (data ?? []).map((m) => {
      const prices = calcPrices(m.yes_reserve, m.no_reserve);
      return { ...m, yes_price: prices.yes, no_price: prices.no };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      from,
      question,
      description,
      category,
      initial_liquidity,
      initial_probability,
      end_date,
      nonce,
      signature,
      public_key,
    } = body;

    if (!from || !question || !signature || !public_key) {
      return NextResponse.json({ success: false, error: 'Parámetros incompletos' }, { status: 400 });
    }

    // Verify signature
    const txData: Record<string, unknown> = {
      type: 'CREATE_MARKET',
      from,
      question,
      description: description ?? null,
      category: category ?? 'general',
      initial_liquidity,
      initial_probability,
      end_date: end_date ?? null,
      nonce,
      timestamp: body.timestamp,
    };

    if (!verifySignature(txData, signature, public_key)) {
      return NextResponse.json({ success: false, error: 'Firma inválida' }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();

    // Verify address matches public_key
    const { data: walletData } = await admin
      .from('wallets')
      .select('address')
      .eq('address', from)
      .eq('public_key', public_key)
      .single();

    if (!walletData) {
      return NextResponse.json({ success: false, error: 'Wallet no autorizada' }, { status: 401 });
    }

    // Check balance
    const { data: balance } = await admin
      .from('balances')
      .select('amount, nonce')
      .eq('address', from)
      .single();

    const currentBalance = balance?.amount ?? 0;
    const currentNonce = balance?.nonce ?? 0;

    if (currentBalance < initial_liquidity) {
      return NextResponse.json(
        { success: false, error: `Saldo insuficiente: tienes ${currentBalance.toFixed(2)} CHC` },
        { status: 400 },
      );
    }

    if (nonce !== currentNonce + 1) {
      return NextResponse.json({ success: false, error: 'Nonce inválido' }, { status: 400 });
    }

    // Calculate initial reserves from probability and liquidity
    const prob = Math.max(0.05, Math.min(0.95, initial_probability));
    const k = initial_liquidity * initial_liquidity;
    // yes_price = no_reserve / (yes_reserve + no_reserve) = prob
    // => no_reserve = prob * (yes_reserve + no_reserve)
    // Using: yes_reserve * no_reserve = k and yes_price = prob
    // yes_reserve = sqrt(k * (1-prob)/prob), no_reserve = sqrt(k * prob/(1-prob))
    const yesReserve = Math.sqrt(k * (1 - prob) / prob);
    const noReserve = Math.sqrt(k * prob / (1 - prob));

    // Create market
    const { data: market, error: marketError } = await admin
      .from('markets')
      .insert({
        question,
        description: description || null,
        creator_address: from,
        yes_reserve: yesReserve,
        no_reserve: noReserve,
        category: category ?? 'general',
        end_date: end_date || null,
      })
      .select()
      .single<Market>();

    if (marketError) throw marketError;

    // Deduct liquidity from creator's balance
    await admin
      .from('balances')
      .update({
        amount: currentBalance - initial_liquidity,
        nonce: currentNonce + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('address', from);

    // Record transaction
    await admin.from('transactions').insert({
      type: 'CREATE_MARKET',
      from_address: from,
      market_id: market.id,
      amount: initial_liquidity,
      signature,
      nonce,
    });

    return NextResponse.json({ success: true, data: market }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

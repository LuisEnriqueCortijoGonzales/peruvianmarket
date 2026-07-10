import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { calcPrices, quoteBuy } from '@/lib/amm';
import type { Market } from '@/lib/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const admin = createAdminSupabaseClient();
    const { data: market, error } = await admin
      .from('markets')
      .select('*')
      .eq('id', id)
      .single<Market>();

    if (error || !market) {
      return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    }

    const prices = calcPrices(market.yes_reserve, market.no_reserve);

    return NextResponse.json({
      success: true,
      data: {
        ...market,
        yes_price: prices.yes,
        no_price: prices.no,
        total_liquidity: market.yes_reserve + market.no_reserve,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// GET quote for a trade (query param: outcome, amount)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const outcome = searchParams.get('outcome') as 'YES' | 'NO' | null;
    const amount = parseFloat(searchParams.get('amount') ?? '0');

    if (!outcome || !['YES', 'NO'].includes(outcome) || isNaN(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data: market } = await admin
      .from('markets')
      .select('yes_reserve, no_reserve, status')
      .eq('id', id)
      .single<Pick<Market, 'yes_reserve' | 'no_reserve' | 'status'>>();

    if (!market) {
      return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
    }

    if (market.status !== 'open') {
      return NextResponse.json({ success: false, error: 'Mercado cerrado' }, { status: 400 });
    }

    const quote = quoteBuy(market, outcome, amount);
    return NextResponse.json({ success: true, data: quote });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

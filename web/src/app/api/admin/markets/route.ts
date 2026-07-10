import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient as createServiceClient } from '@supabase/supabase-js';

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function getAdminUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  return profile?.is_admin ? user : null;
}

// POST /api/admin/markets — crear mercado con probabilidad inicial
export async function POST(request: NextRequest) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
  }

  const body = await request.json();
  const {
    question,
    description,
    category = 'general',
    end_date,
    initial_probability = 0.5,   // P_admin inicial
    initial_liquidity = 1000,     // k = L^2, reserves ~ L
    admin_confidence = 100,
  } = body;

  if (!question?.trim()) {
    return NextResponse.json({ success: false, error: 'La pregunta es requerida' }, { status: 400 });
  }

  const p = Math.max(0.01, Math.min(0.99, Number(initial_probability)));
  const L = Math.max(100, Number(initial_liquidity));

  // Calcular reservas para que AMM refleje P desde el inicio
  // yes_price = no_reserve / (yes_reserve + no_reserve) = p
  // k = yes_reserve * no_reserve = L^2
  // yes_reserve = L * sqrt((1-p)/p), no_reserve = L * sqrt(p/(1-p))
  const yes_reserve = L * Math.sqrt((1 - p) / p);
  const no_reserve = L * Math.sqrt(p / (1 - p));

  const db = serviceClient();
  const { data: market, error } = await db
    .from('markets')
    .insert({
      question: question.trim(),
      description: description?.trim() || null,
      category,
      end_date: end_date || null,
      creator_address: 'HOUSE',
      creator_user_id: adminUser.id,
      yes_reserve,
      no_reserve,
      admin_probability: p,
      admin_confidence: Number(admin_confidence),
      status: 'open',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: market });
}

// PATCH /api/admin/markets — resolver mercado binario como admin
export async function PATCH(request: NextRequest) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
  }

  const body = await request.json();
  const { market_id, resolution } = body;

  if (!market_id || !['YES', 'NO'].includes(resolution)) {
    return NextResponse.json({ success: false, error: 'market_id y resolution (YES|NO) requeridos' }, { status: 400 });
  }

  const db = serviceClient();

  const { data: market } = await db.from('markets').select('status').eq('id', market_id).single();
  if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
  if (market.status !== 'open') return NextResponse.json({ success: false, error: 'El mercado ya está cerrado' }, { status: 400 });

  await db.from('markets').update({
    status: 'resolved',
    resolution,
    resolved_at: new Date().toISOString(),
  }).eq('id', market_id);

  // Pay winning shareholders (1 share = 1 CHC)
  const { data: positions } = await db
    .from('positions')
    .select('address, yes_shares, no_shares')
    .eq('market_id', market_id);

  let winnersCount = 0;
  for (const pos of positions ?? []) {
    const winningShares = resolution === 'YES' ? Number(pos.yes_shares) : Number(pos.no_shares);
    if (winningShares > 0) {
      const { data: bal } = await db.from('balances').select('amount').eq('address', pos.address).single();
      const currentBalance = Number(bal?.amount ?? 0);
      await db.from('balances').upsert({
        address: pos.address,
        amount: currentBalance + winningShares,
        updated_at: new Date().toISOString(),
      });
      await db.from('transactions').insert({
        type: 'CLAIM',
        from_address: market_id,
        to_address: pos.address,
        market_id,
        amount: winningShares,
        outcome: resolution,
        status: 'confirmed',
      });
      winnersCount++;
    }
  }

  await db.from('transactions').insert({
    type: 'RESOLVE',
    from_address: 'HOUSE',
    market_id,
    outcome: resolution,
    status: 'confirmed',
  });

  return NextResponse.json({ success: true, data: { resolution, winners_paid: winnersCount } });
}

// DELETE /api/admin/markets — cancelar mercado
export async function DELETE(request: NextRequest) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
  }

  const { market_id } = await request.json();
  if (!market_id) {
    return NextResponse.json({ success: false, error: 'market_id requerido' }, { status: 400 });
  }

  const db = serviceClient();
  const { error } = await db
    .from('markets')
    .update({ status: 'cancelled' })
    .eq('id', market_id)
    .eq('status', 'open');

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

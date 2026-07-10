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

/**
 * POST /api/admin/probability
 *
 * Aplica la fórmula de probabilidad ponderada al AMM del mercado.
 *
 * Fórmula:
 *   P_blend = (V × P_market + C × P_admin) / (V + C)
 *
 * Donde:
 *   V        = volumen total de trades en PEN
 *   C        = confianza admin (peso en PEN)
 *   P_market = precio implícito del AMM = no_reserve / (yes+no)
 *   P_admin  = estimado del admin (0–1)
 *
 * Luego ajusta las reservas preservando k = yes*no:
 *   yes_reserve_new = sqrt(k × (1 − P_blend) / P_blend)
 *   no_reserve_new  = sqrt(k × P_blend / (1 − P_blend))
 */
export async function POST(request: NextRequest) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
  }

  const body = await request.json();
  const { market_id, admin_probability, admin_confidence, apply } = body;

  if (!market_id) {
    return NextResponse.json({ success: false, error: 'market_id requerido' }, { status: 400 });
  }

  const db = serviceClient();

  // Obtener mercado actual
  const { data: market, error: fetchError } = await db
    .from('markets')
    .select('yes_reserve, no_reserve, status')
    .eq('id', market_id)
    .single();

  if (fetchError || !market) {
    return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });
  }
  if (market.status !== 'open') {
    return NextResponse.json({ success: false, error: 'Solo se pueden ajustar mercados abiertos' }, { status: 400 });
  }

  const yr = Number(market.yes_reserve);
  const nr = Number(market.no_reserve);
  const pMarket = nr / (yr + nr);

  // Obtener volumen total
  const { data: volData } = await db
    .rpc('get_market_volume', { p_market_id: market_id });
  const volume = Number(volData ?? 0);

  const pAdmin = Math.max(0.01, Math.min(0.99, Number(admin_probability)));
  const C = Math.max(1, Number(admin_confidence));

  // Probabilidad ponderada
  const pBlend = (volume * pMarket + C * pAdmin) / (volume + C);

  // Solo guardar los parámetros admin (sin mover el AMM)
  const updatePayload: Record<string, unknown> = {
    admin_probability: pAdmin,
    admin_confidence: C,
  };

  // Si apply=true, mover el AMM a P_blend preservando k
  if (apply) {
    const k = yr * nr;
    const newYr = Math.sqrt(k * (1 - pBlend) / pBlend);
    const newNr = Math.sqrt(k * pBlend / (1 - pBlend));
    updatePayload.yes_reserve = newYr;
    updatePayload.no_reserve = newNr;
  }

  const { error: updateError } = await db
    .from('markets')
    .update(updatePayload)
    .eq('id', market_id);

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      p_market: pMarket,
      p_admin: pAdmin,
      p_blend: pBlend,
      volume,
      confidence: C,
      applied: !!apply,
    },
  });
}

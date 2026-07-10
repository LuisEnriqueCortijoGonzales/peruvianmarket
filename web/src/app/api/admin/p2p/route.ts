// Oráculo P2P (admin): lista mercados en disputa o vencidos sin resolver,
// y los resuelve firmando el veredicto con Ed25519.
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { signP2PResolution } from '@/lib/oracle';
import { settleP2P } from '@/lib/p2p';

async function getAdminUser() {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
  return data?.is_admin ? user : null;
}

// GET — casos que requieren oráculo: disputados + activos vencidos
export async function GET() {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const nowISO = new Date().toISOString();
  const [disputedRes, expiredRes] = await Promise.all([
    admin.from('p2p_markets')
      .select('id, creator_address, opponent_address, amount, deadline, verdict_creator, verdict_opponent, created_at')
      .eq('status', 'disputed').order('created_at', { ascending: true }),
    admin.from('p2p_markets')
      .select('id, creator_address, opponent_address, amount, deadline, verdict_creator, verdict_opponent, created_at')
      .eq('status', 'active').lt('deadline', nowISO).order('deadline', { ascending: true }),
  ]);

  return NextResponse.json({
    success: true,
    data: { disputed: disputedRes.data ?? [], expired: expiredRes.data ?? [] },
  });
}

// POST — resolver: { market_id, winner: 'creator' | 'opponent' }
export async function POST(req: NextRequest) {
  const user = await getAdminUser();
  if (!user) return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });

  const { market_id, winner } = await req.json().catch(() => ({}));
  if (!market_id || !['creator', 'opponent'].includes(winner))
    return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: market } = await admin.from('p2p_markets')
    .select('id, creator_address, opponent_address, status, deadline')
    .eq('id', market_id).single();
  if (!market) return NextResponse.json({ success: false, error: 'Mercado no encontrado' }, { status: 404 });

  const eligible =
    market.status === 'disputed' ||
    (market.status === 'active' && new Date(market.deadline).getTime() < Date.now());
  if (!eligible)
    return NextResponse.json({ success: false, error: 'Solo mercados disputados o vencidos' }, { status: 400 });

  const winnerAddress = winner === 'creator' ? market.creator_address : market.opponent_address;
  const ts = Date.now();
  const oracleSig = await signP2PResolution(market_id, winnerAddress, ts);

  // Claim condicional + pago del pot (settleP2P es idempotente por el claim)
  const ok = await settleP2P(admin, market_id, winnerAddress, ['disputed', 'active'], {
    oracle_sig: oracleSig,
    oracle_ts: ts,
  });
  if (!ok) return NextResponse.json({ success: false, error: 'El mercado ya fue liquidado' }, { status: 409 });

  return NextResponse.json({ success: true, data: { winner_address: winnerAddress, oracle_sig: oracleSig } });
}

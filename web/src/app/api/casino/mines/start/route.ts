import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { adjustHouse } from '@/lib/casino-house';
import { credit, debit } from '@/lib/casino-bank';
import { getCasinoSettings } from '@/lib/casino-settings';
import { generateMinePositions, MINES_OPTIONS } from '@/lib/mines';
import { cookies } from 'next/headers';

async function getUser() {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
  );
  return sb.auth.getUser().then(r => r.data.user);
}

// GET — resume active game (mine positions hidden from client)
export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: true, data: null });
    const { data: game } = await admin
      .from('mines_games')
      .select('id, bet, mines_count, revealed_safe, house_edge, status')
      .eq('address', wallet.address).eq('status', 'active')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return NextResponse.json({ success: true, data: game });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

// POST — start new game { bet, mines }
export async function POST(req: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const body  = await req.json().catch(() => ({}));
    const bet   = parseFloat(body.bet ?? '10');
    const mines = parseInt(body.mines ?? '3', 10);

    if (isNaN(bet) || bet < 1)  return NextResponse.json({ success: false, error: 'Mínimo 1 CHC' }, { status: 400 });
    if (bet > 1000000)             return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });
    if (!MINES_OPTIONS.includes(mines as typeof MINES_OPTIONS[number]))
      return NextResponse.json({ success: false, error: 'Número de minas inválido' }, { status: 400 });

    const admin = createAdminSupabaseClient();
    const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
    if (!wallet) return NextResponse.json({ success: false, error: 'Sin wallet' }, { status: 400 });

    const { data: existing } = await admin.from('mines_games')
      .select('id').eq('address', wallet.address).eq('status', 'active').maybeSingle();
    if (existing) return NextResponse.json({ success: false, error: 'Ya tienes una partida activa' }, { status: 400 });

    const cfg        = await getCasinoSettings(admin, 'mines');
    const houseEdge  = cfg.house_edge;
    const minePos    = generateMinePositions(mines);

    // Débito atómico: chequeo y descuento en una sola operación SQL
    const debitRes = await debit(admin, wallet.address, bet);
    if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });
    await adjustHouse(admin, bet);

    const { data: game, error: insertErr } = await admin.from('mines_games').insert({
      address: wallet.address,
      bet,
      mines_count: mines,
      mine_positions: minePos,
      revealed_safe: [],
      house_edge: houseEdge,
      status: 'active',
    }).select('id').single();

    if (insertErr || !game) {
      // Rollback: devolver la apuesta
      await credit(admin, wallet.address, bet);
      await adjustHouse(admin, -bet);
      return NextResponse.json({ success: false, error: insertErr?.message ?? 'Error al crear la partida' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { game_id: game.id, bet, mines_count: mines, house_edge: houseEdge } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

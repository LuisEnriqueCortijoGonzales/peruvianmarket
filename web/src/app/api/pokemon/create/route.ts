// Crear reto o batalla vs bot.
// - pvp_random / pvp_custom: publica sala en espera (escrow del creador)
// - bot: arranca de inmediato; la casa recibe la apuesta y paga mult× si ganas
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';
import { credit, debit } from '@/lib/casino-bank';
import { adjustHouse } from '@/lib/casino-house';
import { startBattle, setAdminFactory, BOT_PAYOUTS, type BattleMode, type BotLevel } from '@/lib/pokemon-battle';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const MODES: BattleMode[] = ['pvp_random', 'pvp_custom', 'bot'];
const LEVELS: BotLevel[] = ['facil', 'medio', 'dificil'];

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
    const { admin, address } = auth;

    const body = await req.json().catch(() => ({}));
    const wager = parseFloat(body.wager ?? '10');
    const mode = (body.mode ?? 'pvp_random') as BattleMode;
    const botLevel = (body.bot_level ?? 'facil') as BotLevel;

    // vs bot permite apuesta 0 = modo práctica (gratis, sin premio)
    const isPractice = mode === 'bot' && wager === 0;
    if (isNaN(wager) || (!isPractice && wager < 1))
      return NextResponse.json({ success: false, error: 'Apuesta mínima 1 CHC' }, { status: 400 });
    if (wager > 1000000)             return NextResponse.json({ success: false, error: 'Máximo 1,000,000 CHC' }, { status: 400 });
    if (!MODES.includes(mode))       return NextResponse.json({ success: false, error: 'Modo inválido' }, { status: 400 });
    if (mode === 'bot' && !LEVELS.includes(botLevel))
      return NextResponse.json({ success: false, error: 'Dificultad inválida' }, { status: 400 });

    // Una batalla/reto a la vez
    const { data: existing } = await admin.from('pokemon_battles').select('id')
      .or(`creator_address.eq.${address},opponent_address.eq.${address}`)
      .in('status', ['waiting', 'active'])
      .limit(1).maybeSingle();
    if (existing) return NextResponse.json({ success: false, error: 'Ya tienes un reto o batalla en curso' }, { status: 400 });

    // Modo custom: exige equipo guardado
    if (mode === 'pvp_custom') {
      const { data: team } = await admin.from('pokemon_teams').select('address').eq('address', address).maybeSingle();
      if (!team) return NextResponse.json({ success: false, error: 'Primero crea tu equipo en el Team Builder' }, { status: 400 });
    }

    if (!isPractice) {
      const debitRes = await debit(admin, address, wager);
      if (!debitRes.ok) return NextResponse.json({ success: false, error: 'Balance insuficiente' }, { status: 400 });
    }

    const isBot = mode === 'bot';
    const { data: row, error } = await admin.from('pokemon_battles').insert({
      creator_address: address,
      opponent_address: isBot ? 'BOT' : null,
      wager,
      mode,
      bot_level: isBot ? botLevel : null,
      status: isBot ? 'active' : 'waiting',
    }).select('id').single();

    if (error || !row) {
      await credit(admin, address, wager);
      return NextResponse.json({ success: false, error: error?.message ?? 'Error al crear. ¿Corriste el SQL de pokemon?' }, { status: 500 });
    }

    if (isBot) {
      await adjustHouse(admin, wager); // la casa recibe la apuesta
      setAdminFactory(() => createAdminSupabaseClient());
      try {
        startBattle({
          id: row.id,
          mode: 'bot',
          botLevel,
          p1: { address, name: address },
          p2: { address: 'BOT', name: 'BOT' },
        });
      } catch (simErr) {
        // El simulador no arrancó: cancelar y devolver la apuesta
        await admin.from('pokemon_battles').update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('status', 'active');
        await credit(admin, address, wager);
        await adjustHouse(admin, -wager);
        return NextResponse.json({
          success: false,
          error: `No se pudo iniciar el simulador: ${simErr instanceof Error ? simErr.message : 'error'}`,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: { battle_id: row.id, wager, mode, bot_level: botLevel, payout_mult: BOT_PAYOUTS[botLevel], started: true },
      });
    }

    return NextResponse.json({ success: true, data: { battle_id: row.id, wager, mode } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

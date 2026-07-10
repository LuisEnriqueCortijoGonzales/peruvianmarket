import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { sealPendingBlocks, type BlockRow } from '@/lib/blockchain';

export async function GET(request: NextRequest) {
  try {
    const admin = createAdminSupabaseClient();
    const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get('limit') ?? '60'));

    // Sellar transacciones pendientes en bloques reales (best-effort)
    try { await sealPendingBlocks(admin); } catch { /* no bloquear la lectura */ }

    const [txRes, countRes, walletRes, blockRes] = await Promise.all([
      admin
        .from('transactions')
        .select('id, type, from_address, to_address, amount, market_id, created_at, status, block_number')
        .order('created_at', { ascending: false })
        .limit(limit),
      admin.from('transactions').select('*', { count: 'exact', head: true }),
      admin.from('wallets').select('*', { count: 'exact', head: true }),
      admin
        .from('blocks')
        .select('number, prev_hash, hash, tx_ids, tx_count, created_at')
        .order('number', { ascending: false })
        .limit(8),
    ]);

    const txs = txRes.data ?? [];
    const totalTxs = countRes.count ?? 0;
    const totalWallets = walletRes.count ?? 0;
    const totalVolume = txs.reduce((s, t) => s + Math.abs(Number(t.amount ?? 0)), 0);
    const chainBlocks = (blockRes.data ?? []) as BlockRow[];

    // Resolver las transacciones de cada bloque en una sola consulta
    const blockTxIds = chainBlocks.flatMap(b => b.tx_ids);
    const txMap = new Map<string, Record<string, unknown>>();
    if (blockTxIds.length > 0) {
      const { data: blockTxs } = await admin
        .from('transactions')
        .select('id, type, from_address, to_address, amount, market_id, created_at, status')
        .in('id', blockTxIds);
      for (const t of blockTxs ?? []) txMap.set(t.id as string, t);
    }

    const blocks = chainBlocks.map(b => ({
      number: b.number,
      hash: '0x' + b.hash,
      prev_hash: '0x' + b.prev_hash,
      timestamp: b.created_at,
      tx_count: b.tx_count,
      transactions: b.tx_ids
        .map(id => txMap.get(id))
        .filter((t): t is Record<string, unknown> => !!t),
    }));

    return NextResponse.json({
      success: true,
      data: {
        transactions: txs,
        blocks,
        stats: {
          total_transactions: totalTxs,
          total_wallets: totalWallets,
          total_volume: totalVolume,
          latest_block: blocks[0]?.number ?? 0,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

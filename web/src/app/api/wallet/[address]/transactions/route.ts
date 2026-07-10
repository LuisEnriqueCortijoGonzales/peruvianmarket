import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { Transaction } from '@/lib/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    const admin = createAdminSupabaseClient();

    const { data, error } = await admin
      .from('transactions')
      .select('*')
      .or(`from_address.eq.${address},to_address.eq.${address}`)
      .order('created_at', { ascending: false })
      .limit(50)
      .returns<Transaction[]>();

    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

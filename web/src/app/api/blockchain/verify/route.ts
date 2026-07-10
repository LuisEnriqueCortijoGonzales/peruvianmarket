// Verificación pública de integridad de la cadena.
// Recomputa el hash de cada bloque y valida el encadenamiento prev_hash.
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { verifyChain } from '@/lib/blockchain';

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    const result = await verifyChain(admin);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// Helper compartido: usuario autenticado + su wallet, para API routes.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from './supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthedWallet {
  admin: SupabaseClient;
  userId: string;
  address: string;
}

export async function getAuthedWallet(): Promise<AuthedWallet | null> {
  const cs = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cs.getAll(), setAll: (l: { name: string; value: string; options: CookieOptions }[]) => l.forEach(({ name, value, options }) => cs.set(name, value, options)) } },
  );
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const admin = createAdminSupabaseClient();
  const { data: wallet } = await admin.from('wallets').select('address').eq('user_id', user.id).single();
  if (!wallet) return null;

  return { admin, userId: user.id, address: wallet.address };
}

// Llave pública de una wallet — necesaria para el ECDH antes de crear/aceptar.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedWallet } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedWallet();
    if (!auth) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

    const address = req.nextUrl.searchParams.get('address');
    if (!address) return NextResponse.json({ success: false, error: 'address requerido' }, { status: 400 });

    const { data } = await auth.admin.from('wallets')
      .select('address, public_key').eq('address', address).maybeSingle();
    if (!data) return NextResponse.json({ success: false, error: 'Wallet no encontrada' }, { status: 404 });

    return NextResponse.json({ success: true, data: { address: data.address, public_key: data.public_key } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 });
  }
}

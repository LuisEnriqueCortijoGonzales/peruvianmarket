import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2]),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Rutas públicas que no requieren auth
  const publicPaths = ['/login', '/auth/callback'];
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));

  // Si no hay sesión y la ruta no es pública → redirigir a login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Si hay sesión y va a /login → redirigir a markets
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/markets';
    return NextResponse.redirect(url);
  }

  // /admin y /create son exclusivos para admins
  if (user && (pathname.startsWith('/admin') || pathname.startsWith('/create'))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (!profile?.is_admin) {
      const url = request.nextUrl.clone();
      url.pathname = '/markets';
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // Si hay sesión y no tiene wallet configurada → redirigir a /setup
  // (excepto si ya está en /setup o en rutas de API)
  if (user && !pathname.startsWith('/setup') && !pathname.startsWith('/api') && !isPublic) {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .single();

    if (!wallet && pathname !== '/setup') {
      const url = request.nextUrl.clone();
      url.pathname = '/setup';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

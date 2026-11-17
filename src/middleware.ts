import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decrypt } from './lib/auth';

const protectedRoutes = {
  '/masyarakat': 'CITIZEN',
  '/dashboard': 'CITIZEN',
  '/admin': 'ADMIN',
  '/petugas': 'OFFICER',
  '/officer': 'OFFICER',
};

const roleHome: Record<string, string> = {
  CITIZEN: '/masyarakat/dashboard',
  ADMIN: '/admin/dashboard',
  OFFICER: '/petugas/dashboard',
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get('session')?.value;
  let session = null;
  // Cookie ada tapi token tidak dapat diverifikasi (rusak/kedaluwarsa).
  let staleCookie = false;

  if (sessionCookie) {
    session = await decrypt(sessionCookie);
    if (!session) staleCookie = true;
  }

  // Bersihkan cookie sesi yang tidak valid pada respons apa pun (aman:
  // hanya menghapus cookie 'session', tidak menyentuh data lain).
  const clean = (res: NextResponse) => {
    if (staleCookie) {
      res.cookies.set({
        name: 'session',
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
        expires: new Date(0),
      });
    }
    return res;
  };

  // Check if route requires auth
  const routePrefix = Object.keys(protectedRoutes).find((route) => pathname.startsWith(route));

  if (routePrefix) {
    const requiredRole = protectedRoutes[routePrefix as keyof typeof protectedRoutes];

    // If not authenticated, redirect to login
    if (!session) {
      return clean(NextResponse.redirect(new URL('/login', request.url)));
    }

    // If authenticated but wrong role, redirect to their dashboard
    if (session.role !== requiredRole) {
      return NextResponse.redirect(new URL(roleHome[session.role], request.url));
    }

    // Halaman privat tidak boleh disajikan dari cache browser (tombol Back pasca-logout)
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'no-store, must-revalidate');
    res.headers.set('Pragma', 'no-cache');
    return clean(res);
  }

  // Jika menuju login/register sedangkan sesi masih valid -> arahkan ke dashboard.
  if ((pathname === '/login' || pathname === '/register') && session) {
    return NextResponse.redirect(new URL(roleHome[session.role], request.url));
  }

  // Halaman publik: tetap bersihkan cookie rusak bila ada.
  const publicRes = NextResponse.next();
  if (pathname === '/login' || pathname === '/register') {
    publicRes.headers.set('Cache-Control', 'no-store, must-revalidate');
  }
  return clean(publicRes);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};

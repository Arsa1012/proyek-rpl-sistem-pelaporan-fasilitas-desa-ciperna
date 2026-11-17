'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Logo } from '@/components/landing/Logo';
import { dashboardHome, roleLabel } from '@/lib/roles';

export interface NavSession {
  role: string;
  name: string | null;
  photo: string | null;
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/pengumuman') return pathname === '/pengumuman' || pathname.startsWith('/pengumuman/');
  return pathname === href;
}

const PUBLIC_LINKS = [
  { href: '/profil-desa', label: 'Profil Desa' },
  { href: '/pemerintahan', label: 'Pemerintahan' },
  { href: '/layanan', label: 'Layanan' },
  { href: '/pengumuman', label: 'Pengumuman' },
];

function BrandMark() {
  return (
    <Link href="/" className="landing-brand">
      <Logo size={40} className="landing-brand-logo" />
      <span className="landing-brand-text">
        <span>Sistem Pelaporan</span>
        <span className="landing-brand-sub">Desa Ciperna</span>
      </span>
    </Link>
  );
}

export function LandingNav({ session }: { session: NavSession | null }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Navbar publik hanya untuk halaman publik. Halaman dashboard terautentikasi
  // memakai sidebar + topbar sendiri (satu toggle tema, tanpa tautan Login/Register).
  const isDashboard =
    pathname.startsWith('/masyarakat') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/petugas') ||
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/officer');

  const isAuthPage = pathname === '/login' || pathname === '/register';

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* abaikan: cookie tetap dibersihkan di server bila memungkinkan */
    }
    // Navigasi KERAS (bukan router.push) agar layout root dirender ulang
    // oleh server. Ini mencegah navbar menampilkan sisa status login lama.
    window.location.assign('/login');
  };

  if (isDashboard) return null;

  // ── Halaman Login / Register ─────────────────────────────────────────────
  // Header minimal: hanya logo + Home + tautan lawan (Masuk/Daftar).
  // Tidak pernah menampilkan nama akun, Dashboard, atau Logout, terlepas dari
  // prop `session` (server sudah menangani redirect bila sesi masih valid).
  if (isAuthPage) {
    return (
      <div className={`landing-nav-wrap${scrolled ? ' scrolled' : ''}`}>
        <nav className="landing-nav glass-panel landing-nav-auth" aria-label="Navigasi autentikasi">
          <BrandMark />
          <div className="auth-nav-actions">
            <Link href="/" className={`nav-badge${isActive(pathname, '/') ? ' active' : ''}`}>
              Home
            </Link>
            {pathname === '/login' ? (
              <Link href="/register" className="nav-badge nav-register">
                Daftar
              </Link>
            ) : (
              <Link href="/login" className="nav-badge nav-login">
                Masuk
              </Link>
            )}
            <ThemeToggle withLabel />
          </div>
        </nav>
      </div>
    );
  }

  // ── Halaman publik (beranda) ─────────────────────────────────────────────
  const home = session ? dashboardHome(session.role) : null;

  return (
    <div className={`landing-nav-wrap${scrolled ? ' scrolled' : ''}`}>
      <nav className="landing-nav glass-panel" aria-label="Navigasi utama">
        <BrandMark />

        <button
          type="button"
          className="landing-burger"
          aria-label={open ? 'Tutup menu' : 'Buka menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '✕' : '☰'}
        </button>

        <div className="landing-nav-tools">
          <ThemeToggle withLabel />
        </div>

        <div className={`roles-badge${open ? ' open' : ''}`}>
          <Link href="/" className={`nav-badge${isActive(pathname, '/') ? ' active' : ''}`}>
            Home
          </Link>

          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-badge${isActive(pathname, link.href) ? ' active' : ''}`}
            >
              {link.label}
            </Link>
          ))}

          {session ? (
            <>
              <Link href={home!} className="nav-badge nav-dashboard">
                Dashboard
              </Link>
              <span className="nav-user" title={`Masuk sebagai ${session.name || roleLabel(session.role)}`}>
                <span className="nav-user-avatar" aria-hidden="true">
                  {session.photo ? (
                    <img src={session.photo} alt="" />
                  ) : (
                    (session.name || 'U').charAt(0).toUpperCase()
                  )}
                </span>
                <span className="nav-user-text">
                  <strong>{session.name || 'Pengguna'}</strong>
                  <small>{roleLabel(session.role)}</small>
                </span>
              </span>
              <button
                type="button"
                className="nav-badge nav-logout"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? 'Keluar...' : 'Logout'}
              </button>
            </>
          ) : (
            <>
              {/* Pemisah visual antara menu utama dan aksi akun */}
              <span className="nav-separator" aria-hidden="true" />
              <div className="nav-auth-actions">
                <Link
                  href="/login"
                  className={`nav-badge nav-login${isActive(pathname, '/login') ? ' active' : ''}`}
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="nav-badge nav-register"
                >
                  Register
                </Link>
              </div>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}

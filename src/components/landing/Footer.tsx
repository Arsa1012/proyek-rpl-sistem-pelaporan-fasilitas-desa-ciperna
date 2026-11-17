import Link from 'next/link';
import { Logo } from './Logo';
import { dashboardHome } from '@/lib/roles';

/**
 * Footer publik. Kontak admin SENGAJA tidak diulang di sini: bagian kontak
 * resmi hanya ada satu, yaitu section "Hubungi Admin" di beranda (lihat
 * Sections.tsx > ContactAdmin, anchor #kontak). Footer cukup menyediakan
 * tautan pintas ke bagian tersebut agar tidak ada informasi kontak ganda.
 */
export function Footer({ session }: { session?: { role: string } | null }) {
  const loggedIn = Boolean(session);
  const home = session ? dashboardHome(session.role) : null;

  return (
    <footer className="landing-footer glass-panel">
      <div className="footer-grid">
        <div>
          <p className="footer-brand">
            <Logo size={30} className="footer-logo" />
            <span>Sistem Pelaporan Fasilitas Umum</span>
          </p>
          <p className="footer-sub">Desa Ciperna</p>
          <p className="footer-desc">
            Layanan digital untuk membantu masyarakat menyampaikan laporan fasilitas umum dan
            memantau tindak lanjutnya.
          </p>
        </div>
        <nav aria-label="Menu footer">
          <p className="footer-head">Navigasi</p>
          <ul>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/profil-desa">Profil Desa</Link></li>
            <li><Link href="/pemerintahan">Struktur Pemerintahan</Link></li>
            <li><Link href="/layanan">Layanan Desa</Link></li>
            <li><Link href="/pengumuman">Pengumuman</Link></li>
            <li><Link href="/#cara-kerja">Cara Kerja</Link></li>
            <li><Link href="/#fasilitas">Fasilitas</Link></li>
          </ul>
        </nav>
        <div>
          <p className="footer-head">Akun &amp; Bantuan</p>
          <ul>
            {loggedIn ? (
              <li><Link href={home!}>Buka Dashboard</Link></li>
            ) : (
              <>
                <li><Link href="/login">Masuk</Link></li>
                <li><Link href="/register">Daftar Akun</Link></li>
              </>
            )}
            <li>
              <Link href="/#kontak" aria-label="Lihat bagian kontak admin di beranda">
                Kontak Admin
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <p>© 2026 Sistem Pelaporan Fasilitas Umum Desa Ciperna</p>
      </div>
    </footer>
  );
}

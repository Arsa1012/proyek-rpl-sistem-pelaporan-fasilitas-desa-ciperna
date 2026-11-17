import Link from 'next/link';
import Image from 'next/image';
import { existsSync } from 'fs';
import { join } from 'path';
import type { VillageProfile } from '@prisma/client';
import { Logo } from './Logo';
import { dashboardHome } from '@/lib/roles';

/**
 * Hero Section — Layout profesional split: teks di kiri, gambar pedesaan di kanan.
 * Tidak ada gambar yang memenuhi seluruh hero dan menutupi teks.
 */
export function Hero({
  session,
  identity,
  profile,
}: {
  session?: { role: string } | null;
  identity?: { name: string; district: string; regency: string };
  profile?: Pick<VillageProfile, 'heroPhoto' | 'mapLink'> | null;
}) {
  const uploadHero = '/uploads/village_hero_49c4bc75-eb1d-45db-8e82-8ffe568ae9c4.jpg';
  const hasUploadHero = existsSync(join(process.cwd(), 'public', uploadHero.replace(/^\//, '')));
  const heroPhoto = profile?.heroPhoto || (hasUploadHero ? uploadHero : null);

  const role = session?.role ?? null;
  const isCitizen = !session || role === 'CITIZEN';
  const ctaHref = !session ? '/register' : isCitizen ? '/masyarakat/laporan/create' : dashboardHome(role);
  const ctaLabel = !session ? 'Buat Laporan' : isCitizen ? 'Buat Laporan' : 'Buka Dashboard';

  const villageName = identity?.name || 'Desa Ciperna';
  const locationSuffix = identity
    ? ` · Kec. ${identity.district}, Kab. ${identity.regency}`
    : '';

  return (
    <section className="hero-smart reveal" aria-label="Beranda Desa Ciperna">
      {/* Dekorasi latar halus (bukan gambar penutup) */}
      <div className="hero-smart-bg" aria-hidden="true">
        <span className="hero-smart-orb orb-1" />
        <span className="hero-smart-orb orb-2" />
      </div>

      {/* Split container: teks kiri 55%, gambar kanan 45% */}
      <div className="hero-split">
        {/* Konten teks kiri — 55% lebar */}
        <div className="hero-smart-content">
          <span className="hero-smart-badge" style={{ animation: 'fade-in-up 0.6s ease forwards', animationDelay: '0.1s', opacity: 0 }}>
            Pelayanan Digital {villageName}{locationSuffix}
          </span>
          <h1 className="hero-smart-title" style={{ animation: 'fade-in-up 0.7s ease forwards', animationDelay: '0.2s', opacity: 0 }}>
            Membangun Desa,{' '}
            <span className="hero-smart-title-emph">Melayani Masyarakat.</span>
          </h1>
          <p className="hero-smart-sub" style={{ animation: 'fade-in-up 0.8s ease forwards', animationDelay: '0.3s', opacity: 0 }}>
            Melalui layanan digital Desa Ciperna, masyarakat dapat menyampaikan laporan
            fasilitas umum, memantau tindak lanjut, dan memperoleh informasi desa dengan
            lebih mudah dan transparan.
          </p>
          <div className="hero-smart-cta" style={{ animation: 'fade-in-up 0.9s ease forwards', animationDelay: '0.4s', opacity: 0 }}>
            <Link href={ctaHref} className="btn btn-primary hero-smart-btn">
              {ctaLabel}
            </Link>
            <Link href="/profil-desa" className="btn hero-smart-btn-secondary">
              Jelajahi Desa
            </Link>
          </div>
        </div>

        {/* Visual kanan — 45% lebar, gambar pedesaan/persawahan + teks identitas desa */}
        <div className="hero-smart-media">
          <div className="hero-media-grid">
            <div className="hero-media-image">
              {heroPhoto ? (
                profile?.heroPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={heroPhoto}
                    alt={`Pemandangan ${villageName}`}
                    className="hero-smart-photo"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                    loading="eager"
                  />
                ) : (
                  <Image
                    src={heroPhoto}
                    alt={`Pemandangan ${villageName}`}
                    width={700}
                    height={525}
                    sizes="(max-width: 768px) 100vw, 500px"
                    className="hero-smart-photo"
                    priority
                    loading="eager"
                  />
                )
              ) : (
                // Fallback illustrasi pedesaan (tidak ada gambar asli)
                <div className="hero-smart-illustration" role="img" aria-label="Ilustrasi lingkungan pedesaan Cirebon" style={{ animation: 'fade-in 0.8s ease forwards' }}>
                  <svg viewBox="0 0 800 600" className="hero-smart-svg" aria-hidden="true">
                    <defs>
                      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F8FAFC" />
                        <stop offset="100%" stopColor="#E2E8F0" />
                      </linearGradient>
                      <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#10B981" />
                        <stop offset="100%" stopColor="#059669" />
                      </linearGradient>
                    </defs>
                    <rect width="800" height="600" fill="url(#skyGrad)" />
                    <path d="M0 400 Q100 420 200 400 Q300 380 400 400 Q500 420 600 400 L600 600 L0 600 Z" fill="#F1F5F9"/>
                    <path d="M0 400 L800 400" stroke="#CBD5E1" stroke-width="1" fill="none"/>
                    <g stroke="#94A3B8" stroke-width="1" fill="none" opacity="0.5">
                      <line x1="200" y1="380" x2="200" y2="420" />
                      <line x1="400" y1="380" x2="400" y2="420" />
                      <line x1="600" y1="380" x2="600" y2="420" />
                    </g>
                    <rect x="150" y="300" width="100" height="80" rx="8" fill="#F8FAFC" stroke="#94A3B8" stroke-width="1"/>
                    <rect x="170" y="320" width="60" height="30" fill="#10B981"/>
                    <line x1="150" y1="300" x2="250" y2="300" stroke="#94A3B8" stroke-width="1"/>
                    <line x1="150" y1="340" x2="250" y2="340" stroke="#94A3B8" stroke-width="1"/>
                    <line x1="150" y1="340" x2="150" y2="380" stroke="#94A3B8" stroke-width="1"/>
                    <line x1="250" y1="340" x2="250" y2="380" stroke="#94A3B8" stroke-width="1"/>
                    <g fill="#10B981">
                      <ellipse cx="550" cy="280" rx="30" ry="20" />
                      <rect x="540" y="300" width="20" height="40" rx="4" />
                    </g>
                    <circle cx="100" cy="150" r="20" fill="#FBBF24" opacity="0.4" />
                    <circle cx="700" cy="120" r="15" fill="#FBBF24" opacity="0.3" />
                  </svg>
                </div>
              )}
            </div>

            {/* Teks identitas desa di sebelah gambar */}
            <div className="hero-media-text glass" style={{ animation: 'fade-in-up 0.8s ease forwards', animationDelay: '0.2s', opacity: 0 }}>
              <span className="hero-media-badge" aria-hidden="true">🌾</span>
              <h3 className="hero-media-title">Mengenal Desa Ciperna</h3>
              <p className="hero-media-desc">
                Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon, terus berkembang
                melalui kebersamaan masyarakat dan pelayanan desa yang lebih baik.
              </p>
            </div>
          </div>

          {/* Overlay ringan — tidak terlalu gelap agar gambar tetap jelas */}
          <div className="hero-smart-overlay" />
        </div>
      </div>

      <div className="hero-smart-scroll" aria-hidden="true">
        <span className="hero-smart-scroll-line" />
      </div>
    </section>
  );
}

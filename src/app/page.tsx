import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Hero } from '@/components/landing/Hero';
import { VillageGallery } from '@/components/landing/VillageGallery';
import { Stats } from '@/components/landing/Stats';
import { StatsBandSkeleton } from '@/components/landing/StatsBand';
import { Services } from '@/components/landing/Services';
import { TransparencyTimeline } from '@/components/landing/TransparencyTimeline';
import { LocationSection } from '@/components/landing/VillagePortal';
import { CallToAction } from '@/components/landing/CallToAction';
import { Footer } from '@/components/landing/Footer';
import { getSession } from '@/lib/auth';
import { loadVillageHomeData, villageIdentity } from '@/lib/village';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Portal Desa Ciperna — Layanan & Pelaporan Fasilitas Umum',
  description:
    'Portal resmi Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon: profil desa, struktur pemerintahan, layanan, pengumuman, dan pelaporan fasilitas umum.',
};

export default async function Home() {
  const session = await getSession();
  const navSession = session ? { role: session.role } : null;

  const { profile, profileReadError, officials, services, announcements } = await loadVillageHomeData();
  const identity = villageIdentity(profile);

  return (
    <div className="landing-home container">
      {/* 1. Hero Section — Visual utama */}
      <Hero session={navSession} identity={identity} profile={profile} />

      {/* 2. Statistik Desa — Animasi angka dari API */}
      <Suspense fallback={<StatsBandSkeleton />}>
        <Stats />
      </Suspense>

      {/* 3. Section Profil dan Kehidupan Desa — Galeri visual + deskripsi */}
      <VillageGallery identity={identity} profile={profile} />

      {/* 4. Layanan Digital — Kartu visual + deskripsi */}
      <Services session={navSession} />

      {/* 5. Statistik dan Transparansi — Timeline alur laporan */}
      <TransparencyTimeline />

      {/* 6. Peta Fasilitas Umum — Hanya jika integrasi peta tersedia */}
      <LocationSection identity={identity} profile={profile} />

      {/* 7. Call to Action — Penutup */}
      <CallToAction />

      {/* Footer */}
      <Footer session={navSession} />
    </div>
  );
}

import Link from 'next/link';
import type { Metadata } from 'next';
import { getPublishedAnnouncements, villageIdentity, getVillageProfile } from '@/lib/village';
import { AnnouncementFeed } from '@/components/village/AnnouncementFeed';
import { EmptyBlock } from '@/components/village/blocks';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pengumuman Desa Ciperna',
  description: 'Pengumuman resmi Desa Ciperna yang sudah diterbitkan.',
};

export default async function PengumumanPage() {
  let announcements: Awaited<ReturnType<typeof getPublishedAnnouncements>> = [];
  let readError = false;
  try {
    announcements = await getPublishedAnnouncements(50);
  } catch {
    readError = true;
  }

  let identity = villageIdentity(null);
  try {
    identity = villageIdentity(await getVillageProfile());
  } catch {
    /* fallback */
  }

  const items = announcements.map((a) => ({
    id: a.id,
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    category: a.category,
    coverPhoto: a.coverPhoto,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    validUntil: a.validUntil ? a.validUntil.toISOString() : null,
  }));

  return (
    <div className="portal-page container">
      <header className="portal-hero">
        <span className="section-eyebrow">Informasi</span>
        <h1>Pengumuman {identity.name}</h1>
        <p className="portal-hero-loc">Kabar dan informasi resmi dari pemerintah desa.</p>
        <div className="portal-hero-actions">
          <Link href="/profil-desa" className="btn">🏘️ Profil Desa</Link>
          <Link href="/layanan" className="btn">🗂️ Layanan Desa</Link>
        </div>
      </header>

      {readError && (
        <div className="village-alert" role="alert">
          Data pengumuman belum berhasil dimuat karena kendala membaca database. Coba muat ulang halaman.
        </div>
      )}

      {!readError && items.length === 0 ? (
        <EmptyBlock
          icon="📣"
          title="Belum ada pengumuman"
          description="Saat ini belum ada pengumuman resmi yang diterbitkan. Silakan periksa kembali nanti."
        />
      ) : (
        !readError && <AnnouncementFeed items={items} />
      )}
    </div>
  );
}

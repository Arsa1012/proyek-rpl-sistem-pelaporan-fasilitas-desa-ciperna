import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { formatVillageDate, getPublishedAnnouncementBySlug } from '@/lib/village';

export const dynamic = 'force-dynamic';

function parsePhotos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const announcement = await getPublishedAnnouncementBySlug(params.slug);
    if (!announcement) return { title: 'Pengumuman tidak ditemukan' };
    return {
      title: announcement.title,
      description: announcement.excerpt || undefined,
    };
  } catch {
    return { title: 'Pengumuman Desa Ciperna' };
  }
}

export default async function PengumumanDetailPage({ params }: { params: { slug: string } }) {
  let announcement = null;
  let readError = false;
  try {
    announcement = await getPublishedAnnouncementBySlug(params.slug);
  } catch {
    readError = true;
  }

  if (readError) {
    return (
      <div className="portal-page container">
        <div className="village-alert" role="alert">
          Data pengumuman belum berhasil dimuat karena kendala membaca database. Coba muat ulang halaman.
        </div>
        <Link href="/pengumuman" className="btn" style={{ marginTop: '1rem' }}>← Semua Pengumuman</Link>
      </div>
    );
  }

  if (!announcement) notFound();

  const date = formatVillageDate(announcement.publishedAt);
  const until = formatVillageDate(announcement.validUntil);
  const paragraphs = announcement.content.split(/\n+/).filter((p) => p.trim());
  const gallery = parsePhotos(announcement.photos);

  return (
    <article className="portal-page container">
      <nav className="portal-breadcrumb" aria-label="Navigasi halaman">
        <Link href="/">Beranda</Link>
        <span aria-hidden="true">/</span>
        <Link href="/pengumuman">Pengumuman</Link>
      </nav>

      <header className="portal-hero portal-hero-article">
        <span className="section-eyebrow">Pengumuman Resmi</span>
        <h1>{announcement.title}</h1>
        <div className="announcement-detail-meta">
          {announcement.category && <span className="announcement-category">{announcement.category}</span>}
          {date && <time className="announcement-date" dateTime={announcement.publishedAt?.toISOString()}>{date}</time>}
        </div>
        {until && <p className="announcement-until">Berlaku sampai {until}</p>}
      </header>

      {announcement.coverPhoto && (
        <div className="announcement-cover announcement-cover-detail">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={announcement.coverPhoto} alt={`Foto pengumuman: ${announcement.title}`} />
        </div>
      )}

      <div className="glass portal-prose portal-article">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {gallery.length > 0 && (
        <section className="announcement-gallery" aria-label="Foto pengumuman">
          {gallery.map((src) => (
            <div key={src} className="announcement-cover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Foto pengumuman: ${announcement!.title}`} loading="lazy" />
            </div>
          ))}
        </section>
      )}

      <Link href="/pengumuman" className="btn" style={{ marginTop: '1.5rem' }}>← Semua Pengumuman</Link>
    </article>
  );
}

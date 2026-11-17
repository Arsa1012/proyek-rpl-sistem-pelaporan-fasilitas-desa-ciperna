import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllAnnouncements } from '@/lib/village';
import { prisma } from '@/lib/prisma';
import { deriveAnnouncementStatus } from '@/lib/announcementStatus';
import { ANNOUNCEMENT_WHATSAPP_LIMIT } from '@/lib/announcementBroadcast';
import { AnnouncementsManager, type AnnouncementDTO } from '@/components/ui/village/AnnouncementsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Pengumuman Desa — Admin',
  description: 'Kelola pengumuman resmi Desa Ciperna.',
};

export default async function AdminPengumumanPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  let announcements: AnnouncementDTO[] = [];
  let readError = false;
  try {
    const rows = await getAllAnnouncements();
    // Status pengiriman WA dikumpulkan sekali untuk menghindari N+1.
    const grouped = await prisma.announcementDelivery.groupBy({
      by: ['announcementId', 'status'],
      _count: { _all: true },
    });
    const byAnnouncement = new Map<string, { sent: number; failed: number; skipped: number; pending: number; total: number }>();
    for (const g of grouped) {
      const cur =
        byAnnouncement.get(g.announcementId) ||
        { sent: 0, failed: 0, skipped: 0, pending: 0, total: 0 };
      const n = g._count._all;
      cur.total += n;
      if (g.status === 'SENT') cur.sent += n;
      else if (g.status === 'FAILED') cur.failed += n;
      else if (g.status === 'SKIPPED') cur.skipped += n;
      else cur.pending += n;
      byAnnouncement.set(g.announcementId, cur);
    }

    announcements = rows.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      content: a.content,
      excerpt: a.excerpt,
      category: a.category,
      coverPhoto: a.coverPhoto,
      photos: parsePhotos(a.photos),
      target: (a.target as AnnouncementDTO['target']) || 'ALL',
      notifyWhatsApp: a.notifyWhatsApp,
      isPublished: a.isPublished,
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
      validFrom: a.validFrom ? a.validFrom.toISOString() : null,
      validUntil: a.validUntil ? a.validUntil.toISOString() : null,
      archivedAt: a.archivedAt ? a.archivedAt.toISOString() : null,
      deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
      updatedAt: a.updatedAt.toISOString(),
      status: deriveAnnouncementStatus(a),
      delivery: {
        ...(byAnnouncement.get(a.id) || { sent: 0, failed: 0, skipped: 0, pending: 0, total: 0 }),
        sendCount: a.waSendCount ?? 0,
        sendLimit: ANNOUNCEMENT_WHATSAPP_LIMIT,
        limitReached: (a.waSendCount ?? 0) >= ANNOUNCEMENT_WHATSAPP_LIMIT,
      },
    }));
  } catch (error) {
    console.error('[admin/pengumuman] gagal memuat:', error);
    readError = true;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Pengumuman Desa</h2>
          <p>
            Kelola pengumuman resmi: jadwal terbit, masa berlaku, foto, target penerima, dan
            status pengiriman WhatsApp. Pengumuman yang ditarik atau dihapus tetap tersimpan
            sebagai arsip audit.
          </p>
        </div>
      </div>

      {readError ? (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>
          Gagal membaca data pengumuman. Coba muat ulang halaman.
        </div>
      ) : (
        <AnnouncementsManager initial={announcements} />
      )}
    </div>
  );
}

function parsePhotos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

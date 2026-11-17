import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { syncAnnouncementNotification } from '@/lib/announcementNotify';
import { broadcastAnnouncementWhatsApp } from '@/lib/announcementBroadcast';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * PEMROSES TERJADWAL (scheduler) untuk Portal Desa.
 *
 * Tugas:
 *  1. Mengarsipkan pengumuman yang masa berlakunya (validUntil) sudah lewat —
 *     tanpa menghapus riwayat.
 *  2. Menerbitkan notifikasi (aplikasi + opsional WhatsApp) untuk pengumuman
 *     yang sudah jatuh tempo. IDEMPOTEN: pengumuman yang sudah dinotifikasi /
 *     sudah terkirim tidak diproses ulang.
 *
 * Pengamanan: hanya boleh dipanggil dengan header `x-cron-secret` (atau
 * `Authorization: Bearer <CRON_SECRET>`) yang cocok dengan env `CRON_SECRET`,
 * ATAU oleh Admin yang sudah login. Bila CRON_SECRET belum diisi, endpoint ini
 * hanya dapat dipakai Admin (tidak ada jalur terbuka).
 */

async function authorize(request: Request): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const secret = process.env.CRON_SECRET || '';
  const headerSecret =
    request.headers.get('x-cron-secret') ||
    (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (secret && headerSecret && headerSecret === secret) return { ok: true };

  const session = await getSession();
  if (session?.role === 'ADMIN') return { ok: true };

  return {
    ok: false,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

async function run() {
  const now = new Date();

  // 1. Arsipkan yang kedaluwarsa.
  const archived = await prisma.villageAnnouncement.updateMany({
    where: {
      isPublished: true,
      deletedAt: null,
      archivedAt: null,
      validUntil: { not: null, lt: now },
    },
    data: { archivedAt: now },
  });

  // 2. Proses pengumuman jatuh tempo (belum kedaluwarsa/arsip/terhapus).
  const due = await prisma.villageAnnouncement.findMany({
    where: {
      isPublished: true,
      deletedAt: null,
      archivedAt: null,
      publishedAt: { not: null, lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: 20,
  });

  let notificationsCreated = 0;
  let waSent = 0;
  let waFailed = 0;

  for (const a of due) {
    // Notifikasi aplikasi (idempoten; kegagalan tidak menghentikan sisanya).
    try {
      notificationsCreated += await (async () => {
        const before = await prisma.notification.count({ where: { announcementId: a.id } });
        await syncAnnouncementNotification(a);
        const after = await prisma.notification.count({ where: { announcementId: a.id } });
        return Math.max(0, after - before);
      })();
    } catch (e) {
      console.error('[cron/village] notifikasi gagal:', e);
    }

    if (a.notifyWhatsApp) {
      try {
        const summary = await broadcastAnnouncementWhatsApp(a);
        waSent += summary.sent;
        waFailed += summary.failed;
      } catch (e) {
        console.error('[cron/village] siaran WhatsApp gagal:', e);
      }
    }
  }

  return {
    success: true,
    at: now.toISOString(),
    archived: archived.count,
    processed: due.length,
    notificationsCreated,
    whatsapp: { sent: waSent, failed: waFailed },
  };
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await run());
  } catch (error) {
    console.error('[POST /api/cron/village]', error);
    return NextResponse.json({ error: 'Gagal memproses penjadwalan' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}

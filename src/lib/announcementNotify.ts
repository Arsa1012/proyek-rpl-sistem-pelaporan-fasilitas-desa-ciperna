import { prisma } from '@/lib/prisma';
import { isNotifiable } from '@/lib/announcementStatus';

/**
 * Notifikasi DALAM APLIKASI untuk pengumuman desa.
 *
 * Tujuan: saat Admin menerbitkan pengumuman, warga otomatis menerima
 * notifikasi di aplikasi (lonceng + pusat notifikasi) — tanpa perlu menyalin
 * isi pengumuman ke prompt AI. Chatbot masyarakat membaca pengumuman langsung
 * dari database (lihat aiTools.getVillageAnnouncements), jadi keduanya selalu
 * sinkron dengan sumber yang sama.
 *
 * Prinsip:
 * - IDEMPOTEN. Satu pengumuman = satu notifikasi per pengguna. Dijamin oleh
 *   @@unique([userId, announcementId]) di schema + penyaringan di sini.
 * - TERJADWAL. Pengumuman dengan publishedAt di masa depan TIDAK menghasilkan
 *   notifikasi sebelum waktunya; notifikasi dibuat saat jatuh tempo (jalur
 *   `ensureDueAnnouncementForUser` yang dipanggil dari GET /api/notifications).
 * - KONSISTEN. Bila pengumuman diubah, notifikasi diperbarui. Bila ditarik
 *   (unpublish), notifikasi turunannya dihapus.
 * - Notifikasi aplikasi BERBEDA dari WhatsApp broadcast. Modul ini tidak
 *   mengirim WhatsApp apa pun.
 */

export type AnnouncementLike = {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  isPublished: boolean;
  publishedAt: Date | null;
  /** Target penerima: ALL (default), CITIZEN, OFFICER. */
  target?: string | null;
  validUntil?: Date | null;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
};

/** Batas aman jumlah warga per siaran (mencegah operasi masif tak terduga). */
const MAX_BROADCAST = 5000;
const CHUNK = 200;

/** Role penerima sesuai target pengumuman (ADMIN selalu dikecualikan). */
function rolesForTarget(target: string | null | undefined): ('CITIZEN' | 'OFFICER')[] {
  switch ((target || 'ALL').toUpperCase()) {
    case 'CITIZEN':
      return ['CITIZEN'];
    case 'OFFICER':
      return ['OFFICER'];
    default:
      return ['CITIZEN', 'OFFICER'];
  }
}

function excerptFor(a: Pick<AnnouncementLike, 'content' | 'excerpt'>): string {
  const raw = (a.excerpt || a.content || '').replace(/\s+/g, ' ').trim();
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
}

/** Isi dasar notifikasi (type/title/message/url) yang sama untuk semua penerima. */
function basePayload(a: AnnouncementLike) {
  return {
    type: 'ANNOUNCEMENT',
    title: `📣 ${a.title}`,
    message: excerptFor(a),
    url: a.slug ? `/pengumuman/${a.slug}` : null,
  };
}

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Sudah jatuh tempo (terbit & waktunya sudah lewat), belum kedaluwarsa/arsip. */
function isDue(
  a: Pick<AnnouncementLike, 'isPublished' | 'publishedAt' | 'validUntil' | 'archivedAt' | 'deletedAt'>,
  now = new Date()
): boolean {
  return isNotifiable(a, now);
}

/**
 * Siarkan notifikasi pengumuman ke seluruh penerima sesuai target yang sudah
 * terdaftar sebelum pengumuman terbit. Idempoten: penerima yang sudah punya
 * notifikasi dilewati.
 */
export async function broadcastAnnouncementNotifications(a: AnnouncementLike): Promise<number> {
  if (!isDue(a)) return 0;
  try {
    const citizens = await prisma.user.findMany({
      where: {
        role: { in: rolesForTarget(a.target) },
        isActive: true,
        // Pengguna yang mendaftar SETELAH pengumuman terbit tidak diberi notifikasi
        // pengumuman lama (mencegah "banjir" notifikasi saat akun baru dibuat).
        createdAt: { lte: new Date(a.publishedAt as Date) },
      },
      select: { id: true },
      take: MAX_BROADCAST,
    });
    if (citizens.length === 0) return 0;

    const existing = await prisma.notification.findMany({
      where: { announcementId: a.id, userId: { in: citizens.map((c) => c.id) } },
      select: { userId: true },
    });
    const have = new Set(existing.map((e) => e.userId));

    const base = basePayload(a);
    const toCreate = citizens
      .filter((c) => !have.has(c.id))
      .map((c) => ({ ...base, userId: c.id, announcementId: a.id }));
    if (toCreate.length === 0) return 0;

    let created = 0;
    for (const part of chunked(toCreate, CHUNK)) {
      try {
        const res = await prisma.notification.createMany({ data: part });
        created += res.count;
      } catch (e) {
        // Benturan unik berarti baris sudah ada (retry/dua permintaan bersamaan):
        // aman untuk dilewati, bukan kegagalan.
        console.error('[announcementNotify] sebagian notifikasi gagal dibuat:', e);
      }
    }
    return created;
  } catch (e) {
    console.error('[announcementNotify] siaran notifikasi gagal:', e);
    return 0;
  }
}

/**
 * Selaraskan notifikasi dengan keadaan pengumuman saat ini.
 * - Terbit & jatuh tempo  → buat yang belum ada, perbarui isi yang berubah.
 * - Belum terbit / ditarik / terjadwal (belum waktunya) → hapus notifikasi turunannya.
 * Best-effort: kegagalan tidak boleh membatalkan alur bisnis utama (simpan pengumuman).
 */
export async function syncAnnouncementNotification(a: AnnouncementLike): Promise<void> {
  try {
    if (!isDue(a)) {
      await prisma.notification.deleteMany({ where: { announcementId: a.id } });
      return;
    }
    await broadcastAnnouncementNotifications(a);
    const base = basePayload(a);
    // Isi berubah → tandai belum dibaca agar warga melihat versi terbaru.
    await prisma.notification.updateMany({
      where: { announcementId: a.id, message: { not: base.message } },
      data: { ...base, isRead: false },
    });
    // Isi sama → cukup rapikan judul/tautan tanpa mengubah status baca.
    await prisma.notification.updateMany({
      where: { announcementId: a.id, message: base.message },
      data: { title: base.title, url: base.url, type: base.type },
    });
  } catch (e) {
    console.error('[announcementNotify] sinkronisasi notifikasi gagal:', e);
  }
}

/**
 * Jalur "penjadwalan malas": dipanggil dari GET /api/notifications milik warga.
 * Membuat notifikasi untuk pengumuman yang sudah jatuh tempo dan belum pernah
 * dinotifikasikan ke pengguna ini (termasuk pengumuman terjadwal yang baru tiba
 * waktunya, atau notifikasi yang terlewat karena gangguan).
 */
export async function ensureDueAnnouncementForUser(userId: string): Promise<number> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true, createdAt: true },
    });
    // Hanya warga/petugas aktif; Admin tidak menerima siaran pengumuman.
    if (!user || !user.isActive) return 0;
    if (user.role !== 'CITIZEN' && user.role !== 'OFFICER') return 0;

    const now = new Date();
    const due = await prisma.villageAnnouncement.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        archivedAt: null,
        // Sudah jatuh tempo DAN terbit setelah akun dibuat (warga baru tidak
        // dibanjiri notifikasi pengumuman lama), serta belum kedaluwarsa.
        publishedAt: { gte: user.createdAt, lte: now },
        OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        notifications: { none: { userId } },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        content: true,
        excerpt: true,
        publishedAt: true,
        target: true,
        validUntil: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });
    const relevant = due.filter((a) =>
      rolesForTarget(a.target).includes(user.role as 'CITIZEN' | 'OFFICER')
    );
    if (relevant.length === 0) return 0;

    let created = 0;
    for (const a of relevant) {
      const base = basePayload({ ...a, isPublished: true } as AnnouncementLike);
      try {
        await prisma.notification.create({
          data: { ...base, userId, announcementId: a.id },
        });
        created += 1;
      } catch {
        // Sudah ada (benturan unik) → lewati.
      }
    }
    return created;
  } catch (e) {
    console.error('[announcementNotify] penjadwalan malas gagal:', e);
    return 0;
  }
}

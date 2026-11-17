/**
 * Siaran notifikasi WhatsApp PENGUMUMAN desa via Fonnte.
 *
 * Prinsip (lihat juga announcementNotify.ts untuk notifikasi dalam aplikasi):
 * - HANYA dikirim setelah pengumuman benar-benar terbit & jatuh tempo, belum
 *   kedaluwarsa, dan Admin menyalakan opsi notifyWhatsApp.
 * - BATAS KERAS 15 PERCOBAAN KIRIM PER PENGUMUMAN. Satu penerima yang dicoba
 *   (berhasil, gagal, atau ditolak provider) = 1. Counter disimpan pada baris
 *   pengumuman itu sendiri (VillageAnnouncement.waSendCount), bukan counter
 *   global, dan dinaikkan secara atomik sebelum provider dipanggil.
 * - IDEMPOTEN per (pengumuman, penerima) melalui @@unique(announcementId,userId)
 *   di AnnouncementDelivery + dedupeKey lapisan WhatsApp. Penerima diklaim
 *   secara atomik (status SENDING) agar refresh/double request tidak mengirim
 *   dua kali.
 * - Best-effort: kegagalan satu penerima tidak menghentikan penerima lain dan
 *   tidak mempengaruhi status publikasi pengumuman.
 * - Token Fonnte hanya dibaca server-side; tidak pernah di-log.
 */

import { prisma } from '@/lib/prisma';
import { fmtWIB, sendWhatsApp, whatsappConfigStatus } from '@/lib/whatsapp';
import { resolveActiveFonnteConfig } from '@/lib/fonnteConfig';
import { isNotifiable } from '@/lib/announcementStatus';
import { VILLAGE_FALLBACK } from '@/lib/village';

/** Batas keras percobaan kirim WhatsApp untuk SATU pengumuman. */
export const ANNOUNCEMENT_WHATSAPP_LIMIT = 15;
const BATCH_SIZE = ANNOUNCEMENT_WHATSAPP_LIMIT;
const MAX_RECIPIENTS = 5000;
/** Klaim SENDING yang lebih tua dari ini dianggap macet dan boleh dicoba lagi. */
const STALE_SENDING_MS = 5 * 60 * 1000;

type TargetRole = 'CITIZEN' | 'OFFICER';

function rolesForTarget(target: string | null | undefined): TargetRole[] {
  switch ((target || 'ALL').toUpperCase()) {
    case 'CITIZEN':
      return ['CITIZEN'];
    case 'OFFICER':
      return ['OFFICER'];
    default:
      return ['CITIZEN', 'OFFICER'];
  }
}

function maskPhone(digits: string): string {
  return digits.length > 4 ? `${digits.slice(0, 4)}****` : '****';
}

export interface AnnouncementLikeFull {
  id: string;
  title: string;
  slug: string | null;
  content: string;
  excerpt: string | null;
  isPublished: boolean;
  publishedAt: Date | null;
  target?: string | null;
  notifyWhatsApp?: boolean | null;
  validUntil?: Date | null;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
  waSendCount?: number;
}

export interface BroadcastSummary {
  configured: boolean;
  due: boolean;
  recipients: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  remaining: number;
  /** Total percobaan yang sudah tercatat untuk pengumuman ini. */
  sendCount: number;
  /** Batas keras (15). */
  sendLimit: number;
  /** true bila batas tercapai; tidak ada kiriman baru yang dilakukan. */
  limitReached: boolean;
}

const EMPTY_SUMMARY: BroadcastSummary = {
  configured: false,
  due: false,
  recipients: 0,
  attempted: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  pending: 0,
  remaining: 0,
  sendCount: 0,
  sendLimit: ANNOUNCEMENT_WHATSAPP_LIMIT,
  limitReached: false,
};

/** Ringkasan ringkas isi pengumuman untuk badan pesan WhatsApp. */
function summaryText(a: AnnouncementLikeFull): string {
  const raw = (a.excerpt || a.content || '').replace(/\s+/g, ' ').trim();
  return raw.length > 320 ? `${raw.slice(0, 317)}...` : raw;
}

/** Susun pesan WhatsApp dari data pengumuman yang benar-benar tersimpan. */
export function buildAnnouncementWhatsAppMessage(a: AnnouncementLikeFull, baseUrl: string): string {
  const SEP = '----------------------------------';
  const lines = [
    `*📢 PENGUMUMAN ${VILLAGE_FALLBACK.name.toUpperCase()}*`,
    SEP,
    `Judul: ${a.title}`,
    '',
    summaryText(a),
    '',
    `Waktu: ${a.publishedAt ? fmtWIB(a.publishedAt) : '-'}`,
  ];
  if (a.validUntil) lines.push(`Berlaku sampai: ${fmtWIB(a.validUntil)}`);
  lines.push(SEP);
  if (a.slug) {
    lines.push(
      'Silakan cek detail pengumuman selengkapnya di website resmi Pelaporan Desa Ciperna:',
      `${baseUrl.replace(/\/$/, '')}/pengumuman/${a.slug}`
    );
  }
  lines.push('', 'Pesan ini otomatis. Tidak perlu membalas jika tidak ada keperluan lain.');
  return lines.join('\n');
}

/** Pastikan setiap penerima punya baris status (PENDING) tanpa menggandakan. */
async function ensureDeliveryRows(announcementId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const existing = await prisma.announcementDelivery.findMany({
    where: { announcementId, userId: { in: userIds } },
    select: { userId: true },
  });
  const have = new Set(existing.map((e) => e.userId));
  const missing = userIds.filter((id) => !have.has(id));
  if (missing.length === 0) return;
  try {
    await prisma.announcementDelivery.createMany({
      data: missing.map((userId) => ({ announcementId, userId, status: 'PENDING' })),
    });
  } catch (e) {
    console.error('[announcementBroadcast] gagal membuat baris status:', e);
  }
}

async function readSendCount(announcementId: string): Promise<number> {
  const row = await prisma.villageAnnouncement.findUnique({
    where: { id: announcementId },
    select: { waSendCount: true },
  });
  return row?.waSendCount ?? 0;
}

/**
 * Klaim satu penerima secara atomik. Dua permintaan paralel tidak akan
 * memproses penerima yang sama: hanya satu yang berhasil mengubah status
 * PENDING/FAILED → SENDING.
 */
async function claimDelivery(
  announcementId: string,
  userId: string,
  onlyFailed: boolean
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  const eligible = onlyFailed ? ['FAILED'] : ['PENDING', 'FAILED'];
  const claimed = await prisma.announcementDelivery.updateMany({
    where: {
      announcementId,
      userId,
      OR: [
        { status: { in: eligible } },
        { status: 'SENDING', updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: 'SENDING' },
  });
  return claimed.count === 1;
}

/**
 * Pesan slot pengiriman secara atomik. Counter per pengumuman tidak pernah
 * melewati ANNOUNCEMENT_WHATSAPP_LIMIT, termasuk saat ada dua request paralel.
 */
async function reserveSendSlot(announcementId: string): Promise<boolean> {
  const reserved = await prisma.villageAnnouncement.updateMany({
    where: { id: announcementId, waSendCount: { lt: ANNOUNCEMENT_WHATSAPP_LIMIT } },
    data: { waSendCount: { increment: 1 } },
  });
  return reserved.count === 1;
}

/** Kembalikan klaim ke status semula bila slot tidak jadi dipakai. */
async function releaseDelivery(
  announcementId: string,
  userId: string,
  previous: string
): Promise<void> {
  const status = previous === 'FAILED' ? 'FAILED' : 'PENDING';
  await prisma.announcementDelivery
    .update({
      where: { announcementId_userId: { announcementId, userId } },
      data: { status },
    })
    .catch(() => undefined);
}

/**
 * Kirim notifikasi WhatsApp pengumuman secara bertahap, idempoten, dan
 * dibatasi 15 percobaan per pengumuman.
 * `onlyFailed` = proses ulang penerima yang berstatus FAILED (dipakai tombol
 * "Kirim ulang") tanpa mengirim ulang penerima yang sudah SENT.
 */
export async function broadcastAnnouncementWhatsApp(
  a: AnnouncementLikeFull,
  opts: { onlyFailed?: boolean; limit?: number } = {}
): Promise<BroadcastSummary> {
  const currentCount = a.waSendCount ?? (await readSendCount(a.id));
  const limit = Math.max(1, Math.min(opts.limit ?? BATCH_SIZE, BATCH_SIZE));
  const config = await whatsappConfigStatus();
  const base = {
    ...EMPTY_SUMMARY,
    configured: config.configured,
    sendCount: currentCount,
    limitReached: currentCount >= ANNOUNCEMENT_WHATSAPP_LIMIT,
  };

  if (!isNotifiable(a)) {
    return { ...base, due: false };
  }
  if (!a.notifyWhatsApp) {
    return { ...base, due: true };
  }

  const roles = rolesForTarget(a.target);
  const recipients = await prisma.user.findMany({
    where: { isActive: true, role: { in: roles } },
    select: { id: true, name: true, phone: true },
    take: MAX_RECIPIENTS,
  });
  if (recipients.length === 0) {
    return { ...base, due: true };
  }

  await ensureDeliveryRows(
    a.id,
    recipients.map((r) => r.id)
  );

  const deliveries = await prisma.announcementDelivery.findMany({
    where: { announcementId: a.id, userId: { in: recipients.map((r) => r.id) } },
    select: { userId: true, status: true, updatedAt: true },
  });
  const statusByUser = new Map(deliveries.map((d) => [d.userId, d.status]));
  const deliveryByUser = new Map(deliveries.map((d) => [d.userId, d]));
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);

  const candidates = recipients.filter((r) => {
    const delivery = deliveryByUser.get(r.id);
    const st = statusByUser.get(r.id);
    if (st === 'SENT' || st === 'SKIPPED') return false;
    const staleSending = st === 'SENDING' && !!delivery && delivery.updatedAt < staleBefore;
    if (opts.onlyFailed) return st === 'FAILED' || staleSending;
    return true; // PENDING / FAILED / SENDING berumur pendek (akan gagal diklaim)
  });

  const summary: BroadcastSummary = {
    ...base,
    due: true,
    recipients: recipients.length,
    remaining: Math.max(0, candidates.length - Math.max(0, limit)),
  };

  if (!config.configured) {
    // Belum dikonfigurasi: jangan mengklaim terkirim. Baris tetap PENDING agar
    // Admin melihat status "menunggu" dan dapat mengirim ulang setelah diatur.
    summary.pending = candidates.length;
    return summary;
  }

  if (summary.limitReached) {
    // Batas sudah tercapai sebelum ada kiriman baru. Tidak ada provider call.
    summary.pending = candidates.length;
    return summary;
  }

  // Snapshot perangkat pengirim aktif — dipakai untuk SELURUH penerima pada
  // batch ini, sehingga pengirim tidak berubah di tengah broadcast.
  const senderConfig = await resolveActiveFonnteConfig();

  const message = buildAnnouncementWhatsAppMessage(a, process.env.APP_URL || 'http://localhost:3000');
  const batch = candidates.slice(0, limit);
  let processed = 0;

  for (const r of batch) {
    if (summary.sendCount >= ANNOUNCEMENT_WHATSAPP_LIMIT) {
      summary.limitReached = true;
      break;
    }

    const previous = statusByUser.get(r.id) || 'PENDING';
    const claimed = await claimDelivery(a.id, r.id, !!opts.onlyFailed);
    if (!claimed) continue;

    const phone = (r.phone || '').trim();
    const masked = phone ? maskPhone(phone.replace(/\D/g, '')) : '-';

    if (!phone) {
      await prisma.announcementDelivery
        .update({
          where: { announcementId_userId: { announcementId: a.id, userId: r.id } },
          data: { status: 'SKIPPED', error: 'no_phone', attempts: { increment: 1 } },
        })
        .catch(() => undefined);
      summary.skipped += 1;
      processed += 1;
      continue;
    }

    // Slot diambil SEBELUM provider dipanggil. Bila counter sudah 15, kiriman
    // tidak dilakukan dan klaim penerima dikembalikan agar statusnya jujur.
    const reserved = await reserveSendSlot(a.id);
    if (!reserved) {
      await releaseDelivery(a.id, r.id, previous);
      summary.sendCount = await readSendCount(a.id);
      summary.limitReached = true;
      break;
    }
    summary.sendCount += 1;
    summary.attempted += 1;

    const result = await sendWhatsApp(phone, message, {
      dedupeKey: `announce:${a.id}:${r.id}`,
      kind: 'ANNOUNCEMENT_WHATSAPP',
      // Satu snapshot untuk seluruh penerima: pengirim = perangkat aktif yang
      // dipilih Admin, dan tidak berubah di tengah broadcast.
      config: senderConfig,
    });

    if (result.ok) {
      await prisma.announcementDelivery
        .update({
          where: { announcementId_userId: { announcementId: a.id, userId: r.id } },
          data: {
            status: 'SENT',
            toMasked: masked,
            providerMessageId: result.providerMessageId,
            error: null,
            sentAt: new Date(),
            attempts: { increment: 1 },
          },
        })
        .catch(() => undefined);
      summary.sent += 1;
    } else if (result.error === 'invalid_recipient') {
      await prisma.announcementDelivery
        .update({
          where: { announcementId_userId: { announcementId: a.id, userId: r.id } },
          data: { status: 'SKIPPED', error: 'invalid_recipient', attempts: { increment: 1 } },
        })
        .catch(() => undefined);
      summary.skipped += 1;
    } else {
      await prisma.announcementDelivery
        .update({
          where: { announcementId_userId: { announcementId: a.id, userId: r.id } },
          data: {
            status: 'FAILED',
            toMasked: masked,
            error: (result.error || 'unknown').slice(0, 120),
            attempts: { increment: 1 },
          },
        })
        .catch(() => undefined);
      summary.failed += 1;
    }
    processed += 1;
  }

  summary.sendCount = await readSendCount(a.id);
  summary.limitReached = summary.sendCount >= ANNOUNCEMENT_WHATSAPP_LIMIT;
  // Sisa kandidat yang belum sempat diproses (karena batas 15 atau batch).
  summary.pending = Math.max(0, candidates.length - processed);
  return summary;
}

/**
 * Siarkan pengumuman ke SELURUH penerima (bukan hanya satu batch).
 *
 * Dipakai sebagai pekerjaan LATAR BELAKANG setelah Admin menerbitkan pengumuman
 * agar proses simpan tidak menunggu seluruh pengiriman. Tetap memakai jalur
 * idempoten `broadcastAnnouncementWhatsApp`, sehingga aman bila terputus:
 * pemanggilan berikutnya / tombol "Kirim ulang" melanjutkan yang belum terkirim.
 * Loop WAJIB berhenti begitu batas 15 percobaan per pengumuman tercapai.
 */
export async function broadcastAnnouncementWhatsAppAll(
  a: AnnouncementLikeFull
): Promise<BroadcastSummary> {
  const total: BroadcastSummary = {
    ...EMPTY_SUMMARY,
    sendLimit: ANNOUNCEMENT_WHATSAPP_LIMIT,
  };
  let first = true;
  // Batas aman iterasi (MAX_RECIPIENTS / BATCH_SIZE) + margin.
  const maxLoops = Math.ceil(MAX_RECIPIENTS / BATCH_SIZE) + 2;
  for (let i = 0; i < maxLoops; i += 1) {
    const part = await broadcastAnnouncementWhatsApp(a, { limit: BATCH_SIZE });
    if (first) {
      total.configured = part.configured;
      total.due = part.due;
      total.recipients = part.recipients;
      first = false;
    }
    total.attempted += part.attempted;
    total.sent += part.sent;
    total.failed += part.failed;
    total.skipped += part.skipped;
    total.pending = part.pending;
    total.remaining = part.remaining;
    total.sendCount = part.sendCount;
    total.limitReached = part.limitReached;

    // Berhenti bila tidak ada lagi yang bisa diproses, konfigurasi belum ada,
    // batas 15 tercapai, atau batch terakhir tidak mengirim apa pun.
    if (!part.configured || part.limitReached || part.remaining <= 0 || part.attempted === 0) break;
  }
  return total;
}

export interface DeliveryStatus {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  total: number;
  /** Total percobaan kirim WhatsApp untuk pengumuman ini (maks. 15). */
  sendCount: number;
  sendLimit: number;
  limitReached: boolean;
}

/** Ringkasan status pengiriman WhatsApp sebuah pengumuman (untuk UI admin). */
export async function announcementDeliveryStatus(announcementId: string): Promise<DeliveryStatus> {
  const rows = await prisma.announcementDelivery.groupBy({
    by: ['status'],
    where: { announcementId },
    _count: { _all: true },
  });
  const out: DeliveryStatus = {
    sent: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    total: 0,
    sendCount: 0,
    sendLimit: ANNOUNCEMENT_WHATSAPP_LIMIT,
    limitReached: false,
  };
  for (const r of rows) {
    const n = r._count._all;
    out.total += n;
    if (r.status === 'SENT') out.sent += n;
    else if (r.status === 'FAILED') out.failed += n;
    else if (r.status === 'SKIPPED') out.skipped += n;
    else out.pending += n;
  }
  out.sendCount = await readSendCount(announcementId);
  out.limitReached = out.sendCount >= ANNOUNCEMENT_WHATSAPP_LIMIT;
  return out;
}

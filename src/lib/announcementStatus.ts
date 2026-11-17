/**
 * Status pengumuman desa — DITURUNKAN dari kolom yang tersimpan, bukan kolom
 * tersendiri, agar kompatibel dengan data lama (isPublished + publishedAt sudah
 * ada sejak awal). Murni (tanpa Prisma/Next) sehingga mudah diuji.
 *
 * Urutan prioritas:
 *   DELETED   → sudah dihapus lunak (deletedAt terisi); tidak tampil di mana pun.
 *   ARCHIVED  → diarsipkan (archivedAt terisi); tersimpan sebagai histori.
 *   DRAFT     → belum diterbitkan (isPublished=false).
 *   SCHEDULED → diterbitkan tetapi waktu publikasinya belum tiba.
 *   EXPIRED   → masa berlaku (validUntil) sudah lewat.
 *   PUBLISHED → terbit, sudah jatuh tempo, dan masih berlaku.
 */

export type AnnouncementStatus =
  | 'DELETED'
  | 'ARCHIVED'
  | 'DRAFT'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'PUBLISHED';

export interface AnnouncementStatusInput {
  isPublished: boolean;
  publishedAt: Date | string | null;
  validUntil?: Date | string | null;
  archivedAt?: Date | string | null;
  deletedAt?: Date | string | null;
}

function time(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export function deriveAnnouncementStatus(
  a: AnnouncementStatusInput,
  now: Date = new Date()
): AnnouncementStatus {
  if (a.deletedAt) return 'DELETED';
  if (a.archivedAt) return 'ARCHIVED';
  if (!a.isPublished) return 'DRAFT';
  const published = time(a.publishedAt);
  if (published === null || published > now.getTime()) return 'SCHEDULED';
  const until = time(a.validUntil);
  if (until !== null && until < now.getTime()) return 'EXPIRED';
  return 'PUBLISHED';
}

/** Label Bahasa Indonesia untuk badge admin. */
export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  DELETED: 'Terhapus',
  ARCHIVED: 'Arsip',
  DRAFT: 'Draf',
  SCHEDULED: 'Terjadwal',
  EXPIRED: 'Kedaluwarsa',
  PUBLISHED: 'Terbit',
};

/** Kelas badge (badge primary/success/warning/danger). */
export const ANNOUNCEMENT_STATUS_BADGE: Record<AnnouncementStatus, string> = {
  DELETED: 'danger',
  ARCHIVED: 'warning',
  DRAFT: 'warning',
  SCHEDULED: 'primary',
  EXPIRED: 'danger',
  PUBLISHED: 'success',
};

/** Pengumuman masih terlihat publik (terbit, jatuh tempo, belum kedaluwarsa). */
export function isPubliclyVisible(a: AnnouncementStatusInput, now: Date = new Date()): boolean {
  return deriveAnnouncementStatus(a, now) === 'PUBLISHED';
}

/** Pengumuman boleh memicu notifikasi (aplikasi & WhatsApp). */
export function isNotifiable(a: AnnouncementStatusInput, now: Date = new Date()): boolean {
  return deriveAnnouncementStatus(a, now) === 'PUBLISHED';
}

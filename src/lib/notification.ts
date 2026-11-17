import { prisma } from '@/lib/prisma';

export type NotificationType =
  | 'REPORT_CREATED'
  | 'REPORT_VERIFIED'
  | 'REPORT_REJECTED'
  | 'REPORT_ASSIGNED'
  | 'WORK_STARTED'
  | 'WORK_APPROVED'
  | 'WORK_IN_PROGRESS'
  | 'REVISION_REQUESTED'
  | 'REVIEW_REQUESTED'
  | 'REPORT_COMPLETED'
  | 'POSSIBLE_DUPLICATE'
  | 'REPORT_DUPLICATE'
  | 'ASSIGNMENT_CANCELLED'
  | 'NEW_REPORT'
  | 'NEW_USER'
  /** Pengumuman desa yang baru terbit (notifikasi turunan VillageAnnouncement). */
  | 'ANNOUNCEMENT';

export interface NotificationInput {
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
}

/**
 * Membuat 1 notifikasi untuk user tertentu.
 * Kegagalan tidak boleh memotong alur utama -> ditangkap di sini.
 */
export async function createNotification(d: NotificationInput) {
  try {
    return await prisma.notification.create({ data: d });
  } catch (e) {
    console.error('[Notification Error]', e);
    return null;
  }
}

/**
 * Kirim banyak notifikasi secara paralel (best-effort).
 */
export async function createNotifications(items: NotificationInput[]): Promise<void> {
  await Promise.all(items.map(createNotification));
}
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { createNotification } from '@/lib/notification';
import { notifyOfficerCancellation } from '@/lib/whatsapp';

export interface CancelResult {
  ok: boolean;
  status: number;
  error?: string;
  assignmentId?: string;
  officerName?: string;
}

/**
 * Batalkan penugasan aktif (soft-cancel, record TIDAK dihapus).
 * - Assignment: set cancelledAt/cancelReason/cancelledBy
 * - Laporan: kembali ke VERIFIED (Menunggu Penugasan)
 * - History + notifikasi petugas
 * Hanya untuk assignment AKTIF (belum selesai & belum dibatalkan).
 */
export async function cancelAssignment(
  assignmentId: string,
  adminName: string,
  reason?: string | null
): Promise<CancelResult> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      report: { select: { id: true, title: true, status: true } },
      officer: { select: { id: true, name: true } },
    },
  });

  if (!assignment) {
    return { ok: false, status: 404, error: 'Assignment tidak ditemukan' };
  }
  if (assignment.completedAt) {
    return { ok: false, status: 400, error: 'Penugasan sudah selesai dan tidak dapat dibatalkan' };
  }
  if (assignment.cancelledAt) {
    return { ok: false, status: 400, error: 'Penugasan ini sudah dibatalkan sebelumnya' };
  }

  const cleanReason = (reason || '').trim();

  await prisma.$transaction([
    prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        cancelledAt: new Date(),
        cancelReason: cleanReason || null,
        cancelledBy: adminName,
      },
    }),
    prisma.report.update({
      where: { id: assignment.reportId },
      data: { status: 'VERIFIED' },
    }),
    prisma.reportStatusHistory.create({
      data: {
        reportId: assignment.reportId,
        status: 'VERIFIED',
        notes: cleanReason
          ? `Penugasan kepada ${assignment.officer.name} dibatalkan oleh Admin. Alasan: ${cleanReason}. Laporan kembali menunggu penugasan.`
          : `Penugasan kepada ${assignment.officer.name} dibatalkan oleh Admin. Laporan kembali menunggu penugasan.`,
        actorName: 'Admin Penugasan',
        actorRole: 'ADMIN',
      },
    }),
  ]);

  // Notifikasi petugas yang dikeluarkan
  await createNotification({
    userId: assignment.officerId,
    type: 'ASSIGNMENT_CANCELLED',
    title: 'Penugasan Dibatalkan',
    message: cleanReason
      ? `Penugasan Anda pada laporan "${assignment.report.title}" telah dibatalkan oleh Admin. Alasan: ${cleanReason}`
      : `Penugasan Anda pada laporan "${assignment.report.title}" telah dibatalkan oleh Admin.`,
  });

  // WA ke petugas yang dibatalkan (best-effort)
  try {
    await notifyOfficerCancellation(assignmentId, cleanReason || undefined);
  } catch (waError) {
    console.error('[Cancel] Notifikasi WA petugas gagal:', waError);
  }

  return { ok: true, status: 200, assignmentId, officerName: assignment.officer.name };
}

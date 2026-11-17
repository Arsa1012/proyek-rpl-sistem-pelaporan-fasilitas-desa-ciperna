import { prisma } from './prisma';

/**
 * Catat tindakan administratif penting ke AdminAuditLog.
 *
 * Best-effort: kegagalan pencatatan audit TIDAK boleh menggagalkan operasi
 * utama (mis. akun sudah tersimpan). TIDAK PERNAH menyimpan kata sandi,
 * token reset, hash, cookie sesi, atau secret apa pun di `notes`.
 */
export async function logAdminAction(input: {
  adminId: string;
  action: string;
  targetUserId?: string;
  targetReportId?: string;
  notes?: string;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetUserId: input.targetUserId,
        targetReportId: input.targetReportId,
        notes: input.notes,
      },
    });
  } catch (error) {
    console.error('[AuditLog] gagal mencatat aksi administratif:', error);
  }
}

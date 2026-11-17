import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface CreateHistoryParams {
  reportId: string;
  status: string;
  notes?: string | null;
  actorName?: string | null;
  actorRole?: 'CITIZEN' | 'ADMIN' | 'OFFICER' | 'SYSTEM' | string;
}

/**
 * Mencatat riwayat perubahan status laporan secara terpusat.
 * Mendukung eksekusi dalam Prisma TransactionClient (tx) atau prisma instance biasa.
 */
export async function recordReportStatusHistory(
  params: CreateHistoryParams,
  tx?: Prisma.TransactionClient
) {
  const client = tx || prisma;
  return client.reportStatusHistory.create({
    data: {
      reportId: params.reportId,
      status: params.status,
      notes: params.notes || null,
      actorName: params.actorName || null,
      actorRole: params.actorRole || null,
    },
  });
}

/**
 * Membersihkan data riwayat agar aman disajikan kepada masyarakat (CITIZEN),
 * mencegah kebocoran informasi sensitif internal seperti ID admin atau catatan privat.
 */
export function sanitizeHistoryForCitizen(histories: any[]) {
  return histories.map((h) => ({
    id: h.id,
    status: h.status,
    notes: h.notes,
    actorName: h.actorName || (h.actorRole === 'ADMIN' ? 'Admin Verifikator' : h.actorRole === 'OFFICER' ? 'Petugas Lapangan' : 'Masyarakat'),
    actorRole: h.actorRole,
    createdAt: h.createdAt,
  }));
}

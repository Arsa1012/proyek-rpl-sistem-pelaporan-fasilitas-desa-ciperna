import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { createNotification } from '@/lib/notification';

export const dynamic = 'force-dynamic';

// POST /api/admin/duplicates/[id]/cancel — batalkan penandaan duplikat (ADMIN only)
// Mengembalikan laporan menjadi ORIGINAL. Riwayat tetap tersimpan sebagai audit trail.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const report = await prisma.report.findUnique({ where: { id: params.id } });
    if (!report) {
      return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 });
    }
    if (!['DUPLICATE', 'POSSIBLE_DUPLICATE'].includes(report.duplicateStatus)) {
      return NextResponse.json(
        { error: 'Laporan ini tidak berstatus duplikat' },
        { status: 400 }
      );
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: {
        duplicateStatus: 'ORIGINAL',
        duplicateOfReportId: null,
        duplicateConfidence: null,
        duplicateReason: null,
        duplicateBand: null,
        duplicateReviewedBy: admin?.name || 'Admin',
        duplicateReviewedAt: new Date(),
      },
    });

    await recordReportStatusHistory({
      reportId: report.id,
      status: report.status,
      notes: 'Admin membatalkan penandaan duplikat. Laporan kembali diproses sebagai laporan mandiri.',
      actorName: 'Admin Verifikator',
      actorRole: 'ADMIN',
    });

    await createNotification({
      userId: report.userId,
      type: 'REPORT_VERIFIED',
      title: 'Penandaan Duplikat Dibatalkan',
      message: `Penandaan duplikat pada laporan "${report.title}" telah dibatalkan Admin. Laporan Anda diproses normal.`,
    });

    return NextResponse.json({ success: true, report: updated });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/[id]/cancel]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

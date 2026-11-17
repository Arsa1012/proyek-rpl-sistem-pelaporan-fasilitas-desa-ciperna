import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';

export const dynamic = 'force-dynamic';

// POST /api/admin/duplicates/[id]/reject — tandai BUKAN duplikat (ADMIN only)
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
    if (report.duplicateStatus !== 'POSSIBLE_DUPLICATE') {
      return NextResponse.json(
        { error: 'Hanya kandidat duplikat yang dapat ditandai bukan duplikat' },
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
        duplicateStatus: 'NOT_DUPLICATE',
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
      notes: 'Admin meninjau dan menyatakan laporan ini BUKAN duplikat. Laporan diproses normal.',
      actorName: 'Admin Verifikator',
      actorRole: 'ADMIN',
    });

    return NextResponse.json({ success: true, report: updated });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/[id]/reject]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

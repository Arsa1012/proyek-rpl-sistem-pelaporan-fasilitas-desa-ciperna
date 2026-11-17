import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { createNotification } from '@/lib/notification';

export const dynamic = 'force-dynamic';

// POST /api/admin/duplicates/[id]/confirm — konfirmasi duplikat (ADMIN only)
// Body opsional: { mainReportId } untuk memilih laporan utama berbeda.
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
    if (!['POSSIBLE_DUPLICATE', 'DUPLICATE'].includes(report.duplicateStatus)) {
      return NextResponse.json(
        { error: 'Laporan ini tidak berstatus kandidat duplikat' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const mainReportId: string = body.mainReportId || report.duplicateOfReportId || '';
    if (!mainReportId) {
      return NextResponse.json({ error: 'Laporan utama wajib ditentukan' }, { status: 400 });
    }
    if (mainReportId === report.id) {
      return NextResponse.json({ error: 'Laporan utama tidak boleh laporan itu sendiri' }, { status: 400 });
    }

    const main = await prisma.report.findUnique({ where: { id: mainReportId } });
    if (!main) {
      return NextResponse.json({ error: 'Laporan utama tidak ditemukan' }, { status: 404 });
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: {
        duplicateStatus: 'DUPLICATE',
        duplicateOfReportId: main.id,
        duplicateReviewedBy: admin?.name || 'Admin',
        duplicateReviewedAt: new Date(),
      },
    });

    await recordReportStatusHistory({
      reportId: report.id,
      status: report.status,
      notes: `Admin mengonfirmasi laporan ini sebagai duplikat dari laporan #${main.id.slice(0, 8)} (${main.location}). Laporan tetap tersimpan sebagai histori.`,
      actorName: 'Admin Verifikator',
      actorRole: 'ADMIN',
    });

    // Notifikasi pelapor (tanpa data pribadi pelapor lain)
    await createNotification({
      userId: report.userId,
      type: 'REPORT_DUPLICATE',
      title: 'Laporan Duplikat Terkonfirmasi',
      message: `Laporan "${report.title}" tercatat memiliki kejadian yang sama dengan laporan #${main.id.slice(0, 8)} di ${main.location} (status: ${main.status}). Laporan Anda tetap tersimpan sebagai histori dan tidak dihapus.`,
    });

    return NextResponse.json({ success: true, report: updated });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/[id]/confirm]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

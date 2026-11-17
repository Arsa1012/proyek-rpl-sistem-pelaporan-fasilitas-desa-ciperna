import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { scoreSimilarity } from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

// POST /api/admin/duplicates/[id]/set-main — ganti laporan utama (ADMIN only)
// Body: { mainReportId }
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
        { error: 'Hanya laporan duplikat/kandidat yang dapat diganti laporan utamanya' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const mainRef: string = body.mainReportId || '';
    if (!mainRef) {
      return NextResponse.json({ error: 'mainReportId wajib diisi' }, { status: 400 });
    }

    // Dukung ID penuh atau 8 karakter awal
    let newMain = await prisma.report.findUnique({ where: { id: mainRef } });
    if (!newMain && /^[0-9a-f]{8}$/i.test(mainRef)) {
      const list = await prisma.report.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true },
      });
      const hit = list.find((r) => r.id.toLowerCase().startsWith(mainRef.toLowerCase()));
      if (hit) newMain = await prisma.report.findUnique({ where: { id: hit.id } });
    }
    if (!newMain) {
      return NextResponse.json({ error: 'Laporan utama tidak ditemukan' }, { status: 404 });
    }
    if (newMain.id === report.id) {
      return NextResponse.json({ error: 'Laporan utama tidak boleh laporan itu sendiri' }, { status: 400 });
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    // Kasus tukar: laporan utama baru ternyata menunjuk ke laporan ini -> bebaskan dulu
    if (newMain.duplicateOfReportId === report.id) {
      await prisma.report.update({
        where: { id: newMain.id },
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
        reportId: newMain.id,
        status: newMain.status,
        notes: 'Admin menjadikan laporan ini sebagai laporan utama (pertukaran peran duplikat).',
        actorName: 'Admin Verifikator',
        actorRole: 'ADMIN',
      });
    }

    // Hitung ulang confidence terhadap laporan utama baru
    const { score, reasons, band } = scoreSimilarity(
      {
        category: report.category,
        location: report.location,
        latitude: report.latitude,
        longitude: report.longitude,
        title: report.title,
        description: report.description,
        createdAt: report.createdAt,
      },
      {
        category: newMain.category,
        location: newMain.location,
        latitude: newMain.latitude,
        longitude: newMain.longitude,
        title: newMain.title,
        description: newMain.description,
        createdAt: newMain.createdAt,
      }
    );

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: {
        duplicateOfReportId: newMain.id,
        duplicateConfidence: score,
        duplicateReason: reasons.join('; '),
        duplicateBand: band,
        duplicateReviewedBy: admin?.name || 'Admin',
        duplicateReviewedAt: new Date(),
      },
    });

    await recordReportStatusHistory({
      reportId: report.id,
      status: report.status,
      notes: `Admin mengubah laporan utama menjadi #${newMain.id.slice(0, 8)} (${newMain.location}). Confidence ${score}%.`,
      actorName: 'Admin Verifikator',
      actorRole: 'ADMIN',
    });

    return NextResponse.json({ success: true, report: updated });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/[id]/set-main]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

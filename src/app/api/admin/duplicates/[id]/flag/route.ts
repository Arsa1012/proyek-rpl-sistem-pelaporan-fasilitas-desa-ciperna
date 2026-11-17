import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { scoreSimilarity } from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

async function resolveReport(ref: string) {
  if (!ref) return null;
  const exact = await prisma.report.findUnique({ where: { id: ref } });
  if (exact) return exact;
  if (/^[0-9a-f]{8}$/i.test(ref)) {
    const list = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true },
    });
    const hit = list.find((r) => r.id.toLowerCase().startsWith(ref.toLowerCase()));
    if (hit) return prisma.report.findUnique({ where: { id: hit.id } });
  }
  return null;
}

// POST /api/admin/duplicates/[id]/flag — tandai sebagai kandidat duplikat (ADMIN only)
// Body: { mainReportId } (ID penuh atau 8 karakter awal)
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

    const body = await request.json().catch(() => ({}));
    const main = await resolveReport(String(body.mainReportId || ''));
    if (!main) {
      return NextResponse.json({ error: 'Laporan utama tidak ditemukan' }, { status: 404 });
    }
    if (main.id === report.id) {
      return NextResponse.json({ error: 'Laporan utama tidak boleh laporan itu sendiri' }, { status: 400 });
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    const { score, reasons, band } = scoreSimilarity(
      {
        category: report.category, location: report.location, latitude: report.latitude,
        longitude: report.longitude, title: report.title, description: report.description,
        createdAt: report.createdAt,
      },
      {
        category: main.category, location: main.location, latitude: main.latitude,
        longitude: main.longitude, title: main.title, description: main.description,
        createdAt: main.createdAt,
      }
    );

    const updated = await prisma.report.update({
      where: { id: report.id },
      data: {
        duplicateStatus: 'POSSIBLE_DUPLICATE',
        duplicateOfReportId: main.id,
        duplicateConfidence: score,
        duplicateReason: reasons.join('; '),
        duplicateBand: band,
        duplicateReviewedBy: null,
        duplicateReviewedAt: null,
      },
    });

    await recordReportStatusHistory({
      reportId: report.id,
      status: report.status,
      notes: `Admin menandai laporan ini sebagai kandidat duplikat dari #${main.id.slice(0, 8)} (confidence ${score}%). Menunggu konfirmasi.`,
      actorName: 'Admin Verifikator',
      actorRole: 'ADMIN',
    });

    return NextResponse.json({ success: true, report: updated });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/[id]/flag]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

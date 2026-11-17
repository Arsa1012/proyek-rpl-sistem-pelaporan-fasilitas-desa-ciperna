import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/admin/duplicates — daftar laporan kandidat duplikat (ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // POSSIBLE_DUPLICATE | DUPLICATE | ALL

    const where: any = {};
    if (status && status !== 'ALL') {
      where.duplicateStatus = status;
    } else if (!status) {
      where.duplicateStatus = 'POSSIBLE_DUPLICATE';
    }

    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    // Sertakan info laporan utama untuk setiap kandidat
    const mainIds = Array.from(new Set(reports.map((r) => r.duplicateOfReportId).filter(Boolean))) as string[];
    const mains = mainIds.length
      ? await prisma.report.findMany({
          where: { id: { in: mainIds } },
          include: { user: { select: { id: true, name: true } } },
        })
      : [];
    const mainMap = new Map(mains.map((m) => [m.id, m]));

    const [possibleCount, duplicateCount] = await Promise.all([
      prisma.report.count({ where: { duplicateStatus: 'POSSIBLE_DUPLICATE' } }),
      prisma.report.count({ where: { duplicateStatus: 'DUPLICATE' } }),
    ]);

    return NextResponse.json({
      reports: reports.map((r) => ({
        ...r,
        mainReport: r.duplicateOfReportId ? mainMap.get(r.duplicateOfReportId) || null : null,
      })),
      counts: { possible: possibleCount, duplicate: duplicateCount },
    });
  } catch (error) {
    console.error('[GET /api/admin/duplicates]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

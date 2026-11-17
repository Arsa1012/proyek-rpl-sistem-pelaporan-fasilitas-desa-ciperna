import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runReportAnalysis } from '@/lib/reportAnalysis';
import { rateLimit } from '@/lib/rateLimit';

// POST /api/reports/[id]/analyze — analisis ulang (ADMIN, OFFICER terkait, pemilik)
// Penting: analisis ulang HANYA memperbarui hasil analisis laporan yang sama.
// Tidak pernah membuat laporan baru.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    // Batasi frekuensi agar tidak membanjiri provider AI / database.
    const rate = rateLimit(`analyze:${session.userId}`, 8, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan analisis. Coba lagi sebentar.' },
        { status: 429 }
      );
    }

    const report = await prisma.report.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });

    if (!report) {
      return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 });
    }

    let hasAccess = session.role === 'ADMIN' || report.userId === session.userId;
    if (!hasAccess && session.role === 'OFFICER') {
      // Petugas hanya boleh menganalisis laporan yang ditugaskan kepadanya.
      const assignment = await prisma.assignment.findFirst({
        where: { reportId: report.id, officerId: session.userId, cancelledAt: null },
        select: { id: true },
      });
      hasAccess = !!assignment;
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const outcome = await runReportAnalysis(report.id);

    if (!outcome.ok) {
      return NextResponse.json(
        {
          success: false,
          aiStatus: 'FAILED',
          error: outcome.message,
          code: outcome.code,
        },
        { status: 502 }
      );
    }

    const updated = await prisma.report.findUnique({ where: { id: report.id } });

    return NextResponse.json({
      success: true,
      aiStatus: outcome.status,
      report: updated,
      analysis: outcome.analysis,
      durationMs: outcome.durationMs,
    });
  } catch (error) {
    console.error('[POST /api/reports/[id]/analyze]', error);
    return NextResponse.json(
      { error: 'Analisis AI gagal. Silakan coba lagi nanti.' },
      { status: 500 }
    );
  }
}

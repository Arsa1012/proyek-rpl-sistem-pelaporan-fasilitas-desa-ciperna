import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notifyCitizenApproved, getAppBaseUrl, whatsappConfigStatus } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// POST /api/admin/reports/[id]/notify-completion — Admin mengirim ULANG
// notifikasi penyelesaian kepada pelapor (ADMIN only).
//
// Aman & idempoten: notifyCitizenApproved memakai dedupeKey `approved:<reportId>`,
// sehingga bila notifikasi sudah pernah BERHASIL terkirim, pengiriman dilewati
// (status ALREADY_SENT) — mencegah notifikasi ganda. Retry hanya benar-benar
// mengirim bila sebelumnya gagal/belum tercatat.
export async function POST(
  _request: NextRequest,
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

    const report = await prisma.report.findUnique({
      where: { id: params.id },
      include: {
        assignments: {
          include: { officer: { select: { name: true } } },
          orderBy: { assignedAt: 'desc' },
        },
        evidences: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!report) {
      return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 });
    }
    if (report.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Notifikasi penyelesaian hanya untuk laporan yang sudah berstatus Selesai.' },
        { status: 400 }
      );
    }

    const approved =
      report.assignments.find((a) => a.reviewStatus === 'APPROVED') || report.assignments[0];
    const evidence = report.evidences[0];
    const admin = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });

    // Ulangi dengan MODE yang sama seperti saat persetujuan (teks saja / teks+foto),
    // agar retry tidak mengirim format berbeda dari keputusan Admin.
    const notifyMode = approved?.notifyMode === 'TEXT_PHOTO' ? 'TEXT_PHOTO' : 'TEXT';

    const result = await notifyCitizenApproved(report.id, {
      officerName: approved?.officer.name,
      notes: evidence?.description || undefined,
      evidenceUrl: `${getAppBaseUrl()}/masyarakat/laporan/${report.id}`,
      approvedAt: approved?.completedAt || approved?.reviewedAt || new Date(),
      adminName: approved?.reviewedBy || admin?.name || 'Admin',
      location: report.location,
      sendEvidencePhoto: notifyMode === 'TEXT_PHOTO',
      evidencePhoto: evidence?.photo || null,
    });

    const status = result.deduped
      ? 'ALREADY_SENT'
      : result.skipped
      ? 'NOT_CONFIGURED'
      : result.ok
      ? 'SENT'
      : 'FAILED';

    return NextResponse.json({
      success: result.ok,
      status,
      configured: (await whatsappConfigStatus()).configured,
      error: result.error || null,
    });
  } catch (error) {
    console.error('[POST /api/admin/reports/[id]/notify-completion]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

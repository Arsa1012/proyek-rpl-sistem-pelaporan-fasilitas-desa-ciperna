import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory, sanitizeHistoryForCitizen } from '@/lib/history';
import { createNotification } from '@/lib/notification';
import { notifyCitizenStatusChange } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// GET /api/reports/[id] — ambil detail laporan
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const report = await prisma.report.findUnique({
      where: { id: params.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignments: {
          include: {
            officer: { select: { id: true, name: true } },
          },
          orderBy: { assignedAt: 'desc' },
        },
        evidences: { orderBy: { createdAt: 'desc' } },
        histories: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!report) {
      return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 });
    }

    // CITIZEN hanya bisa lihat laporan milik sendiri
    if (session.role === 'CITIZEN') {
      if (report.userId !== session.userId) {
        return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
      }
      // Sanitasi riwayat agar tidak membocorkan data sensitif internal
      report.histories = sanitizeHistoryForCitizen(report.histories) as any;
    }

    // OFFICER hanya bisa melihat laporan yang pernah/sedang ditugaskan kepadanya.
    // Tanpa ini, petugas bisa membaca detail laporan mana pun hanya dengan ID.
    if (session.role === 'OFFICER') {
      const assigned = await prisma.assignment.findFirst({
        where: {
          reportId: params.id,
          officerId: session.userId,
          cancelledAt: null,
        },
        select: { id: true },
      });
      if (!assigned) {
        return NextResponse.json(
          { error: 'Akses ditolak. Anda tidak memiliki penugasan pada laporan ini.' },
          { status: 403 }
        );
      }
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error('[GET /api/reports/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PATCH /api/reports/[id] — update status laporan (ADMIN/OFFICER)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session || !['ADMIN', 'OFFICER'].includes(session.role)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const body = await request.json();
    const { status, rejectionReason, category, severity } = body;

    const validStatuses = ['SUBMITTED', 'VERIFIED', 'REJECTED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
    }

    // Otorisasi khusus ADMIN untuk mengubah data penting atau memverifikasi
    if (session.role !== 'ADMIN') {
      if (
        category ||
        severity ||
        rejectionReason ||
        (status && status !== 'IN_PROGRESS') ||
        ['VERIFIED', 'REJECTED', 'REVIEW'].includes(status)
      ) {
        return NextResponse.json({ error: 'Hanya Admin yang dapat melakukan tindakan ini' }, { status: 403 });
      }

      // Pastikan OFFICER yang bersangkutan memiliki penugasan aktif pada laporan ini
      const isAssigned = await prisma.assignment.findFirst({
        where: {
          reportId: params.id,
          officerId: session.userId,
          completedAt: null,
          cancelledAt: null,
        },
      });
      if (!isAssigned) {
        return NextResponse.json(
          { error: 'Akses ditolak. Anda tidak memiliki penugasan aktif pada laporan ini.' },
          { status: 403 }
        );
      }
    }

    const report = await prisma.report.update({
      where: { id: params.id },
      data: {
        ...(status && { status }),
        ...(rejectionReason !== undefined && { rejectionReason }),
        ...(category && { category }),
        ...(severity && { severity }),
      },
    });

    // Catat perubahan status ke history
    if (status) {
      let notes = 'Status laporan diperbarui.';
      let actorName = session.role === 'ADMIN' ? 'Admin Verifikator' : 'Petugas Lapangan';

      if (status === 'VERIFIED') {
        notes = 'Laporan telah diperiksa dan diverifikasi oleh Admin.';
      } else if (status === 'REJECTED') {
        notes = rejectionReason ? `Alasan penolakan: ${rejectionReason}` : 'Laporan ditolak oleh Admin.';
      } else if (status === 'IN_PROGRESS') {
        notes = 'Penanganan perbaikan laporan sedang berlangsung.';
      } else if (status === 'COMPLETED') {
        notes = 'Pekerjaan perbaikan telah selesai.';
      }

      await recordReportStatusHistory({
        reportId: report.id,
        status,
        notes,
        actorName,
        actorRole: session.role,
      });

      // Notifikasi pelapor (aplikasi + WA) untuk setiap perubahan status
      if (status) {
        const fresh = await prisma.report.findUnique({ where: { id: report.id } });
        if (fresh) {
          const STATUS_TITLE: Record<string, string> = {
            VERIFIED: 'Laporan Diverifikasi',
            REJECTED: 'Laporan Ditolak',
            ASSIGNED: 'Laporan Ditugaskan',
            IN_PROGRESS: 'Pekerjaan Dimulai',
            REVIEW: 'Bukti Menunggu Persetujuan',
            COMPLETED: 'Laporan Selesai',
          };
          const STATUS_MSG: Record<string, string> = {
            VERIFIED: `Laporan "${fresh.title}" telah diverifikasi oleh Admin.`,
            REJECTED: rejectionReason
              ? `Laporan "${fresh.title}" ditolak. Alasan: ${rejectionReason}`
              : `Laporan "${fresh.title}" ditolak oleh Admin.`,
            ASSIGNED: `Laporan "${fresh.title}" telah ditugaskan kepada petugas lapangan.`,
            IN_PROGRESS: `Petugas telah memulai penanganan laporan "${fresh.title}".`,
            REVIEW: `Bukti pengerjaan laporan "${fresh.title}" sedang menunggu persetujuan Admin.`,
            COMPLETED: `Perbaikan laporan "${fresh.title}" telah selesai.`,
          };
          if (STATUS_TITLE[status]) {
            await createNotification({
              userId: fresh.userId,
              type: status === 'VERIFIED' ? 'REPORT_VERIFIED'
                : status === 'REJECTED' ? 'REPORT_REJECTED'
                : status === 'ASSIGNED' ? 'REPORT_ASSIGNED'
                : status === 'IN_PROGRESS' ? 'WORK_STARTED'
                : status === 'REVIEW' ? 'REVIEW_REQUESTED' : 'REPORT_COMPLETED',
              title: STATUS_TITLE[status],
              message: STATUS_MSG[status],
            });
            // WA ke nomor milik pelapor (best-effort, tidak menggagalkan update)
            try {
              await notifyCitizenStatusChange(
                fresh.id, status,
                status === 'REJECTED' ? (rejectionReason || undefined) : undefined
              );
            } catch (waError) {
              console.error('[PATCH report] Notifikasi WA warga gagal (status tetap tersimpan):', waError);
            }
          }
        }
      }
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error('[PATCH /api/reports/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

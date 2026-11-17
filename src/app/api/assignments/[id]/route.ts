import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notification';
import { notifyCitizenStatusChange } from '@/lib/whatsapp';
import { cancelAssignment } from '@/lib/assignmentCancel';

export const dynamic = 'force-dynamic';

// GET /api/assignments/[id] — Detail assignment
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        report: true,
        officer: { select: { id: true, name: true, email: true } },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment tidak ditemukan' }, { status: 404 });
    }

    // Otorisasi: Admin bisa akses semua, Officer hanya yang miliknya
    if (session.role === 'OFFICER' && assignment.officerId !== session.userId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (session.role === 'CITIZEN') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    return NextResponse.json({ assignment });
  } catch (error) {
    console.error('[GET /api/assignments/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// DELETE /api/assignments/[id] — Batalkan assignment (Admin only)
export async function DELETE(
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

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment tidak ditemukan' }, { status: 404 });
    }

    // Soft-cancel: record tetap tersimpan sebagai riwayat/audit
    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });
    const result = await cancelAssignment(params.id, admin?.name || 'Admin', null);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      message: 'Assignment berhasil dibatalkan. Status laporan kembali ke VERIFIED.',
    });
  } catch (error) {
    console.error('[DELETE /api/assignments/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// PATCH /api/assignments/[id] — Mulai pekerjaan (ASSIGNED -> IN_PROGRESS)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya petugas yang dapat memulai pekerjaan.' }, { status: 403 });
    }
    if (session.isActive === false) {
      return NextResponse.json(
        {
          error:
            'Akun Anda sedang nonaktif sehingga tidak dapat memulai pekerjaan baru. ' +
            'Silakan hubungi Admin Desa Ciperna di 082118727522.',
          code: 'ACCOUNT_INACTIVE',
          suspendReason: session.suspendReason ?? null,
        },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { action } = body;

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: { report: true, officer: { select: { id: true, name: true } } },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment tidak ditemukan' }, { status: 404 });
    }

    // Hanya petugas yang ditugaskan yang boleh memulai
    if (assignment.officerId !== session.userId) {
      return NextResponse.json(
        { error: 'Akses ditolak. Anda bukan petugas yang ditugaskan pada laporan ini.' },
        { status: 403 }
      );
    }

    // Penugasan yang dibatalkan tidak dapat dikerjakan lagi
    if (assignment.cancelledAt) {
      return NextResponse.json(
        { error: 'Penugasan ini telah dibatalkan oleh Admin dan tidak dapat dikerjakan.' },
        { status: 400 }
      );
    }

    if (action === 'START' || body.status === 'IN_PROGRESS') {
      if (assignment.report.status !== 'ASSIGNED') {
        return NextResponse.json(
          { error: `Hanya laporan dengan status ASSIGNED yang dapat dimulai. Status saat ini: ${assignment.report.status}` },
          { status: 400 }
        );
      }

      const [updatedReport] = await prisma.$transaction([
        prisma.report.update({
          where: { id: assignment.reportId },
          data: { status: 'IN_PROGRESS' },
        }),
        prisma.reportStatusHistory.create({
          data: {
            reportId: assignment.reportId,
            status: 'IN_PROGRESS',
            notes: 'Petugas telah memulai proses penanganan/perbaikan di lokasi.',
            actorName: `Petugas Lapangan (${assignment.officer.name})`,
            actorRole: 'OFFICER',
          },
        }),
      ]);

      // Notifikasi pelapor: pekerjaan baru dimulai
      await createNotification({
        userId: assignment.report.userId,
        type: 'WORK_STARTED',
        title: 'Pekerjaan Dimulai',
        message: `Petugas telah memulai penanganan laporan "${assignment.report.title}".`,
      });

      // WA ke nomor milik pelapor (best-effort)
      try {
        await notifyCitizenStatusChange(assignment.reportId, 'IN_PROGRESS');
      } catch (waError) {
        console.error('[PATCH assignment] Notifikasi WA warga gagal (status tetap tersimpan):', waError);
      }

      return NextResponse.json({
        success: true,
        message: 'Pekerjaan berhasil dimulai. Status diubah menjadi IN_PROGRESS.',
        report: updatedReport,
      });
    }

    return NextResponse.json({ error: 'Aksi tidak valid' }, { status: 400 });
  } catch (error) {
    console.error('[PATCH /api/assignments/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}


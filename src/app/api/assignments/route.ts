import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notification';
import { notifyCitizenStatusChange, notifyOfficerAssignment, notifyAdminAssignment } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// GET /api/assignments — Daftar assignment
// Admin: semua assignment. Officer: hanya milik sendiri.
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN' && session.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (session.role === 'OFFICER') {
      where.officerId = session.userId;
      where.cancelledAt = null;
    }

    const [assignments, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip,
        take: limit,
        include: {
          report: {
            select: {
              id: true,
              title: true,
              location: true,
              status: true,
              category: true,
              severity: true,
              photo: true,
            },
          },
          officer: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      prisma.assignment.count({ where }),
    ]);

    return NextResponse.json({ assignments, total, page, limit });
  } catch (error) {
    console.error('[GET /api/assignments]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// POST /api/assignments — Buat assignment baru (Admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin yang bisa menugaskan.' }, { status: 403 });
    }

    const body = await request.json();
    const { reportId, officerId, notes } = body;

    if (!reportId || !officerId) {
      return NextResponse.json({ error: 'reportId dan officerId wajib diisi' }, { status: 400 });
    }

    // Validasi laporan
    const report = await prisma.report.findUnique({ where: { id: reportId } });
    if (!report) {
      return NextResponse.json({ error: 'Laporan tidak ditemukan' }, { status: 404 });
    }
    if (report.status !== 'VERIFIED') {
      return NextResponse.json(
        { error: `Laporan harus berstatus VERIFIED untuk ditugaskan. Status saat ini: ${report.status}` },
        { status: 400 }
      );
    }
    if (report.duplicateStatus === 'DUPLICATE') {
      return NextResponse.json(
        {
          error: `Laporan ini adalah duplikat dari laporan #${(report.duplicateOfReportId || '').slice(0, 8)}. Tugaskan laporan utama tersebut agar petugas hanya menangani satu kejadian.`,
        },
        { status: 400 }
      );
    }

    // Validasi petugas
    const officer = await prisma.user.findUnique({ where: { id: officerId } });
    if (!officer) {
      return NextResponse.json({ error: 'Petugas tidak ditemukan' }, { status: 404 });
    }
    if (officer.role !== 'OFFICER') {
      return NextResponse.json({ error: 'User yang dipilih bukan petugas' }, { status: 400 });
    }

    // Validasi: laporan tidak boleh sudah punya assignment aktif
    const existingAssignment = await prisma.assignment.findFirst({
      where: { reportId, completedAt: null, cancelledAt: null },
    });
    if (existingAssignment) {
      return NextResponse.json(
        { error: 'Laporan ini sudah memiliki assignment aktif. Batalkan assignment sebelumnya terlebih dahulu.' },
        { status: 400 }
      );
    }

    // Buat assignment, update status laporan, dan catat history dalam satu transaksi
    const [_, assignment] = await prisma.$transaction([
      prisma.report.update({
        where: { id: reportId },
        data: { status: 'ASSIGNED' },
      }),
      prisma.assignment.create({
        data: {
          reportId,
          officerId,
          notes: notes || null,
        },
        include: {
          report: { select: { id: true, title: true, status: true } },
          officer: { select: { id: true, name: true } },
        },
      }),
      prisma.reportStatusHistory.create({
        data: {
          reportId,
          status: 'ASSIGNED',
          notes: `Laporan telah ditugaskan kepada petugas lapangan (${officer.name}).`,
          actorName: 'Admin Penugasan',
          actorRole: 'ADMIN',
        },
      }),
    ]);

    // Notifikasi ke pelapor & petugas yang ditugaskan
    await createNotification({
      userId: report.userId,
      type: 'REPORT_ASSIGNED',
      title: 'Laporan Ditugaskan',
      message: `Laporan "${report.title}" telah ditugaskan kepada petugas lapangan ${officer.name}.`,
    });
    await createNotification({
      userId: officerId,
      type: 'REPORT_ASSIGNED',
      title: 'Penugasan Baru',
      message: `Anda ditugaskan menangani laporan "${report.title}".`,
    });

    // WA ke nomor milik pelapor (best-effort)
    try {
      await notifyCitizenStatusChange(reportId, 'ASSIGNED', `Ditangani oleh ${officer.name}.`);
    } catch (waError) {
      console.error('[POST /api/assignments] Notifikasi WA warga gagal (assignment tetap tersimpan):', waError);
    }

    // WA ke petugas yang ditugaskan + Admin (best-effort)
    try {
      await notifyOfficerAssignment(reportId, officerId);
    } catch (waError) {
      console.error('[POST /api/assignments] Notifikasi WA petugas gagal:', waError);
    }
    try {
      await notifyAdminAssignment(assignment.id);
    } catch (waError) {
      console.error('[POST /api/assignments] Notifikasi WA admin gagal:', waError);
    }

    return NextResponse.json(
      { success: true, assignment, message: `Laporan berhasil ditugaskan kepada ${officer.name}` },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/assignments]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

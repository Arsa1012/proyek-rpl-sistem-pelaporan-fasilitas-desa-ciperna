import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notification';
import { notifyCitizenStatusChange, notifyAdminCompletion, notifyAdminReview, notifyOfficerReviewReceived } from '@/lib/whatsapp';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// POST /api/assignments/[id]/complete — Selesaikan pekerjaan (IN_PROGRESS -> COMPLETED) dengan upload foto bukti
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'OFFICER') {
      return NextResponse.json(
        { error: 'Akses ditolak. Hanya petugas yang dapat menyelesaikan pekerjaan.' },
        { status: 403 }
      );
    }
    if (session.isActive === false) {
      return NextResponse.json(
        {
          error:
            'Akun Anda sedang nonaktif sehingga tidak dapat menyelesaikan pekerjaan. ' +
            'Silakan hubungi Admin Desa Ciperna di 082118727522.',
          code: 'ACCOUNT_INACTIVE',
          suspendReason: session.suspendReason ?? null,
        },
        { status: 403 }
      );
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: { report: true, officer: { select: { id: true, name: true } } },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment tidak ditemukan' }, { status: 404 });
    }

    // Hanya petugas yang ditugaskan yang boleh menyelesaikan tugas
    if (assignment.officerId !== session.userId) {
      return NextResponse.json(
        { error: 'Akses ditolak. Anda bukan petugas yang ditugaskan pada laporan ini.' },
        { status: 403 }
      );
    }

    // Penugasan yang dibatalkan tidak dapat diselesaikan
    if (assignment.cancelledAt) {
      return NextResponse.json(
        { error: 'Penugasan ini telah dibatalkan oleh Admin dan tidak dapat diselesaikan.' },
        { status: 400 }
      );
    }

    // Validasi alur pekerjaan: harus IN_PROGRESS
    if (assignment.report.status !== 'IN_PROGRESS') {
      return NextResponse.json(
        {
          error: `Pekerjaan harus berstatus IN_PROGRESS sebelum dapat diselesaikan. Status saat ini: ${assignment.report.status}`,
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const photoFile = formData.get('photo') as File | null;
    const notes = ((formData.get('notes') as string) || '').trim();

    // Validasi upload foto bukti
    if (!photoFile || typeof photoFile === 'string' || photoFile.size === 0) {
      return NextResponse.json(
        { error: 'Foto bukti hasil pekerjaan wajib diunggah' },
        { status: 400 }
      );
    }

    // Validasi ukuran file (maksimal 10MB)
    if (photoFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Ukuran foto maksimal 10MB' },
        { status: 400 }
      );
    }

    // Validasi tipe file gambar
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!allowedTypes.includes(photoFile.type)) {
      return NextResponse.json(
        { error: 'Format foto harus berupa JPG, PNG, atau WEBP' },
        { status: 400 }
      );
    }

    // Simpan file ke public/uploads
    const bytes = await photoFile.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate magic bytes to ensure file is actually an image
    const magicBytes = buffer.slice(0, 4);
    const isValidImage =
      (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF) || // JPEG
      (magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47) || // PNG
      (magicBytes[0] === 0x52 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46 && magicBytes[3] === 0x46); // WEBP (RIFF)

    if (!isValidImage) {
      return NextResponse.json(
        { error: 'File tidak valid. Pastikan file adalah gambar yang benar.' },
        { status: 400 }
      );
    }

    // Use safe extension from validated MIME type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[photoFile.type] || 'jpg';
    const filename = `evidence_${assignment.reportId}_${Date.now()}.${ext}`;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');

    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), buffer);
    const photoPath = `/uploads/${filename}`;

    // Update dalam satu transaksi atomik:
    // status laporan -> REVIEW (Menunggu Persetujuan Admin), BUKAN langsung selesai.
    const [evidence, updatedAssignment, updatedReport] = await prisma.$transaction([
      prisma.reportEvidence.create({
        data: {
          reportId: assignment.reportId,
          assignmentId: assignment.id,
          photo: photoPath,
          description: notes || 'Pekerjaan perbaikan telah selesai dilaksanakan',
        },
      }),
      prisma.assignment.update({
        where: { id: params.id },
        data: {
          reviewStatus: 'PENDING',
          reviewNotes: notes || null,
          notes: notes
            ? assignment.notes
              ? `${assignment.notes} | Catatan Selesai: ${notes}`
              : notes
            : assignment.notes,
        },
      }),
      prisma.report.update({
        where: { id: assignment.reportId },
        data: { status: 'REVIEW' },
      }),
      prisma.reportStatusHistory.create({
        data: {
          reportId: assignment.reportId,
          status: 'REVIEW',
          notes: notes
            ? `Bukti pengerjaan dikirim dan menunggu persetujuan Admin. Catatan: ${notes}`
            : 'Bukti pengerjaan dikirim dan menunggu persetujuan Admin.',
          actorName: `Petugas Lapangan (${assignment.officer.name})`,
          actorRole: 'OFFICER',
        },
      }),
    ]);

    // Notifikasi Admin: bukti menunggu persetujuan (aplikasi + WA)
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await Promise.all(
      admins.map((adm) =>
        createNotification({
          userId: adm.id,
          type: 'REVIEW_REQUESTED',
          title: 'Bukti Menunggu Persetujuan',
          message: `Petugas ${assignment.officer.name} mengirim bukti pengerjaan laporan "${assignment.report.title}". Periksa sebelum menyetujui.`,
        })
      )
    );
    try {
      await notifyAdminReview(params.id);
    } catch (waError) {
      console.error('[Complete] Notifikasi WA admin gagal:', waError);
    }

    // Notifikasi petugas pengirim: bukti diterima, menunggu pemeriksaan
    await createNotification({
      userId: assignment.officerId,
      type: 'REVIEW_REQUESTED',
      title: 'Bukti Diterima Admin',
      message: `Bukti pengerjaan laporan "${assignment.report.title}" telah diterima dan menunggu pemeriksaan Admin.`,
    });
    try {
      await notifyOfficerReviewReceived(params.id);
    } catch (waError) {
      console.error('[Complete] Notifikasi WA petugas gagal:', waError);
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Bukti pengerjaan terkirim dan menunggu persetujuan Admin.',
        evidence,
        assignment: updatedAssignment,
        report: updatedReport,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[POST /api/assignments/[id]/complete]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

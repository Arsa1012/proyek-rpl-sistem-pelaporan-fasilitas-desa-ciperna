import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createNotification } from '@/lib/notification';
import {
  notifyCitizenApproved,
  notifyCitizenProgress,
  notifyOfficerApproved,
  notifyOfficerFix,
  notifyAdminCompletion,
  getAppBaseUrl,
} from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// POST /api/assignments/[id]/review — Admin menyetujui / meminta perbaikan (ADMIN only).
// Body: { decision: 'APPROVE' | 'REJECT', notes?: string }
// - APPROVE: assignment selesai, laporan COMPLETED, notifikasi warga + petugas.
// - REJECT (minta perbaikan): notes WAJIB, laporan kembali IN_PROGRESS.
//
// Anti-double: status review diklaim secara ATOMIK lewat updateMany bersyarat
// (`reviewStatus: 'PENDING'`). Bila dua permintaan datang bersamaan, hanya satu
// yang berhasil (count === 1); sisanya menerima 409 dan tidak mengirim notifikasi.
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
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin yang dapat menyetujui hasil.' }, { status: 403 });
    }

    const body = await request.json();
    const decision = String(body?.decision || '').toUpperCase();
    const notes = String(body?.notes || '').trim();
    // Pilihan format notifikasi ke warga (eksplisit dari Admin). Default teks saja.
    const notifyMode = body?.notifyMode === 'TEXT_PHOTO' ? 'TEXT_PHOTO' : 'TEXT';
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      return NextResponse.json({ error: 'Keputusan harus APPROVE atau REJECT' }, { status: 400 });
    }
    if (decision === 'REJECT' && !notes) {
      return NextResponse.json({ error: 'Alasan perbaikan wajib diisi' }, { status: 400 });
    }

    const assignment = await prisma.assignment.findUnique({
      where: { id: params.id },
      include: {
        report: true,
        officer: { select: { id: true, name: true } },
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: 'Penugasan tidak ditemukan' }, { status: 404 });
    }
    if (assignment.cancelledAt) {
      return NextResponse.json({ error: 'Penugasan sudah dibatalkan' }, { status: 400 });
    }
    // Sudah disetujui sebelumnya -> tolak secara tegas (anti persetujuan ganda).
    if (assignment.reviewStatus === 'APPROVED') {
      return NextResponse.json({ error: 'Bukti ini sudah disetujui sebelumnya.' }, { status: 409 });
    }
    if (assignment.report.status !== 'REVIEW') {
      return NextResponse.json(
        { error: `Hanya laporan berstatus REVIEW yang dapat direview. Status saat ini: ${assignment.report.status}` },
        { status: 400 }
      );
    }
    if (assignment.reviewStatus !== 'PENDING') {
      return NextResponse.json(
        { error: 'Bukti ini sudah diproses sebelumnya (disetujui/diminta perbaikan).' },
        { status: 409 }
      );
    }

    const admin = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
    const adminName = admin?.name || 'Admin';
    const now = new Date();

    if (decision === 'APPROVE') {
      const evidence = await prisma.reportEvidence.findFirst({
        where: { reportId: assignment.reportId },
        orderBy: { createdAt: 'desc' },
      });

      // Kirim foto hanya bila benar-benar ada bukti pada laporan INI dan Admin
      // memilih mode foto — tidak pernah mengirim foto secara diam-diam.
      if (notifyMode === 'TEXT_PHOTO' && !evidence?.photo) {
        return NextResponse.json(
          { error: 'Mode "teks + foto" dipilih, tetapi foto bukti tidak ditemukan. Pilih "teks saja" atau pastikan petugas mengunggah bukti.' },
          { status: 400 }
        );
      }

      // Klaim atomik + seluruh mutasi keputusan.
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.assignment.updateMany({
          where: { id: params.id, reviewStatus: 'PENDING', cancelledAt: null },
          data: {
            completedAt: now,
            reviewStatus: 'APPROVED',
            reviewedAt: now,
            reviewedBy: adminName,
            notifyMode,
            reviewNotes: notes || null,
          },
        });
        if (claim.count === 0) return false;

        await tx.report.update({ where: { id: assignment.reportId }, data: { status: 'COMPLETED' } });
        await tx.reportStatusHistory.create({
          data: {
            reportId: assignment.reportId,
            status: 'COMPLETED',
            notes: 'Bukti penyelesaian disetujui Admin. Laporan dinyatakan selesai.',
            actorName: `Admin (${adminName})`,
            actorRole: 'ADMIN',
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: session.userId,
            action: 'APPROVE_WORK',
            targetUserId: assignment.officerId,
            targetReportId: assignment.reportId,
            notes: `Bukti laporan "${assignment.report.title}" disetujui oleh ${adminName}.`,
          },
        });
        return true;
      });

      if (!claimed) {
        return NextResponse.json({ error: 'Bukti sudah diproses oleh permintaan lain.' }, { status: 409 });
      }

      await createNotification({
        userId: assignment.report.userId,
        type: 'REPORT_COMPLETED',
        title: 'Laporan Selesai',
        message: `Bukti penyelesaian laporan "${assignment.report.title}" telah disetujui Admin. Laporan dinyatakan selesai.`,
      });
      await createNotification({
        userId: assignment.officerId,
        type: 'WORK_APPROVED',
        title: 'Pekerjaan Disetujui',
        message: `Bukti penyelesaian laporan "${assignment.report.title}" telah disetujui Admin.`,
      });

      let wa: { ok: boolean; deduped?: boolean; skipped?: boolean; error?: string } | null = null;
      try {
        wa = await notifyCitizenApproved(assignment.reportId, {
          officerName: assignment.officer.name,
          notes: notes || evidence?.description || undefined,
          evidenceUrl: `${getAppBaseUrl()}/masyarakat/laporan/${assignment.reportId}`,
          approvedAt: now,
          adminName,
          location: assignment.report.location,
          sendEvidencePhoto: notifyMode === 'TEXT_PHOTO',
          evidencePhoto: evidence?.photo || null,
        });
      } catch (e) {
        // Kegagalan WA TIDAK membatalkan status selesai.
        console.error('[Review] WA warga gagal (status tetap selesai):', e);
      }
      try {
        await notifyOfficerApproved(params.id);
      } catch (e) {
        console.error('[Review] WA petugas gagal:', e);
      }
      try {
        await notifyAdminCompletion(params.id);
      } catch (e) {
        console.error('[Review] WA admin gagal:', e);
      }

      return NextResponse.json({
        success: true,
        message: 'Bukti disetujui. Laporan dinyatakan selesai.',
        notifyMode,
        notification: {
          status: wa?.ok
            ? wa.deduped
              ? 'ALREADY_SENT'
              : 'SENT'
            : wa?.skipped
              ? 'NOT_CONFIGURED'
              : 'FAILED',
          error: wa?.error || null,
        },
      });
    }

    // ── REJECT = minta perbaikan (notes WAJIB, laporan kembali IN_PROGRESS) ──
    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.assignment.updateMany({
        where: { id: params.id, reviewStatus: 'PENDING', cancelledAt: null },
        data: { reviewStatus: 'REVISION', reviewNotes: notes, reviewedAt: now, reviewedBy: adminName },
      });
      if (claim.count === 0) return false;

      await tx.report.update({ where: { id: assignment.reportId }, data: { status: 'IN_PROGRESS' } });
      await tx.reportStatusHistory.create({
        data: {
          reportId: assignment.reportId,
          status: 'IN_PROGRESS',
          notes: `Bukti ditolak, perlu perbaikan. Alasan: ${notes}`,
          actorName: `Admin (${adminName})`,
          actorRole: 'ADMIN',
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: session.userId,
          action: 'REQUEST_FIX',
          targetUserId: assignment.officerId,
          targetReportId: assignment.reportId,
          notes,
        },
      });
      return true;
    });

    if (!claimed) {
      return NextResponse.json({ error: 'Bukti sudah diproses oleh permintaan lain.' }, { status: 409 });
    }

    await createNotification({
      userId: assignment.officerId,
      type: 'REVISION_REQUESTED',
      title: 'Perbaikan Diperlukan',
      message: `Admin meminta perbaikan pada laporan "${assignment.report.title}". Alasan: ${notes}`,
    });
    await createNotification({
      userId: assignment.report.userId,
      type: 'WORK_IN_PROGRESS',
      title: 'Laporan Masih Diproses',
      message: `Laporan "${assignment.report.title}" masih dalam penanganan dan akan diinformasikan perkembangannya.`,
    });

    try {
      await notifyOfficerFix(params.id, notes);
    } catch (e) {
      console.error('[Review] WA petugas gagal:', e);
    }
    try {
      await notifyCitizenProgress(assignment.reportId);
    } catch (e) {
      console.error('[Review] WA warga gagal:', e);
    }

    return NextResponse.json({ success: true, message: 'Bukti ditolak. Permintaan perbaikan dikirim ke petugas.' });
  } catch (error) {
    console.error('[POST /api/assignments/[id]/review]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

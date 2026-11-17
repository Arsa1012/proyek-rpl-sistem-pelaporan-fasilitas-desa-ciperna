import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { runReportAnalysis } from '@/lib/reportAnalysis';
import { detectAndFlagDuplicates } from '@/lib/duplicates';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { recordReportStatusHistory } from '@/lib/history';
import { createNotification, createNotifications } from '@/lib/notification';
import { notifyAdminNewReport, notifyCitizenReceived, getAppBaseUrl } from '@/lib/whatsapp';
import { sanitizeClientKey } from '@/lib/idempotency';

/** Sanitasi idempotency key dari klien (bukan rahasia, hanya pembeda kiriman). */

// GET /api/reports — ambil semua laporan (Admin) atau laporan milik sendiri (Citizen)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const skip = (page - 1) * limit;

    const where: any = {};
    if (session.role === 'CITIZEN') {
      where.userId = session.userId;
    } else if (session.role === 'OFFICER') {
      // Petugas hanya melihat laporan yang ditugaskan kepadanya.
      where.assignments = { some: { officerId: session.userId, cancelledAt: null } };
    }
    if (status) where.status = status;
    if (category) where.category = category;

    const [reports, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.report.count({ where }),
    ]);

    return NextResponse.json({ reports, total, page, limit });
  } catch (error) {
    console.error('[GET /api/reports]', error);
    return NextResponse.json({ error: 'Gagal mengambil data laporan' }, { status: 500 });
  }
}

// POST /api/reports — buat laporan baru (CITIZEN)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'CITIZEN') {
      return NextResponse.json({ error: 'Hanya warga yang bisa membuat laporan' }, { status: 403 });
    }
    // Akun nonaktif tetap boleh login & melihat status, tetapi TIDAK boleh
    // membuat laporan baru. Alasan ditampilkan di dashboard dan pesan ini.
    if (session.isActive === false) {
      return NextResponse.json(
        {
          error:
            'Akun Anda sedang nonaktif sehingga tidak dapat membuat laporan baru. ' +
            'Silakan hubungi Admin Desa Ciperna di 082118727522 untuk informasi lebih lanjut.',
          code: 'ACCOUNT_INACTIVE',
          suspendReason: session.suspendReason ?? null,
        },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const title = String(formData.get('title') || '').trim();
    const description = String(formData.get('description') || '').trim();
    const location = String(formData.get('location') || '').trim();
    const clientKey = sanitizeClientKey(formData.get('clientKey'));
    const latitude = formData.get('latitude') ? parseFloat(formData.get('latitude') as string) : null;
    const longitude = formData.get('longitude') ? parseFloat(formData.get('longitude') as string) : null;
    const photoFile = formData.get('photo') as File | null;

    if (!title || !description || !location) {
      return NextResponse.json({ error: 'Judul, deskripsi, dan lokasi wajib diisi' }, { status: 400 });
    }

    // Validate field lengths
    if (title.length > 200) {
      return NextResponse.json({ error: 'Judul maksimal 200 karakter' }, { status: 400 });
    }
    if (description.length > 5000) {
      return NextResponse.json({ error: 'Deskripsi maksimal 5000 karakter' }, { status: 400 });
    }
    if (location.length > 300) {
      return NextResponse.json({ error: 'Lokasi maksimal 300 karakter' }, { status: 400 });
    }

    // Validate coordinates if provided
    if (latitude !== null && (isNaN(latitude) || latitude < -90 || latitude > 90)) {
      return NextResponse.json({ error: 'Latitude tidak valid' }, { status: 400 });
    }
    if (longitude !== null && (isNaN(longitude) || longitude < -180 || longitude > 180)) {
      return NextResponse.json({ error: 'Longitude tidak valid' }, { status: 400 });
    }

    // IDEMPOTENSI: kiriman ganda (double click / retry jaringan) dengan kunci yang
    // sama mengembalikan laporan yang SUDAH ada — tidak membuat record baru.
    // Diperiksa SEBELUM file foto ditulis agar tidak ada file yatim.
    if (clientKey) {
      const existing = await prisma.report.findUnique({
        where: { userId_clientKey: { userId: session.userId, clientKey } },
        select: { id: true },
      });
      if (existing) {
        const full = await prisma.report.findUnique({ where: { id: existing.id } });
        console.log(`[POST /api/reports] idempotent hit user=${session.userId.slice(0, 8)} report=${existing.id.slice(0, 8)}`);
        return NextResponse.json({
          success: true,
          idempotent: true,
          report: full,
          aiAnalysis: null,
          aiStatus: full?.aiStatus || 'PENDING',
          message: 'Laporan ini sudah tersimpan sebelumnya; tidak ada data ganda yang dibuat.',
        }, { status: 200 });
      }
    }

    let photoPath: string | null = null;

    if (photoFile && photoFile.size > 0) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(photoFile.type)) {
        return NextResponse.json({ error: 'Format foto harus JPG, PNG, atau WebP' }, { status: 400 });
      }
      if (photoFile.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'Ukuran foto maksimal 10MB' }, { status: 400 });
      }

      const bytes = await photoFile.arrayBuffer();
      const buffer = Buffer.from(bytes);

      // Validate magic bytes to ensure file is actually an image
      const magicBytes = buffer.slice(0, 4);
      const isValidImage =
        (magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF) || // JPEG
        (magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47) || // PNG
        (magicBytes[0] === 0x52 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46 && magicBytes[3] === 0x46); // WEBP (RIFF)

      if (!isValidImage) {
        return NextResponse.json({ error: 'File tidak valid. Pastikan file adalah gambar yang benar.' }, { status: 400 });
      }

      const timestamp = Date.now();
      // Use safe extension from validated MIME type
      const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
      };
      const ext = extMap[photoFile.type] || 'jpg';
      const filename = `report_${session.userId}_${timestamp}.${ext}`;
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');

      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), buffer);
      photoPath = `/uploads/${filename}`;
    }

    // Simpan laporan ke DB (clientKey ikut disimpan untuk idempotensi).
    const report = await prisma.report.create({
      data: {
        userId: session.userId,
        title,
        description,
        location,
        latitude,
        longitude,
        photo: photoPath,
        status: 'SUBMITTED',
        clientKey,
      },
    });

    // Catat riwayat status awal SUBMITTED (status OPERASIONAL, bukan status AI).
    await recordReportStatusHistory({
      reportId: report.id,
      status: 'SUBMITTED',
      notes: 'Laporan berhasil dibuat dan diajukan ke sistem.',
      actorName: 'Masyarakat (Pelapor)',
      actorRole: 'CITIZEN',
    });

    // Notifikasi: laporan baru terhadap pelapor
    await createNotification({
      userId: session.userId,
      type: 'REPORT_CREATED',
      title: 'Laporan Diterima',
      message: `Laporan "${title}" berhasil dibuat dan akan diperiksa oleh Admin.`,
    });

    // Analisis AI — memperbarui laporan yang SAMA (tidak membuat record baru).
    const outcome = await runReportAnalysis(report.id);

    // Deteksi duplikat (tidak pernah menggagalkan pembuatan laporan).
    let duplicateInfo = null;
    try {
      duplicateInfo = await detectAndFlagDuplicates(report.id);
    } catch (dupError) {
      console.error('[Duplicate Detection Error]', dupError);
    }

    const finalReport = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });

    // Notifikasi Admin SETELAH laporan tersimpan (website + WhatsApp, best-effort).
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      await createNotifications(
        admins.map((a) => ({
          userId: a.id,
          type: 'NEW_REPORT' as const,
          title: 'Laporan Baru Masuk',
          message: `Laporan baru "${finalReport.title}" di ${finalReport.location}. Status: ${finalReport.status}.`,
        }))
      );

      const time = new Date(finalReport.createdAt).toISOString();
      const reporter = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { name: true },
      });
      await notifyAdminNewReport({
        reportId: finalReport.id,
        title: finalReport.title,
        reporter: reporter?.name || '-',
        category: finalReport.category || '-',
        location: finalReport.location,
        description: finalReport.description,
        time,
        status: finalReport.status,
        detailUrl: `${getAppBaseUrl()}/admin/laporan/${finalReport.id}`,
        dedupeKey: `report:${finalReport.id}`,
      });
      // Notifikasi penerimaan ke warga pelapor (best-effort)
      try {
        await notifyCitizenReceived(finalReport.id);
      } catch (waError) {
        console.error('[Report] Notifikasi WA penerimaan warga gagal:', waError);
      }
    } catch (notifyError) {
      console.error('[Report] Notifikasi Admin gagal (laporan tetap tersimpan):', notifyError);
    }

    return NextResponse.json({
      success: true,
      report: finalReport,
      aiStatus: finalReport.aiStatus,
      aiAnalysis: outcome.ok ? outcome.analysis : null,
      ...(outcome.ok ? {} : { aiError: outcome.message }),
      ...(duplicateInfo ? { possibleDuplicate: duplicateInfo } : {}),
    }, { status: 201 });

  } catch (error) {
    console.error('[POST /api/reports]', error);
    // Don't expose internal error details to client
    return NextResponse.json({ error: 'Terjadi kesalahan server. Silakan coba lagi.' }, { status: 500 });
  }
}

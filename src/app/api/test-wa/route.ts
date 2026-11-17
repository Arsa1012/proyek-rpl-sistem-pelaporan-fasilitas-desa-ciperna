import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendWhatsApp, whatsappConfigStatus, notifyAdminNewUser, notifyAdminNewReport, getAppBaseUrl } from '@/lib/whatsapp';
import { resolveActiveRecipient } from '@/lib/notificationRecipients';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }
  return null;
}

// GET /api/test-wa — diagnosis konfigurasi + 5 log terakhir (ADMIN only).
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const config = await whatsappConfigStatus();
  const logs = await prisma.whatsAppLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { dedupeKey: true, kind: true, toMasked: true, status: true, providerMessageId: true, error: true, createdAt: true },
  });
  return NextResponse.json({ configured: config.configured, missing: config.missing, logs });
}

// POST /api/test-wa — kirim pesan uji langsung ke nomor admin (ADMIN only).
// Body opsional: { kind: 'text' | 'register' | 'report' } untuk menguji
// format pesan pendaftaran/laporan lengkap dengan data dummy berlabel UJI.
// Mengembalikan struktur hasil + error Meta apa adanya (tanpa token).
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  // Pesan uji dikirim ke nomor PENERIMA notifikasi yang aktif (bukan nomor
  // perangkat pengirim). Tanpa penerima aktif → pengiriman dihentikan.
  const recipient = await resolveActiveRecipient();
  const admin = recipient.phone;
  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        error:
          recipient.problems[0] ||
          'Belum ada nomor penerima notifikasi yang aktif. Tambahkan di menu Admin → Penerima Notifikasi.',
      },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind === 'register' || body?.kind === 'report' ? body.kind : 'text';
  const stamp = Date.now();
  const dedupeKey = `manual-test:${kind}:${stamp}`;

  const result =
    kind === 'register'
      ? await notifyAdminNewUser({
          name: 'UJI Sistem (dummy)',
          email: 'uji.dummy@example.com',
          phone: '6283000000000',
          role: 'Warga',
          rt: '01',
          rw: '02',
          time: new Date().toLocaleString('id-ID'),
          dashboardUrl: `${getAppBaseUrl()}/admin/masyarakat`,
          dedupeKey,
        })
      : kind === 'report'
        ? await notifyAdminNewReport({
            reportId: 'uji-dummy-id',
            title: 'UJI Sistem (dummy)',
            reporter: 'UJI Sistem (dummy)',
            category: 'Jalan Rusak',
            location: 'Jl. Uji RT 01 Ciperna (dummy)',
            description: 'Lampu jalan mati dan jalan berlubang di depan pos ronda. Pesan uji otomatis, mohon abaikan.',
            time: new Date().toLocaleString('id-ID'),
            status: 'SUBMITTED',
            detailUrl: `${getAppBaseUrl()}/admin/laporan`,
            dedupeKey,
          })
        : await sendWhatsApp(
            admin,
            `🔔 UJI SISTEM NOTIFIKASI\nIni pesan uji dari Sistem Pelaporan Desa Ciperna. Mohon abaikan.`,
            { dedupeKey, kind: 'TEXT' }
          );

  // Tidak pernah menyertakan token atau kredensial dalam respons.
  return NextResponse.json({
    ok: result.ok,
    kind,
    configured: result.configured,
    skipped: result.skipped,
    deduped: result.deduped,
    providerMessageId: result.providerMessageId,
    error: result.error,
    dedupeKey,
  });
}

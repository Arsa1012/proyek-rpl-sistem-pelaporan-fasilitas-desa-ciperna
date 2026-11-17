import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { notFound, readJson, requireAdmin } from '@/lib/adminApi';
import {
  announcementDeliveryStatus,
  broadcastAnnouncementWhatsApp,
} from '@/lib/announcementBroadcast';

export const dynamic = 'force-dynamic';

// POST /api/admin/village/announcements/[id]/whatsapp
// Kirim ULANG hanya penerima yang GAGAL — penerima yang sudah SENT tidak dikirim
// ulang (idempoten). Tidak mengubah status publikasi pengumuman.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const onlyFailed = body?.onlyFailed !== false; // default: hanya yang gagal

  try {
    const announcement = await prisma.villageAnnouncement.findUnique({ where: { id: params.id } });
    if (!announcement || announcement.deletedAt) return notFound('Pengumuman tidak ditemukan');

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'RETRY_ANNOUNCEMENT_WHATSAPP',
      notes: announcement.title,
    });

    const whatsapp = await broadcastAnnouncementWhatsApp(announcement, { onlyFailed });
    const status = await announcementDeliveryStatus(announcement.id);
    return NextResponse.json({
      success: true,
      message: whatsapp.limitReached
        ? `Batas ${status.sendLimit} percobaan kirim WhatsApp untuk pengumuman ini sudah tercapai. Tidak ada pesan baru yang dikirim.`
        : 'Percobaan pengiriman ulang selesai.',
      whatsapp,
      status,
    });
  } catch (error) {
    console.error('[POST /api/admin/village/announcements/[id]/whatsapp]', error);
    return NextResponse.json({ error: 'Gagal mengirim ulang notifikasi' }, { status: 500 });
  }
}

// GET status pengiriman pengumuman (untuk panel admin).
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const status = await announcementDeliveryStatus(params.id);
    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('[GET /api/admin/village/announcements/[id]/whatsapp]', error);
    return NextResponse.json({ error: 'Gagal membaca status pengiriman' }, { status: 500 });
  }
}

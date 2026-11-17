import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, readJson, requireAdmin } from '@/lib/adminApi';
import { parseAnnouncementInput } from '@/lib/villageInput';
import { getAllAnnouncements } from '@/lib/village';
import { uniqueAnnouncementSlug } from '@/lib/villageSlug';
import { syncAnnouncementNotification } from '@/lib/announcementNotify';
import { broadcastAnnouncementWhatsAppAll } from '@/lib/announcementBroadcast';

export const dynamic = 'force-dynamic';

// GET /api/admin/village/announcements — semua pengumuman (draft + terbit + arsip).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const announcements = await getAllAnnouncements();
    return NextResponse.json({ success: true, announcements });
  } catch (error) {
    console.error('[GET /api/admin/village/announcements]', error);
    return NextResponse.json({ error: 'Gagal membaca pengumuman' }, { status: 500 });
  }
}

// POST /api/admin/village/announcements — buat pengumuman (ADMIN only).
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const parsed = parseAnnouncementInput(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const slug = await uniqueAnnouncementSlug(parsed.data.slug || parsed.data.title);
    const announcement = await prisma.villageAnnouncement.create({
      data: {
        title: parsed.data.title,
        slug,
        content: parsed.data.content,
        excerpt: parsed.data.excerpt,
        category: parsed.data.category,
        coverPhoto: parsed.data.coverPhoto,
        photos: parsed.data.photos.length ? JSON.stringify(parsed.data.photos) : null,
        target: parsed.data.target,
        notifyWhatsApp: parsed.data.notifyWhatsApp,
        isPublished: parsed.data.isPublished,
        publishedAt: parsed.data.publishedAt,
        validFrom: parsed.data.validFrom,
        validUntil: parsed.data.validUntil,
        authorId: auth.session.userId,
      },
    });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'CREATE_VILLAGE_ANNOUNCEMENT',
      notes: announcement.title,
    });
    // Notifikasi dalam aplikasi untuk warga/petugas (idempoten; terjadwal bila
    // publishedAt di masa depan). Kegagalan notifikasi tidak membatalkan
    // pembuatan pengumuman.
    await syncAnnouncementNotification(announcement);
    // Notifikasi WhatsApp opsional (hanya bila notifyWhatsApp & sudah jatuh tempo).
    // Dijalankan di LATAR BELAKANG agar simpan pengumuman tidak menunggu seluruh
    // pengiriman; status per penerima tetap dicatat dan bisa dikirim ulang.
    void broadcastAnnouncementWhatsAppAll(announcement).catch((error) => {
      console.error('[POST announcements] broadcast WhatsApp gagal:', error);
    });
    return NextResponse.json(
      { success: true, message: 'Pengumuman berhasil dibuat.', announcement, whatsapp: { queued: true } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/village/announcements]', error);
    return NextResponse.json({ error: 'Gagal menyimpan pengumuman' }, { status: 500 });
  }
}

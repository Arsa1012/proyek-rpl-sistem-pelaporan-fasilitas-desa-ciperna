import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, notFound, readJson, requireAdmin } from '@/lib/adminApi';
import { parseAnnouncementInput } from '@/lib/villageInput';
import { uniqueAnnouncementSlug } from '@/lib/villageSlug';
import { syncAnnouncementNotification } from '@/lib/announcementNotify';
import { broadcastAnnouncementWhatsAppAll } from '@/lib/announcementBroadcast';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/village/announcements/[id] — ubah / terbitkan / tarik / arsip.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    const existing = await prisma.villageAnnouncement.findUnique({ where: { id: params.id } });
    if (!existing || existing.deletedAt) return notFound('Pengumuman tidak ditemukan');

    if (action === 'publish' || action === 'unpublish' || action === 'archive' || action === 'unarchive') {
      const data: Record<string, unknown> = {};
      if (action === 'publish') {
        data.isPublished = true;
        data.publishedAt = existing.publishedAt ?? new Date();
        data.archivedAt = null;
      } else if (action === 'unpublish') {
        data.isPublished = false;
      } else if (action === 'archive') {
        data.archivedAt = new Date();
        data.isPublished = false;
      } else {
        data.archivedAt = null;
      }

      const announcement = await prisma.villageAnnouncement.update({ where: { id: params.id }, data });
      await logAdminAction({
        adminId: auth.session.userId,
        action: `ANNOUNCEMENT_${action.toUpperCase()}`,
        notes: announcement.title,
      });
      // Siarkan / tarik notifikasi dalam aplikasi sesuai keadaan pengumuman.
      await syncAnnouncementNotification(announcement);
      // Broadcast WhatsApp dijalankan di latar belakang saat terbit.
      if (action === 'publish') {
        void broadcastAnnouncementWhatsAppAll(announcement).catch((error) => {
          console.error('[PATCH announcements] broadcast WhatsApp gagal:', error);
        });
      }
      const whatsapp = action === 'publish' ? { queued: true } : undefined;
      const messages: Record<string, string> = {
        publish: 'Pengumuman diterbitkan.',
        unpublish: 'Pengumuman ditarik dari halaman publik.',
        archive: 'Pengumuman diarsipkan.',
        unarchive: 'Pengumuman dikeluarkan dari arsip.',
      };
      return NextResponse.json({ success: true, message: messages[action], announcement, whatsapp });
    }

    const parsed = parseAnnouncementInput(body, existing);
    if (!parsed.ok) return badRequest(parsed.error);

    let slug = existing.slug;
    if (typeof body.slug === 'string' && body.slug.trim() && body.slug.trim() !== existing.slug) {
      slug = await uniqueAnnouncementSlug(String(body.slug).trim(), existing.id);
    }

    const announcement = await prisma.villageAnnouncement.update({
      where: { id: params.id },
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
      },
    });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'UPDATE_VILLAGE_ANNOUNCEMENT',
      notes: announcement.title,
    });
    // Perbarui notifikasi turunannya agar isi yang ditampilkan tetap konsisten.
    await syncAnnouncementNotification(announcement);
    // Kirim WhatsApp bila opsi menyala dan pengumuman sudah jatuh tempo; idempoten
    // sehingga mengedit pengumuman yang sudah terkirim tidak mengirim ulang.
    // Dijalankan di latar belakang agar simpan tidak menunggu pengiriman.
    void broadcastAnnouncementWhatsAppAll(announcement).catch((error) => {
      console.error('[PATCH announcements] broadcast WhatsApp gagal:', error);
    });
    return NextResponse.json({
      success: true,
      message: 'Perubahan disimpan.',
      announcement,
      whatsapp: { queued: true },
    });
  } catch (error) {
    console.error('[PATCH /api/admin/village/announcements/[id]]', error);
    return NextResponse.json({ error: 'Gagal memperbarui pengumuman' }, { status: 500 });
  }
}

// DELETE /api/admin/village/announcements/[id] — HAPUS LUNAK.
// Baris tidak dihapus permanen agar riwayat notifikasi/pengiriman tetap utuh.
// Notifikasi dalam aplikasi yang sudah terkirim ditarik dari penerima.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const existing = await prisma.villageAnnouncement.findUnique({ where: { id: params.id } });
    if (!existing) return notFound('Pengumuman tidak ditemukan');
    if (existing.deletedAt) {
      return NextResponse.json({ error: 'Pengumuman sudah dihapus.' }, { status: 409 });
    }

    const announcement = await prisma.villageAnnouncement.update({
      where: { id: params.id },
      data: {
        deletedAt: new Date(),
        deletedBy: auth.session.userId,
        isPublished: false,
      },
    });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'DELETE_VILLAGE_ANNOUNCEMENT',
      notes: announcement.title,
    });
    // Tarik notifikasi aplikasi; log pengiriman WhatsApp TETAP disimpan untuk audit.
    await syncAnnouncementNotification(announcement);

    return NextResponse.json({ success: true, message: 'Pengumuman dihapus (arsip audit tetap tersimpan).', announcement });
  } catch (error) {
    console.error('[DELETE /api/admin/village/announcements/[id]]', error);
    return NextResponse.json({ error: 'Gagal menghapus pengumuman' }, { status: 500 });
  }
}

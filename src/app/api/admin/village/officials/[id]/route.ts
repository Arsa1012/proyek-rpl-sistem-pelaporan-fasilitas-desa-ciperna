import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, notFound, readJson, requireAdmin } from '@/lib/adminApi';
import { parseOfficialInput } from '@/lib/villageInput';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/village/officials/[id] — ubah / arsip / pulihkan (no hard delete).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    const existing = await prisma.villageOfficial.findUnique({ where: { id: params.id } });
    if (!existing) return notFound('Perangkat desa tidak ditemukan');

    if (action === 'archive' || action === 'restore') {
      const isActive = action === 'restore';
      const official = await prisma.villageOfficial.update({
        where: { id: params.id },
        data: { isActive, archivedAt: isActive ? null : existing.archivedAt ?? new Date() },
      });
      await logAdminAction({
        adminId: auth.session.userId,
        action: isActive ? 'RESTORE_VILLAGE_OFFICIAL' : 'ARCHIVE_VILLAGE_OFFICIAL',
        notes: `${official.name} — ${official.position}`,
      });
      return NextResponse.json({
        success: true,
        message: isActive ? 'Profil diaktifkan kembali.' : 'Profil diarsipkan (histori tetap tersimpan).',
        official,
      });
    }

    const parsed = parseOfficialInput(body, existing);
    if (!parsed.ok) return badRequest(parsed.error);

    const official = await prisma.villageOfficial.update({
      where: { id: params.id },
      data: parsed.data,
    });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'UPDATE_VILLAGE_OFFICIAL',
      notes: `${official.name} — ${official.position}`,
    });
    return NextResponse.json({ success: true, message: 'Perubahan disimpan.', official });
  } catch (error) {
    console.error('[PATCH /api/admin/village/officials/[id]]', error);
    return NextResponse.json({ error: 'Gagal memperbarui perangkat desa' }, { status: 500 });
  }
}

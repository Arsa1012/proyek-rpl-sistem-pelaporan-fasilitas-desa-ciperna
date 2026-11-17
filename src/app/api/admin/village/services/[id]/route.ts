import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, notFound, readJson, requireAdmin } from '@/lib/adminApi';
import { parseServiceInput } from '@/lib/villageInput';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/village/services/[id] — ubah / arsip / aktifkan kembali.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : '';

  try {
    const existing = await prisma.villageService.findUnique({ where: { id: params.id } });
    if (!existing) return notFound('Layanan tidak ditemukan');

    if (action === 'archive' || action === 'restore') {
      const service = await prisma.villageService.update({
        where: { id: params.id },
        data: { isActive: action === 'restore' },
      });
      await logAdminAction({
        adminId: auth.session.userId,
        action: action === 'restore' ? 'RESTORE_VILLAGE_SERVICE' : 'ARCHIVE_VILLAGE_SERVICE',
        notes: service.name,
      });
      return NextResponse.json({
        success: true,
        message: action === 'restore' ? 'Layanan diaktifkan kembali.' : 'Layanan dinonaktifkan.',
        service,
      });
    }

    const parsed = parseServiceInput(body, existing);
    if (!parsed.ok) return badRequest(parsed.error);

    const service = await prisma.villageService.update({
      where: { id: params.id },
      data: parsed.data,
    });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'UPDATE_VILLAGE_SERVICE',
      notes: service.name,
    });
    return NextResponse.json({ success: true, message: 'Perubahan disimpan.', service });
  } catch (error) {
    console.error('[PATCH /api/admin/village/services/[id]]', error);
    return NextResponse.json({ error: 'Gagal memperbarui layanan' }, { status: 500 });
  }
}

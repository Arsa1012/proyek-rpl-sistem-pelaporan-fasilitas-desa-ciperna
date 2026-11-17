import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, notFound, readJson, requireAdmin, clampInt } from '@/lib/adminApi';
import { normalizeRegionNumber } from '@/lib/region';

export const dynamic = 'force-dynamic';

// PATCH /api/admin/regions/[id] — ubah RW atau RT (ADMIN only).
// Tidak ada penghapusan permanen: nonaktifkan dengan isActive=false.
// `type` wajib pada body ('RW' | 'RT').
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const id = params.id;
  const body = await readJson(request);
  const type = String(body.type || '').toUpperCase();
  if (type !== 'RW' && type !== 'RT') return badRequest('Jenis wilayah harus RW atau RT');

  try {
    if (type === 'RW') {
      const current = await prisma.villageRw.findUnique({ where: { id } });
      if (!current) return notFound('RW tidak ditemukan');

      const data: Record<string, unknown> = {};
      if (body.number !== undefined) {
        const number = normalizeRegionNumber(body.number);
        if (!number) return badRequest('Nomor RW harus 1-3 angka');
        if (number !== current.number) {
          const dup = await prisma.villageRw.findUnique({ where: { number } });
          if (dup) return badRequest(`RW ${number} sudah ada`);
        }
        data.number = number;
      }
      if (body.name !== undefined) {
        data.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : null;
      }
      if (body.order !== undefined) data.order = clampInt(body.order, 0, 9999, current.order);
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      const rw = await prisma.villageRw.update({ where: { id }, data });
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'UPDATE_RW',
        notes: `RW ${rw.number} → ${rw.isActive ? 'aktif' : 'nonaktif'}${rw.name ? ` (${rw.name})` : ''}`,
      });
      return NextResponse.json({ success: true, message: `RW ${rw.number} diperbarui.`, rw });
    }

    const current = await prisma.villageRt.findUnique({ where: { id }, include: { rw: true } });
    if (!current) return notFound('RT tidak ditemukan');

    const data: Record<string, unknown> = {};
    let movedFrom: string | null = null;

    if (body.rwId !== undefined && typeof body.rwId === 'string' && body.rwId && body.rwId !== current.rwId) {
      const target = await prisma.villageRw.findUnique({ where: { id: body.rwId } });
      if (!target) return badRequest('RW tujuan tidak ditemukan');
      data.rwId = target.id;
      movedFrom = current.rw.number;
    }

    if (body.number !== undefined) {
      const number = normalizeRegionNumber(body.number);
      if (!number) return badRequest('Nomor RT harus 1-3 angka');
      const targetRwId = (data.rwId as string) || current.rwId;
      if (number !== current.number || data.rwId) {
        const dup = await prisma.villageRt.findFirst({ where: { rwId: targetRwId, number, id: { not: id } } });
        if (dup) return badRequest(`RT ${number} sudah ada di RW tersebut`);
      }
      data.number = number;
    } else if (data.rwId) {
      // Pindah RW tanpa ganti nomor: pastikan nomor RT tidak bentrok di RW tujuan.
      const dup = await prisma.villageRt.findFirst({
        where: { rwId: data.rwId as string, number: current.number, id: { not: id } },
      });
      if (dup) return badRequest(`RT ${current.number} sudah ada di RW tujuan. Ganti nomor RT terlebih dahulu.`);
    }

    if (body.name !== undefined) {
      data.name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : null;
    }
    if (body.order !== undefined) data.order = clampInt(body.order, 0, 9999, current.order);
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

    const rt = await prisma.villageRt.update({
      where: { id },
      data,
      include: { rw: true, _count: { select: { users: true } } },
    });

    const parts = [`RT ${rt.number} / RW ${rt.rw.number}`, rt.isActive ? 'aktif' : 'nonaktif'];
    if (movedFrom) parts.push(`dipindah dari RW ${movedFrom}`);
    if (rt._count.users > 0) parts.push(`${rt._count.users} warga tertaut`);
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'UPDATE_RT',
      notes: parts.join(' • '),
    });

    return NextResponse.json({
      success: true,
      message: `RT ${rt.number} diperbarui.`,
      rt: { ...rt, userCount: rt._count.users },
    });
  } catch (error) {
    console.error('[PATCH /api/admin/regions/[id]]', error);
    return NextResponse.json({ error: 'Gagal memperbarui data wilayah' }, { status: 500 });
  }
}

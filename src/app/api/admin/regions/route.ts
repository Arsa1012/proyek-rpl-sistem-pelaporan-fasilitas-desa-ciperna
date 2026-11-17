import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, readJson, requireAdmin, clampInt } from '@/lib/adminApi';
import { getAllRegions, normalizeRegionNumber } from '@/lib/region';

export const dynamic = 'force-dynamic';

// GET /api/admin/regions — seluruh RW/RT (termasuk nonaktif) + jumlah warga.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const rws = await getAllRegions();
    return NextResponse.json({ success: true, rws });
  } catch (error) {
    console.error('[GET /api/admin/regions]', error);
    return NextResponse.json({ error: 'Gagal membaca data wilayah' }, { status: 500 });
  }
}

// POST /api/admin/regions — tambah RW atau RT (ADMIN only). Tidak ada delete.
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const type = String(body.type || '').toUpperCase();
  const number = normalizeRegionNumber(body.number);
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const order = clampInt(body.order, 0, 9999, 0);

  if (type !== 'RW' && type !== 'RT') return badRequest('Jenis wilayah harus RW atau RT');
  if (!number) return badRequest('Nomor wilayah harus 1-3 angka');

  try {
    if (type === 'RW') {
      const exists = await prisma.villageRw.findUnique({ where: { number } });
      if (exists) return badRequest(`RW ${number} sudah ada`);
      const rw = await prisma.villageRw.create({ data: { number, name, order } });
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'CREATE_RW',
        notes: `RW ${rw.number}${rw.name ? ` (${rw.name})` : ''}`,
      });
      return NextResponse.json({ success: true, message: `RW ${number} ditambahkan.`, rw }, { status: 201 });
    }

    const rwId = typeof body.rwId === 'string' ? body.rwId : '';
    if (!rwId) return badRequest('Pilih RW untuk RT baru');
    const rw = await prisma.villageRw.findUnique({ where: { id: rwId } });
    if (!rw) return badRequest('RW tidak ditemukan');
    const exists = await prisma.villageRt.findFirst({ where: { rwId, number } });
    if (exists) return badRequest(`RT ${number} sudah ada di RW ${rw.number}`);

    const rt = await prisma.villageRt.create({ data: { rwId, number, name, order } });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'CREATE_RT',
      notes: `RT ${rt.number} / RW ${rw.number}`,
    });
    return NextResponse.json(
      { success: true, message: `RT ${number} ditambahkan ke RW ${rw.number}.`, rt },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/regions]', error);
    return NextResponse.json({ error: 'Gagal menyimpan data wilayah' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, readJson, requireAdmin } from '@/lib/adminApi';
import { parseServiceInput } from '@/lib/villageInput';
import { getAllServices } from '@/lib/village';

export const dynamic = 'force-dynamic';

// GET /api/admin/village/services — semua layanan desa.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const services = await getAllServices();
    return NextResponse.json({ success: true, services });
  } catch (error) {
    console.error('[GET /api/admin/village/services]', error);
    return NextResponse.json({ error: 'Gagal membaca data layanan' }, { status: 500 });
  }
}

// POST /api/admin/village/services — tambah layanan (ADMIN only).
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const parsed = parseServiceInput(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const service = await prisma.villageService.create({ data: parsed.data });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'CREATE_VILLAGE_SERVICE',
      notes: service.name,
    });
    return NextResponse.json(
      { success: true, message: 'Layanan berhasil ditambahkan.', service },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/village/services]', error);
    return NextResponse.json({ error: 'Gagal menyimpan layanan' }, { status: 500 });
  }
}

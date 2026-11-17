import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import { badRequest, readJson, requireAdmin } from '@/lib/adminApi';
import { parseOfficialInput } from '@/lib/villageInput';
import { getAllOfficials } from '@/lib/village';

export const dynamic = 'force-dynamic';

// GET /api/admin/village/officials — semua perangkat desa (termasuk arsip).
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const officials = await getAllOfficials();
    return NextResponse.json({ success: true, officials });
  } catch (error) {
    console.error('[GET /api/admin/village/officials]', error);
    return NextResponse.json({ error: 'Gagal membaca data perangkat desa' }, { status: 500 });
  }
}

// POST /api/admin/village/officials — tambah profil perangkat desa (ADMIN only).
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  const parsed = parseOfficialInput(body);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const official = await prisma.villageOfficial.create({ data: parsed.data });
    await logAdminAction({
      adminId: auth.session.userId,
      action: 'CREATE_VILLAGE_OFFICIAL',
      notes: `${official.name} — ${official.position}`,
    });
    return NextResponse.json(
      { success: true, message: 'Profil perangkat desa berhasil ditambahkan.', official },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/village/officials]', error);
    return NextResponse.json({ error: 'Gagal menyimpan perangkat desa' }, { status: 500 });
  }
}

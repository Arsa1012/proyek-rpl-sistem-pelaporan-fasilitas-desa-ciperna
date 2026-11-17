import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cancelAssignment } from '@/lib/assignmentCancel';

export const dynamic = 'force-dynamic';

// POST /api/assignments/[id]/cancel — Batalkan penugasan (ADMIN only)
// Body: { reason } — alasan wajib diisi
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin yang dapat membatalkan penugasan.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return NextResponse.json({ error: 'Alasan pembatalan wajib diisi' }, { status: 400 });
    }

    const admin = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    const result = await cancelAssignment(params.id, admin?.name || 'Admin', reason);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      message: `Penugasan Petugas ${result.officerName} berhasil dibatalkan. Laporan kembali ke daftar menunggu penugasan.`,
    });
  } catch (error) {
    console.error('[POST /api/assignments/[id]/cancel]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

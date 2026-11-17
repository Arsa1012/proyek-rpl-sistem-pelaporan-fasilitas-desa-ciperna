import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/officers — Daftar semua user dengan role OFFICER (Admin only)
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const officers = await prisma.user.findMany({
      where: { role: 'OFFICER' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        _count: {
          select: {
            assignments: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ officers });
  } catch (error) {
    console.error('[GET /api/officers]', error);
    return NextResponse.json({ error: 'Gagal mengambil daftar petugas' }, { status: 500 });
  }
}

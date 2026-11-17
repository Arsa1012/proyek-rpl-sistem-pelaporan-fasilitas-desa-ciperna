import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { whatsappConfigStatus } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// GET /api/admin/whatsapp-logs — status konfigurasi + 20 log terakhir (ADMIN only).
// Nomor hanya tampil tersamar, tanpa token atau isi rahasia.
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const config = await whatsappConfigStatus();
    const logs = await prisma.whatsAppLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        dedupeKey: true,
        kind: true,
        toMasked: true,
        status: true,
        providerMessageId: true,
        error: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ configured: config.configured, missing: config.missing, logs });
  } catch (error) {
    console.error('[GET /api/admin/whatsapp-logs]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

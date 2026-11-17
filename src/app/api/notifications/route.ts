import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureDueAnnouncementForUser } from '@/lib/announcementNotify';

export const dynamic = 'force-dynamic';

// GET /api/notifications — list notifikasi user sendiri (terbaru 50) + unreadCount
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Warga: pastikan pengumuman yang sudah jatuh tempo sudah dinotifikasikan
    // (menangani pengumuman terjadwal & notifikasi yang terlewat). Idempoten.
    if (session.role === 'CITIZEN') {
      await ensureDueAnnouncementForUser(session.userId);
    }

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: session.userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.count({
        where: { userId: session.userId, isRead: false },
      }),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('[GET /api/notifications]', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

// POST /api/notifications — { readAll: true } -> tandai semua dibaca
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const readAll = Boolean(body.readAll);
    if (!readAll) {
      return NextResponse.json({ error: 'Body harus berisi { readAll: true }' }, { status: 400 });
    }

    const result = await prisma.notification.updateMany({
      where: { userId: session.userId, isRead: false },
      data: { isRead: true },
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    console.error('[POST /api/notifications]', error);
    return NextResponse.json({ error: 'Failed to mark notifications' }, { status: 500 });
  }
}
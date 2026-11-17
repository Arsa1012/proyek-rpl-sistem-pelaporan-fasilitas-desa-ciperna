import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// PATCH /api/notifications/[id] — { read: true|false } -> update isRead
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existing = await prisma.notification.findUnique({
      where: { id: params.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
    }
    if (existing.userId !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({ read: true }));
    const read = body.read === undefined ? true : Boolean(body.read);

    // Cek apakah harus diupdate (hindari write sia-sia)
    if (existing.isRead === read) {
      return NextResponse.json({ notification: existing });
    }

    const updated = await prisma.notification.update({
      where: { id: params.id },
      data: { isRead: read },
    });

    return NextResponse.json({ notification: updated });
  } catch (error) {
    console.error('[PATCH /api/notifications/[id]]', error);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}
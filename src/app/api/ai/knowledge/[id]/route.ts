import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rateLimit';
import { logAdminAction } from '@/lib/auditLog';

/**
 * PATCH /api/ai/knowledge/[id] — Verifikasi, tolak, atau update entri (Admin only).
 * Body: { verified?: boolean, verificationNotes?: string, title?, content?, category?, isPrivate?, tags? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }

  const rate = rateLimit(`ai-knowledge-patch:${session.userId}`, 20, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);

  const existing = await prisma.aiKnowledgeEntry.findUnique({
    where: { id },
    select: { id: true, title: true, content: true, verified: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Entri tidak ditemukan' }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body?.title === 'string') {
    if (!body.title.trim()) {
      return NextResponse.json({ error: 'Judul tidak boleh kosong' }, { status: 400 });
    }
    data.title = body.title.trim();
  }
  if (typeof body?.content === 'string') {
    if (!body.content.trim()) {
      return NextResponse.json({ error: 'Isi tidak boleh kosong' }, { status: 400 });
    }
    data.content = body.content.trim();
  }
  if (typeof body?.category === 'string') data.category = body.category.toUpperCase();
  if (typeof body?.isPrivate === 'boolean') data.isPrivate = body.isPrivate;
  if (Array.isArray(body?.tags)) data.tags = JSON.stringify(body.tags);

  // Integritas fakta resmi: bila ISI/JUDUL entri yang sudah terverifikasi
  // diubah, status verifikasi otomatis di-reset agar AI tidak mengutip konten
  // yang berubah sebagai fakta lama yang sudah disetujui. Admin dapat
  // memverifikasi ulang setelah meninjau perubahan.
  const contentChanged = data.content !== undefined && data.content !== existing.content;
  const titleChanged = data.title !== undefined && data.title !== existing.title;
  let verificationInvalidated = false;
  if ((contentChanged || titleChanged) && existing.verified) {
    data.verified = false;
    data.verifiedBy = null;
    data.verifiedAt = null;
    verificationInvalidated = true;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Tidak ada perubahan yang valid pada permintaan' },
      { status: 400 }
    );
  }

  // Verifikasi / tolak
  if (typeof body?.verified === 'boolean') {
    data.verified = body.verified;
    data.verifiedBy = session.userId;
    data.verifiedAt = new Date();
    if (typeof body?.verificationNotes === 'string') {
      data.verificationNotes = body.verificationNotes.trim();
    }

    // Catat audit log
    await logAdminAction({
      adminId: session.userId,
      action: body.verified ? 'VERIFY_AI_KNOWLEDGE' : 'REJECT_AI_KNOWLEDGE',
      targetReportId: id,
      notes: `Judul: ${existing.title}. Catatan: ${body.verificationNotes || '-'}`,
    });
  }

  const entry = await prisma.aiKnowledgeEntry.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      category: true,
      verified: true,
      verifiedBy: true,
      verifiedAt: true,
      verificationNotes: true,
      isPrivate: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ entry, verificationInvalidated });
}

/**
 * DELETE /api/ai/knowledge/[id] — Hapus entri (Admin only).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }

  const rate = rateLimit(`ai-knowledge-delete:${session.userId}`, 10, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 });
  }

  const { id } = await params;

  const existing = await prisma.aiKnowledgeEntry.findUnique({
    where: { id },
    select: { id: true, title: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Entri tidak ditemukan' }, { status: 404 });
  }

  await prisma.aiKnowledgeEntry.delete({ where: { id } });

  await logAdminAction({
    adminId: session.userId,
    action: 'DELETE_AI_KNOWLEDGE',
    targetReportId: id,
    notes: `Judul: ${existing.title}`,
  });

  return NextResponse.json({ success: true, message: 'Entri berhasil dihapus' });
}
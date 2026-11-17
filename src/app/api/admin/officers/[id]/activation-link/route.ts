import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, notFound } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import { createAccountToken, buildActivationUrl } from '@/lib/accountTokens';
import { notifyOfficerAccountCreated } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

// POST /api/admin/officers/[id]/activation-link
// Membuat ULANG tautan aktivasi untuk akun petugas & mengirimnya via WhatsApp.
// TIDAK membuat akun baru (mencegah duplikasi saat Admin hanya ingin kirim ulang).
// Token lama dihanguskan; token baru sekali pakai & berbatas waktu.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const officer = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
    });
    if (!officer) return notFound('Akun petugas tidak ditemukan');
    if (officer.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Aksi ini hanya untuk akun petugas.' }, { status: 400 });
    }
    if (!officer.phone) {
      return NextResponse.json(
        { error: 'Nomor WhatsApp petugas belum tercatat. Lengkapi nomor terlebih dahulu melalui Edit Data akun.' },
        { status: 400 }
      );
    }

    const token = await createAccountToken({
      userId: officer.id,
      purpose: 'ACTIVATION',
      createdBy: auth.session.userId,
    });
    const activationUrl = buildActivationUrl(token.raw);

    let whatsapp: 'sent' | 'failed' | 'skipped' = 'skipped';
    try {
      const res = await notifyOfficerAccountCreated({
        userId: officer.id,
        activationUrl,
        dedupeKey: `officer-activation:${officer.id}:${token.expiresAt.getTime()}`,
      });
      whatsapp = res.ok ? 'sent' : res.skipped ? 'skipped' : 'failed';
    } catch (e) {
      console.error('[activation-link] notifikasi WA gagal:', e);
      whatsapp = 'failed';
    }

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'OFFICER_ACTIVATION_LINK',
      targetUserId: officer.id,
      notes: `Kirim ulang tautan aktivasi (WA: ${whatsapp})`,
    });

    return NextResponse.json({
      success: true,
      whatsapp,
      expiresAt: token.expiresAt.toISOString(),
      activationUrl,
      message:
        whatsapp === 'sent'
          ? 'Tautan aktivasi baru telah dikirim ke WhatsApp petugas.'
          : 'Tautan aktivasi baru dibuat, namun pengiriman WhatsApp gagal. Anda dapat menyalin tautan di bawah dan meneruskannya secara aman.',
    });
  } catch (error) {
    console.error('[POST /api/admin/officers/[id]/activation-link]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

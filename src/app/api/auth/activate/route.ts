import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/password';
import { resolveAccountToken, consumeAccountToken } from '@/lib/accountTokens';
import { logAdminAction } from '@/lib/auditLog';

export const dynamic = 'force-dynamic';

// POST /api/auth/activate — menyelesaikan AKTIVASI akun petugas.
// Memakai token sekali pakai (dikirim Admin via tautan resmi). Server:
// - memvalidasi token (hash cocok, belum dipakai, belum kedaluwarsa),
// - memvalidasi kekuatan kata sandi,
// - menyimpan hanya hash bcrypt,
// - menghanguskan token setelah dipakai.
// Tidak pernah meminta/menyimpan kata sandi lama.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!token) {
      return NextResponse.json({ error: 'Tautan aktivasi tidak valid' }, { status: 400 });
    }
    const policyError = validatePassword(password);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Konfirmasi kata sandi tidak cocok' }, { status: 400 });
    }

    const resolved = await resolveAccountToken(token, 'ACTIVATION');
    if (!resolved) {
      return NextResponse.json(
        { error: 'Tautan aktivasi tidak valid, sudah dipakai, atau telah kedaluwarsa. Minta Admin mengirim ulang tautan baru.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: resolved.userId },
      select: { id: true, name: true, role: true, isActive: true },
    });
    if (!user || user.role !== 'OFFICER') {
      return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
    }
    if (user.isActive === false) {
      return NextResponse.json(
        { error: 'Akun Anda sedang nonaktif. Hubungi Admin Desa Ciperna.' },
        { status: 403 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(password, 10), mustChangePassword: false },
    });
    await consumeAccountToken(resolved.id);

    try {
      await logAdminAction({
        adminId: 'system',
        action: 'ACCOUNT_ACTIVATED',
        targetUserId: user.id,
        notes: 'Aktivasi akun petugas via tautan token sekali pakai',
      });
    } catch {
      // Kegagalan audit tidak membatalkan aktivasi.
    }

    return NextResponse.json({ success: true, message: 'Akun berhasil diaktifkan. Silakan login.' });
  } catch (error) {
    console.error('[POST /api/auth/activate]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

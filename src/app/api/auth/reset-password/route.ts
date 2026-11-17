import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/password';
import { resolveAccountToken, consumeAccountToken } from '@/lib/accountTokens';

export const dynamic = 'force-dynamic';

// POST /api/auth/reset-password — menyelesaikan RESET kata sandi (lupa password).
// Token sekali pakai (dikirim ke nomor WhatsApp terdaftar). Menyimpan hanya hash
// bcrypt, membersihkan mustChangePassword, dan menghanguskan token.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!token) {
      return NextResponse.json({ error: 'Tautan reset tidak valid' }, { status: 400 });
    }
    const policyError = validatePassword(password);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Konfirmasi kata sandi tidak cocok' }, { status: 400 });
    }

    const resolved = await resolveAccountToken(token, 'RESET_PASSWORD');
    if (!resolved) {
      return NextResponse.json(
        { error: 'Tautan reset tidak valid, sudah dipakai, atau telah kedaluwarsa. Silakan minta tautan baru.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: resolved.userId },
      select: { id: true, isActive: true },
    });
    if (!user) return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
    if (user.isActive === false) {
      return NextResponse.json({ error: 'Akun Anda sedang nonaktif. Hubungi Admin Desa Ciperna.' }, { status: 403 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(password, 10), mustChangePassword: false },
    });
    await consumeAccountToken(resolved.id);

    return NextResponse.json({ success: true, message: 'Kata sandi berhasil diperbarui. Silakan login.' });
  } catch (error) {
    console.error('[POST /api/auth/reset-password]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

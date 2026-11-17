import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/password';

export const dynamic = 'force-dynamic';

// POST /api/auth/change-password — WAJIB ganti kata sandi sementara.
//
// Dipakai setelah Admin melakukan Reset Kata Sandi (mustChangePassword = true).
// Hanya mengubah kata sandi akun milik sesi yang sedang login (session.userId),
// tidak dapat dipakai untuk akun lain. Kata sandi baru langsung di-hash bcrypt
// dan status mustChangePassword dibersihkan.
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'Kata sandi baru dan konfirmasi wajib diisi' }, { status: 400 });
    }

    const policyError = validatePassword(newPassword);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Konfirmasi kata sandi tidak cocok' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return NextResponse.json({ error: 'Kata sandi baru tidak boleh sama dengan kata sandi sementara' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { password: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
    });

    return NextResponse.json({ success: true, message: 'Kata sandi berhasil diperbarui.' });
  } catch (error) {
    console.error('[POST /api/auth/change-password]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

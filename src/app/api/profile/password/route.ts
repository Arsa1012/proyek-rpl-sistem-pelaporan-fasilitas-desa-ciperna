import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// POST /api/profile/password — ganti password sendiri (wajib password lama).
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }

    const { oldPassword, newPassword } = await request.json();
    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: 'Password lama dan password baru wajib diisi' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return NextResponse.json({ error: 'Akun tidak ditemukan' }, { status: 404 });
    }

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return NextResponse.json({ error: 'Password lama salah' }, { status: 401 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password minimal 8 karakter' }, { status: 400 });
    }
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return NextResponse.json({ error: 'Password harus mengandung huruf kapital, huruf kecil, dan angka' }, { status: 400 });
    }
    if (await bcrypt.compare(newPassword, user.password)) {
      return NextResponse.json({ error: 'Password baru tidak boleh sama dengan password lama' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId },
      // Ganti kata sandi sendiri juga membersihkan status "wajib ganti"
      // (mis. setelah Admin melakukan reset kata sandi).
      data: { password: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
    });

    return NextResponse.json({ success: true, message: 'Password berhasil diubah' });
  } catch (error) {
    console.error('[POST /api/profile/password]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

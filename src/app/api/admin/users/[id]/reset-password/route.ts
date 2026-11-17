import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateTemporaryPassword } from '@/lib/password';
import { logAdminAction } from '@/lib/auditLog';

export const dynamic = 'force-dynamic';

// POST /api/admin/users/[id]/reset-password — reset kata sandi warga/petugas (ADMIN only).
//
// Alur aman:
// 1) Admin memilih akun lalu mengonfirmasi reset.
// 2) Server membuat kata sandi sementara acak, menyimpannya sebagai HASH bcrypt,
//    dan menandai mustChangePassword = true.
// 3) Kata sandi sementara dikembalikan SEKALI ke Admin (untuk diserahkan aman ke
//    pengguna). Tidak pernah disimpan/di-log dalam bentuk asli.
// 4) Pengguna WAJIB mengganti kata sandi saat login berikutnya.
//
// Tidak mengirim kredensial lewat WhatsApp/email (belum ada kanal aman terkonfigurasi).
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) {
      return NextResponse.json({ error: 'Pengguna tidak ditemukan' }, { status: 404 });
    }
    if (target.id === session.userId) {
      return NextResponse.json({ error: 'Gunakan halaman Profil untuk mengubah kata sandi Anda sendiri' }, { status: 403 });
    }
    if (target.role === 'ADMIN') {
      return NextResponse.json({ error: 'Akun Admin tidak dapat direset melalui menu ini' }, { status: 403 });
    }

    const plainPassword = generateTemporaryPassword(12);
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await prisma.user.update({
      where: { id: target.id },
      data: { password: hashedPassword, mustChangePassword: true },
    });

    await logAdminAction({
      adminId: session.userId,
      action: 'RESET_PASSWORD',
      targetUserId: target.id,
      notes: `${target.name} (${target.email})`,
    });

    return NextResponse.json({
      success: true,
      message:
        'Kata sandi berhasil direset. Sampaikan kata sandi sementara ini kepada pengguna secara aman — hanya ditampilkan sekali. Pengguna wajib menggantinya saat login berikutnya.',
      temporaryPassword: plainPassword,
    });
  } catch (error) {
    console.error('[POST /api/admin/users/[id]/reset-password]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

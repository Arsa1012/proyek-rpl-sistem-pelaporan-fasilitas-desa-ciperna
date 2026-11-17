import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/rateLimit';
import { validateRtSelection } from '@/lib/region';
import { startRegistration, validateRegistrationPayload } from '@/lib/registrationOtp';

/**
 * POST /api/auth/register — TAHAP 1: mulai pendaftaran & kirim OTP.
 *
 * Perubahan penting dari alur lama: akun User TIDAK dibuat di sini. Data
 * pendaftaran disimpan sementara (password sudah berupa hash bcrypt) dan akun
 * baru dibuat setelah OTP terverifikasi di /api/auth/register/verify.
 *
 * Pendaftaran mandiri hanya untuk CITIZEN. Akun Petugas tetap dibuat Admin
 * (tidak terpengaruh alur OTP ini).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));

    // Pendaftaran mandiri HANYA untuk Masyarakat (CITIZEN).
    // Akun Petugas dibuat oleh Admin; akun Admin disediakan sistem.
    const requestedRole = body?.role || 'CITIZEN';
    if (requestedRole !== 'CITIZEN') {
      return NextResponse.json(
        {
          error:
            'Pendaftaran mandiri hanya untuk Masyarakat. Akun Petugas dibuat oleh Admin.',
        },
        { status: 403 }
      );
    }

    const parsed = validateRegistrationPayload(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Validasi pilihan RT (wilayah) di SERVER — bukan hanya di frontend.
    // Menolak RT yang tidak ada, nonaktif, atau berada di RW nonaktif.
    const region = await validateRtSelection(parsed.value.rtId);
    if (!region.ok) {
      return NextResponse.json({ error: region.error }, { status: 400 });
    }

    const result = await startRegistration(
      { ...parsed.value, rtId: region.rt ? region.rt.id : null },
      { ip: getClientIp(request) }
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
        },
        { status: result.status }
      );
    }

    // OTP TIDAK pernah dikembalikan di respons — hanya dikirim via WhatsApp.
    return NextResponse.json({
      success: true,
      step: 'verify',
      message: `Kode verifikasi telah dikirim ke WhatsApp ${result.phoneMasked}.`,
      email: result.email,
      phoneMasked: result.phoneMasked,
      resendAfterSeconds: result.resendAfterSeconds,
    });
  } catch (error) {
    console.error('[POST /api/auth/register]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

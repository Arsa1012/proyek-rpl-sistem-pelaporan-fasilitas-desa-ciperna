import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/rateLimit';
import { resendRegistration } from '@/lib/registrationOtp';

/**
 * POST /api/auth/register/resend — kirim ulang kode OTP.
 *
 * Dibatasi: jeda 60 detik per email + rate limit per nomor dan per IP.
 * Respons tidak pernah memuat kode OTP.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    const result = await resendRegistration(email, { ip: getClientIp(request) });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Kode verifikasi baru telah dikirim ke WhatsApp ${result.phoneMasked}.`,
      phoneMasked: result.phoneMasked,
      resendAfterSeconds: result.resendAfterSeconds,
    });
  } catch (error) {
    console.error('[POST /api/auth/register/resend]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeIndonesianPhone, notifyPasswordReset } from '@/lib/whatsapp';
import { createAccountToken, buildResetUrl } from '@/lib/accountTokens';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// POST /api/auth/forgot-password — permintaan tautan reset kata sandi.
//
// Kebijakan keamanan & privasi:
// - Identitas diverifikasi lewat NOMOR terdaftar: tautan HANYA dikirim ke
//   nomor WhatsApp yang tercatat pada akun (kanal yang sudah dipercaya).
// - Respons SELALU sama ("bila akun terdaftar, tautan akan dikirim") sehingga
//   tidak membocorkan apakah email/nomor tertentu terdaftar.
// - Rate limit per IP untuk mencegah penyalahgunaan/pengeboman pesan.
// - Tidak pernah mengembalikan tautan/token ke klien.
export async function POST(request: Request) {
  try {
    const clientIp = getClientIp(request);
    const rl = rateLimit(`forgot:${clientIp}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.', retryAfter: rl.retryAfter },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const identifier = String(body.identifier || '').trim();

    const GENERIC = {
      success: true,
      message:
        'Bila email/nomor tersebut terdaftar dan memiliki nomor WhatsApp, kami telah mengirimkan tautan untuk membuat kata sandi baru. Periksa WhatsApp Anda.',
    };

    if (!identifier) return NextResponse.json(GENERIC);

    // Cari akun. Non-Admin saja yang dapat memakai alur ini.
    let user = null;
    if (identifier.includes('@')) {
      user = await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });
    } else {
      const normalized = normalizeIndonesianPhone(identifier);
      if (normalized) user = await prisma.user.findFirst({ where: { phone: normalized } });
    }

    if (!user || user.role === 'ADMIN' || user.isActive === false) {
      return NextResponse.json(GENERIC);
    }

    // Tanpa nomor WhatsApp terverifikasi, jangan mengirim apa pun (hindari
    // mengirim tautan ke kanal yang tidak dapat dipercaya).
    if (!user.phone) return NextResponse.json(GENERIC);

    let resetUrl: string | undefined;
    try {
      const token = await createAccountToken({ userId: user.id, purpose: 'RESET_PASSWORD' });
      resetUrl = buildResetUrl(token.raw);
      await notifyPasswordReset({ userId: user.id, resetUrl });
    } catch (e) {
      console.error('[POST /api/auth/forgot-password] gagal membuat/mengirim tautan:', e);
    }

    return NextResponse.json(GENERIC);
  } catch (error) {
    console.error('[POST /api/auth/forgot-password]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

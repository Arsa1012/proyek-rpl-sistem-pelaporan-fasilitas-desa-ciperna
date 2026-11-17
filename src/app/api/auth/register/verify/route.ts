import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/rateLimit';
import { normalizeIndonesianPhone } from '@/lib/whatsapp';
import { createNotifications } from '@/lib/notification';
import {
  getAppBaseUrl,
  notifyAdminNewUser,
  notifyCitizenRegistrationWelcome,
} from '@/lib/whatsapp';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  otpMatches,
  verifyIpRateLimited,
} from '@/lib/registrationOtp';

/**
 * POST /api/auth/register/verify — TAHAP 2: verifikasi OTP & buat akun.
 *
 * Jaminan:
 * - Semua validasi OTP di SERVER. Status "terverifikasi" dari browser tidak
 *   pernah dipercaya.
 * - OTP terikat pada email + NOMOR WHATSAPP sesi pendaftaran. Nomor yang
 *   dikirim klien harus sama dengan nomor yang didaftarkan; jika berbeda,
 *   verifikasi ditolak (tanpa memberi tahu nomor mana yang terdaftar).
 * - OTP diverifikasi constant-time dan sekali pakai. Baris pendaftaran
 *   dikonsumsi secara ATOMIK dalam transaksi yang sama dengan pembuatan akun.
 * - Akun baru hanya dibuat bila OTP valid, belum kedaluwarsa, belum dipakai,
 *   dan nomornya cocok. Nomor lalu ditandai terverifikasi (`phoneVerifiedAt`).
 * - `User.email` unik + pemeriksaan ulang nomor mencegah akun ganda.
 * - Notifikasi lama (Admin + selamat datang warga) dipanggil SETELAH akun
 *   tersimpan dan bersifat best-effort (tidak membatalkan akun).
 */

const MSG_WRONG = 'Kode OTP salah. Silakan periksa kembali.';
const MSG_EXPIRED = 'Kode OTP sudah kedaluwarsa. Silakan minta kode baru.';
const MSG_LOCKED = 'Batas percobaan OTP tercapai. Silakan minta kode baru.';
const MSG_USED = 'Kode OTP tidak valid atau sudah digunakan. Silakan minta kode baru.';

export async function POST(request: Request) {
  try {
    const ipLimit = verifyIpRateLimited(getClientIp(request));
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Terlalu banyak percobaan verifikasi. Silakan coba lagi nanti.',
          retryAfter: ipLimit.retryAfter,
        },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const rawPhone = typeof body?.phone === 'string' ? body.phone.trim() : '';

    if (!email || !code || !rawPhone) {
      return NextResponse.json(
        { error: 'Email, nomor WhatsApp, dan kode OTP wajib diisi' },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Kode OTP harus terdiri dari 6 angka' },
        { status: 400 }
      );
    }
    const phone = normalizeIndonesianPhone(rawPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'Format Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.' },
        { status: 400 }
      );
    }

    const pending = await prisma.registrationOtp.findUnique({ where: { email } });
    if (!pending) {
      return NextResponse.json({ error: MSG_USED }, { status: 400 });
    }

    if (pending.expiresAt.getTime() <= Date.now()) {
      await prisma.registrationOtp.deleteMany({ where: { id: pending.id } });
      return NextResponse.json(
        { error: MSG_EXPIRED, canResend: true },
        { status: 400 }
      );
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: MSG_LOCKED, canResend: true, remainingAttempts: 0 },
        { status: 429 }
      );
    }

    // OTP harus cocok dengan NOMOR yang didaftarkan pada sesi ini.
    // Pesan disamakan dengan kode salah agar tidak membocorkan nomor terdaftar.
    // Tidak menambah `attempts` (mencegah pihak lain mengunci sesi orang lain).
    if (phone !== pending.phone) {
      return NextResponse.json({ error: MSG_WRONG }, { status: 400 });
    }

    if (!otpMatches(code, pending.otpHash)) {
      // Optimistic concurrency: hanya menambah bila nilai attempts belum berubah.
      const nextAttempts = pending.attempts + 1;
      await prisma.registrationOtp.updateMany({
        where: { id: pending.id, attempts: pending.attempts },
        data: { attempts: nextAttempts },
      });
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - nextAttempts);
      if (remaining <= 0) {
        return NextResponse.json(
          { error: MSG_LOCKED, remainingAttempts: 0, canResend: true },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: MSG_WRONG, remainingAttempts: remaining },
        { status: 400 }
      );
    }

    // Pemeriksaan terakhir sebelum membuat akun (mencegah akun ganda).
    const [emailUser, phoneUser] = await Promise.all([
      prisma.user.findUnique({ where: { email: pending.email }, select: { id: true } }),
      prisma.user.findFirst({ where: { phone: pending.phone }, select: { id: true } }),
    ]);
    if (emailUser || phoneUser) {
      await prisma.registrationOtp.deleteMany({ where: { id: pending.id } });
      return NextResponse.json(
        {
          error:
            'Email atau nomor WhatsApp ini sudah terdaftar. Silakan masuk atau atur ulang kata sandi.',
        },
        { status: 409 }
      );
    }

    // Konsumsi OTP + buat akun secara ATOMIK. `deleteMany` dengan syarat
    // expiresAt menjadi penjaga sekali-pakai: dua permintaan bersamaan hanya
    // satu yang berhasil (count === 1).
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        const consumed = await tx.registrationOtp.deleteMany({
          where: { id: pending.id, expiresAt: { gt: new Date() } },
        });
        if (consumed.count !== 1) {
          throw new Error('OTP_ALREADY_USED');
        }
        return tx.user.create({
          data: {
            name: pending.name,
            email: pending.email,
            // Sudah berupa hash bcrypt dari tahap 1 — tidak pernah teks biasa.
            password: pending.passwordHash,
            role: 'CITIZEN',
            phone: pending.phone,
            // Nomor WhatsApp dinyatakan TERVERIFIKASI setelah OTP valid.
            phoneVerifiedAt: new Date(),
            rtId: pending.rtId,
          },
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'OTP_ALREADY_USED') {
        return NextResponse.json({ error: MSG_USED }, { status: 400 });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await prisma.registrationOtp.deleteMany({ where: { id: pending.id } }).catch(() => {});
        return NextResponse.json(
          {
            error:
              'Email atau nomor WhatsApp ini sudah terdaftar. Silakan masuk atau atur ulang kata sandi.',
          },
          { status: 409 }
        );
      }
      throw error;
    }

    // Notifikasi lama dipertahankan: notifikasi in-app Admin + WhatsApp Admin
    // + sapaan/konfirmasi pendaftaran ke warga. Best-effort, tidak membatalkan
    // akun yang sudah tersimpan.
    let welcomeStatus: 'sent' | 'failed' | 'skipped' = 'skipped';
    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });
      await createNotifications(
        admins.map((admin) => ({
          userId: admin.id,
          type: 'NEW_USER' as const,
          title: 'Pendaftar Baru',
          message: `Akun masyarakat baru: ${user.name}.`,
        }))
      );

      const region = user.rtId
        ? await prisma.villageRt.findUnique({
            where: { id: user.rtId },
            select: { number: true, rw: { select: { number: true } } },
          })
        : null;

      await notifyAdminNewUser({
        name: user.name,
        email: user.email,
        phone: user.phone || '-',
        role: 'Warga',
        rt: region?.number ?? null,
        rw: region?.rw?.number ?? null,
        time: user.createdAt,
        dashboardUrl: `${getAppBaseUrl()}/admin/masyarakat`,
        dedupeKey: `register:${user.id}`,
      });

      // Pesan WhatsApp konfirmasi keberhasilan registrasi ke nomor pendaftar.
      // Status pengiriman WhatsApp dipisahkan dari status pembuatan akun.
      const welcome = await notifyCitizenRegistrationWelcome(user.id);
      welcomeStatus = welcome.ok ? 'sent' : welcome.skipped ? 'skipped' : 'failed';
    } catch (notifyError) {
      console.error('[register/verify] Notifikasi WA gagal (akun tetap tersimpan):', notifyError);
      welcomeStatus = 'failed';
    }

    return NextResponse.json(
      {
        success: true,
        verified: true,
        message: 'Registrasi berhasil. Nomor WhatsApp Anda telah terverifikasi.',
        whatsapp: welcomeStatus,
        resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
        redirectUrl: '/login',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/auth/register/verify]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

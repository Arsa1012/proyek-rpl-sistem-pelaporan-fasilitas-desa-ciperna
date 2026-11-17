/**
 * REGISTRASI WARGA + VERIFIKASI OTP WHATSAPP — logika inti (server-side only).
 *
 * Alur:
 *   1. `startRegistration`  → validasi data, cek duplikat, simpan pendaftaran
 *      SEMENTARA (hash password + hash OTP), kirim OTP via Fonnte.
 *   2. `POST /api/auth/register/verify` → verifikasi OTP, lalu buat akun User
 *      secara atomik (hanya sekali pakai).
 *   3. `resendRegistration` → kirim ulang dengan jeda 60 detik + rate limit.
 *
 * Prinsip keamanan:
 * - Akun TIDAK dibuat sebelum OTP terverifikasi (tidak ada akun "setengah jadi").
 * - Password disimpan sebagai hash bcrypt (mekanisme autentikasi proyek),
 *   tidak pernah teks biasa.
 * - OTP hanya disimpan sebagai HMAC-SHA256 (pepper = OTP_PEPPER atau JWT_SECRET).
 * - OTP 6 digit, berlaku 5 menit, maksimal 5 percobaan, sekali pakai.
 * - Kode OTP tidak pernah dikembalikan ke API/log/frontend.
 * - Tidak pernah throw untuk kesalahan yang dapat diperkirakan.
 */

import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { validatePassword } from '@/lib/password';
import { rateLimit } from '@/lib/rateLimit';
import { maskPhoneNumber, normalizeIndonesianPhone, sendOtpWhatsApp } from '@/lib/whatsapp';

/** Masa berlaku kode OTP. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** Maksimal percobaan verifikasi per kode. */
export const OTP_MAX_ATTEMPTS = 5;
/** Jeda minimal antar-pengiriman kode. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Panjang kode OTP. */
export const OTP_LENGTH = 6;

const RATE_WINDOW_MS = 15 * 60 * 1000;
const START_LIMIT_PER_IP = 10;
const START_LIMIT_PER_PHONE = 3;
const RESEND_LIMIT_PER_IP = 10;
const RESEND_LIMIT_PER_PHONE = 5;
const VERIFY_LIMIT_PER_IP = 20;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Kunci rate-limit tidak menyimpan nomor/email mentah di memori. */
export function keyHash(value: string): string {
  return createHmac('sha256', otpPepper()).update(String(value)).digest('hex').slice(0, 24);
}

/**
 * Pepper untuk hash OTP. Memakai `OTP_PEPPER` bila disediakan; jika tidak,
 * memakai `JWT_SECRET` yang sudah wajib ada (tanpa menambah konfigurasi wajib).
 */
function otpPepper(): string {
  return process.env.OTP_PEPPER || process.env.JWT_SECRET || 'ciperna-otp-fallback';
}

/** Buat kode OTP numerik yang aman secara kriptografis. */
export function generateOtp(): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i++) code += String(randomInt(0, 10));
  return code;
}

/** Hash OTP (HMAC-SHA256). Kode mentah tidak pernah disimpan. */
export function hashOtp(raw: string): string {
  return createHmac('sha256', otpPepper()).update(String(raw).trim()).digest('hex');
}

/** Perbandingan OTP constant-time. */
export function otpMatches(raw: string, storedHash: string): boolean {
  const code = String(raw || '').trim();
  if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)) return false;
  const a = Buffer.from(hashOtp(code), 'hex');
  const b = Buffer.from(String(storedHash || ''), 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Tersamarkan untuk ditampilkan di UI, mis. "6281****". */
export function maskedPhone(phone: string): string {
  return maskPhoneNumber(phone);
}

/** Pesan OTP — tidak pernah memuat password/token/tautan rahasia. */
export function otpMessage(name: string, code: string): string {
  const clean = String(name || '').trim() || 'Bapak/Ibu';
  return (
    `*Kode Verifikasi Pendaftaran — Desa Ciperna*\n\n` +
    `Halo ${clean},\n\n` +
    `Kode OTP Anda: *${code}*\n\n` +
    `Kode berlaku ${Math.round(OTP_TTL_MS / 60000)} menit dan hanya dapat digunakan satu kali.\n` +
    `Jangan bagikan kode ini kepada siapa pun, termasuk yang mengaku petugas.\n\n` +
    `Jika Anda tidak merasa mendaftar, abaikan pesan ini.\n\n` +
    `_Sistem Pelaporan Fasilitas Umum Desa Ciperna_`
  );
}

// ---------------------------------------------------------------------------
// Validasi input (murni, tanpa database)
// ---------------------------------------------------------------------------

export interface RegistrationPayload {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  confirmPassword?: unknown;
  phone?: unknown;
  rtId?: unknown;
}

export interface ValidRegistration {
  name: string;
  email: string;
  password: string;
  phone: string;
  rtId: string | null;
}

export function validateRegistrationPayload(
  body: RegistrationPayload
): { ok: true; value: ValidRegistration } | { ok: false; error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';
  const phoneRaw = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const rtId = typeof body?.rtId === 'string' && body.rtId.trim() ? body.rtId.trim() : null;

  if (!name || !email || !password) {
    return { ok: false, error: 'Semua field wajib diisi' };
  }
  if (name.length < 2 || name.length > 100) {
    return { ok: false, error: 'Nama harus antara 2-100 karakter' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'Format email tidak valid' };
  }
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };
  if (!confirmPassword) {
    return { ok: false, error: 'Konfirmasi password wajib diisi' };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: 'Konfirmasi password tidak sama' };
  }
  if (!phoneRaw) {
    return { ok: false, error: 'Nomor WhatsApp wajib diisi untuk verifikasi OTP' };
  }
  const phone = normalizeIndonesianPhone(phoneRaw);
  if (!phone) {
    return {
      ok: false,
      error: 'Format Nomor WhatsApp tidak valid. Gunakan format 08xx atau 628xx.',
    };
  }

  return { ok: true, value: { name, email, password, phone, rtId } };
}

// ---------------------------------------------------------------------------
// Mulai pendaftaran (kirim OTP pertama)
// ---------------------------------------------------------------------------

export type StartOutcome =
  | {
      ok: true;
      email: string;
      phoneMasked: string;
      resendAfterSeconds: number;
    }
  | { ok: false; status: number; error: string; retryAfter?: number };

/**
 * Terjemahkan hasil pengiriman OTP dari provider menjadi pesan yang JUJUR dan
 * spesifik. Alasan mentah dari Fonnte sudah aman (tanpa token) dan dipakai
 * untuk membedakan: nomor tidak valid, perangkat WhatsApp terputus, paket
 * layanan, konfigurasi server, batas kirim, timeout/jaringan, dan error lain.
 *
 * Pesan pengguna tidak pernah menyebut "periksa koneksi" sebagai tuduhan
 * generik: bila yang bermasalah adalah perangkat/paket provider, pengguna
 * diberi tahu bahwa masalahnya ada di layanan WhatsApp desa, bukan di ponselnya.
 */
export function classifyOtpSendFailure(result: {
  configured: boolean;
  error?: string;
}): { status: number; error: string } {
  const reason = String(result.error || '').toLowerCase();

  if (!result.configured || reason.includes('not_configured')) {
    return {
      status: 503,
      error:
        'Layanan verifikasi WhatsApp belum dikonfigurasi di server desa, sehingga kode belum dikirim dan akun Anda belum dibuat. ' +
        'Silakan hubungi Admin Desa Ciperna untuk meninjau konfigurasinya.',
    };
  }
  if (reason.includes('invalid_recipient')) {
    return {
      status: 422,
      error:
        'Nomor WhatsApp tidak valid, sehingga kode verifikasi tidak dapat dikirim. ' +
        'Periksa kembali nomor Anda dengan format 08xx atau 628xx, lalu coba lagi.',
    };
  }
  if (
    reason.includes('disconnected device') ||
    reason.includes('device disconnected') ||
    reason.includes('device not connected') ||
    reason.includes('not connected') ||
    reason.includes('device')
  ) {
    return {
      status: 503,
      error:
        'Layanan WhatsApp desa sedang tidak tersambung ke perangkat pengirim, sehingga kode verifikasi belum terkirim dan akun Anda belum dibuat. ' +
        'Ini bukan masalah pada nomor atau ponsel Anda. Silakan coba lagi beberapa saat lagi; Admin Desa Ciperna perlu menghubungkan kembali perangkat WhatsApp layanan.',
    };
  }
  if (reason.includes('free package') || reason.includes('package')) {
    return {
      status: 503,
      error:
        'Layanan WhatsApp desa belum dapat mengirim pesan dengan paket layanan yang aktif saat ini. ' +
        'Kode verifikasi belum terkirim dan akun Anda belum dibuat. Admin Desa Ciperna perlu meninjau paket layanan WhatsApp sebelum pendaftaran dapat dilanjutkan.',
    };
  }
  if (
    reason.includes('token') ||
    reason.includes('unauthorized') ||
    reason.includes('authentication') ||
    reason.includes('auth')
  ) {
    return {
      status: 503,
      error:
        'Konfigurasi layanan WhatsApp di server desa belum valid, sehingga kode verifikasi belum dikirim dan akun Anda belum dibuat. ' +
        'Silakan hubungi Admin Desa Ciperna; masalah ini tidak dapat diperbaiki dari perangkat Anda.',
    };
  }
  if (reason.includes('quota') || reason.includes('limit') || reason.includes('too many') || reason.includes('rate')) {
    return {
      status: 429,
      error:
        'Batas pengiriman WhatsApp layanan desa sedang tercapai, sehingga kode verifikasi belum dikirim. ' +
        'Akun Anda belum dibuat. Silakan coba lagi nanti atau hubungi Admin Desa Ciperna.',
    };
  }
  if (reason.includes('timeout')) {
    return {
      status: 504,
      error:
        'Layanan WhatsApp tidak merespons tepat waktu, sehingga kode verifikasi belum dapat dipastikan terkirim. ' +
        'Akun Anda belum dibuat. Silakan coba lagi beberapa saat lagi.',
    };
  }
  if (reason.includes('network')) {
    return {
      status: 503,
      error:
        'Server desa belum dapat menjangkau layanan WhatsApp, sehingga kode verifikasi belum terkirim dan akun Anda belum dibuat. ' +
        'Silakan coba lagi beberapa saat lagi.',
    };
  }
  if (reason.includes('empty_message')) {
    return {
      status: 500,
      error:
        'Terjadi kesalahan internal saat menyiapkan pesan verifikasi, sehingga akun Anda belum dibuat. Silakan coba lagi atau hubungi Admin Desa Ciperna.',
    };
  }
  return {
    status: 502,
    error:
      'Penyedia layanan WhatsApp menolak permintaan pengiriman kode verifikasi, sehingga akun Anda belum dibuat. ' +
      'Silakan coba lagi nanti; bila tetap gagal, hubungi Admin Desa Ciperna.',
  };
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Bersihkan baris sementara yang sudah lama kedaluwarsa (best-effort). */
async function cleanupExpired(nowMs: number): Promise<void> {
  try {
    await prisma.registrationOtp.deleteMany({
      where: { expiresAt: { lt: new Date(nowMs - 60 * 60 * 1000) } },
    });
  } catch (error) {
    console.error('[register] Gagal membersihkan pendaftaran kedaluwarsa:', error);
  }
}

export async function startRegistration(
  value: ValidRegistration,
  ctx: { ip: string }
): Promise<StartOutcome> {
  const now = Date.now();

  const ipLimit = rateLimit(`reg-start:ip:${keyHash(ctx.ip)}`, START_LIMIT_PER_IP, RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Terlalu banyak permintaan pendaftaran. Silakan coba lagi nanti.',
      retryAfter: ipLimit.retryAfter,
    };
  }
  const phoneLimit = rateLimit(
    `reg-start:phone:${keyHash(value.phone)}`,
    START_LIMIT_PER_PHONE,
    RATE_WINDOW_MS
  );
  if (!phoneLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Terlalu banyak permintaan kode untuk nomor ini. Silakan coba lagi nanti.',
      retryAfter: phoneLimit.retryAfter,
    };
  }

  // Cegah akun ganda: periksa akun yang SUDAH ada.
  const [emailUser, phoneUser] = await Promise.all([
    prisma.user.findUnique({ where: { email: value.email }, select: { id: true } }),
    prisma.user.findFirst({ where: { phone: value.phone }, select: { id: true } }),
  ]);
  if (emailUser) {
    return {
      ok: false,
      status: 409,
      error: 'Email sudah terdaftar. Silakan masuk atau gunakan email lain.',
    };
  }
  if (phoneUser) {
    return {
      ok: false,
      status: 409,
      error:
        'Nomor WhatsApp sudah terdaftar pada akun lain. Silakan masuk atau gunakan nomor lain.',
    };
  }

  await cleanupExpired(now);

  // Baris yang sudah kedaluwarsa tidak boleh memblokir pendaftaran baru
  // (mis. pengiriman OTP sebelumnya gagal). Baris kedaluwarsa tidak dapat
  // diverifikasi, jadi aman dihapus. Yang masih aktif tetap dipertahankan.
  await prisma.registrationOtp.deleteMany({
    where: {
      OR: [{ email: value.email }, { phone: value.phone }],
      expiresAt: { lte: new Date(now) },
    },
  });

  const existing = await prisma.registrationOtp.findUnique({ where: { email: value.email } });
  const phoneOwner = await prisma.registrationOtp.findUnique({ where: { phone: value.phone } });
  if (phoneOwner && phoneOwner.email !== value.email) {
    return {
      ok: false,
      status: 409,
      error:
        'Nomor WhatsApp sedang dipakai pada pendaftaran lain yang belum selesai. Tunggu beberapa saat atau gunakan nomor lain.',
    };
  }

  const passwordHash = await bcrypt.hash(value.password, 10);
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(now + OTP_TTL_MS);

  let rowId: string;
  if (existing) {
    // Jeda pengiriman ulang: cegah spam dan race condition (dobel klik).
    const elapsed = now - existing.lastSentAt.getTime();
    const waitMs = OTP_RESEND_COOLDOWN_SECONDS * 1000 - elapsed;
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      return {
        ok: false,
        status: 429,
        error: `Tunggu ${retryAfter} detik sebelum meminta kode lagi.`,
        retryAfter,
      };
    }
    try {
      // Penjaga optimistis: hanya SATU permintaan yang boleh memperbarui
      // `lastSentAt` lama. Dobel klik/permintaan paralel tidak mengirim 2 OTP.
      const updated = await prisma.registrationOtp.updateMany({
        where: { id: existing.id, lastSentAt: existing.lastSentAt },
        data: {
          name: value.name,
          passwordHash,
          phone: value.phone,
          rtId: value.rtId,
          otpHash,
          expiresAt,
          attempts: 0,
          lastSentAt: new Date(now),
          resendCount: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return {
          ok: false,
          status: 429,
          error: 'Permintaan kode sedang diproses. Tunggu sebentar lalu coba lagi.',
          retryAfter: OTP_RESEND_COOLDOWN_SECONDS,
        };
      }
      rowId = existing.id;
    } catch (error) {
      if (isUniqueError(error)) {
        return {
          ok: false,
          status: 409,
          error:
            'Nomor WhatsApp sedang dipakai pada pendaftaran lain yang belum selesai. Tunggu beberapa saat atau gunakan nomor lain.',
        };
      }
      throw error;
    }
  } else {
    try {
      const created = await prisma.registrationOtp.create({
        data: {
          name: value.name,
          email: value.email,
          passwordHash,
          phone: value.phone,
          rtId: value.rtId,
          otpHash,
          expiresAt,
          lastSentAt: new Date(now),
        },
      });
      rowId = created.id;
    } catch (error) {
      if (isUniqueError(error)) {
        return {
          ok: false,
          status: 409,
          error:
            'Pendaftaran untuk email atau nomor ini sedang diproses. Silakan tunggu sebentar lalu coba lagi.',
        };
      }
      throw error;
    }
  }

  const sent = await sendOtpWhatsApp(value.phone, otpMessage(value.name, otp), {
    dedupeKey: `otp:${rowId}:${now}`,
  });
  if (!sent.ok) {
    // Akun TIDAK dibuat. Baris sementara dipertahankan agar pengguna dapat
    // memakai tombol "Kirim Ulang" setelah masalah provider teratasi.
    console.error(
      `[register] OTP gagal dikirim (configured=${sent.configured}, reason=${sent.error || 'unknown'})`
    );
    return { ok: false, ...classifyOtpSendFailure(sent) };
  }

  return {
    ok: true,
    email: value.email,
    phoneMasked: maskedPhone(value.phone),
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Kirim ulang OTP
// ---------------------------------------------------------------------------

export type ResendOutcome =
  | { ok: true; phoneMasked: string; resendAfterSeconds: number }
  | { ok: false; status: number; error: string; retryAfter?: number };

export async function resendRegistration(
  rawEmail: string,
  ctx: { ip: string }
): Promise<ResendOutcome> {
  const email = String(rawEmail || '').trim();
  if (!email) return { ok: false, status: 400, error: 'Email wajib diisi' };

  const ipLimit = rateLimit(`reg-resend:ip:${keyHash(ctx.ip)}`, RESEND_LIMIT_PER_IP, RATE_WINDOW_MS);
  if (!ipLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
      retryAfter: ipLimit.retryAfter,
    };
  }

  const row = await prisma.registrationOtp.findUnique({ where: { email } });
  if (!row) {
    return {
      ok: false,
      status: 400,
      error:
        'Sesi pendaftaran tidak ditemukan atau sudah selesai. Silakan isi formulir pendaftaran kembali.',
    };
  }

  const phoneLimit = rateLimit(
    `reg-resend:phone:${keyHash(row.phone)}`,
    RESEND_LIMIT_PER_PHONE,
    RATE_WINDOW_MS
  );
  if (!phoneLimit.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'Terlalu banyak permintaan kode untuk nomor ini. Silakan coba lagi nanti.',
      retryAfter: phoneLimit.retryAfter,
    };
  }

  const now = Date.now();
  const waitMs = OTP_RESEND_COOLDOWN_SECONDS * 1000 - (now - row.lastSentAt.getTime());
  if (waitMs > 0) {
    const retryAfter = Math.ceil(waitMs / 1000);
    return {
      ok: false,
      status: 429,
      error: `Tunggu ${retryAfter} detik sebelum mengirim ulang kode.`,
      retryAfter,
    };
  }

  const otp = generateOtp();
  try {
    // Penjaga optimistis: cegah dua permintaan paralel mengirim dua kode.
    const updated = await prisma.registrationOtp.updateMany({
      where: { id: row.id, lastSentAt: row.lastSentAt },
      data: {
        otpHash: hashOtp(otp),
        expiresAt: new Date(now + OTP_TTL_MS),
        attempts: 0,
        lastSentAt: new Date(now),
        resendCount: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return {
        ok: false,
        status: 429,
        error: 'Permintaan kirim ulang sedang diproses. Tunggu sebentar lalu coba lagi.',
        retryAfter: OTP_RESEND_COOLDOWN_SECONDS,
      };
    }
  } catch (error) {
    console.error('[register] Gagal memperbarui OTP untuk kirim ulang:', error);
    return { ok: false, status: 500, error: 'Terjadi kesalahan server' };
  }

  const sent = await sendOtpWhatsApp(row.phone, otpMessage(row.name, otp), {
    dedupeKey: `otp:${row.id}:${now}`,
  });
  if (!sent.ok) {
    console.error(
      `[register] OTP kirim ulang gagal (configured=${sent.configured}, reason=${sent.error || 'unknown'})`
    );
    return { ok: false, ...classifyOtpSendFailure(sent) };
  }

  return {
    ok: true,
    phoneMasked: maskedPhone(row.phone),
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

/** Batas percobaan verifikasi per IP (dipakai route verifikasi). */
export function verifyIpRateLimited(ip: string): { allowed: boolean; retryAfter?: number } {
  return rateLimit(`reg-verify:ip:${keyHash(ip)}`, VERIFY_LIMIT_PER_IP, RATE_WINDOW_MS);
}

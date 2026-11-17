/**
 * TOKEN AKTIVASI AKUN & RESET KATA SANDI — server-side only.
 *
 * Prinsip keamanan:
 * - Token dibuat acak kriptografis (32 byte). Yang DISIMPAN hanya hash SHA-256.
 * - Token mentah tidak pernah masuk database, log, atau respons API (kecuali
 *   sekali saat dikirim melalui tautan WhatsApp milik pengguna sendiri).
 * - Sekali pakai: setelah berhasil dipakai, `usedAt` diisi dan token tidak
 *   dapat dipakai lagi.
 * - Memiliki masa berlaku (default 60 menit aktivasi, 30 menit reset).
 * - Membuat token baru untuk pengguna+tujuan yang sama otomatis menghanguskan
 *   token lama yang belum terpakai (menghindari tautan aktif menumpuk).
 */

import { createHash, randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getAppBaseUrl } from '@/lib/whatsapp';

export type TokenPurpose = 'ACTIVATION' | 'RESET_PASSWORD';

const DEFAULT_TTL_MINUTES: Record<TokenPurpose, number> = {
  ACTIVATION: 60 * 24, // aktivasi akun: berlaku 24 jam
  RESET_PASSWORD: 60, // reset kata sandi: berlaku 60 menit
};

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeRawToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Buat token baru untuk pengguna + tujuan tertentu.
 * Mengembalikan token MENTAH (hanya dipakai untuk menyusun tautan, tidak
 * disimpan). Token lama yang belum terpakai pada tujuan yang sama dihanguskan.
 */
export async function createAccountToken(input: {
  userId: string;
  purpose: TokenPurpose;
  createdBy?: string;
  ttlMinutes?: number;
}): Promise<{ raw: string; expiresAt: Date }> {
  const ttl = input.ttlMinutes ?? DEFAULT_TTL_MINUTES[input.purpose];
  const raw = makeRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000);

  // Hanguskan token lama yang masih berlaku agar tidak ada tautan aktif menumpuk.
  await prisma.accountToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.accountToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash,
      expiresAt,
      createdBy: input.createdBy,
    },
  });

  return { raw, expiresAt };
}

/**
 * Validasi token mentah: harus cocok hash-nya, belum dipakai, dan belum
 * kedaluwarsa. Mengembalikan baris token (tanpa token mentah) atau null.
 */
export async function resolveAccountToken(
  raw: string,
  purpose: TokenPurpose
): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
  if (!raw || typeof raw !== 'string' || raw.length < 16) return null;
  const tokenHash = hashToken(raw);
  const row = await prisma.accountToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (row.purpose !== purpose) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

/** Tandai token sebagai terpakai (sekali pakai). */
export async function consumeAccountToken(id: string): Promise<void> {
  await prisma.accountToken.update({ where: { id }, data: { usedAt: new Date() } });
}

/** Tautan aktivasi akun (token mentah dititipkan pada query string). */
export function buildActivationUrl(raw: string): string {
  return `${getAppBaseUrl()}/aktivasi?token=${encodeURIComponent(raw)}`;
}

/** Tautan reset kata sandi. */
export function buildResetUrl(raw: string): string {
  return `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
}

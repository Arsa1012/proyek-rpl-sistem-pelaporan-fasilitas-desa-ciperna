/**
 * KEBIJAKAN KATA SANDI TERPUSAT — satu sumber kebenaran.
 *
 * Dipakai oleh: /api/auth/register, /api/profile/password,
 * /api/auth/change-password, dan endpoint Admin (buat petugas, reset kata sandi).
 * Tujuannya agar aturan kekuatan kata sandi tidak berbeda antar-alur.
 *
 * Modul ini TIDAK pernah menyimpan atau mencatat kata sandi. Hanya memeriksa
 * string di memori dan (bila diminta) membuat kata sandi sementara acak.
 */

/** Pesan error kebijakan — identik dengan pesan lama agar UI tetap konsisten. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RULES_HINT =
  'Minimal 8 karakter, mengandung huruf kapital, huruf kecil, dan angka.';

/**
 * Validasi kekuatan kata sandi. Mengembalikan pesan error pertama yang gagal,
 * atau null bila kata sandi memenuhi kebijakan.
 */
export function validatePassword(password: unknown): string | null {
  const pw = typeof password === 'string' ? password : '';
  if (pw.length < PASSWORD_MIN_LENGTH) return 'Password minimal 8 karakter';
  if (!/[A-Z]/.test(pw)) return 'Password harus mengandung minimal 1 huruf kapital';
  if (!/[a-z]/.test(pw)) return 'Password harus mengandung minimal 1 huruf kecil';
  if (!/[0-9]/.test(pw)) return 'Password harus mengandung minimal 1 angka';
  return null;
}

/** Karakter aman (tanpa 0/O/1/l/I) untuk kata sandi sementara. */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const ALL = UPPER + LOWER + DIGIT;

function pick(chars: string): string {
  // crypto.getRandomValues tersedia di Node 18+ dan Edge runtime.
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return chars[buf[0] % chars.length];
}

/**
 * Membuat kata sandi sementara acak yang DIJAMIN memenuhi kebijakan
 * (memuat huruf kapital, huruf kecil, dan angka). Hanya ditampilkan SEKALI
 * kepada Admin dan tidak pernah disimpan/di-log dalam bentuk asli.
 */
export function generateTemporaryPassword(length = 12): string {
  const n = Math.max(PASSWORD_MIN_LENGTH, length);
  // Susun 3 karakter wajib lalu isi sisanya, kemudian acak posisinya.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  while (chars.length < n) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

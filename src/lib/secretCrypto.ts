/**
 * ENKRIPSI RAHASIA SERVER-SIDE (AES-256-GCM).
 *
 * Digunakan untuk:
 *  - token perangkat Fonnte (`FonnteConfig.tokenCipher`),
 *  - API Key provider AI (`AiProvider.apiKeyCipher`).
 *
 * Prinsip keamanan:
 *  1. Kunci HANYA dibaca dari environment server (`APP_ENCRYPTION_KEY`).
 *     Tidak ada key fallback, tidak ada key hardcoded, tidak ada default.
 *  2. Modul ini HANYA boleh dijalankan di server. Di lingkungan browser
 *     (dimuat lewat bundel klien) modul ini melempar error, bukan diam-diam
 *     menjadi tidak-op.
 *  3. Format ciphertext: `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`.
 *     Prefiks versi memungkinkan rotasi kunci di masa depan tanpa mengubah
 *     bentuk kolom.
 *  4. IV (nonce) acak 12 byte untuk SETIAP enkripsi. GCM tidak boleh
 *     memakai nonce yang sama untuk dua pesan berbeda dengan kunci sama.
 *  5. Autentikasi GCM (auth tag) diverifikasi saat dekripsi. Ciphertext
 *     yang diubah/dirusak akan GAGAL dekripsi, bukan menghasilkan teks
 *    |Minum. Quality: nilai asli tidak pernah bocor lewat error.
 *  6. Error yang dilempar hanya berisi kode aman (tanpa nilai rahasia,
 *     tanpa potongan ciphertext).
 *
 * Format kunci: Base64 yang hasil decode-nya tepat 32 byte (256 bit).
 * Hex 64 karakter juga diterima.
 */
import { randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const VERSION = 'v1';

/** Kode error yang aman ditampilkan ke log/UI (tanpa nilai rahasia). */
export type SecretCryptoErrorCode =
  | 'encryption_key_missing'
  | 'encryption_key_invalid'
  | 'encrypt_failed'
  | 'decrypt_failed'
  | 'ciphertext_invalid'
  | 'server_only';

export class SecretCryptoError extends Error {
  readonly code: SecretCryptoErrorCode;
  constructor(code: SecretCryptoErrorCode, message: string) {
    super(message);
    this.name = 'SecretCryptoError';
    this.code = code;
  }
}

/**
 * Lindungi agar modul TIDAK ikut ter-bundle ke browser.
 *
 * Pemeriksaan ini bersifat best-effort: bila `process` tidak ada (bundel
 * klien) modul langsung melempar error. Server Next.js selalu menyediakan
 * `process`, sehingga modul tetap aman dipakai di route handler & server
 * component.
 */
function assertServerOnly(): void {
  const g = globalThis as any;
  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    throw new SecretCryptoError(
      'server_only',
      'Modul enkripsi hanya boleh dipakai di server.'
    );
  }
}

/**
 * Ambil kunci enkripsi dari environment server.
 *
 * Mengembalikan buffer 32 byte. Melempar `SecretCryptoError` dengan kode
 * aman bila kunci tidak ada atau formatnya salah. TIDAK ada nilai default.
 */
export function getEncryptionKey(): Buffer {
  assertServerOnly();
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new SecretCryptoError(
      'encryption_key_missing',
      'APP_ENCRYPTION_KEY belum dikonfigurasi di server.'
    );
  }
  const trimmed = raw.trim();
  let key: Buffer | null = null;

  // Base64 (bentuk yang dihasilkan `randomBytes(32).toString('base64')`).
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length >= 40) {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === KEY_BYTES) key = decoded;
  }
  // Hex 64 karakter (alternatif).
  if (!key && /^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed, 'hex');
    if (decoded.length === KEY_BYTES) key = decoded;
  }
  if (!key) {
    throw new SecretCryptoError(
      'encryption_key_invalid',
      'APP_ENCRYPTION_KEY harus Base64 (decode tepat 32 byte) atau hex 64 karakter.'
    );
  }
  return key;
}

/** True bila environment server punya kunci yang valid. */
export function isEncryptionReady(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Enkripsi satu rahasia.
 *
 * Mengembalikan string `v1:iv:tag:ciphertext` (Base64 per bagian).
 * Input kosong → string kosong (tanpa enkripsi) supaya kolom nullable
 * tetap bisa menyimpan "belum diisi".
 */
export function encryptSecret(plaintext: string | null | undefined): string {
  assertServerOnly();
  const value = typeof plaintext === 'string' ? plaintext : '';
  if (!value) return '';
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** True bila string Looks like ciphertext terenkripsi versi ini. */
export function isEncrypted(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith(VERSION + ':') && value.split(':').length === 4;
}

/**
 * Dekripsi satu rahasia.
 *
 * Melempar `SecretCryptoError`:
 *  - `ciphertext_invalid` bila formatnya bukan `v1:iv:tag:ct`
 *  - `decrypt_failed` bila auth tag GCM tidak cocok (ciphertext dirusak /
 *    kunci berbeda / iv tidak cocok)
 */
export function decryptSecret(ciphertext: string | null | undefined): string {
  assertServerOnly();
  const value = typeof ciphertext === 'string' ? ciphertext.trim() : '';
  if (!value) return '';

  // Kunci dicek LEBIH DAHULU: tanpa kunci, dekripsi mustahil apa pun.
  // Melaporkan "kunci hilang" lebih berguna daripada "ciphertext rusak",
  // karena itu akar masalahnya.
  const key = getEncryptionKey();

  if (!isEncrypted(value)) {
    throw new SecretCryptoError(
      'ciphertext_invalid',
      'Format ciphertext tidak valid (harus v1:iv:tag:ciphertext).'
    );
  }
  const parts = value.split(':');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretCryptoError(
      'ciphertext_invalid',
      'Format ciphertext tidak valid (panjang iv/tag tidak sesuai).'
    );
  }
  try {
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(ct), decipher.final()]);
    return out.toString('utf8');
  } catch {
    // Auth tag GCM gagal: ciphertext diubah, atau kunci/iv berbeda.
    throw new SecretCryptoError(
      'decrypt_failed',
      'Tidak dapat mendekripsi rahasia (autentikasi GCM gagal).'
    );
  }
}

/**
 * Samarkan rahasia untuk ditampilkan di UI/log.
 *
 * Hanya 4 karakter terakhir yang ditampilkan. Nilai penuh tidak pernah
 * dikembalikan ke klien.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = String(value);
  if (trimmed.length <= 4) return '••••';
  return '••••' + trimmed.slice(-4);
}

/**
 * Bandingkan dua string secara timing-safe (dipakai untuk memastikan
 * nilai yang dikembalikan dari dekripsi benar-benar sama).
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

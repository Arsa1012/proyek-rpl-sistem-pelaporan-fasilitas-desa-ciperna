/**
 * Idempotency helper untuk pembuatan laporan.
 *
 * Mengapa: klik ganda / retry jaringan tidak boleh membuat dua laporan.
 * Klien mengirim `clientKey` (UUID per form). Server menyimpannya dan
 * database memiliki UNIQUE(userId, clientKey) — kunci yang sama hanya
 * menghasilkan SATU baris.
 */

/** Batas panjang kunci (UUID = 36; sisakan ruang untuk varian lain). */
export const MAX_CLIENT_KEY_LENGTH = 100;

/**
 * Sanitasi kunci dari klien. Mengembalikan null bila tidak valid, sehingga
 * permintaan diperlakukan sebagai pembuatan biasa (tanpa idempotensi).
 * Hanya huruf, angka, tanda hubung, dan garis bawah — mencegah injeksi/abuse.
 */
export function sanitizeClientKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (!key) return null;
  if (key.length > MAX_CLIENT_KEY_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  return key;
}

/** Apakah dua permintaan pembuatan laporan dianggap kiriman yang sama? */
export function isSameSubmission(
  existing: { userId: string; clientKey: string | null } | null,
  incoming: { userId: string; clientKey: string | null }
): boolean {
  if (!existing || !incoming.clientKey) return false;
  return existing.userId === incoming.userId && existing.clientKey === incoming.clientKey;
}

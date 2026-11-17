/**
 * PEMBEDAAN BUKTI PENGIRIMAN: nyata vs mock/uji.
 *
 * Latar belakang: pengujian otomatis (dan uji manual) memakai stub fetch sehingga
 * baris WhatsAppLog tercatat SENT walaupun TIDAK ada pesan yang benar-benar
 * dikirim ke Fonnte. Bila baris seperti itu ikut dihitung sebagai "bukti
 * pengiriman", dashboard Admin akan menampilkan "Terhubung" padahal tidak ada
 * satu pun pesan yang terkirim ke nomor nyata.
 *
 * Aturan:
 * - Suatu pengiriman dianggap MOCK bila id pesan provider/Anthropic-like
 *   memakai penanda uji, ATAU dedupeKey-nya memakai awalan uji.
 * - Baris mock TIDAK dihapus — hanya dibedakan saat dihitung/ditampilkan.
 * - Semua penanda uji dikumpulkan di satu tempat agar mudah dirawat.
 */

/** Penanda id pesan provider yang dipakai oleh pengujian (stub fetch). */
const MOCK_PROVIDER_IDS = new Set(['test-request-id', 'test-message-id', 'mock-id']);

/** Awalan dedupeKey yang dipakai oleh skrip uji/lokal. */
const MOCK_DEDUPE_PREFIXES = ['test:', 'manual-test:', 'zz-', 'probe-', 'mock-'];

/** true bila id pesan provider dikenal sebagai penanda uji. */
export function isMockProviderId(providerMessageId?: string | null): boolean {
  if (!providerMessageId) return false;
  const id = String(providerMessageId).trim().toLowerCase();
  if (!id) return false;
  if (MOCK_PROVIDER_IDS.has(id)) return true;
  return id.startsWith('test-') || id.startsWith('mock-');
}

/** true bila dedupeKey berasal dari pengujian/alat bantu. */
export function isMockDedupeKey(dedupeKey?: string | null): boolean {
  if (!dedupeKey) return false;
  const key = String(dedupeKey).trim().toLowerCase();
  if (!key) return false;
  return MOCK_DEDUPE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export interface DeliveryRowLike {
  dedupeKey?: string | null;
  providerMessageId?: string | null;
}

/**
 * true bila baris pengiriman dianggap hasil UJI (bukan bukti nyata).
 * Unsur penentu: id provider berupa penanda uji ATAU dedupeKey berawalan uji.
 */
export function isMockDelivery(row: DeliveryRowLike): boolean {
  if (!row) return false;
  if (isMockProviderId(row.providerMessageId)) return true;
  if (isMockDedupeKey(row.dedupeKey)) return true;
  return false;
}

/**
 * SERVICE KONFIGURASI PERANGKAT FONNTE (single source of truth).
 *
 * Prinsip:
 * 1. HANYA SATU perangkat boleh aktif. Aktivasi perangkat lain otomatis
 *    menonaktifkan yang lama, secara ATOMIK (transaksi database).
 * 2. SELURUH pengiriman notifikasi membaca konfigurasi dari fungsi ini
 *    (`resolveActiveFonnteConfig`) — tidak ada jalur lain yang membaca token
 *    dari `.env` secara langsung, dan tidak ada cache jangka panjang yang
 *    bisa membuat pengiriman memakai perangkat lama.
 * 3. Fallback `.env` HANYA dipakai bila database belum memiliki satu pun
 *    perangkat (instalasi baru). Bila database sudah punya perangkat tetapi
 *    bermasalah (token kosong/nomor tidak valid/tidak ada yang aktif), sistem
 *    TIDAK diam-diam memakai perangkat `.env` — pengiriman dihentikan dengan
 *    alasan yang jelas dan tercatat.
 * 4. Nomor Admin, token, dan nomor tujuan adalah hal BERBEDA:
 *    - token + nomor admin = milik perangkat PENGIRIM yang aktif,
 *    - nomor tujuan = milik penerima (warga/petugas/admin) sesuai notifikasi.
 *    Nomor PENERIMA notifikasi Admin dikelola terpisah di
 *    `notificationRecipients.ts` dan TIDAK lagi diambil dari `adminPhone`.
 * 5. Token disimpan TERENKRIPSI (AES-256-GCM) pada `tokenCipher`. Kolom
 *    `token` (plaintext) hanya dipakai sebagai jalur transisi selama
 *    migrasi belumselesai, lalu tidak lagi menjadi sumber utama.
 *
 * Keamanan: token tidak pernah dikembalikan ke klien; nomor dinormalisasi
 * (dibuang tanda kutip/spasi) sehingga data lama yang terisi tanda kutip
 * tidak lagi melumpuhkan seluruh sistem.
 */
import { prisma } from '@/lib/prisma';
import { decryptSecret, isEncrypted, SecretCryptoError } from './secretCrypto';

export interface FonnteConfig {
  id: string;
  token: string;
  adminPhone: string;
  deviceName?: string | null;
  isActive: boolean;
  lastValidation: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Sumber konfigurasi yang dipakai untuk sebuah pengiriman. */
export type FonnteConfigSource = 'database' | 'env' | 'none' | 'error';

export interface ResolvedFonnteConfig {
  /** Asal konfigurasi: perangkat aktif di DB, .env (bootstrap), atau tidak ada. */
  source: FonnteConfigSource;
  /** ID perangkat pengirim aktif (null bila memakai .env / tidak ada). */
  deviceId: string | null;
  /** Nama perangkat pengirim aktif untuk ditampilkan ke Admin. */
  deviceName: string | null;
  /** Token Fonnte yang sudah dinormalisasi (string kosong bila tidak valid). */
  token: string;
  /** Nomor Admin perangkat aktif, ternormalisasi ke format 62... (null bila tidak valid). */
  adminPhone: string | null;
  tokenValid: boolean;
  adminPhoneValid: boolean;
  /** Masalah konfigurasi dalam bahasa manusia (aman, tanpa rahasia). */
  problems: string[];
  lastValidation: Date | null;
  totalDevices: number;
  activeDeviceId: string | null;
}

/**
 * Buang tanda kutip/spesial yang sering ikut tersalin saat nilai diambil
 * dari `.env` atau diisi manual. Contoh: '"082118727522"' → '082118727522'.
 */
export function sanitizePhoneInput(input: string | null | undefined): string {
  return String(input ?? '').replace(/["'`]/g, '').replace(/[\s\-().]/g, '').trim();
}

/** Buang tanda kutip di sekeliling token (token tidak boleh berformat lain). */
export function sanitizeTokenInput(input: string | null | undefined): string {
  return String(input ?? '').trim().replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
}

/**
 * Normalisasi nomor Indonesia ke format internasional 62...
 * Menerima 08xx, 628xx, +628xx (dan varian berisi tanda kutip/spasi).
 * Mengembalikan null bila bukan nomor yang bisa dipakai.
 */
export function normalizePhoneTo62(input: string | null | undefined): string | null {
  let digits = sanitizePhoneInput(input);
  if (!digits) return null;
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('08')) digits = '62' + digits.slice(1);
  else if (digits.startsWith('8') && digits.length >= 9 && digits.length <= 14) digits = '62' + digits;
  if (!/^62\d{9,13}$/.test(digits)) return null;
  return digits;
}

/** Ambil konfigurasi Fonnte aktif dari database (satu perangkat aktif). */
export async function getActiveFonnteConfig(): Promise<FonnteConfig | null> {
  try {
    const config = await prisma.fonnteConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return config ?? null;
  } catch (error) {
    console.error('[FonnteConfig] Gagal mengambil konfigurasi aktif:', error);
    return null;
  }
}

/**
 * Baca token perangkat Fonnte.
 *
 * Sumber utama: `tokenCipher` (AES-256-GCM). Kolom `token` (plaintext)
 * hanya dipakai sebagai JALUR TRANSISI selama migrasi token belum rampung,
 * dan tidak lagi jadi sumber utama setelah `tokenCipher` terisi.
 *
 * Kalau `tokenCipher` gagal didekripsi (kunci hilang/berubah), sistem TIDAK
 * diam-diam memakai token plaintext lama — token dikembalikan kosong dan
 * masalahnya dilaporkan agar pengiriman berhenti dengan alasan jelas.
 */
export function readDeviceToken(device: {
  tokenCipher?: string | null;
  token?: string | null;
}): string {
  const cipher = device.tokenCipher;
  if (cipher && cipher.length > 0) {
    if (!isEncrypted(cipher)) {
      console.error('[FonnteConfig] Format tokenCipher tidak valid pada perangkat aktif.');
      return '';
    }
    try {
      return decryptSecret(cipher);
    } catch (e) {
      const code = e instanceof SecretCryptoError ? e.code : 'decrypt_failed';
      console.error(`[FonnteConfig] Gagal mendekripsi token perangkat aktif (${code}).`);
      return '';
    }
  }
  // Jalur transisi: token lama masih dipakai sampai migrasi selesai.
  return sanitizeTokenInput(device.token);
}

/** Ambil semua konfigurasi Fonnte dari database. */
export async function getAllFonnteConfigs(): Promise<FonnteConfig[]> {
  try {
    return await prisma.fonnteConfig.findMany({ orderBy: { createdAt: 'desc' } });
  } catch (error) {
    console.error('[FonnteConfig] Gagal mengambil daftar konfigurasi:', error);
    return [];
  }
}

/**
 * Jaga invarian "hanya satu perangkat aktif".
 * Bila karena faktor di luar (mis. suntingan manual) ada lebih dari satu
 * perangkat aktif, perangkat TERBARU dipertahankan dan sisanya dinonaktifkan.
 */
async function enforceSingleActiveDevice(
  actives: FonnteConfig[]
): Promise<FonnteConfig | null> {
  const sorted = [...actives].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = sorted[0];
  const others = sorted.slice(1).map((c) => c.id);
  if (others.length > 0) {
    try {
      await prisma.$transaction([
        prisma.fonnteConfig.updateMany({ where: { id: { in: others } }, data: { isActive: false } }),
      ]);
      console.warn(
        `[FonnteConfig] Menormalkan perangkat aktif ganda: "${keep.deviceName || keep.id}" dipertahankan, ` +
          `${others.length} perangkat lain dinonaktifkan.`
      );
    } catch (e) {
      console.error('[FonnteConfig] Gagal menormalkan perangkat aktif ganda:', e);
    }
  }
  return keep;
}

/**
 * Resolusi konfigurasi aktif — dipakai oleh SELURUH jalur pengiriman,
 * monitoring, dan AI Assistant.
 *
 * Tidak ada cache: konfigurasi dibaca setiap kali dibutuhkan, sehingga
 * perubahan perangkat aktif oleh Admin langsung berlaku untuk pengiriman
 * berikutnya.
 */
export async function resolveActiveFonnteConfig(): Promise<ResolvedFonnteConfig> {
  let devices: FonnteConfig[];
  try {
    devices = await prisma.fonnteConfig.findMany({ orderBy: { createdAt: 'desc' } });
  } catch (error) {
    console.error('[FonnteConfig] Gagal membaca daftar perangkat:', error);
    return {
      source: 'error',
      deviceId: null,
      deviceName: null,
      token: '',
      adminPhone: null,
      tokenValid: false,
      adminPhoneValid: false,
      problems: [
        'Konfigurasi perangkat WhatsApp tidak dapat dibaca dari database. ' +
          'Pengiriman dihentikan agar tidak memakai perangkat lain yang tidak dipilih Admin.',
      ],
      lastValidation: null,
      totalDevices: 0,
      activeDeviceId: null,
    };
  }

  // Instalasi baru: belum ada satu pun perangkat → boleh memakai .env.
  if (devices.length === 0) {
    const token = sanitizeTokenInput(process.env.FONNTE_TOKEN);
    const adminPhone = normalizePhoneTo62(
      process.env.WHATSAPP_ADMIN_NUMBER ||
        process.env.FONNTE_ADMIN_PHONE ||
        process.env.WHATSAPP_ADMIN_PHONE
    );
    const problems: string[] = [];
    if (!token) problems.push('Token Fonnte belum dikonfigurasi (belum ada perangkat terdaftar di menu Admin).');
    if (!adminPhone) problems.push('Nomor Admin belum dikonfigurasi (belum ada perangkat terdaftar di menu Admin).');
    return {
      source: 'env',
      deviceId: null,
      deviceName: 'Konfigurasi .env (belum ada perangkat terdaftar)',
      token,
      adminPhone,
      tokenValid: Boolean(token),
      adminPhoneValid: Boolean(adminPhone),
      problems,
      lastValidation: null,
      totalDevices: 0,
      activeDeviceId: null,
    };
  }

  const actives = devices.filter((d) => d.isActive);
  const active = actives.length > 1 ? await enforceSingleActiveDevice(actives) : actives[0] ?? null;

  // Sudah ada perangkat di DB tetapi tidak ada yang aktif → JANGAN fallback .env.
  if (!active) {
    return {
      source: 'none',
      deviceId: null,
      deviceName: null,
      token: '',
      adminPhone: null,
      tokenValid: false,
      adminPhoneValid: false,
      problems: [
        `Tidak ada perangkat WhatsApp yang aktif (terdaftar ${devices.length} perangkat). ` +
          'Aktifkan satu perangkat di menu Admin → Pusat WhatsApp Admin.',
      ],
      lastValidation: null,
      totalDevices: devices.length,
      activeDeviceId: null,
    };
  }

  const token = readDeviceToken(active);
  const adminPhone = normalizePhoneTo62(active.adminPhone);
  const problems: string[] = [];
  if (!token) {
    problems.push(`Token Fonnte pada perangkat "${active.deviceName || active.id}" kosong atau tidak valid.`);
  }
  if (!adminPhone) {
    problems.push(
      `Nomor Admin pada perangkat "${active.deviceName || active.id}" tidak valid (harus format 08xx atau 62xx).`
    );
  }

  return {
    source: 'database',
    deviceId: active.id,
    deviceName: active.deviceName || 'Tanpa Nama',
    token,
    adminPhone,
    tokenValid: Boolean(token),
    adminPhoneValid: Boolean(adminPhone),
    problems,
    lastValidation: active.lastValidation,
    totalDevices: devices.length,
    activeDeviceId: active.id,
  };
}

/**
 * Aktifkan satu perangkat dan nonaktifkan yang lain — ATOMIK.
 * Bila target sudah aktif, operasi tetap dijalankan (idempoten) agar
 * tidak ada dua perangkat aktif.
 * Bila transaksi gagal, TIDAK ada perubahan sama sekali (rollback database).
 */
export async function setActiveFonnteConfig(id: string): Promise<FonnteConfig | null> {
  try {
    const existing = await prisma.fonnteConfig.findUnique({ where: { id } });
    if (!existing) return null;

    await prisma.$transaction([
      prisma.fonnteConfig.updateMany({
        where: { isActive: true, NOT: { id } },
        data: { isActive: false },
      }),
      prisma.fonnteConfig.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);

    return await prisma.fonnteConfig.findUnique({ where: { id } });
  } catch (error) {
    console.error('[FonnteConfig] Gagal mengatur konfigurasi aktif:', error);
    return null;
  }
}

/**
 * Susun patch konfigurasi dari body PATCH (fungsi murni, mudah diuji).
 *
 * Aturan:
 * - Hanya field yang DIKIRIM yang berubah; field lain tidak tersentuh.
 * - Token bersifat OPSIONAL: token kosong/tidak dikirim berarti token lama
 *   DIPERTAHANKAN (Admin tidak perlu mengetik ulang token).
 * - Nomor & token dinormalisasi (tanda kutip/spasi dibuang).
 * - Token TIDAK PERNAH dikembalikan ke klien.
 */
export function buildFonnteConfigPatch(
  body: { deviceName?: unknown; adminPhone?: unknown; token?: unknown },
  existing: { deviceName: string | null; adminPhone: string }
):
  | { ok: true; patch: { deviceName?: string; adminPhone?: string; token?: string }; tokenUpdated: boolean }
  | { ok: false; error: string } {
  const patch: { deviceName?: string; adminPhone?: string; token?: string } = {};
  let tokenUpdated = false;

  if (body.deviceName !== undefined) {
    if (typeof body.deviceName !== 'string' || !body.deviceName.trim()) {
      return { ok: false, error: 'Nama perangkat tidak boleh kosong' };
    }
    patch.deviceName = body.deviceName.trim();
  }

  if (body.adminPhone !== undefined) {
    if (typeof body.adminPhone !== 'string' || !sanitizePhoneInput(body.adminPhone)) {
      return { ok: false, error: 'Nomor admin tidak boleh kosong' };
    }
    const cleanPhone = sanitizePhoneInput(body.adminPhone);
    const phoneRegex = /^(\+62|62|0)8\d{8,13}$/;
    if (!phoneRegex.test(cleanPhone)) {
      return { ok: false, error: 'Nomor admin tidak valid (format: 08xxxx atau 62xxxx)' };
    }
    patch.adminPhone = cleanPhone;
  }

  if (body.token !== undefined) {
    if (typeof body.token !== 'string') {
      return { ok: false, error: 'Token Fonnte tidak valid' };
    }
    const cleanToken = sanitizeTokenInput(body.token);
    if (cleanToken.length > 0) {
      patch.token = cleanToken;
      tokenUpdated = true;
    }
    // token kosong → token lama dipertahankan (tidak masuk patch).
  }

  return { ok: true, patch, tokenUpdated };
}

/**
 * Perbarui konfigurasi perangkat. Nilai nomor & token dinormalisasi sebelum
 * disimpan sehingga data yang tersimpan selalu dalam format bersih.
 * Parameter yang tidak diberikan TIDAK diubah (token lama tetap bila
 * token baru tidak diisi).
 */
export async function updateFonnteConfig(
  id: string,
  patch: { deviceName?: string; adminPhone?: string; token?: string }
): Promise<FonnteConfig | null> {
  const data: Record<string, string> = {};
  if (patch.deviceName !== undefined) data.deviceName = patch.deviceName.trim();
  if (patch.adminPhone !== undefined) data.adminPhone = sanitizePhoneInput(patch.adminPhone);
  if (patch.token !== undefined) data.token = sanitizeTokenInput(patch.token);
  if (Object.keys(data).length === 0) {
    return prisma.fonnteConfig.findUnique({ where: { id } });
  }
  return prisma.fonnteConfig.update({ where: { id }, data });
}

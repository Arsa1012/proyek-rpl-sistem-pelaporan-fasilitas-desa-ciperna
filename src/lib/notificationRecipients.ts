/**
 * KONFIGURASI PENERIMA NOTIFIKASI WHATSAPP ADMIN (single source of truth).
 *
 * TERPISAH dari `fonnteConfig.ts`:
 *  - `fonnteConfig.ts` = perangkat **PENGIRIM** (token Fonnte, nomor perangkat).
 *  - modul ini            = nomor **PENERIMA** notifikasi Admin.
 *
 * Prinsip:
 *  1. Hanya SATU nomor berstatus aktif. Dijamin partial UNIQUE INDEX di
 *     database + transaksi atomik di service layer (dua lapis pengaman).
 *  2. Tidak ada fallback diam-diam ke nomor lama perangkat Fonnte. Bila
 *     tidak ada penerima aktif, pemanggil HARUS menghentikan pengiriman
 *     dan mencatat kegagalan.
 *  3. Nomor lama TIDAK PERNAH dihapus; hanya dinonaktifkan agar dapat
 *     diaktifkan kembali.
 *  4. Tidak ada kredensial yang disimpan di sini.
 */
import { prisma } from '@/lib/prisma';
import { normalizePhoneTo62 } from './fonnteConfig';

export interface NotificationRecipientRow {
  id: string;
  label: string;
  phone: string;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RecipientSource = 'database' | 'none' | 'error';

export interface ResolvedRecipient {
  source: RecipientSource;
  /** Nomor penerima aktif (62xxx). null bila tidak ada / tidak valid. */
  phone: string | null;
  /** Nomor aktif di database (mentah, untuk keperluan display Admin). */
  rawPhone: string | null;
  label: string | null;
  /** Masalah dalam bahasa manusia (aman untuk UI/log). */
  problems: string[];
  totalRecipients: number;
}

/** Daftar semua penerima, aktif lebih dulu. */
export async function listRecipients(): Promise<NotificationRecipientRow[]> {
  return prisma.notificationRecipient.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }] });
}

/**
 * Ambil penerima aktif.
 *
 * TIDAK ada fallback ke `FonnteConfig.adminPhone` (nomor perangkat
 * pengirim). Bila tabel kosong atau tidak ada yang aktif, `phone` = null
 * dan pemanggil wajib menghentikan pengiriman.
 */
export async function resolveActiveRecipient(): Promise<ResolvedRecipient> {
  let rows: NotificationRecipientRow[];
  try {
    rows = await listRecipients();
  } catch (error) {
    console.error('[NotificationRecipients] Gagal membaca daftar penerima:', error);
    return {
      source: 'error',
      phone: null,
      rawPhone: null,
      label: null,
      problems: [
        'Daftar penerima notifikasi tidak dapat dibaca dari database. ' +
          'Pengiriman dihentikan agar tidak memakai nomor lain yang tidak dipilih Admin.',
      ],
      totalRecipients: 0,
    };
  }

  if (rows.length === 0) {
    return {
      source: 'none',
      phone: null,
      rawPhone: null,
      label: null,
      problems: [
        'Belum ada nomor penerima notifikasi yang terdaftar. ' +
          'Tambahkan nomor di menu Admin → Penerima Notifikasi.',
      ],
      totalRecipients: 0,
    };
  }

  const active = rows.find((r) => r.isActive);
  if (!active) {
    return {
      source: 'none',
      phone: null,
      rawPhone: null,
      label: null,
      problems: [
        `Tidak ada nomor penerima notifikasi yang AKTIF (terdaftar ${rows.length} nomor). ` +
          'Aktifkan satu nomor di menu Admin → Penerima Notifikasi.',
      ],
      totalRecipients: rows.length,
    };
  }

  const normalized = normalizePhoneTo62(active.phone);
  if (!normalized) {
    return {
      source: 'none',
      phone: null,
      rawPhone: active.phone,
      label: active.label,
      problems: [
        `Nomor penerima aktif ("${active.label}") tidak valid (harus format 08xx atau 62xx). ` +
          'Pengiriman dihentikan.',
      ],
      totalRecipients: rows.length,
    };
  }

  return {
    source: 'database',
    phone: normalized,
    rawPhone: active.phone,
    label: active.label,
    problems: [],
    totalRecipients: rows.length,
  };
}

/**
 * Jaga invarian "hanya satu penerima aktif".
 *
 * Bila karena faktor luar (suntingan manual) ada >1 aktif, nomor TERBARU
 * dipertahankan dan sisanya dinonaktifkan.
 */
async function enforceSingleActiveRecipient(actives: NotificationRecipientRow[]): Promise<NotificationRecipientRow | null> {
  const sorted = [...actives].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = sorted[0];
  const others = sorted.slice(1).map((r) => r.id);
  if (others.length > 0) {
    try {
      await prisma.$transaction([
        prisma.notificationRecipient.updateMany({ where: { id: { in: others } }, data: { isActive: false } }),
      ]);
      console.warn(
        `[NotificationRecipients] Menormalkan penerima aktif ganda: "${keep.label || keep.id}" dipertahankan, ` +
          `${others.length} nomor lain dinonaktifkan.`
      );
    } catch (e) {
      console.error('[NotificationRecipients] Gagal menormalkan penerima aktif ganda:', e);
    }
  }
  return keep;
}

/**
 * Aktifkan satu nomor; nonaktifkan yang lain. ATOMIK.
 *
 * Bila target sudah aktif, operasi tetap dijalankan (idempoten) agar tidak
 * pernah ada dua nomor aktif. Bila transaksi gagal, TIDAK ada perubahan.
 */
export async function activateRecipient(id: string): Promise<NotificationRecipientRow | null> {
  const target = await prisma.notificationRecipient.findUnique({ where: { id } });
  if (!target) return null;
  try {
    await prisma.$transaction([
      prisma.notificationRecipient.updateMany({ where: { isActive: true, NOT: { id } }, data: { isActive: false } }),
      prisma.notificationRecipient.update({ where: { id }, data: { isActive: true } }),
    ]);
  } catch (e) {
    console.error('[NotificationRecipients] Gagal mengaktifkan penerima:', e);
    return null;
  }
  return prisma.notificationRecipient.findUnique({ where: { id } });
}

/** Nonaktifkan satu nomor (nomor tetap tersimpan, dapat diaktifkan kembali). */
export async function deactivateRecipient(id: string): Promise<NotificationRecipientRow | null> {
  const target = await prisma.notificationRecipient.findUnique({ where: { id } });
  if (!target) return null;
  await prisma.notificationRecipient.update({ where: { id }, data: { isActive: false } });
  return prisma.notificationRecipient.findUnique({ where: { id } });
}

/**
 * Pesan duplikat yang informatif.
 *
 * Menyertakan LABEL penerima yang sudah memakai nomor tersebut, sehingga Admin
 * tahu baris mana yang harus diaktifkan — bukan membuat nomor kembar.
 *
 * Keamanan: TIDAK memuat nomor telepon lengkap (hanya label milik Admin),
 * dan tidak mengubah aturan duplikasi sama sekali.
 */
function duplicateErrorMessage(existing: { label: string }): string {
  const label = (existing.label || '').trim() || 'tanpa label';
  return `Nomor ini sudah terdaftar pada penerima "${label}". Gunakan penerima yang sudah ada.`;
}

/**
 * Label untuk penerima hasil migrasi.
 *
 * Ditambah penanda 4 digit TERAKHIR nomor agar beberapa hasil migrasi dapat
 * dibedakan satu sama lain (mis. ada 2 baris hasil migrasi). Penanda hanya
 * 4 digit terakhir — bukan nomor lengkap.
 */
const MIGRATION_LABEL_BASE = 'Admin Utama (migrasi dari perangkat Fonnte)';
const MIGRATION_NOTES_PREFIX = 'Dibuat otomatis saat migrasi';

export function buildMigrationLabel(phone: string): string {
  const marker = String(phone || '').slice(-4);
  return marker ? `${MIGRATION_LABEL_BASE} ·${marker}` : MIGRATION_LABEL_BASE;
}

/**
 * Pastikan label baris hasil migrasi dapat dibedakan satu sama lain.
 *
 * Sifat penting:
 *  - **HANYA** kolom `label` yang diubah (SQL mentah → `updatedAt`, `phone`,
 *    `isActive`, `createdAt`, `id`, dan `notes` tidak tersentuh).
 *  - IDEMPOTEN: dijalankan berkali-kali tidak menghasilkan perubahan kedua.
 *  - Baris yang dibuat MANUAL oleh Admin (bukan hasil migrasi) TIDAK pernah
 *    diberi label migrasi.
 *  - Tidak menambah, menghapus, mengaktifkan, atau membuat ulang baris.
 */
export async function ensureMigrationLabels(): Promise<{ updated: number }> {
  const rows = await prisma.notificationRecipient.findMany({
    where: { notes: { startsWith: MIGRATION_NOTES_PREFIX } },
    select: { id: true, phone: true, label: true },
  });
  let updated = 0;
  for (const row of rows) {
    const desired = buildMigrationLabel(row.phone);
    if (desired === row.label) continue;
    await prisma.$executeRaw`
      UPDATE "NotificationRecipient" SET "label" = ${desired}
      WHERE "id" = ${row.id} AND "label" <> ${desired}
    `;
    updated++;
  }
  return { updated };
}

/**
 * Tambah nomor baru.
 *
 * Nomor duplikat DITOLAK agar tidak ada dua entri untuk nomor yang sama
 * (yang bisa membingungkan saat_admin memilih nomor aktif).
 */
export async function addRecipient(input: {
  label: string;
  phone: string;
  isActive?: boolean;
  notes?: string | null;
}): Promise<
  | { ok: true; recipient: NotificationRecipientRow }
  | { ok: false; error: string }
> {
  const label = (input.label || '').trim();
  if (!label) return { ok: false, error: 'Label wajib diisi' };
  const normalized = normalizePhoneTo62(input.phone);
  if (!normalized) {
    return { ok: false, error: 'Nomor penerima tidak valid (format: 08xxxx atau 62xxxx)' };
  }
  const duplicate = await prisma.notificationRecipient.findFirst({
    where: { phone: normalized },
    select: { id: true, label: true },
  });
  if (duplicate) {
    return { ok: false, error: duplicateErrorMessage(duplicate) };
  }
  const created = await prisma.notificationRecipient.create({
    data: {
      label,
      phone: normalized,
      isActive: false,
      notes: input.notes ?? null,
    },
  });
  if (input.isActive) {
    const active = await activateRecipient(created.id);
    return { ok: true, recipient: active ?? created };
  }
  return { ok: true, recipient: created };
}

/** Ubah label / nomor / catatan. Status aktif TIDAK diubah lewat sini. */
export async function updateRecipient(
  id: string,
  input: { label?: string; phone?: string; notes?: string | null }
): Promise<
  | { ok: true; recipient: NotificationRecipientRow }
  | { ok: false; error: string }
> {
  const existing = await prisma.notificationRecipient.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: 'Penerima tidak ditemukan' };

  const data: { label?: string; phone?: string; notes?: string | null } = {};
  if (input.label !== undefined) {
    const label = input.label.trim();
    if (!label) return { ok: false, error: 'Label tidak boleh kosong' };
    data.label = label;
  }
  if (input.phone !== undefined) {
    const normalized = normalizePhoneTo62(input.phone);
    if (!normalized) return { ok: false, error: 'Nomor penerima tidak valid (format: 08xxxx atau 62xxxx)' };
    // `NOT: { id }` mengecualikan baris yang SEDANG DIEDIT, sehingga
    // menyimpan label/catatan tanpa mengubah nomor tetap berhasil.
    const duplicate = await prisma.notificationRecipient.findFirst({
      where: { phone: normalized, NOT: { id } },
      select: { id: true, label: true },
    });
    if (duplicate) return { ok: false, error: duplicateErrorMessage(duplicate) };
    data.phone = normalized;
  }
  if (input.notes !== undefined) data.notes = input.notes;

  if (Object.keys(data).length === 0) return { ok: true, recipient: existing };
  const updated = await prisma.notificationRecipient.update({ where: { id }, data });
  return { ok: true, recipient: updated };
}

/**
 * Riwayat perubahan penerima notifikasi.
 *
 * Sumber: `AdminAuditLog` dengan awalan aksi `WA_RECIPIENT_`. Tidak ada tabel
 * riwayat baru — histori memakai audit log yang sudah ada, sehingga tidak
 * menambah skema dan tidak menambah beban tulis.
 *
 * Catatan: `notes` audit tidak pernah memuat nomor penuh atau rahasia, hanya
 * label, nomor (sudah ternormalisasi) dan aksi — cukup untuk keperluan
 * "histori perubahan" di halaman Admin.
 */
export interface RecipientHistoryEntry {
  id: string;
  action: string;
  notes: string | null;
  adminName: string | null;
  at: string;
}

export async function listRecipientHistory(limit = 20): Promise<RecipientHistoryEntry[]> {
  try {
    const rows = await prisma.adminAuditLog.findMany({
      where: { action: { startsWith: 'WA_RECIPIENT_' } },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      select: {
        id: true,
        adminId: true,
        action: true,
        notes: true,
        createdAt: true,
      },
    });

    // `AdminAuditLog` tidak punya relasi ke `User` (hanya `adminId`),
    // jadi nama Admin diambil terpisah agar tidak menambah relasi baru.
    const adminIds = [...new Set(rows.map((r) => r.adminId))];
    const admins = adminIds.length
      ? await prisma.user.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(admins.map((a) => [a.id, a.name]));

    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      notes: r.notes,
      adminName: nameById.get(r.adminId) ?? null,
      at: r.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('[NotificationRecipients] Gagal membaca riwayat perubahan:', error);
    return [];
  }
}

/**
 * Migrasi/idempoten: jadikan nomor `adminPhone` lama sebagai penerima aktif
 * pertama.
 *
 * Sifat:
 *  - IDEMPOTEN: menjalankan berkali-kali tidak membuat duplikasi.
 *  - TIDAK mengubah/menghapus `FonnteConfig` (nomor perangkat pengirim
 *    tetap utuh).
 *  - Nomor diambil dari perangkat Fonnte yang AKTIF.
 *  - Label hasil migrasi diberi penanda 4 digit terakhir nomor agar beberapa
 *    baris hasil migrasi dapat dibedakan. Penandaan hanya menyentuh kolom
 *    `label` (SQL mentah) sehingga `id`, `phone`, `isActive`, `createdAt`,
 *    `updatedAt`, dan `notes` tidak berubah sama sekali.
 *  - Baris yang dibuat MANUAL oleh Admin (bukan hasil migrasi) labelnya
 *    tidak pernah ditimpa.
 */
export async function migrateLegacyAdminPhone(): Promise<
  | { ok: true; created: boolean; phone: string | null; label: string }
  | { ok: false; error: string }
> {
  const legacy = await prisma.fonnteConfig.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { adminPhone: true, deviceName: true },
  });
  if (!legacy) {
    return { ok: false, error: 'Tidak ada perangkat Fonnte aktif untuk dimigrasikan' };
  }
  const normalized = normalizePhoneTo62(legacy.adminPhone);
  if (!normalized) {
    return { ok: false, error: 'Nomor admin pada perangkat aktif tidak valid' };
  }
  const label = buildMigrationLabel(normalized);
  // Label baris hasil migrasi yang lain dipastikan tetap dapat dibedakan
  // (HANYA kolom `label` yang disentuh; status aktif TIDAK diubah di sini).
  await ensureMigrationLabels();
  const existing = await prisma.notificationRecipient.findFirst({
    where: { phone: normalized },
    select: { id: true, label: true, isActive: true, notes: true },
  });
  if (existing) {
    // Sudah pernah dimigrasikan: JANGAN buat ulang, JANGAN hapus.
    if (!existing.isActive) {
      await activateRecipient(existing.id);
    }
    return { ok: true, created: false, phone: normalized, label };
  }
  const created = await prisma.notificationRecipient.create({
    data: {
      label,
      phone: normalized,
      isActive: false,
      notes: `${MIGRATION_NOTES_PREFIX} dari FonnteConfig.adminPhone (${legacy.deviceName || 'perangkat tanpa nama'})`,
    },
  });
  const activated = await activateRecipient(created.id);
  return { ok: true, created: true, phone: normalized, label };
}

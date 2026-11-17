/**
 * VILLAGE DATA LAYER — satu sumber kebenaran untuk informasi Desa Ciperna.
 *
 * Prinsip:
 * - Hanya data yang tersimpan di database yang boleh tampil sebagai data desa.
 * - Informasi resmi (perangkat desa, layanan) hanya tampil ke publik bila
 *   `isActive` DAN `isVerified`. Data yang belum diverifikasi tetap tersimpan
 *   untuk dikelola Admin, tetapi tidak dipublikasikan.
 * - Tidak ada penghapusan permanen: perangkat desa diarsipkan (isActive=false).
 * - Semua fungsi baca di sini READ-ONLY dan dipakai halaman publik maupun AI.
 */

import type {
  VillageProfile,
  VillageOfficial,
  VillageService,
  VillageAnnouncement,
} from '@prisma/client';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Fallback identitas administratif (tidak pernah berupa pejabat/statistik).
// ---------------------------------------------------------------------------
export const VILLAGE_FALLBACK = {
  name: 'Desa Ciperna',
  district: 'Talun',
  regency: 'Cirebon',
  province: 'Jawa Barat',
} as const;

export const WIKIPEDIA_SOURCE =
  'https://id.wikipedia.org/wiki/Ciperna,_Talun,_Cirebon';

export const OFFICIAL_CATEGORY_LABELS: Record<string, string> = {
  KEPALA_DESA: 'Kepala Desa',
  SEKRETARIAT: 'Sekretariat Desa',
  KASI: 'Kepala Seksi',
  KAUR: 'Kepala Urusan',
  RT_RW: 'Ketua RT / RW',
  LAINNYA: 'Perangkat Desa Lainnya',
};

export const OFFICIAL_CATEGORY_ORDER = [
  'KEPALA_DESA',
  'SEKRETARIAT',
  'KASI',
  'KAUR',
  'RT_RW',
  'LAINNYA',
];

export const DATA_STATUS_LABELS: Record<string, string> = {
  UNVERIFIED: 'Belum diverifikasi',
  PARTIAL: 'Sebagian data dari referensi awal',
  VERIFIED: 'Terverifikasi',
};

export type VillageReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; data: null; error: 'query gagal' };

// ---------------------------------------------------------------------------
// Baca profil
// ---------------------------------------------------------------------------

export async function getVillageProfile(): Promise<VillageProfile | null> {
  return prisma.villageProfile.findUnique({ where: { id: 'singleton' } });
}

/** Versi aman untuk halaman: membedakan "belum diisi" dari "query gagal". */
export async function loadVillageProfile(): Promise<VillageReadResult<VillageProfile | null>> {
  try {
    return { ok: true, data: await getVillageProfile() };
  } catch (error) {
    console.error('[village] gagal membaca profil desa:', error);
    return { ok: false, data: null, error: 'query gagal' };
  }
}

/** Identitas administratif yang aman dipakai kapan pun (fallback statis). */
export function villageIdentity(profile: VillageProfile | null) {
  return {
    name: profile?.name?.trim() || VILLAGE_FALLBACK.name,
    district: profile?.district?.trim() || VILLAGE_FALLBACK.district,
    regency: profile?.regency?.trim() || VILLAGE_FALLBACK.regency,
    province: profile?.province?.trim() || VILLAGE_FALLBACK.province,
  };
}

export function fullAddress(profile: VillageProfile | null): string | null {
  if (!profile) return null;
  const parts = [profile.address, profile.district, profile.regency, profile.province]
    .map((p) => (p || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Apakah profil punya cukup isi untuk ditampilkan sebagai ringkasan? */
export function hasProfileContent(profile: VillageProfile | null): boolean {
  if (!profile) return false;
  return Boolean(
    profile.address ||
      profile.history ||
      profile.geography ||
      profile.potential ||
      profile.vision ||
      profile.mission ||
      profile.serviceHours
  );
}

/** Field yang masih kosong (dipakai Admin & AI agar tidak mengarang). */
export function missingProfileFields(profile: VillageProfile | null): string[] {
  const fields: [keyof VillageProfile, string][] = [
    ['address', 'alamat kantor desa'],
    ['postalCode', 'kode pos'],
    ['phone', 'kontak resmi'],
    ['email', 'email resmi'],
    ['mapLink', 'tautan lokasi'],
    ['history', 'sejarah desa'],
    ['geography', 'kondisi geografis'],
    ['potential', 'potensi desa'],
    ['demographics', 'data demografi'],
    ['vision', 'visi'],
    ['mission', 'misi'],
    ['serviceHours', 'jam pelayanan'],
  ];
  if (!profile) return fields.map(([, label]) => label);
  return fields
    .filter(([key]) => {
      const value = profile[key];
      return value === null || value === undefined || String(value).trim() === '';
    })
    .map(([, label]) => label);
}

// ---------------------------------------------------------------------------
// Perangkat desa
// ---------------------------------------------------------------------------

/** HANYA data yang sudah diverifikasi & aktif yang boleh tampil ke publik. */
export async function getPublicOfficials(): Promise<VillageOfficial[]> {
  return prisma.villageOfficial.findMany({
    where: { isActive: true, isVerified: true },
    orderBy: [{ level: 'asc' }, { order: 'asc' }, { name: 'asc' }],
  });
}

/** Semua data untuk Admin (termasuk yang belum diverifikasi & diarsipkan). */
export async function getAllOfficials(): Promise<VillageOfficial[]> {
  return prisma.villageOfficial.findMany({
    orderBy: [{ isActive: 'desc' }, { level: 'asc' }, { order: 'asc' }, { name: 'asc' }],
  });
}

export function groupOfficials(items: VillageOfficial[]) {
  const groups = new Map<string, VillageOfficial[]>();
  for (const item of items) {
    const key = OFFICIAL_CATEGORY_LABELS[item.category] ? item.category : 'LAINNYA';
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }
  return OFFICIAL_CATEGORY_ORDER.filter((key) => groups.has(key)).map((key) => ({
    category: key,
    label: OFFICIAL_CATEGORY_LABELS[key],
    items: groups.get(key)!,
  }));
}

// ---------------------------------------------------------------------------
// Layanan desa
// ---------------------------------------------------------------------------

export async function getPublicServices(): Promise<VillageService[]> {
  return prisma.villageService.findMany({
    where: { isActive: true, isVerified: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
}

export async function getAllServices(): Promise<VillageService[]> {
  return prisma.villageService.findMany({
    orderBy: [{ isActive: 'desc' }, { order: 'asc' }, { name: 'asc' }],
  });
}

// ---------------------------------------------------------------------------
// Pengumuman
// ---------------------------------------------------------------------------

export async function getPublishedAnnouncements(limit = 6): Promise<VillageAnnouncement[]> {
  const now = new Date();
  return prisma.villageAnnouncement.findMany({
    // Terbit DAN waktunya sudah tiba: pengumuman terjadwal (publishedAt di masa
    // depan) tidak tampil — konsisten dengan notifikasi yang juga menunggu waktu.
    // Arsip, terhapus, dan yang masa berlakunya habis tidak ditampilkan.
    where: {
      isPublished: true,
      deletedAt: null,
      archivedAt: null,
      publishedAt: { not: null, lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
  });
}

export async function getAllAnnouncements(): Promise<VillageAnnouncement[]> {
  return prisma.villageAnnouncement.findMany({
    orderBy: [{ isPublished: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getPublishedAnnouncementBySlug(slug: string) {
  const now = new Date();
  return prisma.villageAnnouncement.findFirst({
    where: {
      slug,
      isPublished: true,
      deletedAt: null,
      archivedAt: null,
      publishedAt: { not: null, lte: now },
    },
  });
}

// ---------------------------------------------------------------------------
// Ringkasan untuk beranda
// ---------------------------------------------------------------------------

export async function loadVillageHomeData() {
  const [profile, officials, services, announcements] = await Promise.all([
    loadVillageProfile(),
    getPublicOfficials().catch(() => [] as VillageOfficial[]),
    getPublicServices().catch(() => [] as VillageService[]),
    getPublishedAnnouncements(3).catch(() => [] as VillageAnnouncement[]),
  ]);
  return {
    profile: profile.data,
    profileReadError: !profile.ok,
    officials,
    services,
    announcements,
  };
}

// ---------------------------------------------------------------------------
// Validasi & format (dipakai endpoint Admin)
// ---------------------------------------------------------------------------

/** Ambil teks opsional; kosong → null. Panjang dibatasi agar tidak membebani DB. */
export function optionalText(value: unknown, max = 4000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function requiredText(value: unknown, max = 200): string | null {
  const text = optionalText(value, max);
  return text;
}

const MAP_HOSTS = [
  'maps.app.goo.gl',
  'goo.gl',
  'google.com',
  'www.google.com',
  'maps.google.com',
  'openstreetmap.org',
  'www.openstreetmap.org',
];

/** Validasi tautan peta: hanya https dan host peta yang dikenal. */
export function normalizeMapLink(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'Tautan lokasi tidak valid' };
  const raw = value.trim();
  if (!raw) return { ok: true, value: null };
  if (raw.length > 500) return { ok: false, error: 'Tautan lokasi terlalu panjang' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Format tautan lokasi tidak valid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Tautan lokasi harus menggunakan https' };
  const host = url.hostname.toLowerCase();
  if (!MAP_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
    return { ok: false, error: 'Gunakan tautan Google Maps atau OpenStreetMap' };
  }
  return { ok: true, value: url.toString() };
}

/** Embed peta hanya diizinkan dari host yang aman (Google Maps/OSM). */
export function normalizeEmbedUrl(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'URL peta tidak valid' };
  const raw = value.trim();
  if (!raw) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Format URL peta tidak valid' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'URL peta harus https' };
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'www.google.com' ||
    host === 'maps.google.com' ||
    host === 'www.openstreetmap.org' ||
    host === 'openstreetmap.org';
  if (!allowed) return { ok: false, error: 'Embed peta harus dari Google Maps atau OpenStreetMap' };
  return { ok: true, value: url.toString() };
}

/** Angka desimal opsional dengan rentang aman. */
export function optionalCoordinate(value: unknown, min: number, max: number): number | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return 'invalid';
  return n;
}

export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `pengumuman-${Date.now()}`;
}

/** Format tanggal Indonesia (WIB) tanpa mengubah data tersimpan. */
export { formatVillageDate, formatVillageDateTime } from './villageFormat';

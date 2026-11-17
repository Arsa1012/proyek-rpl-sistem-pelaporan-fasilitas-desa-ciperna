/**
 * Parser input Portal Desa — murni (tanpa Prisma/Next) agar mudah diuji.
 * Semua nilai dikembalikan sudah dibatasi panjang dan tervalidasi.
 */

export const OFFICIAL_CATEGORIES = [
  'KEPALA_DESA',
  'SEKRETARIAT',
  'KASI',
  'KAUR',
  'RT_RW',
  'LAINNYA',
];

export const DATA_STATUSES = ['UNVERIFIED', 'PARTIAL', 'VERIFIED'];

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function integer(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function photoRef(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = text(value, 500);
  if (!raw) return { ok: true, value: null };
  if (raw.startsWith('/') && !raw.startsWith('//')) return { ok: true, value: raw };
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return { ok: true, value: url.toString() };
  } catch {
    /* ditangani di bawah */
  }
  return { ok: false, error: 'Foto harus berupa path "/..." atau URL https' };
}

function sourceRef(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = text(value, 500);
  if (!raw) return { ok: true, value: null };
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') return { ok: true, value: url.toString() };
  } catch {
    /* ditangani di bawah */
  }
  return { ok: false, error: 'Sumber harus berupa URL http(s) yang valid' };
}

function dateOrNull(value: unknown): Date | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) return 'invalid';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

// ---------------------------------------------------------------------------
// Perangkat desa
// ---------------------------------------------------------------------------

export interface OfficialInput {
  name: string;
  position: string;
  category: string;
  level: number;
  order: number;
  area: string | null;
  period: string | null;
  photo: string | null;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: Date | null;
  archivedAt: Date | null;
}

type ExistingOfficial = {
  name: string;
  position: string;
  category: string;
  level: number;
  order: number;
  area: string | null;
  period: string | null;
  photo: string | null;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: Date | null;
  archivedAt: Date | null;
};

export function parseOfficialInput(
  body: Record<string, unknown>,
  existing?: ExistingOfficial | null
):
  | { ok: true; data: OfficialInput }
  | { ok: false; error: string } {
  const name = text(body.name, 120) ?? existing?.name ?? null;
  const position = text(body.position, 120) ?? existing?.position ?? null;
  if (!name || name.length < 2) return { ok: false, error: 'Nama wajib diisi (minimal 2 karakter)' };
  if (!position || position.length < 2) return { ok: false, error: 'Jabatan wajib diisi (minimal 2 karakter)' };

  const category = String(body.category ?? existing?.category ?? 'LAINNYA').toUpperCase();
  if (!OFFICIAL_CATEGORIES.includes(category)) {
    return { ok: false, error: 'Kategori jabatan tidak valid' };
  }

  const photo = photoRef(body.photo !== undefined ? body.photo : existing?.photo ?? null);
  if (!photo.ok) return { ok: false, error: photo.error };

  const source = sourceRef(body.sourceUrl !== undefined ? body.sourceUrl : existing?.sourceUrl ?? null);
  if (!source.ok) return { ok: false, error: source.error };

  const isActive = booleanOr(body.isActive, existing?.isActive ?? true);
  const isVerified = booleanOr(body.isVerified, existing?.isVerified ?? false);

  let verifiedAt =
    body.verifiedAt !== undefined ? dateOrNull(body.verifiedAt) : existing?.verifiedAt ?? null;
  if (verifiedAt === 'invalid') return { ok: false, error: 'Tanggal verifikasi tidak valid' };
  if (isVerified && !verifiedAt) verifiedAt = new Date();
  if (!isVerified) verifiedAt = null;

  // Arsip = tidak aktif. Histori tetap tersimpan; tidak pernah dihapus.
  const archivedAt = isActive ? null : existing?.archivedAt ?? new Date();

  return {
    ok: true,
    data: {
      name: name.slice(0, 120),
      position: position.slice(0, 120),
      category,
      level: integer(body.level, 0, 20, existing?.level ?? 1),
      order: integer(body.order, 0, 9999, existing?.order ?? 0),
      area: text(body.area, 200) ?? (body.area === '' ? null : existing?.area ?? null),
      period: text(body.period, 100) ?? (body.period === '' ? null : existing?.period ?? null),
      photo: photo.value,
      isActive,
      isVerified,
      sourceUrl: source.value,
      verifiedAt: verifiedAt as Date | null,
      archivedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Layanan desa
// ---------------------------------------------------------------------------

export interface ServiceInput {
  name: string;
  description: string | null;
  requirements: string | null;
  procedure: string | null;
  schedule: string | null;
  contact: string | null;
  link: string | null;
  order: number;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: Date | null;
}

type ExistingService = {
  name: string;
  description: string | null;
  requirements: string | null;
  procedure: string | null;
  schedule: string | null;
  contact: string | null;
  link: string | null;
  order: number;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: Date | null;
};

export function parseServiceInput(
  body: Record<string, unknown>,
  existing?: ExistingService | null
): { ok: true; data: ServiceInput } | { ok: false; error: string } {
  const name = text(body.name, 140) ?? existing?.name ?? null;
  if (!name || name.length < 3) return { ok: false, error: 'Nama layanan wajib diisi (minimal 3 karakter)' };

  const linkRaw = text(body.link, 500) ?? (body.link === '' ? null : existing?.link ?? null);
  let link: string | null = null;
  if (linkRaw) {
    if (linkRaw.startsWith('/') && !linkRaw.startsWith('//')) {
      link = linkRaw;
    } else {
      try {
        const url = new URL(linkRaw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
        link = url.toString();
      } catch {
        return { ok: false, error: 'Tautan layanan harus path "/..." atau URL http(s)' };
      }
    }
  }

  const source = sourceRef(body.sourceUrl !== undefined ? body.sourceUrl : existing?.sourceUrl ?? null);
  if (!source.ok) return { ok: false, error: source.error };

  const isActive = booleanOr(body.isActive, existing?.isActive ?? true);
  const isVerified = booleanOr(body.isVerified, existing?.isVerified ?? false);

  let verifiedAt =
    body.verifiedAt !== undefined ? dateOrNull(body.verifiedAt) : existing?.verifiedAt ?? null;
  if (verifiedAt === 'invalid') return { ok: false, error: 'Tanggal verifikasi tidak valid' };
  if (isVerified && !verifiedAt) verifiedAt = new Date();
  if (!isVerified) verifiedAt = null;

  return {
    ok: true,
    data: {
      name,
      description: text(body.description, 3000) ?? (body.description === '' ? null : existing?.description ?? null),
      requirements: text(body.requirements, 4000) ?? (body.requirements === '' ? null : existing?.requirements ?? null),
      procedure: text(body.procedure, 5000) ?? (body.procedure === '' ? null : existing?.procedure ?? null),
      schedule: text(body.schedule, 500) ?? (body.schedule === '' ? null : existing?.schedule ?? null),
      contact: text(body.contact, 300) ?? (body.contact === '' ? null : existing?.contact ?? null),
      link,
      order: integer(body.order, 0, 9999, existing?.order ?? 0),
      isActive,
      isVerified,
      sourceUrl: source.value,
      verifiedAt: verifiedAt as Date | null,
    },
  };
}

// ---------------------------------------------------------------------------
// Pengumuman
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_TARGETS = ['ALL', 'CITIZEN', 'OFFICER'] as const;
export type AnnouncementTarget = (typeof ANNOUNCEMENT_TARGETS)[number];

export const ANNOUNCEMENT_TARGET_LABELS: Record<AnnouncementTarget, string> = {
  ALL: 'Masyarakat dan Petugas',
  CITIZEN: 'Masyarakat saja',
  OFFICER: 'Petugas saja',
};

/** Batas jumlah foto tambahan per pengumuman. */
export const MAX_ANNOUNCEMENT_PHOTOS = 5;

export interface AnnouncementInput {
  title: string;
  slug: string | null;
  content: string;
  excerpt: string | null;
  category: string | null;
  coverPhoto: string | null;
  photos: string[];
  target: AnnouncementTarget;
  notifyWhatsApp: boolean;
  isPublished: boolean;
  publishedAt: Date | null;
  validFrom: Date | null;
  validUntil: Date | null;
}

type ExistingAnnouncement = {
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  category?: string | null;
  coverPhoto?: string | null;
  photos?: string | null;
  target?: string | null;
  notifyWhatsApp?: boolean;
  isPublished: boolean;
  publishedAt: Date | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

/** Ambil daftar foto (array atau JSON string) dan validasi tiap entri. */
function photoList(value: unknown): { ok: true; value: string[] } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, value: [] };
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value);
    } catch {
      return { ok: false, error: 'Daftar foto tidak valid' };
    }
  }
  if (!Array.isArray(raw)) return { ok: false, error: 'Daftar foto tidak valid' };
  if (raw.length > MAX_ANNOUNCEMENT_PHOTOS) {
    return { ok: false, error: `Maksimal ${MAX_ANNOUNCEMENT_PHOTOS} foto tambahan` };
  }
  const out: string[] = [];
  for (const item of raw) {
    const ref = photoRef(item);
    if (!ref.ok) return { ok: false, error: ref.error };
    if (ref.value && !out.includes(ref.value)) out.push(ref.value);
  }
  return { ok: true, value: out };
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

export function parseAnnouncementInput(
  body: Record<string, unknown>,
  existing?: ExistingAnnouncement | null
): { ok: true; data: AnnouncementInput } | { ok: false; error: string } {
  const title = text(body.title, 200) ?? existing?.title ?? null;
  const content = text(body.content, 20000) ?? existing?.content ?? null;
  if (!title || title.length < 3) return { ok: false, error: 'Judul wajib diisi (minimal 3 karakter)' };
  if (!content || content.length < 10) return { ok: false, error: 'Isi pengumuman wajib diisi (minimal 10 karakter)' };

  const isPublished = booleanOr(body.isPublished, existing?.isPublished ?? false);

  let publishedAt =
    body.publishedAt !== undefined ? dateOrNull(body.publishedAt) : existing?.publishedAt ?? null;
  if (publishedAt === 'invalid') return { ok: false, error: 'Tanggal publikasi tidak valid' };
  if (isPublished && !publishedAt) publishedAt = new Date();

  let validFrom =
    body.validFrom !== undefined ? dateOrNull(body.validFrom) : existing?.validFrom ?? null;
  if (validFrom === 'invalid') return { ok: false, error: 'Tanggal mulai berlaku tidak valid' };

  let validUntil =
    body.validUntil !== undefined ? dateOrNull(body.validUntil) : existing?.validUntil ?? null;
  if (validUntil === 'invalid') return { ok: false, error: 'Tanggal akhir berlaku tidak valid' };

  if (validFrom && validUntil && validUntil.getTime() < validFrom.getTime()) {
    return { ok: false, error: 'Tanggal akhir berlaku tidak boleh lebih awal daripada tanggal mulai' };
  }
  // Bila hanya akhir yang diisi, mulai dianggap saat ini (agar rentang tetap logis).
  if (validUntil && !validFrom) validFrom = new Date();

  const explicitSlug = text(body.slug, 90);
  const slug = explicitSlug ? slugify(explicitSlug) : existing?.slug ?? null;

  const cover = photoRef(body.coverPhoto !== undefined ? body.coverPhoto : existing?.coverPhoto ?? null);
  if (!cover.ok) return { ok: false, error: cover.error };

  const photos = photoList(body.photos !== undefined ? body.photos : existing?.photos ?? null);
  if (!photos.ok) return { ok: false, error: photos.error };

  const targetRaw = String(body.target ?? existing?.target ?? 'ALL').toUpperCase();
  const target = (ANNOUNCEMENT_TARGETS as readonly string[]).includes(targetRaw)
    ? (targetRaw as AnnouncementTarget)
    : 'ALL';

  const notifyWhatsApp = booleanOr(body.notifyWhatsApp, existing?.notifyWhatsApp ?? false);

  const category = text(body.category, 40) ?? (body.category === '' ? null : existing?.category ?? null);

  const excerpt =
    text(body.excerpt, 300) ??
    (body.excerpt === '' ? null : existing?.excerpt ?? null) ??
    content.replace(/\s+/g, ' ').slice(0, 180) + (content.length > 180 ? '…' : '');

  return {
    ok: true,
    data: {
      title,
      slug,
      content,
      excerpt,
      category,
      coverPhoto: cover.value,
      photos: photos.value,
      target,
      notifyWhatsApp,
      isPublished,
      publishedAt: publishedAt as Date | null,
      validFrom: validFrom as Date | null,
      validUntil: validUntil as Date | null,
    },
  };
}

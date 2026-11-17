import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAdminAction } from '@/lib/auditLog';
import {
  badRequest,
  parseDateOrNull,
  readJson,
  requireAdmin,
} from '@/lib/adminApi';
import {
  VILLAGE_FALLBACK,
  missingProfileFields,
  normalizeEmbedUrl,
  normalizeMapLink,
  optionalCoordinate,
  optionalText,
  requiredText,
} from '@/lib/village';

export const dynamic = 'force-dynamic';

const DATA_STATUSES = ['UNVERIFIED', 'PARTIAL', 'VERIFIED'];

function normalizePhoto(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = optionalText(value, 500);
  if (!raw) return { ok: true, value: null };
  if (raw.startsWith('/') && !raw.startsWith('//')) return { ok: true, value: raw };
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return { ok: true, value: url.toString() };
  } catch {
    /* ditangani di bawah */
  }
  return { ok: false, error: 'Path/foto harus diawali "/" atau berupa URL https' };
}

function normalizeSource(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = optionalText(value, 500);
  if (!raw) return { ok: true, value: null };
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' || url.protocol === 'http:') return { ok: true, value: url.toString() };
  } catch {
    /* ditangani di bawah */
  }
  return { ok: false, error: 'Sumber harus berupa URL http(s) yang valid' };
}

// GET /api/admin/village/profile — baca profil untuk form Admin.
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const profile = await prisma.villageProfile.findUnique({ where: { id: 'singleton' } });
    return NextResponse.json({
      success: true,
      profile,
      identity: VILLAGE_FALLBACK,
      missingFields: missingProfileFields(profile),
    });
  } catch (error) {
    console.error('[GET /api/admin/village/profile]', error);
    return NextResponse.json({ error: 'Gagal membaca profil desa' }, { status: 500 });
  }
}

// PUT /api/admin/village/profile — perbarui profil desa (ADMIN only).
export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await readJson(request);

  const name = requiredText(body.name, 120) || VILLAGE_FALLBACK.name;
  const district = requiredText(body.district, 120) || VILLAGE_FALLBACK.district;
  const regency = requiredText(body.regency, 120) || VILLAGE_FALLBACK.regency;
  const province = requiredText(body.province, 120) || VILLAGE_FALLBACK.province;
  const postalCode = optionalText(body.postalCode, 10);
  const address = optionalText(body.address, 500);
  const phone = optionalText(body.phone, 40);
  const email = optionalText(body.email, 160);
  const coordinateSource = optionalText(body.coordinateSource, 300);
  const history = optionalText(body.history, 6000);
  const geography = optionalText(body.geography, 6000);
  const potential = optionalText(body.potential, 6000);
  const demographics = optionalText(body.demographics, 6000);
  const vision = optionalText(body.vision, 4000);
  const mission = optionalText(body.mission, 6000);
  const serviceHours = optionalText(body.serviceHours, 1000);
  const dataStatus = String(body.dataStatus || 'UNVERIFIED').toUpperCase();

  if (postalCode && !/^\d{4,6}$/.test(postalCode)) {
    return badRequest('Kode pos harus berupa 4-6 angka');
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest('Format email resmi tidak valid');
  }
  if (!DATA_STATUSES.includes(dataStatus)) {
    return badRequest('Status data tidak valid');
  }

  const mapLink = normalizeMapLink(body.mapLink);
  if (!mapLink.ok) return badRequest(mapLink.error);

  const embed = normalizeEmbedUrl(body.mapEmbedUrl);
  if (!embed.ok) return badRequest(embed.error);

  const lat = optionalCoordinate(body.latitude, -90, 90);
  const lng = optionalCoordinate(body.longitude, -180, 180);
  if (lat === 'invalid') return badRequest('Latitude harus antara -90 dan 90');
  if (lng === 'invalid') return badRequest('Longitude harus antara -180 dan 180');

  const photo = normalizePhoto(body.heroPhoto);
  if (!photo.ok) return badRequest(photo.error);

  const source = normalizeSource(body.sourceUrl);
  if (!source.ok) return badRequest(source.error);
  const historySource = normalizeSource(body.historySource);
  if (!historySource.ok) return badRequest(historySource.error);

  let verifiedAt = parseDateOrNull(body.verifiedAt);
  if (verifiedAt === 'invalid') return badRequest('Tanggal verifikasi tidak valid');
  if (dataStatus === 'VERIFIED' && !verifiedAt) verifiedAt = new Date();
  if (dataStatus !== 'VERIFIED') verifiedAt = null;

  const data = {
    name,
    district,
    regency,
    province,
    postalCode,
    address,
    phone,
    email,
    mapLink: mapLink.value,
    mapEmbedUrl: embed.value,
    latitude: lat,
    longitude: lng,
    coordinateSource,
    heroPhoto: photo.value,
    history,
    historySource: historySource.value,
    geography,
    potential,
    demographics,
    vision,
    mission,
    serviceHours,
    dataStatus,
    sourceUrl: source.value,
    verifiedAt: verifiedAt as Date | null,
    updatedBy: auth.session.userId,
  };

  try {
    const profile = await prisma.villageProfile.upsert({
      where: { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...data },
    });

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'UPDATE_VILLAGE_PROFILE',
      notes: `Profil desa diperbarui (status data: ${dataStatus})`,
    });

    return NextResponse.json({
      success: true,
      message: 'Profil desa berhasil disimpan.',
      profile,
      missingFields: missingProfileFields(profile),
    });
  } catch (error) {
    console.error('[PUT /api/admin/village/profile]', error);
    return NextResponse.json({ error: 'Gagal menyimpan profil desa' }, { status: 500 });
  }
}

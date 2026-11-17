/**
 * MASTER DATA WILAYAH (RW/RT) — satu sumber kebenaran.
 *
 * Prinsip:
 * - Wilayah bukan role. Warga tetap `CITIZEN`; data wilayah hanya tautan
 *   administratif (RT → RW) yang dipakai registrasi, profil, dan statistik.
 * - Registrasi hanya boleh memilih RT yang AKTIF dan berada di RW yang AKTIF.
 * - Tidak ada penghapusan permanen: wilayah dinonaktifkan (`isActive=false`).
 */

import type { VillageRt, VillageRw } from '@prisma/client';
import { prisma } from './prisma';

export interface PublicRt {
  id: string;
  number: string;
  name: string | null;
}
export interface PublicRw {
  id: string;
  number: string;
  name: string | null;
  rts: PublicRt[];
}

export interface AdminRt extends PublicRt {
  isActive: boolean;
  order: number;
  userCount: number;
}
export interface AdminRw {
  id: string;
  number: string;
  name: string | null;
  isActive: boolean;
  order: number;
  userCount: number;
  rts: AdminRt[];
}

/** Daftar RW+RT aktif untuk formulir publik/registrasi (tanpa data pribadi). */
export async function getActiveRegions(): Promise<PublicRw[]> {
  const rws = await prisma.villageRw.findMany({
    where: { isActive: true },
    orderBy: [{ order: 'asc' }, { number: 'asc' }],
    include: {
      rts: {
        where: { isActive: true },
        orderBy: [{ order: 'asc' }, { number: 'asc' }],
        select: { id: true, number: true, name: true },
      },
    },
  });
  return rws
    .map((rw) => ({ id: rw.id, number: rw.number, name: rw.name, rts: rw.rts }))
    .filter((rw) => rw.rts.length > 0);
}

/** Daftar lengkap untuk Admin (termasuk yang nonaktif + jumlah warga). */
export async function getAllRegions(): Promise<AdminRw[]> {
  const rws = await prisma.villageRw.findMany({
    orderBy: [{ order: 'asc' }, { number: 'asc' }],
    include: {
      rts: {
        orderBy: [{ order: 'asc' }, { number: 'asc' }],
        include: { _count: { select: { users: true } } },
      },
      _count: { select: { rts: true } },
    },
  });
  return rws.map((rw) => {
    const rts: AdminRt[] = rw.rts.map((rt) => ({
      id: rt.id,
      number: rt.number,
      name: rt.name,
      isActive: rt.isActive,
      order: rt.order,
      userCount: rt._count.users,
    }));
    return {
      id: rw.id,
      number: rw.number,
      name: rw.name,
      isActive: rw.isActive,
      order: rw.order,
      userCount: rts.reduce((sum, rt) => sum + rt.userCount, 0),
      rts,
    };
  });
}

/**
 * Validasi pilihan RT saat registrasi/ubah profil.
 * Menolak RT yang tidak ada, nonaktif, atau berada di RW nonaktif.
 */
export async function validateRtSelection(
  rtId: unknown
): Promise<
  | { ok: true; rt: (VillageRt & { rw: VillageRw }) | null }
  | { ok: false; error: string }
> {
  if (rtId === null || rtId === undefined || rtId === '') return { ok: true, rt: null };
  if (typeof rtId !== 'string' || rtId.length > 60) {
    return { ok: false, error: 'Pilihan RT/RW tidak valid' };
  }
  const rt = await prisma.villageRt.findUnique({
    where: { id: rtId },
    include: { rw: true },
  });
  if (!rt || !rt.isActive || !rt.rw.isActive) {
    return { ok: false, error: 'RT/RW yang dipilih tidak tersedia atau tidak aktif' };
  }
  return { ok: true, rt };
}

export function regionLabel(rt: { number: string; rw: { number: string } } | null | undefined): string | null {
  if (!rt) return null;
  return `RT ${rt.number} / RW ${rt.rw.number}`;
}

/** Normalisasi nomor wilayah: digit saja, 1–3 angka, tanpa nol di depan yang berlebihan. */
export function normalizeRegionNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  // Nomor wilayah harus >= 1 (menolak "0"/"00" yang tidak bermakna).
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, '0').slice(0, 3);
}

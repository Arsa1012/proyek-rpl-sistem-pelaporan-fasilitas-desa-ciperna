import { NextResponse } from 'next/server';
import { getSession } from './auth';

export type AdminSession = { userId: string; role: 'ADMIN' };

/**
 * Otorisasi server-side untuk seluruh endpoint pengelolaan Portal Desa.
 * Jangan pernah mengandalkan penyembunyian menu di frontend.
 */
export async function requireAdmin(): Promise<
  { ok: true; session: AdminSession } | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 }) };
  }
  if (session.role !== 'ADMIN') {
    return { ok: false, response: NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 }) };
  }
  return { ok: true, session: { userId: session.userId, role: 'ADMIN' } };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = 'Data tidak ditemukan') {
  return NextResponse.json({ error: message }, { status: 404 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

/** Batas aman agar input tidak membebani database. */
export function clampInt(value: unknown, min: number, max: number, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function parseDateOrNull(value: unknown): Date | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) return 'invalid';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

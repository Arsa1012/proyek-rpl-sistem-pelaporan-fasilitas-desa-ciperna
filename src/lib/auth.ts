import { SignJWT, jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const secretKey = process.env.JWT_SECRET;
if (!secretKey) {
  throw new Error('JWT_SECRET environment variable is required. Set it in .env file.');
}
const key = new TextEncoder().encode(secretKey);

export interface SessionPayload {
  userId: string;
  role: 'CITIZEN' | 'ADMIN' | 'OFFICER';
  email: string;
  /**
   * Status akun terkini dari database (bukan dari JWT). `false` berarti akun
   * dinonaktifkan Admin: tetap boleh login & membaca data, tetapi API fitur
   * utama (mis. membuat laporan / memulai tugas) menolaknya.
   */
  isActive?: boolean;
  /** Alasan penonaktifan (diisi Admin), untuk banner & jawaban asisten. */
  suspendReason?: string | null;
}

/**
 * Susun payload sesi dari baris pengguna di database.
 *
 * Penting: status akun (isActive) dan alasan penonaktifan ikut dibawa ke
 * dalam sesi. Tanpa ini, guard API (`session.isActive === false`) tidak
 * pernah terpicu dan akun yang sudah dinonaktifkan Admin masih dapat
 * memakai fitur utama sampai cookie-nya kedaluwarsa.
 *
 * Akun nonaktif TIDAK ditolak saat login: pengguna tetap boleh masuk dan
 * membaca data, hanya fitur (buat laporan/mulai tugas) yang diblokir.
 */
export function buildSessionPayload(user: {
  id: string;
  email: string;
  role: string;
  isActive?: boolean | null;
  suspendReason?: string | null;
}): SessionPayload {
  return {
    userId: user.id,
    email: user.email,
    role: user.role as 'CITIZEN' | 'ADMIN' | 'OFFICER',
    isActive: user.isActive ?? true,
    suspendReason: user.suspendReason ?? null,
  };
}

export async function encrypt(payload: SessionPayload, expiresIn: string | number = '24h') {
  return await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

export async function decrypt(input: string, cookieValue?: string): Promise<SessionPayload | null> {
  try {
    const value = cookieValue || input;
    const { payload } = await jwtVerify(value, key, {
      algorithms: ['HS256'],
    });
    return payload as unknown as SessionPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Ambil session dari cookie request.
 * Digunakan oleh API routes dan Server Components.
 * @param req NextRequest opsional - jika tidak diberikan, session akan dicari dari cookie yang sudah ada
 */
export async function getSession(req?: NextRequest): Promise<SessionPayload | null> {
  try {
    const sessionCookie = req
      ? req.cookies.get('session')?.value
      : cookies().get('session')?.value;

    if (!sessionCookie) return null;
    return await decrypt(sessionCookie);
  } catch {
    return null;
  }
}

/**
 * Auth untuk Client Component.
 *
 * File ini TIDAK mengimpor next/headers, sehingga aman digunakan di
 * komponen dengan "use client". Session dibaca langsung dari document.cookie.
 */

export interface SessionPayload {
  userId: string;
  role: 'CITIZEN' | 'ADMIN' | 'OFFICER';
  email: string;
  isActive?: boolean;
  suspendReason?: string | null;
}

/**
 * Ambil nilai cookie dari document.cookie (client-side).
 */
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp('(^| )' + name + '=([^;]+)')
  );
  return match ? match[2] : null;
}

/**
 * Ambil session dari cookie klien.
 * Digunakan oleh Client Component yang memerlukan data session.
 */
export async function getSessionClient(): Promise<SessionPayload | null> {
  try {
    const token = getCookie('session');
    if (!token) return null;

    // Dekripsi JWT sisi klien menggunakan base64 decode sederhana
    // (tidak memverifikasi signatur, hanya membaca payload untuk UI)
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payloadJson = decodeURIComponent(
      atob(payloadBase64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const payload = JSON.parse(payloadJson) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

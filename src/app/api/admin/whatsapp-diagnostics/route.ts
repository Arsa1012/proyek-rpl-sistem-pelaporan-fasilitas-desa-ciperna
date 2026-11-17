import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  FONNTE_HOST,
  FONNTE_PORT,
  runConnectivityDiagnostics,
} from '@/lib/whatsappDiagnostics';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // real-time, tidak cache

/**
 * GET /api/admin/whatsapp-diagnostics — diagnostik koneksi Fonnte (ADMIN only).
 *
 * Sifat penting:
 * - TIDAK mengirim pesan WhatsApp dan TIDAK melakukan HTTP POST ke Fonnte.
 * - Host yang diperiksa KONSTAN (api.fonnte.com); tidak menerima hostname dari request.
 * - Tidak pernah mengembalikan token, header Authorization, atau data internal.
 * - Tidak mengubah database.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const diagnostics = await runConnectivityDiagnostics(FONNTE_HOST, FONNTE_PORT);

    return NextResponse.json({
      success: true,
      diagnostics,
    });
  } catch (error) {
    console.error('[GET /api/admin/whatsapp-diagnostics]', error);
    return NextResponse.json(
      { error: 'Diagnostik tidak dapat dijalankan saat ini.' },
      { status: 500 }
    );
  }
}

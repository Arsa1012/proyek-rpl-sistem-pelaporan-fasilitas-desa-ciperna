import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { runAiDiagnostics } from '@/lib/aiTools';

export const dynamic = 'force-dynamic';

// GET /api/admin/ai/diagnostics — diagnostik READ-ONLY khusus ADMIN/development.
// Memeriksa apakah AI dapat membaca setiap domain data yang diizinkan, berapa
// jumlah hasilnya, dan domain mana yang gagal. Tidak mengekspos stack trace,
// SQL, token, atau detail infrastruktur. Tidak tersedia untuk masyarakat umum.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }
  try {
    const report = await runAiDiagnostics();
    return NextResponse.json({ success: true, ...report });
  } catch {
    return NextResponse.json({ error: 'Diagnostik gagal dijalankan.' }, { status: 500 });
  }
}

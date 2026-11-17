import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { reevaluateDuplicateFlags } from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

// POST /api/admin/duplicates/revalidate — hitung ulang kandidat duplikat dengan
// algoritma terbaru. ADMIN only. Non-destruktif: tidak menghapus laporan, dan
// setiap perubahan dicatat pada riwayat status laporan.
export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const result = await reevaluateDuplicateFlags();
    console.log(
      `[duplicates] revalidate admin=${session.userId.slice(0, 8)} checked=${result.checked} kept=${result.kept} cleared=${result.cleared}`
    );

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[POST /api/admin/duplicates/revalidate]', error);
    return NextResponse.json({ error: 'Gagal memvalidasi ulang kandidat duplikat' }, { status: 500 });
  }
}

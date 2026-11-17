import { NextResponse } from 'next/server';
import { getActiveRegions } from '@/lib/region';

export const dynamic = 'force-dynamic';

// GET /api/regions — daftar RW + RT AKTIF untuk formulir publik (registrasi).
// Tidak memuat data pribadi warga. Bila belum ada data, mengembalikan array kosong
// sehingga frontend menampilkan pesan yang jelas (bukan pilihan palsu).
export async function GET() {
  try {
    const rws = await getActiveRegions();
    return NextResponse.json({ success: true, rws });
  } catch (error) {
    console.error('[GET /api/regions]', error);
    return NextResponse.json({ error: 'Gagal memuat data wilayah' }, { status: 500 });
  }
}

import { prisma } from '@/lib/prisma';
import { StatsBand, type PublicStat } from './StatsBand';

/**
 * Statistik publik — SEMUA angka berasal dari database (tidak ada angka
 * hardcode). Hanya menghitung agregat, tidak pernah menampilkan data pelapor.
 */
async function getStats(): Promise<PublicStat[] | null> {
  try {
    const [total, completed, processing, categories] = await Promise.all([
      prisma.report.count(),
      prisma.report.count({ where: { status: 'COMPLETED' } }),
      prisma.report.count({ where: { status: { in: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS'] } } }),
      prisma.report.groupBy({ by: ['category'], _count: { id: true } }),
    ]);
    return [
      { value: total, label: 'Total Laporan' },
      { value: processing, label: 'Laporan Diproses' },
      { value: completed, label: 'Laporan Selesai' },
      { value: categories.length, label: 'Kategori Fasilitas' },
    ];
  } catch {
    return null;
  }
}

export async function Stats() {
  const stats = await getStats();
  return <StatsBand stats={stats} error={stats === null} />;
}

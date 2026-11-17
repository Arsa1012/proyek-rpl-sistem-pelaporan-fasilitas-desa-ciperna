import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { BarChart, DonutChart, HorizontalBar, LineChart } from '@/components/ui/Charts';
import { REPORT_STATUS_COLORS, REPORT_STATUS_LABELS } from '@/lib/status';

export default async function AdminStatistikPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const [
    statusCounts,
    categoryCounts,
    severityCounts,
    monthlyData,
    locationData,
  ] = await Promise.all([
    prisma.report.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.report.groupBy({
      by: ['category'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 8,
    }),
    prisma.report.groupBy({
      by: ['severity'],
      _count: { id: true },
      where: { severity: { not: null } },
    }),
    prisma.$queryRaw<{ month: string; count: number }[]>`
      SELECT
        strftime('%Y-%m', createdAt) as month,
        COUNT(*) as count
      FROM Report
      WHERE createdAt >= datetime('now', '-6 months')
      GROUP BY month
      ORDER BY month ASC
    `,
    prisma.report.groupBy({
      by: ['location'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of statusCounts) {
    statusMap[s.status] = s._count.id;
  }

  const total = Object.values(statusMap).reduce((a, b) => a + b, 0);

  const STATUS_COLORS: Record<string, string> = {
    ...REPORT_STATUS_COLORS,
  };

  const STATUS_LABELS: Record<string, string> = {
    ...REPORT_STATUS_LABELS,
  };

  const SEVERITY_COLORS: Record<string, string> = {
    RENDAH: 'var(--severity-low)',
    SEDANG: 'var(--severity-medium)',
    TINGGI: 'var(--severity-high)',
    KRITIS: 'var(--severity-critical)',
  };

  const months = (monthlyData as { month: string; count: number | bigint }[]).map((m) => ({
    month: m.month,
    count: Number(m.count),
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Statistik & Laporan</h2>
          <p>Visualisasi data laporan secara menyeluruh.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="glass card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Total Laporan</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{total}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Laporan Baru</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{statusMap['SUBMITTED'] || 0}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--warning-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Menunggu Verifikasi</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{statusMap['VERIFIED'] || 0}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--cyan-text)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Sedang Diproses</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--cyan-text)' }}>{(statusMap['ASSIGNED'] || 0) + (statusMap['IN_PROGRESS'] || 0)}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--success-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Selesai</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{statusMap['COMPLETED'] || 0}</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="dashboard-charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📊 Status Laporan</h3>
          <DonutChart
            data={Object.entries(statusMap).map(([status, count]) => ({
              label: STATUS_LABELS[status] || status,
              value: count,
              color: STATUS_COLORS[status] || 'var(--text-secondary)',
            }))}
          />
        </div>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📈 Laporan per Bulan</h3>
          <LineChart
            data={months.map(m => ({ label: m.month, value: m.count }))}
          />
        </div>
      </div>

      <div className="dashboard-charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>🏷️ Kategori Fasilitas</h3>
          <HorizontalBar
            data={categoryCounts.map(c => ({
              label: c.category || 'Tidak Terkategori',
              value: c._count.id,
            }))}
          />
        </div>
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📍 Lokasi Terbanyak</h3>
          <HorizontalBar
            data={locationData
              .filter(l => l.location)
              .slice(0, 8)
              .map(l => ({
                label: l.location,
                value: l._count.id,
              }))}
          />
        </div>
      </div>
    </div>
  );
}

import { PrismaClient } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

const prisma = new PrismaClient();

export default async function CitizenDashboard() {
  const session = await getSession();
  if (!session) return null;

  const userId = session.userId;

  const totalReports = await prisma.report.count({ where: { userId } });
  const activeReports = await prisma.report.count({ 
    where: { userId, status: { in: ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'] } }
  });
  const completedReports = await prisma.report.count({ where: { userId, status: 'COMPLETED' } });

  const recentReports = await prisma.report.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Ringkasan Laporan Anda</h2>
          <p>Pantau status laporan fasilitas umum yang Anda kirimkan.</p>
        </div>
        <Link href="/dashboard/reports/new" className="btn btn-primary">
          Buat Laporan
        </Link>
      </div>

      <div className="stat-grid">
        <Card title="Total Laporan" value={totalReports} />
        <Card title="Laporan Aktif" value={activeReports} description="Sedang diproses" />
        <Card title="Selesai" value={completedReports} description="Masalah teratasi" />
      </div>

      <div className="glass" style={{ padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Laporan Terbaru</h3>
        {recentReports.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Judul</th>
                  <th>Lokasi</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.map(report => (
                  <tr key={report.id}>
                    <td>{new Date(report.createdAt).toLocaleDateString('id-ID')}</td>
                    <td>{report.title}</td>
                    <td>{report.location}</td>
                    <td><Badge status={report.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>Belum ada laporan yang dibuat.</p>
        )}
      </div>
    </div>
  );
}

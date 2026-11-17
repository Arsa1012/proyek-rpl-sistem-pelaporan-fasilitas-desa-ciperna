import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

export default async function MasyarakatLaporanPage() {
  const session = await getSession();
  if (!session) return null;

  const reports = await prisma.report.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Laporan Saya</h2>
          <p>Semua laporan yang pernah Anda kirimkan — buka &quot;Detail&quot; untuk melacak status terbaru.</p>
        </div>
        <Link href="/masyarakat/laporan/create" className="btn btn-primary">
          Buat Laporan Baru
        </Link>
      </div>

      <div className="glass" style={{ overflow: 'hidden' }}>
        {reports.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Judul</th>
                  <th>Kategori</th>
                  <th>Lokasi</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {reports.map(report => (
                  <tr key={report.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(report.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ fontWeight: 500 }}>{report.title}</td>
                    <td>{report.category || '—'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{report.location}</td>
                    <td><Badge status={report.status} /></td>
                    <td>
                      <Link
                        href={`/masyarakat/laporan/${report.id}`}
                        className="btn btn-soft"
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</p>
            <p>Belum ada laporan. Klik &quot;Buat Laporan Baru&quot; untuk mulai melaporkan.</p>
          </div>
        )}
      </div>
    </div>
  );
}

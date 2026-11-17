import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

export default async function PetugasRiwayatPage() {
  const session = await getSession();
  if (!session || session.role !== 'OFFICER') redirect('/login');

  const officerId = session.userId;

  const completedAssignments = await prisma.assignment.findMany({
    where: { officerId, completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
    include: {
      report: {
        select: {
          id: true,
          title: true,
          location: true,
          status: true,
          category: true,
          severity: true,
        },
      },
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Riwayat Tugas</h2>
          <p>Semua tugas yang telah Anda selesaikan.</p>
        </div>
      </div>

      <div className="glass" style={{ overflow: 'hidden' }}>
        {completedAssignments.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📜</p>
            <p style={{ fontWeight: 500, fontSize: '1rem' }}>Belum ada riwayat tugas.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Tugas yang telah Anda selesaikan akan muncul di sini.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal Selesai</th>
                  <th>Laporan</th>
                  <th>Lokasi</th>
                  <th>Kategori</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {completedAssignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {assignment.completedAt
                        ? new Date(assignment.completedAt).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '—'}
                    </td>
                    <td>
                      <p style={{ fontWeight: 600, margin: 0, fontSize: '0.875rem' }}>
                        {assignment.report.title.length > 40
                          ? assignment.report.title.slice(0, 40) + '…'
                          : assignment.report.title}
                      </p>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>📍 {assignment.report.location}</td>
                    <td>{assignment.report.category || '—'}</td>
                    <td>
                      <Badge status={assignment.report.status} />
                    </td>
                    <td>
                      <Link
                        href={`/petugas/tugas/${assignment.id}`}
                        className="btn"
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}
                      >
                        Lihat Detail
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

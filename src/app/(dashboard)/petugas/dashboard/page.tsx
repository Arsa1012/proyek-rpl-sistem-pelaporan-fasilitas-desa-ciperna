import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

export default async function PetugasDashboard() {
  const session = await getSession();
  if (!session || session.role !== 'OFFICER') redirect('/login');

  const officer = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true },
  });

  if (!officer) redirect('/login');

  const officerId = session.userId;

  const totalAssignments = await prisma.assignment.count({ where: { officerId, cancelledAt: null } });
  const newAssignments = await prisma.assignment.count({
    where: { officerId, cancelledAt: null, report: { status: 'ASSIGNED' } },
  });
  const inProgressAssignments = await prisma.assignment.count({
    where: { officerId, cancelledAt: null, report: { status: 'IN_PROGRESS' } },
  });
  const completedAssignments = await prisma.assignment.count({
    where: { officerId, completedAt: { not: null } },
  });

  const assignments = await prisma.assignment.findMany({
    where: { officerId, cancelledAt: null },
    orderBy: { assignedAt: 'desc' },
    include: {
      report: {
        select: {
          id: true,
          title: true,
          location: true,
          status: true,
          category: true,
          severity: true,
          description: true,
          createdAt: true,
        },
      },
    },
  });

  const severityColor: Record<string, string> = {
    RENDAH: 'var(--severity-low)',
    SEDANG: 'var(--severity-medium)',
    TINGGI: 'var(--severity-high)',
    KRITIS: 'var(--severity-critical)',
  };
  const severityBg: Record<string, string> = {
    RENDAH: 'var(--severity-low-bg)',
    SEDANG: 'var(--severity-medium-bg)',
    TINGGI: 'var(--severity-high-bg)',
    KRITIS: 'var(--severity-critical-bg)',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Selamat Datang, {officer.name} 👋</h2>
          <p>Dashboard Petugas Lapangan Desa Ciperna. Kelola tugas penanganan fasilitas umum yang diberikan kepada Anda.</p>
          <p className="login-identity">Anda login sebagai <strong>Petugas</strong></p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="stat-grid reveal" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="glass card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Total Tugas</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{totalAssignments}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid #f59e0b' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Tugas Baru</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{newAssignments}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid #06b6d4' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Sedang Dikerjakan</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--cyan-text)' }}>{inProgressAssignments}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid #10b981' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Selesai</p>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{completedAssignments}</div>
        </div>
      </div>

      {/* Task List Table */}
      <div className="glass reveal" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--divider)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Daftar Tugas</h3>
        </div>
        {assignments.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📋</p>
            <p style={{ fontWeight: 500, fontSize: '1rem' }}>Belum ada tugas yang diberikan kepada Anda.</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Tugas baru akan muncul di sini setelah Admin melakukan penugasan.
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal Ditugaskan</th>
                  <th>Tanggal Laporan</th>
                  <th>Laporan</th>
                  <th>Lokasi</th>
                  <th>Severity</th>
                  <th>Status Laporan</th>
                  <th>Status Pekerjaan</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(assignment.assignedAt).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                      {new Date(assignment.report.createdAt).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      <p style={{ fontWeight: 600, margin: 0, fontSize: '0.875rem' }}>
                        {assignment.report.title.length > 40
                          ? assignment.report.title.slice(0, 40) + '…'
                          : assignment.report.title}
                      </p>
                      {assignment.report.category && (
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {assignment.report.category}
                        </p>
                      )}
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>📍 {assignment.report.location}</td>
                    <td>
                      {assignment.report.severity ? (
                        <span
                          className="ai-severity-badge"
                          style={{
                            background: severityBg[assignment.report.severity] || 'var(--muted-bg)',
                            color: severityColor[assignment.report.severity] || 'var(--text-secondary)',
                            fontSize: '0.75rem',
                          }}
                        >
                          {assignment.report.severity}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                    <td>
                      <Badge status={assignment.report.status} />
                    </td>
                    <td>
                      {assignment.completedAt || assignment.report.status === 'COMPLETED' ? (
                        <span
                          style={{
                            padding: '0.25rem 0.65rem',
                            borderRadius: '999px',
                            background: 'rgba(16,185,129,0.1)',
                            color: 'var(--success-text)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          ✓ Selesai
                        </span>
                      ) : assignment.report.status === 'IN_PROGRESS' ? (
                        <span
                          style={{
                            padding: '0.25rem 0.65rem',
                            borderRadius: '999px',
                            background: 'rgba(59,130,246,0.1)',
                            color: 'var(--primary-color)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          🔧 Sedang Dikerjakan
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: '0.25rem 0.65rem',
                            borderRadius: '999px',
                            background: 'rgba(245,158,11,0.1)',
                            color: 'var(--warning-text)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                          }}
                        >
                          ⏳ Menunggu Dimulai
                        </span>
                      )}
                    </td>
                    <td>
                      <Link
                        href={`/petugas/tugas/${assignment.id}`}
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
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

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';

export default async function OfficerDashboard({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'OFFICER') redirect('/login');

  const officerId = session.userId;
  const currentTab = searchParams?.status || 'all';

  // Kondisi query berdasarkan tab (penugasan yang dibatalkan tidak ditampilkan)
  const whereCondition: any = { officerId, cancelledAt: null };
  if (currentTab === 'active') {
    whereCondition.completedAt = null;
  } else if (currentTab === 'completed') {
    whereCondition.completedAt = { not: null };
  }

  const [totalAssignments, activeAssignments, completedAssignments, assignments] = await Promise.all([
    prisma.assignment.count({ where: { officerId, cancelledAt: null } }),
    prisma.assignment.count({ where: { officerId, completedAt: null, cancelledAt: null } }),
    prisma.assignment.count({ where: { officerId, completedAt: { not: null } } }),
    prisma.assignment.findMany({
      where: whereCondition,
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
          },
        },
      },
    }),
  ]);

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
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.25rem' }}>🔧 Tugas Lapangan Saya</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
          Kelola laporan dan alur perbaikan fasilitas umum yang ditugaskan kepada Anda
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4" style={{ marginBottom: '2rem' }}>
        <Link
          href="/officer"
          className="glass card"
          style={{
            borderLeft: '4px solid var(--primary-color)',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'transform 0.15s ease',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Total Penugasan</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{totalAssignments}</div>
        </Link>
        <Link
          href="/officer?status=active"
          className="glass card"
          style={{
            borderLeft: '4px solid #f59e0b',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'transform 0.15s ease',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Tugas Aktif</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{activeAssignments}</div>
        </Link>
        <Link
          href="/officer?status=completed"
          className="glass card"
          style={{
            borderLeft: '4px solid #10b981',
            textDecoration: 'none',
            color: 'inherit',
            transition: 'transform 0.15s ease',
          }}
        >
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Tugas Selesai</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{completedAssignments}</div>
        </Link>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Link
          href="/officer"
          className="btn"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            background: currentTab === 'all' ? 'var(--primary-color)' : 'var(--muted-bg)',
            color: currentTab === 'all' ? 'var(--on-accent-text, #fff)' : 'var(--text-secondary)',
            fontWeight: currentTab === 'all' ? 600 : 400,
          }}
        >
          Semua Tugas ({totalAssignments})
        </Link>
        <Link
          href="/officer?status=active"
          className="btn"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            background: currentTab === 'active' ? 'var(--severity-medium)' : 'var(--muted-bg)',
            color: currentTab === 'active' ? 'var(--on-accent-text, #1f2937)' : 'var(--text-secondary)',
            fontWeight: currentTab === 'active' ? 600 : 400,
          }}
        >
          ⏳ Tugas Aktif ({activeAssignments})
        </Link>
        <Link
          href="/officer?status=completed"
          className="btn"
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
            background: currentTab === 'completed' ? 'var(--severity-low)' : 'var(--muted-bg)',
            color: currentTab === 'completed' ? 'var(--on-accent-text, #fff)' : 'var(--text-secondary)',
            fontWeight: currentTab === 'completed' ? 600 : 400,
          }}
        >
          ✓ Tugas Selesai ({completedAssignments})
        </Link>
      </div>

      {/* Task List Table */}
      <div className="glass" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>
            {currentTab === 'active'
              ? 'Daftar Tugas Aktif'
              : currentTab === 'completed'
              ? 'Daftar Tugas Selesai'
              : 'Semua Daftar Tugas'}
          </h3>
        </div>

        {assignments.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              {currentTab === 'completed' ? '🎉' : '📋'}
            </p>
            <p style={{ fontWeight: 500, fontSize: '1rem' }}>
              {currentTab === 'active'
                ? 'Tidak ada tugas aktif saat ini.'
                : currentTab === 'completed'
                ? 'Belum ada tugas yang selesai.'
                : 'Belum ada tugas yang diberikan kepada Anda.'}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {currentTab === 'active'
                ? 'Semua tugas telah diselesaikan dengan baik!'
                : 'Tugas baru akan muncul di sini setelah Admin melakukan penugasan.'}
            </p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal Ditugaskan</th>
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
                        href={`/officer/tasks/${assignment.id}`}
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

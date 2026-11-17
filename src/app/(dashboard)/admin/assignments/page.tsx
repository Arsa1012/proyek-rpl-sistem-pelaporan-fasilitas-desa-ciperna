import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { CancelAssignmentButton } from '@/components/ui/CancelAssignmentButton';
import { ReviewButtons } from '@/components/ui/ReviewButtons';

export default async function AdminAssignmentsPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const assignments = await prisma.assignment.findMany({
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
        },
      },
      officer: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  // Pekerjaan yang menunggu persetujuan Admin (bukti sudah dikirim)
  const pendingReview = await prisma.assignment.findMany({
    where: { cancelledAt: null, completedAt: null, reviewStatus: 'PENDING', report: { status: 'REVIEW' } },
    orderBy: { assignedAt: 'desc' },
    include: {
      report: {
        select: {
          id: true,
          title: true,
          location: true,
          category: true,
          evidences: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
      officer: { select: { id: true, name: true } },
    },
  });

  const activeCount = assignments.filter(a => !a.completedAt && !a.cancelledAt).length;
  const completedCount = assignments.filter(a => a.completedAt).length;
  const cancelledCount = assignments.filter(a => a.cancelledAt && !a.completedAt).length;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ marginBottom: '0.25rem' }}>👷 Manajemen Penugasan</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
          Pantau dan kelola semua penugasan laporan kepada petugas lapangan
          {cancelledCount > 0 && (
            <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)' }}>
              • {cancelledCount} penugasan dibatalkan (tersimpan sebagai riwayat)
            </span>
          )}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4" style={{ marginBottom: '2rem' }}>
        <div className="glass card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Total Penugasan</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{assignments.length}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--severity-medium)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Aktif</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{activeCount}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--severity-low)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Selesai</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{completedCount}</div>
        </div>
      </div>

      {/* Menunggu Persetujuan */}
      <div className="glass" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--severity-medium)' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>🕐 Menunggu Persetujuan ({pendingReview.length})</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
          Bukti pengerjaan yang dikirim petugas. Periksa foto dan catatan sebelum menyetujui atau meminta perbaikan.
        </p>
        {pendingReview.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Tidak ada pekerjaan menunggu persetujuan.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pendingReview.map((a) => {
              const ev = a.report.evidences[0];
              return (
                <div key={a.id} className="glass" style={{ padding: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {ev && (
                    <img
                      src={ev.photo}
                      alt={`Bukti ${a.report.title}`}
                      style={{ width: '160px', height: '120px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <Link href={`/admin/laporan/${a.report.id}`} style={{ color: 'var(--primary-color)', fontWeight: 600 }}>
                      {a.report.title}
                    </Link>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0' }}>
                      Petugas: {a.officer.name} • Kategori: {a.report.category || '-'} • Lokasi: {a.report.location}
                    </p>
                    <p style={{ fontSize: '0.8rem', margin: '0.25rem 0' }}>
                      Catatan petugas: {ev?.description || a.reviewNotes || '-'}
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0.75rem' }}>
                      Dikirim: {ev ? new Date(ev.createdAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </p>
                    <ReviewButtons assignmentId={a.id} reportTitle={a.report.title} evidencePhoto={ev?.photo || null} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tanggal Ditugaskan</th>
                <th>Laporan</th>
                <th>Lokasi</th>
                <th>Petugas</th>
                <th>Status Laporan</th>
                <th>Status Tugas</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    Belum ada penugasan. Buka detail laporan berstatus VERIFIED untuk menugaskan petugas.
                  </td>
                </tr>
              ) : (
                assignments.map(assignment => (
                  <tr key={assignment.id}>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(assignment.assignedAt).toLocaleDateString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      <Link
                        href={`/admin/laporan/${assignment.report.id}`}
                        style={{ color: 'var(--primary-color)', fontWeight: 500 }}
                      >
                        {assignment.report.title.length > 40
                          ? assignment.report.title.slice(0, 40) + '…'
                          : assignment.report.title}
                      </Link>
                      {assignment.notes && (
                        <p style={{ margin: '0.1rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          📝 {assignment.notes}
                        </p>
                      )}
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>📍 {assignment.report.location}</td>
                    <td>
                      <div>
                        <p style={{ fontWeight: 600, margin: 0, fontSize: '0.875rem' }}>{assignment.officer.name}</p>
                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{assignment.officer.email}</p>
                      </div>
                    </td>
                    <td><Badge status={assignment.report.status} /></td>
                    <td>
                      {assignment.completedAt ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.2rem 0.6rem', borderRadius: '999px',
                          background: 'rgba(16,185,129,0.1)', color: 'var(--success-text)',
                          fontSize: '0.75rem', fontWeight: 600,
                        }}>
                          ✓ Selesai
                        </span>
                      ) : assignment.cancelledAt ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.2rem 0.6rem', borderRadius: '999px',
                          background: 'var(--muted-bg)', color: 'var(--text-secondary)',
                          fontSize: '0.75rem', fontWeight: 600,
                        }} title={assignment.cancelReason || 'Dibatalkan oleh Admin'}>
                          ⚪ Dibatalkan
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.2rem 0.6rem', borderRadius: '999px',
                          background: 'rgba(245,158,11,0.1)', color: 'var(--warning-text)',
                          fontSize: '0.75rem', fontWeight: 600,
                        }}>
                          ⏳ Aktif
                        </span>
                      )}
                      {assignment.cancelledAt && assignment.cancelReason && (
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                          Alasan: {assignment.cancelReason}
                        </p>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Link
                          href={`/admin/laporan/${assignment.report.id}`}
                          className="btn"
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}
                        >
                          Detail
                        </Link>
                        {!assignment.completedAt && !assignment.cancelledAt && (
                          <CancelAssignmentButton
                            assignmentId={assignment.id}
                            reportTitle={assignment.report.title}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

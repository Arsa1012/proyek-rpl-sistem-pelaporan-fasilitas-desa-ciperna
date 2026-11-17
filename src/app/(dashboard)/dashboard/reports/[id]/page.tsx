import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { AIResultCard } from '@/components/ui/AIResultCard';
import { ReAnalyzeButton } from '@/components/ui/ReAnalyzeButton';
import { ReportTimeline } from '@/components/ui/ReportTimeline';
import { sanitizeHistoryForCitizen } from '@/lib/history';

export default async function ReportDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const report = await prisma.report.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      assignments: {
        include: { officer: { select: { id: true, name: true } } },
        orderBy: { assignedAt: 'desc' },
      },
      evidences: { orderBy: { createdAt: 'asc' } },
      histories: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!report) notFound();

  // Akses check
  if (session.role === 'CITIZEN' && report.userId !== session.userId) {
    redirect('/dashboard');
  }

  // Sanitasi riwayat agar aman dari data sensitif internal
  const safeHistories = sanitizeHistoryForCitizen(report.histories);
  const isRejected = report.status === 'REJECTED';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
        <Link href="/dashboard" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          ← Kembali
        </Link>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        <span style={{ fontSize: '0.875rem' }}>Detail Laporan</span>
      </div>

      <div className="detail-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Kolom Kiri */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Info Utama */}
          <div className="glass" style={{ padding: '1.5rem' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)' }}>{report.title}</h2>
              <Badge status={report.status} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Pelapor</p>
                <p style={{ fontWeight: 500 }}>{report.user.name}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Tanggal Laporan</p>
                <p style={{ fontWeight: 500 }}>{new Date(report.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Lokasi</p>
                <p style={{ fontWeight: 500 }}>📍 {report.location}</p>
              </div>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Deskripsi Kerusakan</p>
              <p style={{ lineHeight: '1.6', color: 'var(--text-primary)' }}>{report.description}</p>
            </div>

            {isRejected && report.rejectionReason && (
              <div className="rejection-notice" style={{ marginTop: '1rem' }}>
                <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--danger-text)' }}>❌ Alasan Penolakan</p>
                <p style={{ color: '#7f1d1d' }}>{report.rejectionReason}</p>
              </div>
            )}
          </div>

          {/* Foto */}
          {report.photo && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📷 Foto Kerusakan</h3>
              <img
                src={report.photo}
                alt="Foto kerusakan"
                style={{ width: '100%', maxHeight: '400px', objectFit: 'cover', borderRadius: '8px' }}
              />
            </div>
          )}

          {/* AI Analysis Result */}
          <AIResultCard report={report} />

          {/* Re-analyze Button (hanya jika belum ada atau butuh update) */}
          <ReAnalyzeButton reportId={report.id} />

          {/* Bukti Penyelesaian */}
          {report.evidences.length > 0 && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📎 Bukti Penyelesaian</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
                {report.evidences.map(ev => (
                  <div key={ev.id} style={{ borderRadius: '8px', overflow: 'hidden' }}>
                    <img src={ev.photo} alt="Bukti" style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
                    {ev.description && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0.5rem', margin: 0 }}>
                        {ev.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Kolom Kanan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Timeline Status Berbasis History Nyata */}
          <ReportTimeline
            currentStatus={report.status}
            rejectionReason={report.rejectionReason}
            histories={safeHistories}
          />

          {/* Info Petugas */}
          {report.assignments.length > 0 && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>👷 Petugas Ditugaskan</h3>
              {report.assignments.map(a => (
                <div key={a.id} className="officer-card">
                  <div className="officer-avatar">
                    {a.officer.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontWeight: 600, margin: 0 }}>{a.officer.name}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Ditugaskan: {new Date(a.assignedAt).toLocaleDateString('id-ID')}
                    </p>
                    {a.completedAt && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--success-text)', margin: 0 }}>
                        ✓ Selesai: {new Date(a.completedAt).toLocaleDateString('id-ID')}
                      </p>
                    )}
                    {a.notes && <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', margin: 0 }}>{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

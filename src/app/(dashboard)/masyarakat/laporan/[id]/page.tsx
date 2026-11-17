import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { AIResultCard } from '@/components/ui/AIResultCard';
import { ReAnalyzeButton } from '@/components/ui/ReAnalyzeButton';
import { ReportTimeline } from '@/components/ui/ReportTimeline';
import { sanitizeHistoryForCitizen } from '@/lib/history';
import { reportStatusLabel } from '@/lib/status';

export default async function MasyarakatLaporanDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { success?: string };
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
      evidences: {
        orderBy: { createdAt: 'asc' },
        include: { assignment: { include: { officer: { select: { name: true } } } } },
      },
      histories: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!report) notFound();

  // Akses check
  if (session.role === 'CITIZEN' && report.userId !== session.userId) {
    redirect('/masyarakat/laporan');
  }

  // Sanitasi riwayat agar aman dari data sensitif internal
  const safeHistories = sanitizeHistoryForCitizen(report.histories);
  const isRejected = report.status === 'REJECTED';
  const showSuccess = searchParams?.success === 'true';

  // Info publik laporan utama (tanpa data pribadi pelapor lain)
  const mainReport = report.duplicateOfReportId
    ? await prisma.report.findUnique({
        where: { id: report.duplicateOfReportId },
        select: { id: true, title: true, location: true, status: true },
      })
    : null;

  return (
    <div>
      {showSuccess && (
        <div style={{ padding: '1rem 1.25rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', color: 'var(--success-text)', marginBottom: '1.5rem' }}>
          ✓ Laporan berhasil dikirim! Tim kami akan segera memprosesnya.
        </div>
      )}

      <div className="page-header">
        <div>
          <h2>{report.title}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            ID: {report.id.slice(0, 8)}... • Dibuat {new Date(report.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Badge status={report.status} />
      </div>

      {report.duplicateStatus === 'DUPLICATE' && (
        <div style={{ padding: '1rem 1.25rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 700, margin: '0 0 0.35rem' }}>⚠️ Laporan Anda memiliki kejadian yang sama dengan laporan yang sudah terdaftar.</p>
          {mainReport && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Laporan utama: #{mainReport.id.slice(0, 8)} — {mainReport.title} ({mainReport.location}, status: {reportStatusLabel(mainReport.status)}).
              Laporan Anda tetap tersimpan sebagai histori dan tidak dihapus.
            </p>
          )}
        </div>
      )}

      <div className="detail-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Kolom Kiri */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Info Utama */}
          <div className="glass" style={{ padding: '1.5rem' }}>
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
                <p style={{ color: 'var(--danger-text)', margin: 0 }}>{report.rejectionReason}</p>
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

          {/* Re-analyze Button */}
          <ReAnalyzeButton reportId={report.id} />

          {/* Bukti Penyelesaian */}
          {report.evidences.length > 0 && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📎 Bukti Penyelesaian</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
                {report.evidences.map(ev => (
                  <div key={ev.id} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(16,185,129,0.25)' }}>
                    <a href={ev.photo} target="_blank" rel="noopener noreferrer" title="Buka bukti ukuran penuh">
                      <img src={ev.photo} alt="Bukti penyelesaian" style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }} />
                    </a>
                    <div style={{ padding: '0.5rem' }}>
                      {ev.assignment?.officer?.name && (
                        <p style={{ fontSize: '0.72rem', color: 'var(--primary-color)', fontWeight: 600, margin: '0 0 0.2rem' }}>
                          👷 {ev.assignment.officer.name} (Petugas Lapangan)
                        </p>
                      )}
                      {ev.description && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                          {ev.description}
                        </p>
                      )}
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                        {new Date(ev.createdAt).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
                      </p>
                    </div>
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
                    <p style={{ fontSize: '0.72rem', color: 'var(--primary-color)', fontWeight: 600, margin: 0 }}>
                      Petugas Lapangan
                    </p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                      Ditugaskan: {new Date(a.assignedAt).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} WIB
                    </p>
                    {a.completedAt && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--success-text)', margin: 0 }}>
                        ✓ Selesai: {new Date(a.completedAt).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}
                      </p>
                    )}
                    {a.notes && <p style={{ fontSize: '0.75rem', marginTop: '0.25rem', margin: 0 }}>{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <Link href="/masyarakat/laporan" className="btn" style={{ display: 'block', textAlign: 'center', padding: '0.75rem', background: 'var(--muted-bg)', color: 'var(--text-secondary)', textDecoration: 'none' }}>
            ← Kembali ke Daftar Laporan
          </Link>
        </div>
      </div>
    </div>
  );
}

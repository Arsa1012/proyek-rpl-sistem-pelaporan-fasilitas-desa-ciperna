import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { AIResultCard } from '@/components/ui/AIResultCard';
import { AdminAnalyzeButton } from '@/components/ui/AdminAnalyzeButton';
import { AdminReportActions } from '@/components/ui/AdminReportActions';
import { AssignOfficerPanel } from '@/components/ui/AssignOfficerPanel';
import { DuplicateActions } from '@/components/ui/DuplicateActions';
import { ReportTimeline } from '@/components/ui/ReportTimeline';
import { AdminEvidenceVerification } from '@/components/ui/AdminEvidenceVerification';

export default async function AdminLaporanDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

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
      analyses: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!report) notFound();

  const latestSuccess = report.analyses.find((a) => a.status === 'SUCCESS') || null;
  const hasAiResult = report.aiStatus === 'SUCCESS' || report.aiStatus === 'NEEDS_REVIEW';

  const mainReport = report.duplicateOfReportId
    ? await prisma.report.findUnique({
        where: { id: report.duplicateOfReportId },
        include: { user: { select: { id: true, name: true } } },
      })
    : null;

  const severityColor: Record<string, { bg: string; color: string }> = {
    RENDAH: { bg: 'var(--severity-low-bg)', color: 'var(--severity-low)' },
    SEDANG: { bg: 'var(--severity-medium-bg)', color: 'var(--severity-medium)' },
    TINGGI: { bg: 'var(--severity-high-bg)', color: 'var(--severity-high)' },
    KRITIS: { bg: 'var(--severity-critical-bg)', color: 'var(--severity-critical)' },
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{report.title}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            ID: {report.id.slice(0, 8)}... • Dibuat {new Date(report.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Badge status={report.status} />
      </div>

      <div className="detail-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Kolom Kiri */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Banner Duplikat */}
          {(report.duplicateStatus === 'POSSIBLE_DUPLICATE' || report.duplicateStatus === 'DUPLICATE') && (
            <div
              className="glass"
              style={{
                padding: '1.25rem 1.5rem',
                borderLeft: `4px solid ${report.duplicateStatus === 'DUPLICATE' ? 'var(--severity-low)' : 'var(--severity-medium)'}`,
              }}
            >
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>
                🔗 {report.duplicateStatus === 'DUPLICATE' ? 'Laporan Duplikat Terkonfirmasi' : 'Kemungkinan Laporan Duplikat'}
                {report.duplicateConfidence != null && (
                  <span className="ai-severity-badge" style={{ marginLeft: '0.5rem', background: 'rgba(245,158,11,0.18)' }}>
                    {Math.round(report.duplicateConfidence)}%
                  </span>
                )}
                {report.duplicateBand && (
                  <span className="ai-severity-badge" style={{ marginLeft: '0.4rem', background: 'rgba(245,158,11,0.12)', color: 'var(--warning-text)' }}>
                    {report.duplicateBand}
                  </span>
                )}
              </h3>
              {mainReport ? (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem' }}>
                  Terkait dengan laporan utama:{' '}
                  <Link href={`/admin/laporan/${mainReport.id}`} style={{ color: 'var(--primary-color)', fontWeight: 600 }}>
                    #{mainReport.id.slice(0, 8)} — {mainReport.title}
                  </Link>{' '}
                  ({mainReport.location})
                </p>
              ) : (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Laporan utama tidak ditemukan (mungkin sudah dihapus referensinya).
                </p>
              )}
              {report.duplicateReason && (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Alasan: {report.duplicateReason}
                </p>
              )}
              <DuplicateActions
                reportId={report.id}
                duplicateStatus={report.duplicateStatus}
                currentMainId={report.duplicateOfReportId}
              />
            </div>
          )}
          {/* Info Utama */}
          <div className="glass" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem', fontWeight: 600 }}>PELAPOR</p>
                <p style={{ fontWeight: 500 }}>{report.user.name}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{report.user.email}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem', fontWeight: 600 }}>TANGGAL LAPORAN</p>
                <p style={{ fontWeight: 500 }}>
                  {new Date(report.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem', fontWeight: 600 }}>LOKASI</p>
                <p style={{ fontWeight: 500 }}>📍 {report.location}</p>
              </div>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>DESKRIPSI KERUSAKAN</p>
              <p style={{ lineHeight: '1.65', color: 'var(--text-primary)' }}>{report.description}</p>
            </div>
            {report.rejectionReason && (
              <div className="rejection-notice" style={{ marginTop: '1rem' }}>
                <p style={{ fontWeight: 600, color: 'var(--danger-text)', marginBottom: '0.25rem' }}>❌ Alasan Penolakan</p>
                <p style={{ color: 'var(--danger-text)', margin: 0 }}>{report.rejectionReason}</p>
              </div>
            )}
          </div>

          {/* Foto */}
          {report.photo && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📷 Foto Laporan</h3>
              <img
                src={report.photo}
                alt="Foto kerusakan"
                style={{ width: '100%', maxHeight: '420px', objectFit: 'cover', borderRadius: '10px' }}
              />
            </div>
          )}

          {/* AI Result */}
          <AIResultCard report={report} analysis={latestSuccess} />

          {/* Re-analyze */}
          <div className="glass" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>🤖 Jalankan Ulang Analisis AI</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Analisis ulang memakai foto dan deskripsi terbaru, memperbarui hasil analisis laporan ini,
              dan <strong>tidak membuat laporan baru</strong>. Setiap percobaan disimpan pada riwayat analisis.
            </p>
            <AdminAnalyzeButton reportId={report.id} hasResult={hasAiResult} />
            {report.aiStatus === 'FAILED' && report.aiError && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: 'var(--danger-text)' }}>
                ⚠️ Percobaan terakhir gagal: {report.aiError}
              </p>
            )}
            {report.analyses.length > 1 && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Total percobaan analisis tersimpan: {report.analysisCount}. Menampilkan hasil berhasil terakhir.
              </p>
            )}
          </div>

          {/* Bukti Penyelesaian dari Petugas */}
          {report.evidences.length > 0 && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--success-text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>✅</span>
                <span>Bukti Penyelesaian Pekerjaan (Petugas)</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {report.evidences.map((evidence) => (
                  <div
                    key={evidence.id}
                    style={{
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'rgba(16, 185, 129, 0.03)',
                    }}
                  >
                    <img
                      src={evidence.photo}
                      alt="Bukti pekerjaan selesai"
                      style={{ width: '100%', maxHeight: '350px', objectFit: 'cover' }}
                    />
                    <div style={{ padding: '0.85rem' }}>
                      <p style={{ margin: '0 0 0.25rem', fontWeight: 600, fontSize: '0.85rem' }}>
                        Catatan Hasil Perbaikan:
                      </p>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        {evidence.description || 'Pekerjaan perbaikan telah selesai dilaksanakan.'}
                      </p>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Diunggah pada: {new Date(evidence.createdAt).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })} WIB
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
          {/* Verifikasi Bukti Penyelesaian (Admin) */}
          <AdminEvidenceVerification reportId={report.id} />

          {/* AI Quick Stats */}
          {hasAiResult && report.aiResult && (
            <div className="glass" style={{ padding: '1.25rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>📊 Ringkasan AI</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Label AI</span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{report.aiResult}</span>
                </div>
                {report.severity && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Severity</span>
                    <span
                      className="ai-severity-badge"
                      style={{
                        background: severityColor[report.severity]?.bg || 'var(--muted-bg)',
                        color: severityColor[report.severity]?.color || 'var(--text-secondary)',
                        fontSize: '0.75rem',
                      }}
                    >
                      {report.severity}
                    </span>
                  </div>
                )}
                {report.aiConfidence != null && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Confidence</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary-color)' }}>{Math.round(report.aiConfidence)}%</span>
                    </div>
                    <div className="confidence-bar-bg">
                      <div className="confidence-bar-fill" style={{ width: `${report.aiConfidence}%` }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timeline Riwayat Status */}
          <ReportTimeline
            currentStatus={report.status}
            rejectionReason={report.rejectionReason}
            histories={report.histories}
            title="🗓️ Timeline Riwayat Status"
          />

          {/* Actions */}
          <AdminReportActions
            reportId={report.id}
            initialStatus={report.status}
            initialCategory={report.category}
            initialSeverity={report.severity}
            categories={['Infrastruktur Jalan', 'Infrastruktur Jembatan', 'Penerangan Jalan', 'Sistem Drainase', 'Ruang Terbuka Hijau', 'Fasilitas Umum', 'Gedung/Bangunan Publik', 'Sarana Transportasi', 'Sanitasi & Kebersihan', 'Fasilitas Lainnya']}
          />

          {/* Panel Tugaskan ke Petugas — hanya jika status VERIFIED */}
          {report.status === 'VERIFIED' && (
            <AssignOfficerPanel
              reportId={report.id}
              reportTitle={report.title}
            />
          )}

          <div className="glass" style={{ padding: '0.75rem 1.25rem' }}>
            <Link
              href={`/admin/laporan`}
              className="btn"
              style={{ width: '100%', justifyContent: 'center', background: 'transparent', textAlign: 'center', color: 'var(--text-secondary)' }}
            >
              ← Kembali ke Daftar Laporan
            </Link>
          </div>

          {/* Petugas */}
          {report.assignments.length > 0 && (
            <div className="glass" style={{ padding: '1.25rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>👷 Petugas</h3>
              {report.assignments.map(a => (
                <div key={a.id} className="officer-card">
                  <div className="officer-avatar">{a.officer.name.charAt(0).toUpperCase()}</div>
                  <div>
                    <p style={{ fontWeight: 600, margin: 0, fontSize: '0.875rem' }}>{a.officer.name}</p>
                    <p style={{ fontSize: '0.72rem', color: 'var(--primary-color)', margin: 0, fontWeight: 600 }}>
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
                    {a.cancelledAt && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
                        ⚪ Dibatalkan{a.cancelReason ? ` — ${a.cancelReason}` : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Info DB */}
          <div className="glass" style={{ padding: '1.25rem' }}>
            <h3 style={{ marginBottom: '0.75rem', fontSize: '0.95rem' }}>🔍 Info Teknis</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>ID Laporan</span>
                <code style={{ fontSize: '0.7rem', background: 'var(--muted-bg)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                  {report.id.slice(0, 12)}...
                </code>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Dibuat</span>
                <span>{new Date(report.createdAt).toLocaleString('id-ID')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Diperbarui</span>
                <span>{new Date(report.updatedAt).toLocaleString('id-ID')}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ada Foto</span>
                <span>{report.photo ? '✅ Ya' : '❌ Tidak'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Hasil AI</span>
                <span>
                  {report.aiStatus === 'SUCCESS' ? '✅ Berhasil'
                    : report.aiStatus === 'NEEDS_REVIEW' ? '🔎 Perlu ditinjau'
                    : report.aiStatus === 'FAILED' ? '⚠️ Gagal'
                    : report.aiStatus === 'ANALYZING' ? '🔄 Sedang dianalisis'
                    : '⏳ Belum'}
                </span>
              </div>
              {report.aiModel && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Model AI</span>
                  <span style={{ textAlign: 'right' }}>{report.aiModel}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Status Duplikat</span>
                <span>{report.duplicateStatus}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Percobaan Analisis</span>
                <span>{report.analysisCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

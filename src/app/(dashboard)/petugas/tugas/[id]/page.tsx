import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { OfficerTaskWorkflow } from '@/components/ui/OfficerTaskWorkflow';

function maskEmail(email: string) {
  if (!email) return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const maskedUser = user.length > 2 ? user.slice(0, 2) + '***' : user + '***';
  return `${maskedUser}@${domain}`;
}

export default async function PetugasTugasDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'OFFICER') redirect('/login');

  const assignment = await prisma.assignment.findUnique({
    where: { id: params.id },
    include: {
      report: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          evidences: { orderBy: { createdAt: 'desc' } },
        },
      },
      officer: { select: { id: true, name: true } },
    },
  });

  if (!assignment) notFound();

  // Otorisasi: petugas hanya boleh melihat tugas yang ditugaskan kepada dirinya
  if (assignment.officerId !== session.userId) {
    redirect('/petugas/tugas');
  }

  // Penugasan yang dibatalkan bukan lagi tugas aktif
  if (assignment.cancelledAt) {
    redirect('/petugas/tugas');
  }

  const report = assignment.report;

  const severityColor: Record<string, { bg: string; color: string }> = {
    RENDAH: { bg: 'var(--severity-low-bg)', color: 'var(--severity-low)' },
    SEDANG: { bg: 'var(--severity-medium-bg)', color: 'var(--severity-medium)' },
    TINGGI: { bg: 'var(--severity-high-bg)', color: 'var(--severity-high)' },
    KRITIS: { bg: 'var(--severity-critical-bg)', color: 'var(--severity-critical)' },
  };

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
        <Link href="/petugas/tugas" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          ← Tugas Saya
        </Link>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        <span style={{ fontSize: '0.875rem' }}>Detail Tugas Lapangan</span>
      </div>

      {report.duplicateStatus === 'DUPLICATE' && (
        <div style={{ padding: '1rem 1.25rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          ⚠️ Laporan ini tercatat sebagai duplikat dari laporan #{(report.duplicateOfReportId || '').slice(0, 8)}. Tangani laporan utama agar tidak terjadi penanganan ganda.
        </div>
      )}

      <div className="detail-grid-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.5rem', alignItems: 'start' }}>
        {/* Kolom Kiri: Informasi Laporan & Bukti */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Info Utama Laporan */}
          <div className="glass" style={{ padding: '1.5rem' }}>
            <div className="flex justify-between items-center" style={{ marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>{report.title}</h2>
              <Badge status={report.status} reviewStatus={assignment.reviewStatus} />
            </div>

            {/* Grid Informasi Umum */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  👤 PELAPOR (WARGA)
                </p>
                <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>{report.user.name}</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.1rem 0 0' }}>
                  Kontak: {maskEmail(report.user.email)} <span style={{ fontSize: '0.7rem' }}>(Privasi Terlindungi)</span>
                </p>
              </div>

              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  📅 TANGGAL LAPORAN
                </p>
                <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>
                  {new Date(report.createdAt).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.1rem 0 0' }}>
                  Pukul {new Date(report.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                </p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  📍 LOKASI KERUSAKAN
                </p>
                <p style={{ fontWeight: 500, margin: '0 0 0.25rem', fontSize: '0.95rem' }}>{report.location}</p>
                {report.latitude && report.longitude ? (
                  <a
                    href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.8rem', color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    🗺️ Buka Koordinat di Google Maps ({report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}) →
                  </a>
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    (Koordinat peta tidak tersemat)
                  </span>
                )}
              </div>
            </div>

            {/* Deskripsi */}
            <div style={{ borderTop: '1px solid var(--divider)', paddingTop: '1rem' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem', fontWeight: 600 }}>
                DESKRIPSI KERUSAKAN FASILITAS
              </p>
              <p style={{ lineHeight: '1.65', color: 'var(--text-primary)', margin: 0, fontSize: '0.9rem' }}>
                {report.description}
              </p>
            </div>
          </div>

          {/* Foto Kerusakan Awal dari Warga */}
          {report.photo && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>📷 Foto Laporan Kerusakan</h3>
              <img
                src={report.photo}
                alt="Foto fasilitas rusak"
                style={{ width: '100%', maxHeight: '420px', objectFit: 'cover', borderRadius: '10px' }}
              />
            </div>
          )}

          {/* Klasifikasi & Hasil AI */}
          <div className="glass" style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>🏷️ Klasifikasi & Analisis AI</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
              <div style={{ padding: '0.85rem', background: 'rgba(37,99,235,0.04)', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  KATEGORI FASILITAS
                </p>
                <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>
                  {report.category || 'Belum dikategorikan'}
                </p>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(37,99,235,0.04)', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  JENIS KERUSAKAN
                </p>
                <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>
                  {report.damageType || 'Belum dianalisis'}
                </p>
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(37,99,235,0.04)', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  TINGKAT KEPARAHAN (SEVERITY)
                </p>
                {report.severity ? (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.75rem',
                      borderRadius: '999px',
                      background: severityColor[report.severity]?.bg || '#f3f4f6',
                      color: severityColor[report.severity]?.color || '#6b7280',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                    }}
                  >
                    {report.severity}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>—</span>
                )}
              </div>

              <div style={{ padding: '0.85rem', background: 'rgba(37,99,235,0.04)', borderRadius: '8px' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                  HASIL DETEKSI AI
                </p>
                <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem' }}>
                  {report.aiResult || 'Belum dianalisis'}
                </p>
              </div>
            </div>
          </div>

          {/* Bukti Penyelesaian Hasil Pekerjaan */}
          {report.evidences.length > 0 && (
            <div className="glass" style={{ padding: '1.5rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', color: 'var(--success-text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>✅</span>
                <span>Bukti Penyelesaian Pekerjaan</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {report.evidences.map((evidence) => (
                  <div
                    key={evidence.id}
                    style={{
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      background: 'rgba(16, 185, 129, 0.03)',
                    }}
                  >
                    <img
                      src={evidence.photo}
                      alt="Bukti pekerjaan selesai"
                      style={{ width: '100%', maxHeight: '360px', objectFit: 'cover' }}
                    />
                    <div style={{ padding: '1rem' }}>
                      <p style={{ margin: '0 0 0.35rem', fontWeight: 600, fontSize: '0.875rem' }}>
                        Catatan Hasil Perbaikan:
                      </p>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
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

        {/* Kolom Kanan: Status & Panel Interaktif Alur Kerja Petugas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Panel Alur Kerja Petugas (Mulai / Selesaikan Tugas) */}
          <OfficerTaskWorkflow
            assignmentId={assignment.id}
            reportId={report.id}
            initialStatus={report.status}
            initialNotes={assignment.notes}
            completedAt={assignment.completedAt ? assignment.completedAt.toISOString() : null}
            reviewStatus={assignment.reviewStatus}
            reviewNotes={assignment.reviewNotes}
          />

          {/* Info Detail Penugasan */}
          <div className="glass" style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>📋 Info Penugasan</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Petugas</span>
                <span style={{ fontWeight: 600 }}>{assignment.officer.name} (Petugas Lapangan)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ditugaskan</span>
                <span style={{ fontWeight: 500 }}>
                  {new Date(assignment.assignedAt).toLocaleString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Jakarta',
                  })}{' '}
                  WIB
                </span>
              </div>
              {assignment.completedAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Disetujui Pada</span>
                  <span style={{ fontWeight: 600, color: 'var(--success-text)' }}>
                    {new Date(assignment.completedAt).toLocaleDateString('id-ID', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'Asia/Jakarta',
                    })}
                  </span>
                </div>
              )}
              {assignment.reviewStatus === 'REVISION' && assignment.reviewNotes && (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(245,158,11,0.1)',
                    borderRadius: '8px',
                    marginTop: '0.25rem',
                    border: '1px solid rgba(245,158,11,0.3)',
                  }}
                >
                  <p style={{ fontSize: '0.75rem', color: '#b45309', margin: '0 0 0.25rem', fontWeight: 700 }}>
                    PERLU PERBAIKAN (ALASAN ADMIN)
                  </p>
                  <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.8rem' }}>{assignment.reviewNotes}</p>
                </div>
              )}
              {assignment.notes && (
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(37, 99, 235, 0.05)',
                    borderRadius: '8px',
                    marginTop: '0.25rem',
                  }}
                >
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontWeight: 600 }}>
                    INSTRUKSI / CATATAN
                  </p>
                  <p style={{ margin: 0, fontStyle: 'italic', fontSize: '0.8rem' }}>{assignment.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Tombol Navigasi Kembali */}
          <Link
            href="/petugas/tugas"
            className="btn"
            style={{
              display: 'block',
              textAlign: 'center',
              padding: '0.75rem',
              background: 'var(--muted-bg)',
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: '0.875rem',
            }}
          >
            ← Kembali ke Daftar Tugas
          </Link>
        </div>
      </div>
    </div>
  );
}

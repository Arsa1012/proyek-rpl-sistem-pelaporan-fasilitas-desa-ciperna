import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { AdminAnalyzeButton } from '@/components/ui/AdminAnalyzeButton';
import { AdminReportFilters } from '@/components/ui/AdminReportFilters';
import { aiStatusLabel } from '@/lib/reportAnalysis';

export const dynamic = 'force-dynamic';

const AI_STATUS_COLOR: Record<string, { bg: string; color: string; icon: string }> = {
  PENDING: { bg: 'var(--muted-bg)', color: 'var(--text-secondary)', icon: '⏳' },
  ANALYZING: { bg: 'var(--soft-primary-bg)', color: 'var(--accent)', icon: '🔄' },
  SUCCESS: { bg: 'var(--severity-low-bg)', color: 'var(--success-text)', icon: '✅' },
  FAILED: { bg: 'var(--severity-high-bg)', color: 'var(--danger-text)', icon: '⚠️' },
  NEEDS_REVIEW: { bg: 'var(--severity-medium-bg)', color: 'var(--warning-text)', icon: '🔎' },
};

export default async function AdminLaporanPage({
  searchParams,
}: {
  searchParams: {
    status?: string;
    category?: string;
    aiStatus?: string;
    page?: string;
    q?: string;
  };
}) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
  const limit = 15;
  const skip = (page - 1) * limit;
  const statusFilter = searchParams.status;
  const categoryFilter = searchParams.category;
  const aiStatusFilter = searchParams.aiStatus;
  const searchQuery = searchParams.q?.trim();

  const where: any = {};
  if (statusFilter) where.status = statusFilter;
  if (categoryFilter) where.category = categoryFilter;
  if (aiStatusFilter) where.aiStatus = aiStatusFilter;
  if (searchQuery) {
    // Cari di judul, deskripsi, lokasi, dan kategori — bukan hanya judul.
    where.OR = [
      { title: { contains: searchQuery } },
      { description: { contains: searchQuery } },
      { location: { contains: searchQuery } },
      { category: { contains: searchQuery } },
      { id: { contains: searchQuery } },
    ];
  }

  const [reports, total, categories, aiGroups, totalAll, confirmedDuplicates] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.report.count({ where }),
    prisma.report.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    }),
    prisma.report.groupBy({
      by: ['aiStatus'],
      _count: { id: true },
    }),
    prisma.report.count(),
    prisma.report.count({ where: { duplicateStatus: 'DUPLICATE' } }),
  ]);

  const aiCounts: Record<string, number> = {};
  for (const g of aiGroups) aiCounts[g.aiStatus] = g._count.id;
  const analyzed = aiCounts.SUCCESS || 0;
  const failed = aiCounts.FAILED || 0;
  const needsReview = aiCounts.NEEDS_REVIEW || 0;
  const waiting = (aiCounts.PENDING || 0) + (aiCounts.ANALYZING || 0);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const uniqueCategories = categories.map((c) => c.category).filter(Boolean) as string[];

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

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (aiStatusFilter) params.set('aiStatus', aiStatusFilter);
    if (searchQuery) params.set('q', searchQuery);
    params.set('page', String(target));
    return `/admin/laporan?${params.toString()}`;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{statusFilter === 'SUBMITTED' ? 'Verifikasi Laporan' : 'Daftar Laporan'}</h2>
          <p>
            {statusFilter === 'SUBMITTED'
              ? 'Tinjau laporan baru yang menunggu verifikasi admin.'
              : 'Kelola semua laporan dan pantau status analisis AI.'}
          </p>
        </div>
      </div>

      {/* Ringkasan — status OPERASIONAL dan status ANALISIS dipisah. */}
      <div
        className="stat-grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1.25rem' }}
      >
        <div className="glass card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>Total Laporan</p>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--primary-color)' }}>{totalAll}</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
            {confirmedDuplicates} terkonfirmasi duplikat (tetap tersimpan)
          </p>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--success-color)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>Berhasil Dianalisis</p>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{analyzed}</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
            {totalAll > 0 ? Math.round((analyzed / totalAll) * 100) : 0}% dari total
          </p>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--warning-text)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>Menunggu Analisis</p>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{waiting}</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>PENDING + sedang diproses</p>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--danger-text)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>Gagal Dianalisis</p>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--danger-text)' }}>{failed}</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>Perlu analisis ulang</p>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--severity-critical)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem' }}>Perlu Ditinjau</p>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--purple-text)' }}>{needsReview}</div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>Hasil AI perlu verifikasi admin</p>
        </div>
      </div>

      <AdminReportFilters
        basePath="/admin/laporan"
        statusFilter={statusFilter}
        categoryFilter={categoryFilter}
        aiStatusFilter={aiStatusFilter}
        searchQuery={searchQuery}
        categories={uniqueCategories}
        total={total}
      />

      <div className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Pelapor</th>
                <th>Judul Laporan</th>
                <th>Status AI</th>
                <th>Ringkasan Analisis</th>
                <th>Severity</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    Tidak ada laporan yang cocok dengan filter/pencarian
                    {searchQuery ? ` “${searchQuery}”` : ''}.
                  </td>
                </tr>
              ) : (
                reports.map((report) => {
                  const aiMeta = AI_STATUS_COLOR[report.aiStatus] || AI_STATUS_COLOR.PENDING;
                  const hasAiResult = report.aiStatus === 'SUCCESS' || report.aiStatus === 'NEEDS_REVIEW';
                  return (
                    <tr key={report.id}>
                      <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {new Date(report.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td style={{ fontWeight: 500 }}>{report.user.name}</td>
                      <td>
                        <Link
                          href={`/admin/laporan/${report.id}`}
                          style={{ color: 'var(--primary-color)', fontWeight: 500 }}
                        >
                          {report.title.length > 40 ? report.title.slice(0, 40) + '…' : report.title}
                        </Link>
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          #{report.id.slice(0, 8)}
                        </p>
                        {report.duplicateStatus === 'POSSIBLE_DUPLICATE' && (
                          <span className="ai-severity-badge" style={{ marginTop: '0.25rem', background: 'rgba(245,158,11,0.18)', color: 'var(--warning-text)' }}>
                            🔗 {report.duplicateBand || 'Perlu pemeriksaan admin'}
                          </span>
                        )}
                        {report.duplicateStatus === 'DUPLICATE' && (
                          <span className="ai-severity-badge" style={{ marginTop: '0.25rem', background: 'rgba(16,185,129,0.16)', color: 'var(--success-text)' }}>
                            ✅ Duplikat terkonfirmasi
                          </span>
                        )}
                      </td>
                      <td>
                        <span
                          className="ai-severity-badge"
                          style={{ background: aiMeta.bg, color: aiMeta.color, fontSize: '0.72rem' }}
                          title={report.aiError || aiStatusLabel(report.aiStatus)}
                        >
                          {aiMeta.icon} {aiStatusLabel(report.aiStatus)}
                        </span>
                        {report.aiAnalyzedAt && (
                          <p style={{ margin: '0.2rem 0 0', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            {new Date(report.aiAnalyzedAt).toLocaleDateString('id-ID')}
                          </p>
                        )}
                      </td>
                      <td style={{ maxWidth: '260px' }}>
                        {hasAiResult && report.aiResult ? (
                          <div>
                            <span style={{ fontWeight: 500, fontSize: '0.82rem' }}>{report.aiResult}</span>
                            {report.category && (
                              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                {report.category}
                              </p>
                            )}
                          </div>
                        ) : report.aiStatus === 'FAILED' ? (
                          <span style={{ color: 'var(--danger-text)', fontSize: '0.78rem' }}>
                            {report.aiError || 'Analisis gagal'}
                          </span>
                        ) : report.aiStatus === 'ANALYZING' ? (
                          <span style={{ color: 'var(--primary-color)', fontSize: '0.8rem' }}>Sedang diproses…</span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            Belum ada hasil valid
                          </span>
                        )}
                      </td>
                      <td>
                        {hasAiResult && report.severity ? (
                          <span
                            className="ai-severity-badge"
                            style={{
                              background: severityBg[report.severity] || 'var(--muted-bg)',
                              color: severityColor[report.severity] || 'var(--text-secondary)',
                              fontSize: '0.75rem',
                            }}
                          >
                            {report.severity}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        {hasAiResult && report.aiConfidence != null ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '80px' }}>
                            <div className="confidence-bar-bg" style={{ flex: 1 }}>
                              <div
                                className="confidence-bar-fill"
                                style={{ width: `${report.aiConfidence}%` }}
                              />
                            </div>
                            <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{Math.round(report.aiConfidence)}%</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td><Badge status={report.status} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <Link
                            href={`/admin/laporan/${report.id}`}
                            className="btn"
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}
                          >
                            Detail
                          </Link>
                          <AdminAnalyzeButton reportId={report.id} hasResult={hasAiResult} />
                          {report.duplicateStatus === 'POSSIBLE_DUPLICATE' && (
                            <Link
                              href="/admin/duplikat"
                              className="btn"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: 'rgba(245,158,11,0.14)', color: 'var(--warning-text)' }}
                            >
                              Tinjau Duplikat
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between" style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--divider)', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Halaman {page} dari {totalPages} • {total} laporan
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="btn" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'var(--muted-bg)' }}>
                  ← Prev
                </Link>
              )}
              {page < totalPages && (
                <Link href={pageHref(page + 1)} className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';

interface AdminReportFiltersProps {
  basePath: string;
  statusFilter?: string;
  categoryFilter?: string;
  aiStatusFilter?: string;
  searchQuery?: string;
  categories: string[];
  total: number;
}

function navigate(param: 'status' | 'category' | 'aiStatus', value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(param, value);
  else url.searchParams.delete(param);
  url.searchParams.delete('page');
  window.location.href = url.toString();
}

export function AdminReportFilters({
  basePath,
  statusFilter,
  categoryFilter,
  aiStatusFilter,
  searchQuery,
  categories,
  total,
}: AdminReportFiltersProps) {
  // Tab mempertahankan filter lain (kategori/AI/pencarian) saat berpindah
  // antara "Semua Laporan" dan antrean "Menunggu Verifikasi".
  function statusHref(value: string) {
    const params = new URLSearchParams();
    if (value) params.set('status', value);
    if (categoryFilter) params.set('category', categoryFilter);
    if (aiStatusFilter) params.set('aiStatus', aiStatusFilter);
    if (searchQuery) params.set('q', searchQuery);
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const verifying = statusFilter === 'SUBMITTED';

  return (
    <div className="glass" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
      <nav className="report-view-tabs" aria-label="Tampilan daftar laporan">
        <Link
          href={statusHref('')}
          className={`report-view-tab${!verifying ? ' active' : ''}`}
          aria-current={!verifying ? 'page' : undefined}
        >
          Semua Laporan
        </Link>
        <Link
          href={statusHref('SUBMITTED')}
          className={`report-view-tab${verifying ? ' active' : ''}`}
          aria-current={verifying ? 'page' : undefined}
        >
          Menunggu Verifikasi
        </Link>
      </nav>
      <form className="flex items-center gap-4" style={{ flexWrap: 'wrap' }} action={basePath} method="GET">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {categoryFilter && <input type="hidden" name="category" value={categoryFilter} />}
        {aiStatusFilter && <input type="hidden" name="aiStatus" value={aiStatusFilter} />}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '200px' }}>
          <label htmlFor="report-search" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Cari:</label>
          <input
            id="report-search"
            type="text"
            name="q"
            defaultValue={searchQuery || ''}
            placeholder="Judul atau deskripsi laporan..."
            className="filter-select"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>Cari</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="report-status" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Status:</label>
          <select
            id="report-status"
            name="status"
            defaultValue={statusFilter || ''}
            className="filter-select"
            onChange={(e) => navigate('status', e.target.value)}
          >
            <option value="">Semua Status</option>
            <option value="SUBMITTED">Baru</option>
            <option value="VERIFIED">Terverifikasi</option>
            <option value="ASSIGNED">Ditugaskan</option>
            <option value="IN_PROGRESS">Dalam Proses</option>
            <option value="COMPLETED">Selesai</option>
            <option value="REJECTED">Ditolak</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="report-category" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Kategori AI:</label>
          <select
            id="report-category"
            name="category"
            defaultValue={categoryFilter || ''}
            className="filter-select"
            onChange={(e) => navigate('category', e.target.value)}
          >
            <option value="">Semua Kategori</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label htmlFor="report-ai-status" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Status AI:</label>
          <select
            id="report-ai-status"
            name="aiStatus"
            defaultValue={aiStatusFilter || ''}
            className="filter-select"
            onChange={(e) => navigate('aiStatus', e.target.value)}
          >
            <option value="">Semua Status AI</option>
            <option value="PENDING">Menunggu analisis</option>
            <option value="ANALYZING">Sedang dianalisis</option>
            <option value="SUCCESS">Berhasil dianalisis</option>
            <option value="FAILED">Gagal dianalisis</option>
            <option value="NEEDS_REVIEW">Perlu ditinjau admin</option>
          </select>
        </div>
        {(statusFilter || categoryFilter || aiStatusFilter || searchQuery) && (
          <Link
            href={basePath}
            style={{ fontSize: '0.875rem', color: 'var(--danger-text)' }}
          >
            ✕ Reset Filter
          </Link>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          {total} laporan ditemukan
        </span>
      </form>
    </div>
  );
}

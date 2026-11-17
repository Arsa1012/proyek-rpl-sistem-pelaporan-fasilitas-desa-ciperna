'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import type { MapReport } from '@/components/ui/ReportMap';
import { REPORT_STATUS_LABELS } from '@/lib/status';

// Dynamic import agar Leaflet tidak crash di SSR
const ReportMap = dynamic(() => import('@/components/ui/ReportMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: '560px',
        borderRadius: '16px',
        background: 'rgba(240, 244, 255, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div
        className="spinner"
        style={{
          width: 36,
          height: 36,
          borderWidth: 3,
          borderColor: 'rgba(37,99,235,0.15)',
          borderTopColor: '#2563eb',
        }}
      />
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Memuat komponen peta…</span>
    </div>
  ),
});

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status' },
  { value: 'SUBMITTED', label: '🆕 Baru' },
  { value: 'VERIFIED', label: '✅ Terverifikasi' },
  { value: 'ASSIGNED', label: '📌 Ditugaskan' },
  { value: 'IN_PROGRESS', label: '⚙️ Dalam Proses' },
  { value: 'COMPLETED', label: '🎉 Selesai' },
  { value: 'REJECTED', label: '❌ Ditolak' },
];

const SEVERITY_OPTIONS = [
  { value: '', label: 'Semua Severity' },
  { value: 'RENDAH', label: '🟢 Rendah' },
  { value: 'SEDANG', label: '🟡 Sedang' },
  { value: 'TINGGI', label: '🔴 Tinggi' },
  { value: 'KRITIS', label: '🟣 Kritis' },
];

const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: '#2563eb',
  VERIFIED: '#f59e0b',
  REJECTED: '#ef4444',
  ASSIGNED: '#8b5cf6',
  IN_PROGRESS: '#06b6d4',
  COMPLETED: '#10b981',
};

const STATUS_LABEL: Record<string, string> = { ...REPORT_STATUS_LABELS };

export default function AdminMapPage() {
  const [reports, setReports] = useState<MapReport[]>([]);
  const [allReports, setAllReports] = useState<MapReport[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  // Sidebar selected
  const [selectedReport, setSelectedReport] = useState<MapReport | null>(null);

  // Fetch data dari API
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterCategory) params.set('category', filterCategory);
      if (filterSeverity) params.set('severity', filterSeverity);

      const res = await fetch(`/api/admin/map?${params.toString()}`);
      if (!res.ok) throw new Error('Gagal memuat data peta');
      const data = await res.json();
      setReports(data.reports);
      setAllReports(data.reports);
      setCategories(data.filters.categories);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCategory, filterSeverity]);

  // Fetch initial — load all
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/map');
        if (!res.ok) throw new Error('Gagal memuat data peta');
        const data = await res.json();
        setReports(data.reports);
        setAllReports(data.reports);
        setCategories(data.filters.categories);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Apply filter saat filter berubah
  useEffect(() => {
    let filtered = allReports;
    if (filterStatus) filtered = filtered.filter((r) => r.status === filterStatus);
    if (filterCategory) filtered = filtered.filter((r) => r.category === filterCategory);
    if (filterSeverity) filtered = filtered.filter((r) => r.severity === filterSeverity);
    setReports(filtered);
  }, [filterStatus, filterCategory, filterSeverity, allReports]);

  const hasFilter = filterStatus || filterCategory || filterSeverity;

  // Stat summary
  const statusStats = allReports.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h2 style={{ marginBottom: '0.25rem', fontSize: '1.5rem', fontWeight: 800 }}>
            🗺️ Peta Sebaran Laporan
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
            Visualisasi lokasi laporan berdasarkan koordinat GPS
          </p>
        </div>
        <Link
          href="/admin"
          className="btn"
          style={{
            padding: '0.4rem 1rem',
            fontSize: '0.8rem',
            background: 'var(--muted-bg)',
          }}
        >
          ← Kembali ke Dashboard
        </Link>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: '1rem' }}>
          ⚠️ {error}
          <button
            onClick={fetchData}
            style={{
              marginLeft: '0.75rem',
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* Stat Summary Pills */}
      {!loading && allReports.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginBottom: '1rem',
          }}
        >
          {Object.entries(statusStats).map(([status, count]) => (
            <button
              key={status}
              onClick={() =>
                setFilterStatus(filterStatus === status ? '' : status)
              }
              style={{
                background:
                  filterStatus === status
                    ? STATUS_COLOR[status] || '#64748b'
                    : (STATUS_COLOR[status] || '#64748b') + '15',
                color:
                  filterStatus === status ? 'white' : STATUS_COLOR[status] || '#64748b',
                border: `1.5px solid ${STATUS_COLOR[status] || '#64748b'}`,
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontFamily: 'inherit',
              }}
            >
              {STATUS_LABEL[status] || status}: {count}
            </button>
          ))}
          {allReports.length > 0 && (
            <span
              style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                border: '1.5px solid rgba(0,0,0,0.1)',
                background: 'var(--hover-bg)',
              }}
            >
              Total GPS: {allReports.length}
            </span>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="glass" style={{ padding: '1rem 1.25rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            🔍 Filter:
          </span>

          <select
            id="map-filter-status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            id="map-filter-category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="filter-select"
          >
            <option value="">Semua Kategori</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            id="map-filter-severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="filter-select"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {hasFilter && (
            <button
              onClick={() => {
                setFilterStatus('');
                setFilterCategory('');
                setFilterSeverity('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--danger-text)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              ✕ Reset Filter
            </button>
          )}

          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}
          >
            {loading ? 'Memuat…' : `${reports.length} titik ditampilkan`}
          </span>
        </div>
      </div>

      {/* Main: Map + Sidebar */}
      <div
        className="detail-grid-2col"
        style={{
          display: 'grid',
          gridTemplateColumns: selectedReport ? '1fr 300px' : '1fr',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        {/* Map */}
        <div className="glass" style={{ overflow: 'hidden', padding: 0 }}>
          {loading ? (
            <div
              style={{
                height: '560px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '0.75rem',
              }}
            >
              <div
                className="spinner"
                style={{
                  width: 36,
                  height: 36,
                  borderWidth: 3,
                  borderColor: 'rgba(37,99,235,0.15)',
                  borderTopColor: '#2563eb',
                }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Memuat data laporan…
              </span>
            </div>
          ) : (
            <ReportMap reports={reports} height="560px" />
          )}
        </div>

        {/* Sidebar detail laporan terpilih */}
        {selectedReport && (
          <div className="glass" style={{ padding: '1.25rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem',
              }}
            >
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>
                Detail Laporan
              </h3>
              <button
                onClick={() => setSelectedReport(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1,
                  padding: '0.1rem',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <p style={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.4, margin: 0 }}>
                {selectedReport.title}
              </p>

              <Badge status={selectedReport.status} />

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '0.5rem',
                  marginTop: '0.25rem',
                }}
              >
                <div>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', margin: '0 0 0.15rem', fontWeight: 600, textTransform: 'uppercase' }}>
                    Kategori
                  </p>
                  <p style={{ fontSize: '0.8rem', margin: 0, fontWeight: 500 }}>
                    {selectedReport.category || '—'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', margin: '0 0 0.15rem', fontWeight: 600, textTransform: 'uppercase' }}>
                    Severity
                  </p>
                  <p style={{ fontSize: '0.8rem', margin: 0, fontWeight: 500 }}>
                    {selectedReport.severity || '—'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', margin: '0 0 0.15rem', fontWeight: 600, textTransform: 'uppercase' }}>
                    Tanggal
                  </p>
                  <p style={{ fontSize: '0.8rem', margin: 0 }}>
                    {new Date(selectedReport.createdAt).toLocaleDateString('id-ID', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', margin: '0 0 0.15rem', fontWeight: 600, textTransform: 'uppercase' }}>
                    Koordinat
                  </p>
                  <p style={{ fontSize: '0.72rem', margin: 0, fontFamily: 'monospace' }}>
                    {selectedReport.latitude.toFixed(4)}, {selectedReport.longitude.toFixed(4)}
                  </p>
                </div>
              </div>

              <div>
                <p style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', margin: '0 0 0.15rem', fontWeight: 600, textTransform: 'uppercase' }}>
                  Lokasi
                </p>
                <p style={{ fontSize: '0.8rem', margin: 0 }}>{selectedReport.location}</p>
              </div>

              <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <Link
                  href={`/admin/laporan/${selectedReport.id}`}
                  className="btn btn-primary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.875rem', justifyContent: 'center' }}
                >
                  Lihat Detail Laporan →
                </Link>
                <a
                  href={`https://www.google.com/maps?q=${selectedReport.latitude},${selectedReport.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn"
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.4rem 0.875rem',
                    justifyContent: 'center',
                    background: 'rgba(37,99,235,0.08)',
                    color: 'var(--primary-color)',
                  }}
                >
                  🗺️ Buka di Google Maps
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="glass" style={{ padding: '1rem 1.25rem', marginTop: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            LEGENDA:
          </span>
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: STATUS_COLOR[status] || '#64748b',
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{label}</span>
            </div>
          ))}
          <div style={{ width: 1, height: 16, background: 'var(--divider)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            🔵 Titik kecil sudut kanan = Severity
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Klik marker untuk detail • Data pribadi tidak ditampilkan
          </span>
        </div>
      </div>

      {/* No GPS data notice */}
      {!loading && allReports.length === 0 && (
        <div
          className="glass"
          style={{
            padding: '2.5rem',
            textAlign: 'center',
            marginTop: '1rem',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>🗺️</div>
          <h3 style={{ marginBottom: '0.5rem' }}>Belum Ada Laporan Berkoordinat GPS</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
            Peta hanya menampilkan laporan yang memiliki data latitude & longitude.
            Pastikan masyarakat mengizinkan akses lokasi saat membuat laporan.
          </p>
          <Link href="/admin/laporan" className="btn btn-primary">
            Lihat Semua Laporan
          </Link>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { BarChart, DonutChart, HorizontalBar, LineChart } from '@/components/ui/Charts';
import { REPORT_STATUS_COLORS, REPORT_STATUS_LABELS } from '@/lib/status';

interface DashboardStats {
  total: number;
  byStatus: {
    SUBMITTED: number;
    VERIFIED: number;
    REJECTED: number;
    ASSIGNED: number;
    IN_PROGRESS: number;
    COMPLETED: number;
  };
  byCategory: { category: string; count: number }[];
  bySeverity: { severity: string; count: number }[];
  byMonth: { month: string; count: number }[];
  byLocation: { location: string; count: number }[];
  recentReports: {
    id: string;
    title: string;
    status: string;
    category: string | null;
    severity: string | null;
    location: string;
    createdAt: string;
    user: { name: string };
  }[];
  pendingVerification: {
    id: string;
    title: string;
    status: string;
    category: string | null;
    location: string;
    createdAt: string;
    user: { name: string };
  }[];
  recentAnnouncements: {
    id: string;
    title: string;
    slug: string;
    category: string | null;
    publishedAt: string | null;
  }[];
  waDelivery: { sent: number; failed: number };
  officers: {
    id: string;
    name: string;
    total: number;
    active: number;
    completed: number;
  }[];
}

// Label & warna status berasal dari sumber terpusat (src/lib/status.ts)
const STATUS_COLORS: Record<string, string> = REPORT_STATUS_COLORS;
const STATUS_LABELS: Record<string, string> = REPORT_STATUS_LABELS;

const SEVERITY_COLORS: Record<string, string> = {
  RENDAH: 'var(--severity-low)',
  SEDANG: 'var(--severity-medium)',
  TINGGI: 'var(--severity-high)',
  KRITIS: 'var(--severity-critical)',
};

// Latar soft sepadan — menggantikan trik hex+'20' yang tidak valid pada CSS var.
const SEVERITY_BGS: Record<string, string> = {
  RENDAH: 'var(--severity-low-bg)',
  SEDANG: 'var(--severity-medium-bg)',
  TINGGI: 'var(--severity-high-bg)',
  KRITIS: 'var(--severity-critical-bg)',
};

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

function StatCard({
  title,
  value,
  icon,
  color,
  sub,
  href,
}: {
  title: string;
  value: number;
  icon: string;
  color: string;
  sub?: string;
  href?: string;
}) {
  const content = (
    <div
      className="glass card"
      style={{
        borderLeft: `4px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        cursor: href ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.25rem' }}>{icon}</span>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
          {title}
        </p>
      </div>
      <div style={{ fontSize: '2.2rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>{sub}</p>}
    </div>
  );

  return href ? (
    <Link href={href} style={{ textDecoration: 'none' }}>
      {content}
    </Link>
  ) : (
    content
  );
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('Gagal memuat data');
      const data = await res.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Auto-refresh tiap 60 detik
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
          gap: '1rem',
        }}
      >
        <div className="spinner" style={{ width: 36, height: 36, borderWidth: 3, borderTopColor: 'var(--primary-color)', borderColor: 'var(--soft-primary-border)' }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Memuat data dashboard…</p>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="error-banner">
        ⚠️ {error || 'Gagal memuat data'}
        <button
          onClick={fetchStats}
          style={{ marginLeft: '1rem', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  const { total, byStatus, byCategory, bySeverity, byMonth, byLocation, recentReports, officers, pendingVerification, recentAnnouncements, waDelivery } = stats;

  // Data untuk donut status
  const statusDonutData = Object.entries(byStatus)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      label: STATUS_LABELS[k] || k,
      value: v,
      color: STATUS_COLORS[k] || '#999',
    }));

  // Data untuk bar chart category
  const categoryBarData = byCategory.map((c) => ({
    label: c.category.length > 12 ? c.category.slice(0, 12) + '…' : c.category,
    value: c.count,
  }));

  // Data untuk severity
  const severityBarData = bySeverity
    .sort((a, b) => {
      const order = ['RENDAH', 'SEDANG', 'TINGGI', 'KRITIS'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    })
    .map((s) => ({
      label: s.severity,
      value: s.count,
      color: SEVERITY_COLORS[s.severity] || '#94a3b8',
    }));

  // Data untuk monthly trend
  const monthlyChartData = byMonth.map((m) => ({
    label: formatMonthLabel(m.month),
    value: m.count,
  }));

  // Persentase selesai
  const completionRate = total > 0 ? Math.round((byStatus.COMPLETED / total) * 100) : 0;
  const pendingCount = byStatus.SUBMITTED + byStatus.VERIFIED;

  return (
    <div>
      {/* Refresh */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Diperbarui {lastUpdated.toLocaleTimeString('id-ID')}
            </span>
          )}
          <button
            onClick={fetchStats}
            className="btn btn-soft"
            style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* ===== STAT CARDS GRID ===== */}
      <div
        className="dashboard-stats-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}
      >
        <StatCard title="Total Laporan" value={total} icon="📋" color="var(--primary-color)" href="/admin/laporan" />
        <StatCard title="Laporan Baru" value={byStatus.SUBMITTED} icon="🆕" color="var(--primary-color)" sub="Menunggu verifikasi" href="/admin/laporan?status=SUBMITTED" />
        <StatCard title="Terverifikasi" value={byStatus.VERIFIED} icon="✅" color="var(--warning-text)" sub="Siap ditugaskan" href="/admin/laporan?status=VERIFIED" />
        <StatCard title="Ditolak" value={byStatus.REJECTED} icon="❌" color="var(--danger-text)" href="/admin/laporan?status=REJECTED" />
        <StatCard title="Ditugaskan" value={byStatus.ASSIGNED} icon="📌" color="var(--purple-text)" href="/admin/laporan?status=ASSIGNED" />
        <StatCard title="Dalam Proses" value={byStatus.IN_PROGRESS} icon="⚙️" color="var(--cyan-text)" href="/admin/laporan?status=IN_PROGRESS" />
        <StatCard title="Selesai" value={byStatus.COMPLETED} icon="🎉" color="var(--success-text)" sub={`${completionRate}% completion rate`} href="/admin/laporan?status=COMPLETED" />
      </div>

      {/* ===== ROW 1: DONUT + TREND ===== */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}
        className="dashboard-charts-row"
      >
        {/* Status Donut */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-primary)' }}>
            📊 Distribusi Status Laporan
          </h3>
          <DonutChart data={statusDonutData} size={160} />
        </div>

        {/* Trend Bulanan */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            📈 Tren Laporan (6 Bulan)
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
            Jumlah laporan masuk per bulan
          </p>
          {monthlyChartData.length >= 2 ? (
            <LineChart data={monthlyChartData} height={130} />
          ) : (
            <div
              style={{
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-secondary)',
                fontSize: '0.8rem',
                background: 'var(--hover-bg)',
                borderRadius: '10px',
              }}
            >
              Data tren belum tersedia
            </div>
          )}
        </div>
      </div>

      {/* ===== ROW 2: CATEGORY + SEVERITY ===== */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}
        className="dashboard-charts-row"
      >
        {/* Category Chart */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            🏷️ Laporan per Kategori
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
            Berdasarkan hasil klasifikasi AI
          </p>
          {categoryBarData.length > 0 ? (
            <BarChart data={categoryBarData} height={160} />
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Belum ada data kategori
            </div>
          )}
        </div>

        {/* Severity Chart */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            ⚠️ Laporan per Tingkat Keparahan
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
            Distribusi severity dari analisis AI
          </p>
          {severityBarData.length > 0 ? (
            <BarChart data={severityBarData} height={160} />
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Belum ada data severity
            </div>
          )}
        </div>
      </div>

      {/* ===== ROW 3: LOCATION + OFFICERS ===== */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}
        className="dashboard-charts-row"
      >
        {/* Location */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            📍 Laporan per Wilayah
          </h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
            Top 8 lokasi dengan laporan terbanyak
          </p>
          {byLocation.length > 0 ? (
            <HorizontalBar
              data={byLocation.map((l) => ({
                label: l.location.length > 25 ? l.location.slice(0, 25) + '…' : l.location,
                value: l.count,
              }))}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Belum ada data lokasi
            </div>
          )}
        </div>

        {/* Officers */}
        <div className="glass" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              👷 Performa Petugas
            </h3>
            <Link href="/admin/assignments" style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>
              Lihat semua →
            </Link>
          </div>
          {officers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Belum ada petugas terdaftar
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {officers.slice(0, 6).map((o) => (
                <div
                  key={o.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--hover-bg)',
                    borderRadius: '8px',
                    border: '1px solid var(--soft-primary-border)',
                  }}
                >
                  <div className="officer-avatar" style={{ width: 34, height: 34, fontSize: '0.85rem' }}>
                    {o.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.name}
                    </p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                      {o.active} aktif · {o.completed} selesai
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                    {o.active > 0 && (
                      <span className="badge primary" style={{ fontSize: '0.65rem' }}>
                        {o.active} aktif
                      </span>
                    )}
                    {o.completed > 0 && (
                      <span className="badge success" style={{ fontSize: '0.65rem' }}>
                        {o.completed} ✓
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== ROW 4: QUICK ACTIONS + RECENT ===== */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1.25rem' }}
        className="dashboard-charts-row"
      >
        {/* Quick Actions */}
        <div className="glass" style={{ padding: '1.5rem', height: 'fit-content' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>
            ⚡ Tindakan Cepat
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <Link
              href="/admin/laporan?status=SUBMITTED"
              className="btn btn-primary"
              style={{ justifyContent: 'space-between', padding: '0.65rem 1rem', fontSize: '0.82rem' }}
            >
              <span>🔍 Verifikasi Laporan Baru</span>
              <span
                style={{
                  background: 'rgba(255,255,255,0.25)',
                  padding: '0.1rem 0.5rem',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                }}
              >
                {byStatus.SUBMITTED}
              </span>
            </Link>
            <Link
              href="/admin/laporan?status=VERIFIED"
              className="btn"
              style={{
                justifyContent: 'space-between',
                padding: '0.65rem 1rem',
                fontSize: '0.82rem',
                background: 'rgba(139, 92, 246, 0.12)',
                color: 'var(--purple-text)',
              }}
            >
              <span>📌 Tugaskan Laporan</span>
              <span
                style={{
                  background: 'rgba(139, 92, 246, 0.15)',
                  padding: '0.1rem 0.5rem',
                  borderRadius: '9999px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: 'var(--purple-text)',
                }}
              >
                {byStatus.VERIFIED}
              </span>
            </Link>
            <Link
              href="/admin/laporan"
              className="btn"
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.82rem',
                background: 'var(--hover-bg)',
                color: 'var(--text-primary)',
              }}
            >
              📋 Semua Laporan
            </Link>
            <Link
              href="/admin/assignments"
              className="btn"
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.82rem',
                background: 'rgba(6, 182, 212, 0.1)',
                color: 'var(--cyan-text)',
              }}
            >
              👷 Manajemen Penugasan
            </Link>
            <Link
              href="/admin/map"
              className="btn"
              style={{
                padding: '0.65rem 1rem',
                fontSize: '0.82rem',
                background: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--danger-text)',
              }}
            >
              🗺️ Peta Sebaran Lokasi
            </Link>
          </div>

          {/* Ringkasan metric */}
          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.875rem',
              background: 'rgba(16, 185, 129, 0.06)',
              borderRadius: '10px',
              border: '1px solid rgba(16, 185, 129, 0.15)',
            }}
          >
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.35rem', fontWeight: 600 }}>
              TINGKAT PENYELESAIAN
            </p>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success-text)', lineHeight: 1 }}>
              {completionRate}%
            </div>
            <div
              style={{
                marginTop: '0.5rem',
                height: '6px',
                background: 'var(--muted-bg)',
                borderRadius: '9999px',
              }}
            >
              <div
                style={{
                  width: `${completionRate}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #10b981, #059669)',
                  borderRadius: '9999px',
                  transition: 'width 0.8s ease',
                }}
              />
            </div>
            {pendingCount > 0 && (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>
                {pendingCount} laporan menunggu tindakan
              </p>
            )}
          </div>
        </div>

        {/* Recent Reports */}
        <div className="glass" style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--divider)',
            }}
          >
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              🕐 Laporan Terbaru
            </h3>
            <Link href="/admin/laporan" style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>
              Lihat semua →
            </Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Pelapor</th>
                  <th>Judul</th>
                  <th>Kategori</th>
                  <th>Severity</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentReports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}
                    >
                      Belum ada laporan
                    </td>
                  </tr>
                ) : (
                  recentReports.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {new Date(r.createdAt).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </td>
                      <td style={{ fontSize: '0.8rem', fontWeight: 500 }}>{r.user.name}</td>
                      <td>
                        <Link
                          href={`/admin/laporan/${r.id}`}
                          style={{ color: 'var(--primary-color)', fontWeight: 500, fontSize: '0.82rem' }}
                        >
                          {r.title.length > 35 ? r.title.slice(0, 35) + '…' : r.title}
                        </Link>
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {r.category || '—'}
                      </td>
                      <td>
                        {r.severity ? (
                          <span
                            style={{
                              background: SEVERITY_BGS[r.severity] || 'var(--muted-bg)',
                              color: SEVERITY_COLORS[r.severity] || 'var(--text-secondary)',
                              padding: '0.15rem 0.6rem',
                              borderRadius: '9999px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                            }}
                          >
                            {r.severity}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        <Badge status={r.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===== ROW 5: VERIFIKASI + PENGUMUMAN + WHATSAPP ===== */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginTop: '1.25rem' }}
        className="dashboard-charts-row"
      >
        {/* Menunggu verifikasi */}
        <div className="glass reveal" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--divider)' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>🔍 Menunggu Verifikasi</h3>
            <Link href="/admin/laporan?status=SUBMITTED" style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>
              Lihat semua →
            </Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Tanggal</th><th>Judul</th><th>Pelapor</th><th>Status</th></tr>
              </thead>
              <tbody>
                {pendingVerification.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                      Tidak ada laporan yang menunggu verifikasi
                    </td>
                  </tr>
                ) : (
                  pendingVerification.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                        {new Date(r.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                      </td>
                      <td>
                        <Link href={`/admin/laporan/${r.id}`} style={{ color: 'var(--primary-color)', fontSize: '0.82rem' }}>
                          {r.title.length > 28 ? r.title.slice(0, 28) + '…' : r.title}
                        </Link>
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>{r.user.name}</td>
                      <td><Badge status={r.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pengumuman terbaru + status WhatsApp */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="glass reveal" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--divider)' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>📣 Pengumuman Terbaru</h3>
              <Link href="/admin/pengumuman" style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>
                Kelola →
              </Link>
            </div>
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Judul</th><th>Kategori</th><th>Terbit</th></tr>
                </thead>
                <tbody>
                  {recentAnnouncements.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                        Belum ada pengumuman terbit
                      </td>
                    </tr>
                  ) : (
                    recentAnnouncements.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/pengumuman/${a.slug}`} style={{ color: 'var(--primary-color)', fontSize: '0.82rem' }}>
                            {a.title.length > 30 ? a.title.slice(0, 30) + '…' : a.title}
                          </Link>
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{a.category || '—'}</td>
                        <td style={{ fontSize: '0.75rem', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                          {a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass reveal" style={{ padding: '1.25rem 1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 0.75rem' }}>📲 Status Pengiriman WhatsApp</h3>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--success-text)', lineHeight: 1 }}>{waDelivery.sent}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Terkirim</div>
              </div>
              <div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--danger-text)', lineHeight: 1 }}>{waDelivery.failed}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Gagal</div>
              </div>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.65rem 0 0' }}>
              Status keberhasilan penerimaan oleh penyedia (Fonnte), bukan konfirmasi dibaca.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

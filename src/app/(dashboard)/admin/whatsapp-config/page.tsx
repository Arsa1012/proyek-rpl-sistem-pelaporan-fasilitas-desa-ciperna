'use client';

import { useState, useEffect, useCallback } from 'react';
import './page.css';

interface FonnteDevice {
  id: string;
  deviceName: string | null;
  adminPhone: string;
  isActive: boolean;
  /** true bila token tersimpan di server (nilainya tidak pernah dikirim ke browser). */
  hasToken: boolean;
  lastValidation: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ApiDevice {
  id: string;
  deviceName: string | null;
  adminPhone: string;
  isActive: boolean;
  hasToken?: boolean;
  lastValidation: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MonitoringDeliverySummary {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  pending: number;
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  /** Bukti pengiriman NYATA terakhir (bukan hasil uji/mok). */
  lastRealSuccessAt?: string | null;
  /** Keberhasilan uji/mock terakhir (bukan bukti koneksi). */
  lastTestSuccessAt?: string | null;
  hasRealSuccessfulDelivery?: boolean;
  hasMockDeliveryOnly?: boolean;
}

interface WhatsAppMonitoring {
  deviceName: string | null;
  adminPhone: string | null;
  isActive: boolean;
  isConfigured: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'unknown';
  /** Dasar status: 'inference' (dari riwayat) atau 'not_configured'. */
  connectionStatusBasis?: 'inference' | 'not_configured';
  configSource?: string;
  problems?: string[];
  /** true bila ada bukti pengiriman BERHASIL pada catatan pengiriman. */
  hasSuccessfulDelivery?: boolean;
  lastValidation: string | null;
  lastCheckedAt: string;
  deliverySummary: MonitoringDeliverySummary;
  note?: string;
}

/** Hasil diagnostik DNS/TCP/TLS (tanpa mengirim pesan). */
interface DiagnosticsResult {
  checkedAt: string;
  host: string;
  port: number;
  dns: { ok: boolean; detail: string; data?: Record<string, string | number | null> };
  tcp: { ok: boolean; detail: string; data?: Record<string, string | number | null> };
  tls: { ok: boolean; detail: string; data?: Record<string, string | number | null> };
  summary: string;
  note: string;
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    d.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB'
  );
}

export default function WhatsAppConfigPage() {
  const [devices, setDevices] = useState<FonnteDevice[]>([]);
  const [activeDevice, setActiveDevice] = useState<{
    id: string;
    deviceName: string | null;
    adminPhone: string;
    lastValidation: Date | null;
  } | null>(null);
  const [configError, setConfigError] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [editId, setEditId] = useState<string>('');
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editToken, setEditToken] = useState('');

  const [deviceToDelete, setDeviceToDelete] = useState<{ id: string; name: string } | null>(null);

  const [monitoring, setMonitoring] = useState<WhatsAppMonitoring | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [configSource, setConfigSource] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  // Nomor PENERIMA notifikasi aktif (terpisah dari nomor perangkat pengirim).
  const [activeRecipient, setActiveRecipient] = useState<{
    phone: string;
    label: string | null;
  } | null>(null);
  // Diagnostik DNS/TCP/TLS — tidak mengirim pesan WhatsApp.
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState('');

  const runDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    setDiagError('');
    try {
      const res = await fetch('/api/admin/whatsapp-diagnostics', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Diagnostik gagal dijalankan.');
      setDiagnostics(data?.diagnostics ?? null);
    } catch (e: any) {
      setDiagError(e?.message || 'Diagnostik gagal dijalankan.');
    } finally {
      setDiagLoading(false);
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp-config', {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const mappedDevices: FonnteDevice[] = (data.devices || []).map((d: ApiDevice) => ({
          id: d.id,
          deviceName: d.deviceName,
          adminPhone: d.adminPhone,
          isActive: d.isActive,
          hasToken: d.hasToken !== false,
          lastValidation: d.lastValidation ? new Date(d.lastValidation) : null,
          createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
          updatedAt: d.updatedAt ? new Date(d.updatedAt) : new Date(),
        }));
        setDevices(mappedDevices);
        setActiveDevice(
          data.activeDevice
            ? {
                id: data.activeDevice.id,
                deviceName: data.activeDevice.deviceName,
                adminPhone: data.activeDevice.adminPhone,
                lastValidation: data.activeDevice.lastValidation
                  ? new Date(data.activeDevice.lastValidation)
                  : null,
              }
            : null,
        );
        setMonitoring(data.whatsappMonitoring ?? null);
        setMissingFields(Array.isArray(data.missing) ? data.missing : []);
        setConfigSource(typeof data.configSource === 'string' ? data.configSource : '');
        setActiveRecipient(
          data.activeRecipient && data.activeRecipient.phone
            ? {
                phone: data.activeRecipient.phone,
                label: data.activeRecipient.label ?? null,
              }
            : null
        );
        setConfigError('');
      } else {
        setConfigError('Gagal memuat konfigurasi WhatsApp.');
      }
    } catch (err) {
      setConfigError('Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshMonitoring = async () => {
    setRefreshing(true);
    await fetchDevices();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(''), 5000);
  };

  const openAddModal = () => {
    setShowAddModal(true);
    setShowEditModal(false);
    setShowDeleteModal(false);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
  };

  const openEditModal = (id: string, name: string, phone: string) => {
    setEditId(id);
    setEditName(name);
    setEditPhone(phone);
    setEditToken('');
    setShowEditModal(true);
    setShowAddModal(false);
    setShowDeleteModal(false);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
  };

  const openDeleteModal = (id: string, name: string, isActive: boolean) => {
    if (isActive) {
      showError('Tidak dapat menghapus perangkat aktif. Aktifkan perangkat lain terlebih dahulu.');
      return;
    }
    setDeviceToDelete({ id, name });
    setShowDeleteModal(true);
    setShowAddModal(false);
    setShowEditModal(false);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDeviceToDelete(null);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const body = {
      deviceName: formData.get('deviceName') as string,
      adminPhone: formData.get('adminPhone') as string,
      token: formData.get('token') as string,
    };

    try {
      const res = await fetch('/api/admin/whatsapp-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || 'Perangkat berhasil ditambahkan.');
        closeAddModal();
        fetchDevices();
      } else {
        showError(data.error || 'Gagal menambahkan perangkat.');
      }
    } catch (err) {
      showError('Terjadi kesalahan jaringan.');
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Memakai nilai state (input terkontrol) agar pasti sesuai yang tampil.
    // Token yang dikosongkan TIDAK dikirim → server mempertahankan token lama.
    const body: Record<string, string> = {};
    if (editName.trim()) body.deviceName = editName.trim();
    if (editPhone.trim()) body.adminPhone = editPhone.trim();
    if (editToken.trim()) body.token = editToken.trim();

    try {
      const res = await fetch(`/api/admin/whatsapp-config/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || 'Perangkat berhasil diperbarui.');
        closeEditModal();
        setEditToken('');
        fetchDevices();
      } else {
        showError(data.error || 'Gagal memperbarui perangkat.');
      }
    } catch (err) {
      showError('Terjadi kesalahan jaringan.');
    }
  };

  const activateDevice = (id: string, name: string) => {
    if (!confirm(`Aktifkan perangkat "${name}" sebagai perangkat WhatsApp admin utama?`)) return;
    fetch(`/api/admin/whatsapp-config/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          showSuccess(data.message || 'Perangkat berhasil diaktifkan.');
          fetchDevices();
        } else {
          showError(data.error || 'Gagal mengaktifkan perangkat.');
        }
      })
      .catch(() => {
        showError('Terjadi kesalahan jaringan.');
      });
    closeEditModal();
  };

  const handleDelete = async () => {
    if (!deviceToDelete) return;
    try {
      const res = await fetch(`/api/admin/whatsapp-config/${deviceToDelete.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok) {
        showSuccess(data.message || 'Perangkat berhasil dihapus.');
        closeDeleteModal();
        fetchDevices();
      } else {
        showError(data.error || 'Gagal menghapus perangkat.');
        closeDeleteModal();
      }
    } catch (err) {
      showError('Terjadi kesalahan jaringan.');
      closeDeleteModal();
    }
    setDeviceToDelete(null);
  };

  if (loading) {
    return <div className="admin-page">
      <div className="page-header">
        <h1>Pusat WhatsApp Admin</h1>
      </div>
      <div className="loading">Memuat...</div>
    </div>
  }

  return (
    <div className="admin-page">
      <div className="page-header">
        <div className="page-header-left">
          <h1>Pusat WhatsApp Admin</h1>
          <p>Kelola konfigurasi perangkat WhatsApp Fonnte untuk notifikasi sistem.</p>
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn btn-primary" onClick={openAddModal}>
            + Tambah Perangkat
          </button>
        </div>
      </div>

      {/* Panel pemisahan SENDER (perangkat pengirim) vs RECIPIENT (nomor tujuan) */}
      <div className="card monitoring-card" style={{ marginBottom: '1rem' }}>
        <div className="card-header monitoring-header">
          <h2>Pengirim &amp; Penerima Notifikasi</h2>
          <a href="/admin/whatsapp-recipients" className="btn btn-sm btn-secondary">
            Kelola Penerima
          </a>
        </div>
        <div className="card-body">
          <div className="monitoring-grid">
            <div className="monitoring-item">
              <span className="monitoring-label">📤 SENDER — Perangkat Pengirim</span>
              <span className="monitoring-value">
                {activeDevice?.deviceName || monitoring?.deviceName || 'Belum ada perangkat aktif'}
              </span>
              <span className="monitoring-sub">
                Nomor perangkat Fonnte: {activeDevice?.adminPhone || monitoring?.adminPhone || '-'}
                <br />
                Hanya nomor perangkat ini, BUKAN nomor tujuan notifikasi.
              </span>
            </div>
            <div className="monitoring-item">
              <span className="monitoring-label">📥 RECIPIENT — Nomor Tujuan Notifikasi</span>
              <span className="monitoring-value">
                {activeRecipient ? activeRecipient.phone : 'Belum ada penerima aktif'}
              </span>
              <span className="monitoring-sub">
                {activeRecipient
                  ? `${activeRecipient.label || 'Tanpa label'} — menerima semua notifikasi Admin.`
                  : 'Notifikasi Admin akan DIHENTIKAN dan dicatat FAILED. Tidak ada fallback otomatis ke nomor perangkat.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Status Monitoring WhatsApp Fonnte */}
      <div className="card monitoring-card">
        <div className="card-header monitoring-header">
          <h2>Status Monitoring WhatsApp</h2>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={refreshMonitoring}
            disabled={refreshing}
          >
            {refreshing ? 'Memeriksa...' : 'Muat Ulang Status'}
          </button>
        </div>
        <div className="card-body">
          {!monitoring ? (
            <p className="monitoring-empty">Status monitoring belum tersedia.</p>
          ) : (
            <>
              <div className="monitoring-grid">
                <div className="monitoring-item">
                  <span className="monitoring-label">Perangkat Aktif</span>
                  <span className="monitoring-value">
                    {monitoring.deviceName || activeDevice?.deviceName || 'Belum ada'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Nomor Admin</span>
                  <span className="monitoring-value">
                    {monitoring.adminPhone || activeDevice?.adminPhone || 'Belum diatur'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Status Konfigurasi</span>
                  <span className={`badge ${monitoring.isConfigured ? 'badge-success' : 'badge-danger'}`}>
                    {monitoring.isConfigured ? 'Lengkap' : 'Belum Lengkap'}
                  </span>
                  <span className="monitoring-sub">
                    Sumber: {configSource === 'database' ? 'Database' : configSource === 'env' ? 'Environment (.env)' : '-'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Status Koneksi</span>
                  <span
                    className={`badge ${
                      monitoring.connectionStatus === 'connected'
                        ? 'badge-success'
                        : monitoring.connectionStatus === 'disconnected'
                          ? 'badge-danger'
                          : 'badge-inactive'
                    }`}
                  >
                    {monitoring.connectionStatus === 'connected'
                      ? 'Terhubung'
                      : monitoring.connectionStatus === 'disconnected'
                        ? 'Terputus'
                        : 'Belum Pasti'}
                  </span>
                  <span className="monitoring-sub">
                    {monitoring.connectionStatusBasis === 'inference'
                      ? 'Status ini INFERENSI dari catatan pengiriman NYATA 24 jam terakhir (pengiriman uji/mock tidak dihitung), bukan pemeriksaan langsung ke Fonnte.'
                      : 'Status koneksi tidak dapat dinilai karena konfigurasi belum lengkap.'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Bukti Pengiriman Nyata</span>
                  <span className="monitoring-value">
                    {monitoring.deliverySummary.hasRealSuccessfulDelivery
                      ? formatDateTime(monitoring.deliverySummary.lastRealSuccessAt)
                      : 'Belum ada'}
                  </span>
                  <span className="monitoring-sub">
                    {monitoring.deliverySummary.hasRealSuccessfulDelivery
                      ? 'Pengiriman sungguhan terakhir yang tercatat (bukan uji).'
                      : 'Belum ada bukti pengiriman nyata ke nomor asli.'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Pengiriman Uji (Mock) Terakhir</span>
                  <span className="monitoring-value">
                    {monitoring.deliverySummary.lastTestSuccessAt
                      ? formatDateTime(monitoring.deliverySummary.lastTestSuccessAt)
                      : 'Tidak ada'}
                  </span>
                  <span className="monitoring-sub">
                    {monitoring.deliverySummary.hasMockDeliveryOnly
                      ? 'Hanya ada pengiriman uji/mok — TIDAK dihitung sebagai bukti koneksi.'
                      : 'Pengiriman uji tidak dihitung sebagai bukti koneksi atau pesan terkirim.'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Error Terakhir</span>
                  <span className="monitoring-value">
                    {monitoring.deliverySummary.lastError || 'Tidak ada error'}
                  </span>
                  <span className="monitoring-sub">
                    {monitoring.deliverySummary.lastFailedAt
                      ? `Tercatat ${formatDateTime(monitoring.deliverySummary.lastFailedAt)}` +
                        (monitoring.deliverySummary.lastError?.startsWith('network_error:')
                          ? ` — jenis: ${monitoring.deliverySummary.lastError.split(':')[1]} (masalah jaringan)`
                          : monitoring.deliverySummary.lastError?.startsWith('network_error')
                            ? ' — jenis: masalah jaringan (kode detail tidak tersimpan)'
                            : '')
                      : 'Belum ada kegagalan tercatat.'}
                  </span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Waktu Pemeriksaan</span>
                  <span className="monitoring-value">{formatDateTime(monitoring.lastCheckedAt)}</span>
                </div>
                <div className="monitoring-item">
                  <span className="monitoring-label">Validasi Terakhir</span>
                  <span className="monitoring-value">
                    {monitoring.lastValidation ? formatDateTime(monitoring.lastValidation) : 'Belum pernah'}
                  </span>
                </div>
              </div>

              {missingFields.length > 0 && (
                <div className="alert alert-error" role="alert" style={{ marginTop: '0.75rem' }}>
                  Konfigurasi belum lengkap. Kolom yang kurang: {missingFields.join(', ')}
                </div>
              )}

              {(monitoring.problems?.length || 0) > 0 && (
                <div className="alert alert-error" role="alert" style={{ marginTop: '0.75rem' }}>
                  <strong>Perangkat aktif bermasalah — notifikasi TIDAK dikirim memakai perangkat lain.</strong>
                  <ul style={{ margin: '0.35rem 0 0 1.1rem' }}>
                    {monitoring.problems!.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="monitoring-delivery">
                <h3>Diagnostik Koneksi (DNS / TCP / TLS)</h3>
                <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Pemeriksaan ini TIDAK mengirim pesan WhatsApp dan tidak memakai token. Koneksi jaringan
                  berhasil <strong>bukan</strong> berarti pesan terkirim — bukti pengiriman tetap berasal dari
                  catatan pengiriman nyata.
                </p>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={runDiagnostics}
                  disabled={diagLoading}
                >
                  {diagLoading ? 'Memeriksa...' : 'Jalankan Diagnostik Koneksi'}
                </button>
                {diagError && (
                  <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem' }}>
                    {diagError}
                  </div>
                )}
                {diagnostics && (
                  <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                    <div className="monitoring-stat" style={{ alignItems: 'flex-start' }}>
                      <span className={`badge ${diagnostics.dns.ok ? 'badge-success' : 'badge-danger'}`}>
                        DNS {diagnostics.dns.ok ? 'OK' : 'GAGAL'}
                      </span>
                      <span className="monitoring-sub">
                        {diagnostics.dns.detail}
                        {diagnostics.dns.data?.addresses ? ` — ${diagnostics.dns.data.addresses}` : ''}
                      </span>
                    </div>
                    <div className="monitoring-stat" style={{ alignItems: 'flex-start' }}>
                      <span className={`badge ${diagnostics.tcp.ok ? 'badge-success' : 'badge-danger'}`}>
                        TCP {diagnostics.tcp.ok ? 'OK' : 'GAGAL'}
                      </span>
                      <span className="monitoring-sub">
                        {diagnostics.tcp.detail}
                        {diagnostics.tcp.data?.code ? ` (${diagnostics.tcp.data.code})` : ''}
                      </span>
                    </div>
                    <div className="monitoring-stat" style={{ alignItems: 'flex-start' }}>
                      <span className={`badge ${diagnostics.tls.ok ? 'badge-success' : 'badge-danger'}`}>
                        TLS {diagnostics.tls.ok ? 'OK' : 'GAGAL'}
                      </span>
                      <span className="monitoring-sub">
                        {diagnostics.tls.detail}
                        {diagnostics.tls.data?.protocol ? ` — ${diagnostics.tls.data.protocol}` : ''}
                        {diagnostics.tls.data?.validTo ? ` — berlaku s/d ${diagnostics.tls.data.validTo}` : ''}
                      </span>
                    </div>
                    <p className="monitoring-note" style={{ marginTop: 0 }}>
                      Diperiksa {formatDateTime(diagnostics.checkedAt)} terhadap {diagnostics.host}:{diagnostics.port}.{' '}
                      {diagnostics.summary}
                    </p>
                  </div>
                )}
              </div>

              <div className="monitoring-delivery">
                <h3>Ringkasan Pengiriman</h3>
                <div className="monitoring-stats">
                  <div className="monitoring-stat">
                    <span className="monitoring-stat-value">{monitoring.deliverySummary.total}</span>
                    <span className="monitoring-stat-label">Total</span>
                  </div>
                  <div className="monitoring-stat monitoring-stat-success">
                    <span className="monitoring-stat-value">{monitoring.deliverySummary.success}</span>
                    <span className="monitoring-stat-label">Berhasil</span>
                  </div>
                  <div className="monitoring-stat monitoring-stat-failed">
                    <span className="monitoring-stat-value">{monitoring.deliverySummary.failed}</span>
                    <span className="monitoring-stat-label">Gagal</span>
                  </div>
                  <div className="monitoring-stat">
                    <span className="monitoring-stat-value">{monitoring.deliverySummary.skipped}</span>
                    <span className="monitoring-stat-label">Dilewati</span>
                  </div>
                  <div className="monitoring-stat">
                    <span className="monitoring-stat-value">{monitoring.deliverySummary.pending}</span>
                    <span className="monitoring-stat-label">Menunggu</span>
                  </div>
                </div>
                <p className="monitoring-sub">
                  Terakhir berhasil:{' '}
                  {monitoring.deliverySummary.lastSentAt
                    ? formatDateTime(monitoring.deliverySummary.lastSentAt)
                    : 'belum ada'}{' '}
                  · Terakhir gagal:{' '}
                  {monitoring.deliverySummary.lastFailedAt
                    ? formatDateTime(monitoring.deliverySummary.lastFailedAt)
                    : 'belum ada'}
                </p>
                {monitoring.deliverySummary.lastError && (
                  <p className="monitoring-error">Error terakhir: {monitoring.deliverySummary.lastError}</p>
                )}
              </div>

              {monitoring.note && <p className="monitoring-note">{monitoring.note}</p>}
            </>
          )}
        </div>
      </div>

      {configError && (
        <div className="alert alert-error" role="alert">
          {configError}
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success" role="alert">
          {successMsg}
          <button type="button" className="alert-close" onClick={() => setSuccessMsg('')}>
            ✕
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="alert alert-error" role="alert">
          {errorMsg}
          <button type="button" className="alert-close" onClick={() => setErrorMsg('')}>
            ✕
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2>Daftar Perangkat WhatsApp</h2>
        </div>
        <div className="card-body">
          {devices.length === 0 ? (
            <div className="empty-state">
              <p>Belum ada perangkat WhatsApp terdaftar.</p>
              <button type="button" className="btn btn-primary" onClick={openAddModal}>
                + Tambah Perangkat Pertama
              </button>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Nama Perangkat</th>
                    <th>Nomor Admin</th>
                    <th>Token</th>
                    <th>Status</th>
                    <th>Terakhir diverifikasi</th>
                    <th>Dibuat</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => {
                    const isActive = activeDevice?.id === d.id;
                    return (
                      <tr key={d.id}>
                        <td>
                          <span className="device-name">{d.deviceName || 'Tanpa Nama'}</span>
                          {isActive && (
                            <span className="badge badge-active" title="Sedang aktif">AKTIF</span>
                          )}
                        </td>
                        <td>{d.adminPhone}</td>
                        <td>
                          {d.hasToken ? (
                            <span className="badge badge-success" title="Token tersimpan di server">
                              Tersimpan
                            </span>
                          ) : (
                            <span className="badge badge-danger" title="Token belum diisi">
                              Kosong
                            </span>
                          )}
                        </td>
                        <td>
                          {isActive ? (
                            <span className="badge badge-success">Aktif</span>
                          ) : (
                            <span className="badge badge-inactive">Tidak Aktif</span>
                          )}
                        </td>
                        <td>
                          {d.lastValidation ? (
                            <span>{new Date(d.lastValidation).toLocaleString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })} WIB</span>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>Belum pernah</span>
                          )}
                        </td>
                        <td>{new Date(d.createdAt).toLocaleDateString('id-ID', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}</td>
                        <td className="actions">
                          {!isActive && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => activateDevice(d.id, d.deviceName || 'Tanpa Nama')}
                              title="Jadikan Aktif"
                            >
                              Jadikan Aktif
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => openEditModal(d.id, d.deviceName || '', d.adminPhone)}
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => openDeleteModal(d.id, d.deviceName || 'Tanpa Nama', d.isActive)}
                            title="Hapus"
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <dialog id="add-device-modal" className="modal" open={showAddModal}>
        <div className="modal-content">
          <div className="modal-header">
            <h2>Tambah Perangkat WhatsApp</h2>
            <button type="button" className="modal-close" onClick={closeAddModal}>
              ✕
            </button>
          </div>
          <div className="modal-body">
            <form id="add-device-form" onSubmit={handleAddSubmit}>
              <div className="form-group">
                <label htmlFor="add-device-name">Nama Perangkat</label>
                <input
                  type="text"
                  id="add-device-name"
                  name="deviceName"
                  placeholder="Contoh: WhatsApp A"
                  required
                  maxLength={100}
                />
                <p className="form-hint">Nama untuk mengidentifikasi perangkat ini.</p>
              </div>

              <div className="form-group">
                <label htmlFor="add-admin-phone">Nomor Admin</label>
                <input
                  type="tel"
                  id="add-admin-phone"
                  name="adminPhone"
                  placeholder="Contoh: 082118727522"
                  required
                  maxLength={20}
                />
                <p className="form-hint">Nomor WhatsApp admin yang akan menerima notifikasi.</p>
              </div>

              <div className="form-group">
                <label htmlFor="add-token">Token Fonnte</label>
                <input
                  type="password"
                  id="add-token"
                  name="token"
                  placeholder="Token API Fonnte"
                  required
                  maxLength={255}
                />
                <p className="form-hint">
                  Token akan disimpan aman di server dan tidak akan ditampilkan kembali.
                </p>
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeAddModal}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Simpan Perangkat
                </button>
              </div>
            </form>
          </div>
        </div>
      </dialog>

      <dialog id="edit-device-modal" className="modal" open={showEditModal}>
        <div className="modal-content">
          <div className="modal-header">
            <h2>Edit Perangkat WhatsApp</h2>
            <button type="button" className="modal-close" onClick={closeEditModal}>
              ✕
            </button>
          </div>
          <div className="modal-body">
            <form id="edit-device-form" onSubmit={handleEditSubmit}>
              <input type="hidden" id="edit-device-id" value={editId} />
              <div className="form-group">
                <label htmlFor="edit-device-name">Nama Perangkat</label>
                <input
                  type="text"
                  id="edit-device-name"
                  name="deviceName"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label htmlFor="edit-admin-phone">Nomor Admin</label>
                <input
                  type="tel"
                  id="edit-admin-phone"
                  name="adminPhone"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  required
                  maxLength={20}
                />
                <p className="form-hint">
                  Nomor ini menjadi PENERIMA notifikasi Admin dan berasal dari perangkat ini.
                </p>
              </div>

              <div className="form-group">
                <label htmlFor="edit-token">Token Fonnte</label>
                <input
                  type="password"
                  id="edit-token"
                  name="token"
                  value={editToken}
                  onChange={(e) => setEditToken(e.target.value)}
                  placeholder="Biarkan kosong jika tidak ingin mengubah"
                  maxLength={255}
                  autoComplete="new-password"
                />
                <p className="form-hint">
                  Biarkan kosong bila hanya ingin mengganti nama atau nomor — token lama tetap dipakai.
                  Token tidak akan pernah ditampilkan kembali.
                </p>
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closeEditModal}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      </dialog>

      <dialog id="confirm-delete-modal" className="modal" open={showDeleteModal}>
        <div className="modal-content">
          <div className="modal-header">
            <h2>Hapus Perangkat</h2>
            <button type="button" className="modal-close" onClick={closeDeleteModal}>
              ✕
            </button>
          </div>
          <div className="modal-body">
            <p id="delete-confirm-message">Anda yakin ingin menghapus perangkat ini?</p>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={closeDeleteModal}>
                Batal
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Hapus
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
'use client';

import { useCallback, useEffect, useState } from 'react';
import './admin-config.css';

interface Recipient {
  id: string;
  label: string;
  phone: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  notes: string | null;
  adminName: string | null;
  at: string;
}

interface ApiPayload {
  recipients?: Recipient[];
  active?: { id?: string | null; phone: string; label: string | null } | null;
  source?: string;
  problems?: string[];
  totalRecipients?: number;
  history?: HistoryEntry[];
  error?: string;
  message?: string;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
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

/**
 * MANAGER PENERIMA NOTIFIKASI WHATSAPP.
 *
 * Terpisah dari "Pusat WhatsApp Admin" (yangmanaged perangkat PENGIRIM
 * Fonnte). Halaman ini mengelola nomor PENERIMA notifikasi Admin.
 *
 * Aturan yang dijaga UI ini:
 *  - Hanya SATU nomor berstatus aktif.
 *  - Nomor lama tidak dihapus permanen (nonaktifkan = soft-delete).
 *  - Bila tidak ada nomor aktif, notifikasi Admin DIHENTIKAN (tidak ada
 *    fallback diam-diam ke nomor perangkat pengirim).
 */
export default function WhatsAppRecipientsManager() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [active, setActive] = useState<{ phone: string; label: string | null } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  // Pesan error untuk aksi yang dilakukan DI DALAM modal (tambah/ubah).
  // Dirender di dalam modal agar tidak tertutup overlay — pesan tetap
  // terlihat di desktop, mobile, maupun viewport pendek.
  const [modalError, setModalError] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [busyId, setBusyId] = useState<string>('');

  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    window.setTimeout(() => setSuccessMsg(''), 5000);
  }, []);
  const showError = useCallback((msg: string) => {
    setErrorMsg(msg);
    window.setTimeout(() => setErrorMsg(''), 6000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp-recipients?history=1', { cache: 'no-store' });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Gagal memuat daftar penerima.');
        return;
      }
      setRecipients(Array.isArray(data.recipients) ? data.recipients : []);
      setActive(data.active ?? null);
      setProblems(Array.isArray(data.problems) ? data.problems : []);
      setHistory(Array.isArray(data.history) ? data.history : []);
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const resetForm = () => {
    setLabel('');
    setPhone('');
    setNotes('');
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/whatsapp-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), phone: phone.trim(), notes: notes.trim() }),
      });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Modal TETAP TERBUKA dan isian tidak hilang; pesan tampil di dalam modal.
        setModalError(data.error || 'Gagal menambahkan penerima.');
        return;
      }
      setModalError('');
      showSuccess(data.message || 'Penerima berhasil ditambahkan.');
      setShowAdd(false);
      resetForm();
      load();
    } catch {
      setModalError('Terjadi kesalahan jaringan.');
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      const res = await fetch(`/api/admin/whatsapp-recipients/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          phone: phone.trim(),
          notes: notes.trim(),
        }),
      });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Modal TETAP TERBUKA dan isian tidak hilang; pesan tampil di dalam modal.
        setModalError(data.error || 'Gagal memperbarui penerima.');
        return;
      }
      setModalError('');
      showSuccess(data.message || 'Penerima berhasil diperbarui.');
      setEditing(null);
      resetForm();
      load();
    } catch {
      setModalError('Terjadi kesalahan jaringan.');
    }
  };

  const setActiveRecipient = async (r: Recipient, isActive: boolean) => {
    if (isActive && !confirm(`Jadikan "${r.label}" sebagai penerima notifikasi aktif?`)) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/whatsapp-recipients/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Gagal mengubah status penerima.');
        return;
      }
      showSuccess(data.message || 'Status penerima diperbarui.');
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusyId('');
    }
  };

  const disableRecipient = async (r: Recipient) => {
    const reason = window.prompt(
      `Alasan menonaktifkan "${r.label}" (opsional). Nomor tetap tersimpan dan dapat diaktifkan kembali.`
    );
    if (reason === null) return;
    setBusyId(r.id);
    try {
      const res = await fetch(`/api/admin/whatsapp-recipients/${r.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Gagal menonaktifkan penerima.');
        return;
      }
      showSuccess(data.message || 'Penerima dinonaktifkan.');
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusyId('');
    }
  };

  const migrateLegacy = async () => {
    if (
      !confirm(
        'Migrasikan nomor admin pada perangkat Fonnte aktif menjadi penerima notifikasi aktif?\n' +
          'Proses ini idempoten (aman dijalankan berkali-kali) dan tidak menghapus data perangkat Fonnte.'
      )
    )
      return;
    setBusyId('__migrate__');
    try {
      const res = await fetch('/api/admin/whatsapp-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'migrate-legacy' }),
      });
      const data: ApiPayload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.error || 'Migrasi gagal.');
        return;
      }
      showSuccess(data.message || 'Migrasi selesai.');
      load();
    } catch {
      showError('Terjadi kesalahan jaringan.');
    } finally {
      setBusyId('');
    }
  };

  /** Buka modal tambah: bersihkan error modal & pesan halaman yang stale. */
  const openAdd = () => {
    setModalError('');
    setErrorMsg('');
    setShowAdd(true);
  };

  /** Tutup modal tambah: modal tetap bisa dibuka lagi tanpa pesan basi. */
  const closeAdd = () => {
    setModalError('');
    setShowAdd(false);
  };

  const openEdit = (r: Recipient) => {
    setModalError('');
    setErrorMsg('');
    setEditing(r);
    setLabel(r.label);
    setPhone(r.phone);
    setNotes(r.notes || '');
  };

  const closeEdit = () => {
    setModalError('');
    setEditing(null);
  };

  return (
    <div>
      {successMsg && (
        <div className="cfg-alert success" role="status">
          <span aria-hidden="true">✅</span>
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="cfg-alert error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Penjelasan SENDER vs RECIPIENT — wajib jelas agar Admin tidak salah. */}
      <div className="cfg-role-split">
        <div className="cfg-role-card">
          <p className="cfg-role-title">📤 SENDER — perangkat pengirim</p>
          <p className="cfg-role-body">
            Perangkat WhatsApp Fonnte yang dipakai untuk mengirim pesan (token &amp; nomor
            perangkat). Diatur di{' '}
            <a href="/admin/whatsapp-config" style={{ color: 'var(--primary-color)' }}>
              Pusat WhatsApp Admin
            </a>
            . Nomor perangkat <strong>tidak otomatis</strong> disalin menjadi penerima di halaman ini.
          </p>
        </div>
        <div className="cfg-role-card cfg-role-card-focus">
          <p className="cfg-role-title">📥 RECIPIENT — nomor tujuan notifikasi</p>
          <p className="cfg-role-body">
            Nomor Admin yang <strong>menerima</strong> notifikasi sistem. Dikelola di halaman ini.
            Tidak harus sama dengan nomor perangkat pengirim — tetapi <strong>bisa</strong> sama.
            Bila nomor yang ingin dipakai sudah terdaftar di bawah, cukup klik{' '}
            <strong>Aktifkan</strong> pada baris tersebut.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="cfg-item-head">
          <div>
            <p className="cfg-item-title">Penerima notifikasi aktif saat ini</p>
            <p className="cfg-item-sub">
              {active
                ? `${active.label || 'Tanpa label'} — ${active.phone}`
                : 'Belum ada penerima aktif. Notifikasi Admin akan DIHENTIKAN (tidak ada fallback otomatis).'}
            </p>
          </div>
          <div className="cfg-badges">
            {active ? (
              <span className="badge success">AKTIF</span>
            ) : (
              <span className="badge danger">TIDAK ADA PENERIMA AKTIF</span>
            )}
          </div>
        </div>

        {problems.length > 0 && (
          <div className="cfg-alert warning" style={{ marginTop: '1rem', marginBottom: 0 }}>
            <span aria-hidden="true">ℹ️</span>
            <div>
              <strong>Perlu perhatian:</strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="cfg-item-actions">
          <button className="btn btn-primary" onClick={openAdd}>
            + Tambah Nomor
          </button>
          <button
            className="btn btn-secondary"
            onClick={migrateLegacy}
            disabled={busyId === '__migrate__'}
            title="Memindahkan nomor admin perangkat Fonnte aktif menjadi penerima notifikasi aktif (idempoten)."
          >
            {busyId === '__migrate__' ? 'Memigrasi…' : 'Migrasi Nomor Admin Lama'}
          </button>
          <button className="btn btn-secondary" onClick={load}>
            Muat Ulang
          </button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem' }}>
          Daftar Penerima ({recipients.length})
        </h2>
        <p className="cfg-item-sub" style={{ marginBottom: '1rem' }}>
          Hanya satu nomor boleh berstatus AKTIF. Nomor yang dinonaktifkan tidak dihapus dan dapat
          diaktifkan kembali kapan saja.
        </p>

        {loading ? (
          <p className="cfg-item-sub">Memuat…</p>
        ) : recipients.length === 0 ? (
          <div className="cfg-alert" style={{ marginBottom: 0 }}>
            <span aria-hidden="true">ℹ️</span>
            <span>
              Belum ada penerima terdaftar. Tambahkan nomor, atau gunakan tombol “Migrasi Nomor Admin
              Lama”.
            </span>
          </div>
        ) : (
          <div className="cfg-list">
            {recipients.map((r) => (
              <div key={r.id} className={`cfg-item${r.isActive ? ' is-active' : ''}`}>
                <div className="cfg-item-head">
                  <div>
                    <p className="cfg-item-title">{r.label}</p>
                    <p className="cfg-item-sub cfg-mono">{r.phone}</p>
                    {r.notes && <p className="cfg-item-sub">{r.notes}</p>}
                    <p className="cfg-item-sub">Diperbarui: {formatDateTime(r.updatedAt)}</p>
                  </div>
                  <div className="cfg-badges">
                    {r.isActive ? (
                      <span className="badge success">AKTIF</span>
                    ) : (
                      <span className="badge">NONAKTIF</span>
                    )}
                  </div>
                </div>
                <div className="cfg-item-actions">
                  {!r.isActive && (
                    <button
                      className="btn btn-primary"
                      onClick={() => setActiveRecipient(r, true)}
                      disabled={busyId === r.id}
                    >
                      Aktifkan
                    </button>
                  )}
                  {r.isActive && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => setActiveRecipient(r, false)}
                      disabled={busyId === r.id}
                    >
                      Nonaktifkan
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    onClick={() => openEdit(r)}
                    disabled={busyId === r.id}
                  >
                    Ubah
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => disableRecipient(r)}
                    disabled={busyId === r.id}
                  >
                    Nonaktifkan (soft)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Riwayat perubahan (dari AdminAuditLog) */}
      <div className="card">
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.05rem' }}>Riwayat Perubahan</h2>
        <p className="cfg-item-sub" style={{ marginBottom: '1rem' }}>
          25 perubahan terakhir pada konfigurasi penerima notifikasi (bersumber dari audit log
          Admin).
        </p>
        {history.length === 0 ? (
          <p className="cfg-item-sub">Belum ada riwayat perubahan.</p>
        ) : (
          <div className="cfg-history">
            {history.map((h) => (
              <div key={h.id} className="cfg-history-item">
                <span className="cfg-history-action">{h.action.replace('WA_RECIPIENT_', '')}</span>
                <span className="cfg-history-note">{h.notes || '—'}</span>
                <span className="cfg-history-meta">
                  {h.adminName ? `${h.adminName} · ` : ''}
                  {formatDateTime(h.at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal tambah */}
      {showAdd && (
        <div className="modal-overlay cfg-modal-overlay" role="dialog" aria-modal="true" aria-label="Tambah penerima notifikasi">
          <div className="modal-card card" style={{ maxWidth: 480 }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>Tambah Penerima Notifikasi</h2>
            <form onSubmit={submitAdd}>
              <div className="cfg-field">
                <label htmlFor="wrec-label">Label</label>
                <input
                  id="wrec-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Admin Utama"
                  required
                  maxLength={80}
                />
              </div>
              <div className="cfg-field">
                <label htmlFor="wrec-phone">Nomor WhatsApp</label>
                <input
                  id="wrec-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx atau 62xxxxxxxxxx"
                  required
                  inputMode="tel"
                />
                <p className="cfg-hint">Nomor otomatis dinormalisasi ke format 62xx.</p>
              </div>
              <div className="cfg-field">
                <label htmlFor="wrec-notes">Catatan (opsional)</label>
                <input
                  id="wrec-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="mis. piket malam"
                  maxLength={200}
                />
              </div>
              {/* Petunjuk SENDER vs RECIPIENT (perbaikan 4) */}
              <div className="cfg-role-hint">
                <p className="cfg-role-hint-title">📥 RECIPIENT — nomor tujuan notifikasi</p>
                <p className="cfg-role-hint-body">
                  Nomor yang diisi di sini adalah <strong>nomor penerima</strong> notifikasi Admin.
                  Nomor perangkat Fonnte (<strong>SENDER</strong>) diatur terpisah di{' '}
                  <a href="/admin/whatsapp-config" style={{ color: 'var(--primary-color)' }}>
                    Pusat WhatsApp Admin
                  </a>{' '}
                  dan tidak otomatis disalin ke sini.
                </p>
                <p className="cfg-role-hint-body">
                  Bila nomor ini sudah terdaftar, gunakan tombol <strong>Aktifkan</strong> pada baris
                  yang sudah ada — jangan membuat nomor kembar.
                </p>
              </div>
              <div className="cfg-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeAdd}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Simpan
                </button>
              </div>
              {/* Pesan error dari API ditampilkan DI DALAM modal (sticky di
                  bawah kartu) — tidak tertutup overlay/topbar/sidebar. */}
              {modalError && (
                <div className="cfg-alert error cfg-modal-error" role="alert">
                  <span aria-hidden="true">⚠️</span>
                  <span>{modalError}</span>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Modal ubah */}
      {editing && (
        <div className="modal-overlay cfg-modal-overlay" role="dialog" aria-modal="true" aria-label="Ubah penerima notifikasi">
          <div className="modal-card card" style={{ maxWidth: 480 }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>Ubah Penerima Notifikasi</h2>
            <form onSubmit={submitEdit}>
              <div className="cfg-field">
                <label htmlFor="wrec-edit-label">Label</label>
                <input
                  id="wrec-edit-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                  maxLength={80}
                />
              </div>
              <div className="cfg-field">
                <label htmlFor="wrec-edit-phone">Nomor WhatsApp</label>
                <input
                  id="wrec-edit-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  inputMode="tel"
                />
              </div>
              <div className="cfg-field">
                <label htmlFor="wrec-edit-notes">Catatan</label>
                <input
                  id="wrec-edit-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="cfg-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeEdit}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary">
                  Simpan Perubahan
                </button>
              </div>
              {/* Pesan error dari API ditampilkan DI DALAM modal (sticky di
                  bawah kartu) — tidak tertutup overlay/topbar/sidebar. */}
              {modalError && (
                <div className="cfg-alert error cfg-modal-error" role="alert">
                  <span aria-hidden="true">⚠️</span>
                  <span>{modalError}</span>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

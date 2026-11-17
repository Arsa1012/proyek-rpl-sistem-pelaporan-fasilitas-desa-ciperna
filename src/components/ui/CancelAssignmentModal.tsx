'use client';

import { useState } from 'react';

interface CancelAssignmentModalProps {
  assignmentId: string;
  reportId: string;
  reportTitle: string;
  officerName: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

// Modal konfirmasi pembatalan penugasan. Alasan wajib diisi.
export function CancelAssignmentModal({
  assignmentId,
  reportId,
  reportTitle,
  officerName,
  onClose,
  onSuccess,
}: CancelAssignmentModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!reason.trim()) {
      setError('Alasan pembatalan wajib diisi.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || 'Gagal membatalkan penugasan.');
        return;
      }
      onSuccess(data?.message || 'Penugasan berhasil dibatalkan.');
      onClose();
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Konfirmasi pembatalan penugasan"
    >
      <div className="modal-card glass" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span aria-hidden="true">⚠️</span> Batalkan Penugasan?
        </h3>

        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
          Anda akan membatalkan penugasan:
        </p>
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'var(--hover-bg)',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.875rem',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>
            Laporan #{reportId.slice(0, 8)} — {reportTitle}
          </p>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)' }}>
            Petugas: {officerName}
          </p>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Laporan tidak akan dihapus. Laporan akan kembali ke daftar menunggu penugasan.
        </p>

        <form onSubmit={handleConfirm}>
          <label htmlFor="cancel-reason" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Alasan pembatalan <span style={{ color: 'var(--danger-text)' }}>*</span>
          </label>
          <textarea
            id="cancel-reason"
            className="form-input form-textarea"
            placeholder="Contoh: Petugas berhalangan menangani laporan."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            required
            maxLength={500}
          />

          {error && (
            <div className="error-banner" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={loading}
              style={{ flex: 1, justifyContent: 'center', background: 'var(--muted-bg)' }}
            >
              Batal
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={loading || !reason.trim()}
              style={{ flex: 2, justifyContent: 'center' }}
            >
              {loading ? 'Memproses...' : 'Batalkan Penugasan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

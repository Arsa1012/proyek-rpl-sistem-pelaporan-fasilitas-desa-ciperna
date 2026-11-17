'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportStatusLabel } from '@/lib/status';

interface AdminReportActionsProps {
  reportId: string;
  initialStatus: string;
  initialCategory: string | null;
  initialSeverity: string | null;
  categories: string[];
}

export function AdminReportActions({ reportId, initialStatus, initialCategory, initialSeverity, categories }: AdminReportActionsProps) {
  const router = useRouter();
  
  const [status, setStatus] = useState(initialStatus);
  const [category, setCategory] = useState(initialCategory || '');
  const [severity, setSeverity] = useState(initialSeverity || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleUpdateData = async () => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, severity }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal menyimpan perubahan');
      } else {
        setSuccessMessage('Data berhasil diperbarui');
        router.refresh();
      }
    } catch (err) {
      setError('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!window.confirm('Anda yakin ingin menyetujui (VERIFIED) laporan ini?')) return;

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'VERIFIED' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal menyetujui laporan');
      } else {
        setStatus('VERIFIED');
        setSuccessMessage('Laporan berhasil disetujui');
        router.refresh();
      }
    } catch (err) {
      setError('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Masukkan alasan penolakan:');
    if (reason === null) return; // User cancelled
    if (reason.trim() === '') {
      setError('Alasan penolakan wajib diisi');
      return;
    }

    if (!window.confirm('Anda yakin ingin menolak laporan ini?')) return;

    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED', rejectionReason: reason }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal menolak laporan');
      } else {
        setStatus('REJECTED');
        setSuccessMessage('Laporan berhasil ditolak');
        router.refresh();
      }
    } catch (err) {
      setError('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem' }}>⚙️ Tindakan Admin</h3>

      {error && (
        <div className="error-banner" style={{ margin: 0, padding: '0.5rem', fontSize: '0.8rem' }}>
          ⚠️ {error}
        </div>
      )}
      {successMessage && (
        <div style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success-text)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid rgba(16,185,129,0.35)' }}>
          ✅ {successMessage}
        </div>
      )}

      {/* Form Edit Category & Severity */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--hover-bg)', padding: '0.75rem', borderRadius: '8px' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600 }}>Edit Data AI</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <select 
            value={category} 
            onChange={e => setCategory(e.target.value)}
            className="filter-select"
            disabled={loading}
          >
            <option value="">-- Pilih Kategori --</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          
          <select 
            value={severity} 
            onChange={e => setSeverity(e.target.value)}
            className="filter-select"
            disabled={loading}
          >
            <option value="">-- Pilih Tingkat Keparahan --</option>
            <option value="RENDAH">RENDAH</option>
            <option value="SEDANG">SEDANG</option>
            <option value="TINGGI">TINGGI</option>
            <option value="KRITIS">KRITIS</option>
          </select>
          <button 
            onClick={handleUpdateData}
            disabled={loading || (category === (initialCategory || '') && severity === (initialSeverity || ''))}
            className="btn"
            style={{ fontSize: '0.8rem', padding: '0.4rem', justifyContent: 'center', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}
          >
            Simpan Perubahan
          </button>
        </div>
      </div>

      {/* Verification Actions */}
      {status === 'SUBMITTED' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            onClick={handleApprove}
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            ✅ Setujui Laporan
          </button>
          <button
            onClick={handleReject}
            disabled={loading}
            className="btn btn-danger"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            ❌ Tolak Laporan
          </button>
        </div>
      )}

      {status !== 'SUBMITTED' && (
         <div style={{ padding: '0.5rem', background: 'var(--hover-bg)', borderRadius: '8px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
           Status laporan saat ini: <strong>{reportStatusLabel(status)}</strong>
         </div>
      )}
    </div>
  );
}

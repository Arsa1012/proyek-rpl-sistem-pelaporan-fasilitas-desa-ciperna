'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Officer {
  id: string;
  name: string;
  email: string;
  _count: { assignments: number };
}

interface AssignOfficerPanelProps {
  reportId: string;
  reportTitle: string;
}

export function AssignOfficerPanel({ reportId, reportTitle }: AssignOfficerPanelProps) {
  const router = useRouter();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [selectedOfficerId, setSelectedOfficerId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function fetchOfficers() {
      try {
        const res = await fetch('/api/officers');
        if (!res.ok) throw new Error('Gagal mengambil daftar petugas');
        const data = await res.json();
        setOfficers(data.officers || []);
      } catch (err: any) {
        setError(err.message || 'Gagal memuat daftar petugas');
      } finally {
        setFetchLoading(false);
      }
    }
    fetchOfficers();
  }, []);

  async function handleAssign() {
    if (!selectedOfficerId) {
      setError('Pilih petugas terlebih dahulu');
      return;
    }

    const selectedOfficer = officers.find(o => o.id === selectedOfficerId);
    const confirmed = window.confirm(
      `Tugaskan laporan "${reportTitle}" kepada ${selectedOfficer?.name}?\n\nStatus laporan akan berubah menjadi ASSIGNED.`
    );
    if (!confirmed) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, officerId: selectedOfficerId, notes: notes || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Gagal membuat assignment');
        return;
      }

      setSuccess(data.message || 'Laporan berhasil ditugaskan!');
      setSelectedOfficerId('');
      setNotes('');

      // Refresh halaman untuk menampilkan data terbaru
      setTimeout(() => router.refresh(), 1000);
    } catch (err: any) {
      setError('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass" style={{ padding: '1.25rem' }}>
      <h3 style={{ marginBottom: '1rem', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        👷 Tugaskan ke Petugas
      </h3>

      {fetchLoading ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Memuat daftar petugas...</p>
      ) : officers.length === 0 ? (
        <div style={{
          padding: '1rem',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem',
          color: 'var(--warning-text)',
        }}>
          ⚠️ Belum ada petugas terdaftar di sistem. Tambahkan user dengan role OFFICER terlebih dahulu.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
              PILIH PETUGAS
            </label>
            <select
              value={selectedOfficerId}
              onChange={e => {
                setSelectedOfficerId(e.target.value);
                setError('');
              }}
              className="filter-select"
              style={{ width: '100%' }}
              disabled={loading}
            >
              <option value="">-- Pilih Petugas --</option>
              {officers.map(officer => (
                <option key={officer.id} value={officer.id}>
                  {officer.name} — {officer._count.assignments} tugas aktif/total
                </option>
              ))}
            </select>
          </div>

          {selectedOfficerId && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(37, 99, 235, 0.05)',
              border: '1px solid rgba(37, 99, 235, 0.15)',
              borderRadius: '8px',
            }}>
              {(() => {
                const o = officers.find(x => x.id === selectedOfficerId);
                return o ? (
                  <div style={{ fontSize: '0.8rem' }}>
                    <p style={{ fontWeight: 600, margin: '0 0 0.2rem' }}>{o.name}</p>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{o.email}</p>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                      Total penugasan: {o._count.assignments}
                    </p>
                  </div>
                ) : null;
              })()}
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
              CATATAN (opsional)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Catatan instruksi untuk petugas..."
              rows={2}
              className="filter-select"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.875rem' }}
              disabled={loading}
            />
          </div>

          {error && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: 'var(--danger-text)',
            }}>
              ❌ {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: '0.75rem',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: 'var(--success-text)',
            }}>
              ✅ {success}
            </div>
          )}

          <button
            onClick={handleAssign}
            disabled={loading || !selectedOfficerId}
            className="btn btn-primary"
            style={{ width: '100%', opacity: (!selectedOfficerId || loading) ? 0.6 : 1 }}
          >
            {loading ? (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Menugaskan...
              </span>
            ) : (
              '👷 Tugaskan Laporan'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface DuplicateActionsProps {
  reportId: string;
  duplicateStatus: string;
  currentMainId?: string | null;
}

// Tombol aksi duplikat untuk daftar review Admin.
export function DuplicateActions({ reportId, duplicateStatus, currentMainId }: DuplicateActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showSetMain, setShowSetMain] = useState(false);
  const [newMainId, setNewMainId] = useState('');

  async function call(action: 'confirm' | 'reject' | 'cancel' | 'set-main' | 'flag', mainReportId?: string) {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/admin/duplicates/${reportId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mainReportId ? { mainReportId } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Aksi gagal.');
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Aksi gagal.');
    } finally {
      setBusy(null);
    }
  }

  const shortMain = currentMainId ? currentMainId.slice(0, 8) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Link
          href={`/admin/laporan/${reportId}`}
          className="btn"
          style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(15,118,110,0.1)', color: 'var(--primary-color)' }}
        >
          Lihat Laporan
        </Link>
        {duplicateStatus === 'POSSIBLE_DUPLICATE' && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => call('confirm')}
              style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem' }}
            >
              {busy === 'confirm' ? '…' : 'Konfirmasi Duplikat'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => call('reject')}
              style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'var(--muted-bg)' }}
            >
              {busy === 'reject' ? '…' : 'Bukan Duplikat'}
            </button>
          </>
        )}
        {duplicateStatus === 'DUPLICATE' && (
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => call('cancel')}
            style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(239,68,68,0.08)', color: 'var(--danger-text)' }}
          >
            {busy === 'cancel' ? '…' : 'Batalkan Penandaan'}
          </button>
        )}
        {(duplicateStatus === 'POSSIBLE_DUPLICATE' || duplicateStatus === 'DUPLICATE') && (
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            onClick={() => setShowSetMain((v) => !v)}
            style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(124,58,237,0.12)', color: 'var(--purple-text)' }}
          >
            Jadikan Laporan Utama Lain
          </button>
        )}
      </div>

      {showSetMain && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newMainId.trim()) call('set-main', newMainId.trim());
          }}
          style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}
        >
          <input
            type="text"
            className="filter-select"
            placeholder={shortMain ? `Utama saat ini: ${shortMain} — isi ID baru` : 'ID laporan utama baru'}
            value={newMainId}
            onChange={(e) => setNewMainId(e.target.value)}
            style={{ flex: 1, fontSize: '0.8rem' }}
          />
          <button type="submit" className="btn btn-primary" disabled={!!busy || !newMainId.trim()} style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem' }}>
            Simpan
          </button>
        </form>
      )}

      {error && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--danger-text)' }}>⚠️ {error}</p>
      )}
    </div>
  );
}

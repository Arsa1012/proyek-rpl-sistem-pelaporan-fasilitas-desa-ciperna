'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tombol Admin untuk menghitung ulang seluruh kandidat duplikat dengan algoritma
 * terbaru. Non-destruktif: hanya melepas/menyegarkan penandaan + menulis riwayat.
 */
export function RevalidateDuplicatesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run() {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/duplicates/revalidate', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Gagal memvalidasi ulang.');
      setMessage(
        `Selesai: ${data.checked} kandidat diperiksa, ${data.kept} dipertahankan, ${data.cleared} dilepas (bukti tidak cukup).`
      );
      router.refresh();
    } catch (e: any) {
      setError(e?.message || 'Gagal memvalidasi ulang.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="btn"
        onClick={run}
        disabled={busy}
        style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem', background: 'rgba(15,118,110,0.1)', color: 'var(--primary-color)' }}
        title="Hitung ulang kandidat duplikat memakai algoritma berbasis bukti terbaru"
      >
        {busy ? 'Memvalidasi…' : '↻ Validasi Ulang Semua Kandidat'}
      </button>
      {message && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--success-text)' }}>{message}</p>
      )}
      {error && (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--danger-text)' }}>⚠️ {error}</p>
      )}
    </div>
  );
}

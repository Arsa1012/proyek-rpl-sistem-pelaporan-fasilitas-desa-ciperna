'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function UserDisableButton({
  userId,
  userName,
  isActive,
}: {
  userId: string;
  userName: string;
  isActive: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleToggle = async () => {
    const action = isActive ? 'menonaktifkan' : 'mengaktifkan';
    if (!window.confirm(`Yakin ingin ${action} akun "${userName}"?${isActive ? ' Akun tetap bisa login untuk melihat status, tetapi tidak dapat membuat laporan / memulai tugas baru. Data dan laporannya tetap tersimpan.' : ''}`)) {
      return;
    }

    // Admin wajib mengisi alasan saat menonaktifkan; alasan dikirim ke WhatsApp
    // pemilik akun dan ditampilkan pada banner dashboard-nya.
    let suspendReason: string | undefined;
    if (isActive) {
      const input = window.prompt(`Alasan penonaktifan akun "${userName}" (akan dikirim ke WhatsApp pemilik akun):`, '');
      if (input === null) return;
      suspendReason = input.trim();
      if (!suspendReason) {
        alert('Alasan penonaktifan wajib diisi.');
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive, ...(suspendReason ? { suspendReason } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'Gagal memperbarui status akun');
        return;
      }
      router.refresh();
    } catch {
      alert('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={loading}
      className="btn"
      style={{
        padding: '0.25rem 0.75rem',
        fontSize: '0.8rem',
        background: isActive ? 'rgba(239,68,68,0.1)' : 'rgba(22,163,74,0.1)',
        color: isActive ? 'var(--danger-text)' : 'var(--success-text)',
      }}
      aria-label={isActive ? `Nonaktifkan akun ${userName}` : `Aktifkan akun ${userName}`}
    >
      {loading ? '...' : isActive ? 'Nonaktifkan' : 'Aktifkan'}
    </button>
  );
}

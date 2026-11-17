'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CancelAssignmentButtonProps {
  assignmentId: string;
  reportTitle: string;
}

export function CancelAssignmentButton({ assignmentId, reportTitle }: CancelAssignmentButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    const confirmed = window.confirm(
      `Batalkan penugasan untuk laporan "${reportTitle}"?\n\nStatus laporan akan kembali ke VERIFIED.`
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Gagal membatalkan assignment');
        return;
      }
      router.refresh();
    } catch {
      alert('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleCancel}
      disabled={loading}
      className="btn"
      style={{
        padding: '0.25rem 0.75rem',
        fontSize: '0.8rem',
        background: 'rgba(239, 68, 68, 0.1)',
        color: 'var(--danger-text)',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? '...' : '✕ Batalkan'}
    </button>
  );
}

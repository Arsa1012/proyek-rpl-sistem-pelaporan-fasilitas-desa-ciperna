'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tombol Admin untuk mengirim ULANG notifikasi penyelesaian ke pelapor.
 * Aman & idempoten di server (dedupeKey per laporan) — tidak akan mengirim ganda
 * bila notifikasi sebelumnya sudah berhasil.
 */
export function ResendCompletionButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/notify-completion`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: 'err', text: data.error || 'Gagal mengirim ulang notifikasi.' });
        return;
      }
      const text =
        data.status === 'SENT'
          ? 'Notifikasi berhasil dikirim.'
          : data.status === 'ALREADY_SENT'
          ? 'Notifikasi sudah pernah terkirim (dilewati agar tidak ganda).'
          : data.status === 'NOT_CONFIGURED'
          ? 'Konfigurasi perangkat WhatsApp aktif belum lengkap (periksa menu Admin → Pusat WhatsApp Admin).'
          : `Pengiriman gagal (${data.error || 'tidak diketahui'}). Status laporan tetap Selesai.`;
      setMsg({ type: res.ok && data.success ? 'ok' : 'err', text });
      router.refresh();
    } catch {
      setMsg({ type: 'err', text: 'Gagal terhubung ke server.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="btn"
        style={{ alignSelf: 'flex-start', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)', fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
        title="Mengirim ulang dengan format yang sama seperti saat persetujuan (teks saja / teks + foto)"
      >
        {busy ? 'Mengirim...' : '🔁 Kirim Ulang Notifikasi Penyelesaian'}
      </button>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
        Dikirim ulang dengan format yang sama seperti saat persetujuan. Tidak mengubah status laporan
        dan tidak membuat laporan baru.
      </p>
      {msg && (
        <p style={{ margin: 0, fontSize: '0.78rem', fontWeight: 600, color: msg.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)' }}>
          {msg.type === 'ok' ? '✓ ' : '⚠ '}
          {msg.text}
        </p>
      )}
    </div>
  );
}

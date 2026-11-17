'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type NotifyMode = 'TEXT' | 'TEXT_PHOTO';

/**
 * Dua tindakan Admin yang jelas untuk memverifikasi bukti penyelesaian:
 *  1. Setujui Bukti & Selesaikan Laporan
 *  2. Tolak Bukti & Minta Perbaikan (alasan WAJIB)
 *
 * Sebelum menyetujui, Admin memilih SECARA EKSPLISIT format pemberitahuan ke warga:
 *  - "Teks saja" (default, aman)
 *  - "Teks + foto bukti" (hanya aktif bila foto bukti benar-benar tersedia)
 *
 * Server tetap memvalidasi otorisasi, mencegah persetujuan ganda (409), dan
 * memisahkan status persetujuan laporan dari status pengiriman WhatsApp.
 */
export function ReviewButtons({
  assignmentId,
  reportTitle,
  evidencePhoto,
}: {
  assignmentId: string;
  reportTitle: string;
  /** URL foto bukti terbaru (relatif, mis. /uploads/x.jpg). Bila null, opsi foto dinonaktifkan. */
  evidencePhoto?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [notifyMode, setNotifyMode] = useState<NotifyMode>('TEXT');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const photoAvailable = Boolean(evidencePhoto);

  const decide = async (decision: 'APPROVE' | 'REJECT', notes: string, mode?: NotifyMode) => {
    if (busy) return;
    setBusy(decision);
    setMsg(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes, notifyMode: mode || notifyMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: 'err', text: data.error || 'Gagal memproses keputusan.' });
        return;
      }
      let text = data.message || 'Keputusan tersimpan.';
      if (data.notification) {
        const st = data.notification.status as string;
        const label =
          st === 'SENT'
            ? mode === 'TEXT_PHOTO'
              ? 'Notifikasi WhatsApp (teks + foto) berhasil dikirim.'
              : 'Notifikasi WhatsApp berhasil dikirim.'
            : st === 'ALREADY_SENT'
              ? 'Notifikasi WhatsApp sudah pernah terkirim (tidak dikirim ganda).'
              : st === 'NOT_CONFIGURED'
                ? 'WhatsApp belum dikonfigurasi — status laporan tetap Selesai.'
                : `Notifikasi WhatsApp gagal dikirim (${data.notification.error || 'tidak diketahui'}). Status laporan tetap Selesai; Anda dapat mencoba kirim ulang.`;
        text += ` ${label}`;
        setMsg({ type: st === 'FAILED' ? 'err' : 'ok', text });
      } else {
        setMsg({ type: 'ok', text });
      }
      setConfirmApprove(false);
      setShowReject(false);
      setReason('');
      setAdminNote('');
      router.refresh();
    } catch {
      setMsg({ type: 'err', text: 'Gagal terhubung ke server.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {!confirmApprove && !showReject && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setConfirmApprove(true)}
            disabled={busy !== null}
            className="btn btn-primary"
            style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}
          >
            ✓ Setujui Bukti &amp; Selesaikan Laporan
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            disabled={busy !== null}
            className="btn"
            style={{ background: 'rgba(245,158,11,0.14)', color: 'var(--warning-text)', fontWeight: 600 }}
          >
            ↩ Tolak Bukti &amp; Minta Perbaikan
          </button>
        </div>
      )}

      {confirmApprove && (
        <div
          style={{
            padding: '1rem',
            border: '1px solid rgba(16,185,129,0.35)',
            background: 'rgba(16,185,129,0.06)',
            borderRadius: '10px',
          }}
        >
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600 }}>
            Setujui bukti ini dan nyatakan laporan &quot;{reportTitle}&quot; SELESAI?
          </p>

          {/* Pilihan format pemberitahuan ke warga — WAJIB terlihat sebelum menyetujui. */}
          <fieldset
            style={{
              margin: '0 0 0.85rem',
              padding: '0.7rem 0.85rem',
              border: '1px solid var(--border-color, rgba(0,0,0,0.15))',
              borderRadius: '8px',
            }}
          >
            <legend style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0 0.3rem' }}>
              Format pemberitahuan ke warga (WhatsApp)
            </legend>
            <label style={radioRow}>
              <input
                type="radio"
                name={`notify-mode-${assignmentId}`}
                value="TEXT"
                checked={notifyMode === 'TEXT'}
                onChange={() => setNotifyMode('TEXT')}
                disabled={busy !== null}
              />
              <span>
                📄 <strong>Teks saja</strong>
                <span style={radioHint}> — ringkasan penyelesaian + tautan detail laporan.</span>
              </span>
            </label>
            <label style={{ ...radioRow, opacity: photoAvailable ? 1 : 0.5 }}>
              <input
                type="radio"
                name={`notify-mode-${assignmentId}`}
                value="TEXT_PHOTO"
                checked={notifyMode === 'TEXT_PHOTO'}
                onChange={() => setNotifyMode('TEXT_PHOTO')}
                disabled={busy !== null || !photoAvailable}
              />
              <span>
                🖼️ <strong>Teks + foto bukti pengerjaan</strong>
                <span style={radioHint}>
                  {photoAvailable
                    ? ' — foto bukti dilampirkan pada pesan warga.'
                    : ' — tidak tersedia (belum ada foto bukti).'}
                </span>
              </span>
            </label>
            {notifyMode === 'TEXT_PHOTO' && photoAvailable && (
              <div
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  alignItems: 'center',
                  marginTop: '0.5rem',
                  paddingTop: '0.5rem',
                  borderTop: '1px dashed var(--divider)',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={evidencePhoto as string}
                  alt="Pratinjau foto bukti yang akan dikirim ke warga"
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  Foto ini akan dikirim ke nomor WhatsApp pelapor. Pastikan foto sudah benar dan
                  tidak memuat data pribadi yang tidak perlu.
                </span>
              </div>
            )}
          </fieldset>

          <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Pelapor akan menerima notifikasi penyelesaian. Tindakan ini tercatat permanen.
          </p>

          <label
            htmlFor={`approve-note-${assignmentId}`}
            style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}
          >
            Catatan Admin (opsional, ikut dikirim ke warga)
          </label>
          <textarea
            id={`approve-note-${assignmentId}`}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Contoh: Perbaikan sudah dilakukan; mohon dipelihara bersama."
            disabled={busy !== null}
            style={{
              width: '100%',
              padding: '0.55rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid var(--border, rgba(0,0,0,0.15))',
              fontSize: '0.85rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
              marginBottom: '0.75rem',
            }}
          />

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => decide('APPROVE', adminNote.trim(), notifyMode)}
            >
              {busy === 'APPROVE'
                ? 'Memproses...'
                : notifyMode === 'TEXT_PHOTO'
                  ? 'Ya, Setujui & Kirim Teks + Foto'
                  : 'Ya, Setujui & Kirim Teks'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setConfirmApprove(false);
                setAdminNote('');
              }}
              style={{ background: 'var(--muted-bg)', color: 'var(--text-secondary)' }}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {showReject && (
        <div
          style={{
            padding: '1rem',
            border: '1px solid rgba(245,158,11,0.4)',
            background: 'rgba(245,158,11,0.06)',
            borderRadius: '10px',
          }}
        >
          <label htmlFor={`reject-${assignmentId}`} style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.4rem' }}>
            Alasan perbaikan (wajib diisi)
          </label>
          <textarea
            id={`reject-${assignmentId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Contoh: Foto bukti kurang jelas / pekerjaan belum selesai pada bagian tertentu."
            style={{
              width: '100%',
              padding: '0.6rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid var(--border, rgba(0,0,0,0.15))',
              fontSize: '0.875rem',
              fontFamily: 'inherit',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={busy !== null || !reason.trim()}
              onClick={() => decide('REJECT', reason.trim())}
              style={{ background: 'var(--severity-medium)', color: 'var(--on-accent-text, #1f2937)', fontWeight: 600 }}
            >
              {busy === 'REJECT' ? 'Mengirim...' : 'Kirim Permintaan Perbaikan'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setShowReject(false);
                setReason('');
              }}
              style={{ background: 'var(--muted-bg)', color: 'var(--text-secondary)' }}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: '0.8rem',
            fontWeight: 600,
            color: msg.type === 'ok' ? 'var(--success-text)' : 'var(--danger-text)',
          }}
        >
          {msg.type === 'ok' ? '✓ ' : '⚠ '}
          {msg.text}
        </p>
      )}
    </div>
  );
}

const radioRow: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'flex-start',
  fontSize: '0.82rem',
  marginBottom: '0.4rem',
  cursor: 'pointer',
};
const radioHint: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontWeight: 400,
};

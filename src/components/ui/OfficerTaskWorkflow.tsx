'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

interface OfficerTaskWorkflowProps {
  assignmentId: string;
  reportId: string;
  initialStatus: string;
  initialNotes?: string | null;
  completedAt?: string | null;
  reviewStatus?: string | null;
  reviewNotes?: string | null;
}

export function OfficerTaskWorkflow({
  assignmentId,
  reportId,
  initialStatus,
  initialNotes,
  completedAt,
  reviewStatus,
  reviewNotes,
}: OfficerTaskWorkflowProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notes, setNotes] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showConfirmStart, setShowConfirmStart] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('File harus berupa gambar (JPG, PNG, atau WEBP).');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Ukuran file maksimal 10MB.');
      return;
    }

    setSelectedPhoto(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setSelectedPhoto(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Mulai Pekerjaan: ASSIGNED -> IN_PROGRESS
  const handleStartTask = async () => {
    setIsStarting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'START' }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memulai tugas');
      }

      setCurrentStatus('IN_PROGRESS');
      setSuccessMsg('Status tugas berhasil diubah menjadi Dalam Pengerjaan.');
      setShowConfirmStart(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat memulai tugas');
    } finally {
      setIsStarting(false);
    }
  };

  // Selesaikan Pekerjaan: IN_PROGRESS -> COMPLETED (Upload Bukti)
  const handleCompleteTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!selectedPhoto) {
      setError('Foto bukti hasil pekerjaan wajib diunggah.');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('photo', selectedPhoto);
      formData.append('notes', notes.trim());

      const res = await fetch(`/api/assignments/${assignmentId}/complete`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal menyelesaikan tugas');
      }

      // Bukti terkirim -> laporan berstatus REVIEW (menunggu verifikasi Admin),
      // BUKAN langsung selesai. Status selesai hanya ditetapkan Admin.
      setCurrentStatus('REVIEW');
      setSuccessMsg('Bukti pengerjaan berhasil dikirim. Laporan menunggu verifikasi Admin.');
      router.refresh();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat menyelesaikan tugas');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="glass" style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>⚙️</span>
        <span>Aksi Petugas Lapangan</span>
      </h3>

      {/* Pesan Error */}
      {error && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '8px',
            color: 'var(--danger-text)',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Pesan Sukses */}
      {successMsg && (
        <div
          style={{
            padding: '0.75rem 1rem',
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '8px',
            color: 'var(--success-text)',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          ✓ {successMsg}
        </div>
      )}

      {/* ─────────────────────────────────────────────
          KONDISI 1: ASSIGNED (Menunggu Dikerjakan)
         ───────────────────────────────────────────── */}
      {currentStatus === 'ASSIGNED' && (
        <div>
          <div
            style={{
              padding: '1rem',
              background: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: '8px',
              marginBottom: '1.25rem',
            }}
          >
            <p style={{ margin: '0 0 0.5rem', fontWeight: 600, color: 'var(--warning-text)', fontSize: '0.875rem' }}>
              ⏳ Menunggu Dimulai
            </p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Laporan ini telah ditugaskan kepada Anda. Klik tombol di bawah saat Anda siap untuk memulai pengerjaan perbaikan di lokasi.
            </p>
          </div>

          {!showConfirmStart ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}
              onClick={() => setShowConfirmStart(true)}
            >
              🚀 Mulai Kerjakan Tugas
            </button>
          ) : (
            <div
              style={{
                padding: '1rem',
                border: '1px solid var(--primary-color)',
                borderRadius: '8px',
                background: 'var(--hover-bg)',
              }}
            >
              <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>
                Apakah Anda yakin ingin memulai tugas ini sekarang?
              </p>
              <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Status laporan akan otomatis diperbarui menjadi <strong>Dalam Pengerjaan (IN_PROGRESS)</strong>.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleStartTask}
                  disabled={isStarting}
                >
                  {isStarting ? '⏳ Memulai...' : 'Ya, Mulai Sekarang'}
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ background: 'var(--muted-bg)', color: 'var(--text-secondary)' }}
                  onClick={() => setShowConfirmStart(false)}
                  disabled={isStarting}
                >
                  Batal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────
          KONDISI 2: IN_PROGRESS (Sedang Dikerjakan)
         ───────────────────────────────────────────── */}
      {currentStatus === 'IN_PROGRESS' && (
        <div>
          {reviewStatus === 'REVISION' && (
            <div
              style={{
                padding: '1rem',
                background: 'rgba(245,158,11,0.1)',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: '8px',
                marginBottom: '1.25rem',
              }}
            >
              <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: 'var(--warning-text)', fontSize: '0.875rem' }}>
                ⚠️ Perlu Perbaikan
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Admin meminta perbaikan sebelum laporan dapat diselesaikan.
                {reviewNotes ? (
                  <>
                    {' '}Alasan: <strong>{reviewNotes}</strong>.
                  </>
                ) : null}{' '}
                Silakan lakukan perbaikan lalu unggah bukti terbaru di bawah ini.
              </p>
            </div>
          )}
          <div
            style={{
              padding: '1rem',
              background: 'var(--soft-primary-bg)',
              border: '1px solid var(--soft-primary-border)',
              borderRadius: '8px',
              marginBottom: '1.25rem',
            }}
          >
            <p style={{ margin: '0 0 0.25rem', fontWeight: 600, color: 'var(--primary-color)', fontSize: '0.875rem' }}>
              🔧 Pekerjaan Sedang Berlangsung
            </p>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Setelah perbaikan selesai, unggah foto bukti hasil pekerjaan dan tambahkan catatan penyelesaian di bawah ini.
            </p>
          </div>

          <form onSubmit={handleCompleteTask}>
            {/* Upload Foto Bukti */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                📷 Foto Bukti Pekerjaan <span style={{ color: 'var(--danger-text)' }}>*</span>
              </label>

              {!photoPreview ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--input-border)',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'var(--hover-bg)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <p style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>📸</p>
                  <p style={{ margin: '0 0 0.25rem', fontWeight: 600, fontSize: '0.875rem' }}>
                    Klik untuk memilih foto bukti
                  </p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    JPG, PNG, atau WEBP (Maksimal 10MB)
                  </p>
                </div>
              ) : (
                <div style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--input-border)' }}>
                  <img
                    src={photoPreview}
                    alt="Preview bukti"
                    style={{ width: '100%', maxHeight: '240px', objectFit: 'cover', display: 'block' }}
                  />
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      background: 'rgba(239,68,68,0.9)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '50%',
                      width: '28px',
                      height: '28px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Hapus foto"
                  >
                    ✕
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Catatan Penyelesaian */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                📝 Catatan Hasil Pekerjaan
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Contoh: Telah dilakukan penambalan aspal pada lubang jalan dan perapihan tepi..."
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--input-border)',
                  fontSize: '0.85rem',
                  background: 'var(--input-bg)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Tombol Selesai */}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '0.75rem' }}
              disabled={isSubmitting || !selectedPhoto}
            >
              {isSubmitting ? '⏳ Mengunggah bukti...' : '📤 Kirim Bukti Pengerjaan'}
            </button>
          </form>
        </div>
      )}

      {/* ─────────────────────────────────────────────
          KONDISI 3: REVIEW (Bukti terkirim, menunggu verifikasi Admin)
         ───────────────────────────────────────────── */}
      {currentStatus === 'REVIEW' && (
        <div
          style={{
            padding: '1.25rem',
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>🔍</p>
          <h4 style={{ margin: '0 0 0.25rem', color: 'var(--warning-text)', fontSize: '1rem' }}>
            Menunggu Verifikasi Admin
          </h4>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Bukti pengerjaan Anda telah terkirim dan sedang diperiksa Admin. Laporan dinyatakan selesai hanya setelah
            Admin menyetujui bukti ini. Anda akan menerima notifikasi bila perlu perbaikan.
          </p>
        </div>
      )}

      {/* ─────────────────────────────────────────────
          KONDISI 4: COMPLETED (Disetujui Admin)
         ───────────────────────────────────────────── */}
      {currentStatus === 'COMPLETED' && (
        <div
          style={{
            padding: '1.25rem',
            background: 'rgba(16,185,129,0.08)',
            border: '1px solid rgba(16,185,129,0.25)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '2rem', margin: '0 0 0.5rem' }}>🎉</p>
          <h4 style={{ margin: '0 0 0.25rem', color: 'var(--success-text)', fontSize: '1rem' }}>
            Tugas Telah Selesai
          </h4>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Bukti penyelesaian telah disetujui Admin dan status laporan telah menjadi <strong>COMPLETED</strong>.
          </p>
          {completedAt && (
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.75rem', color: 'var(--success-text)', fontWeight: 500 }}>
              Selesai pada: {new Date(completedAt).toLocaleString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Jakarta',
              })} WIB
            </p>
          )}
        </div>
      )}
    </div>
  );
}

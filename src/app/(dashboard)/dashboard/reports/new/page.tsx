'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface AIAnalysis {
  category: string;
  damageType: string;
  severity: string;
  confidence: number;
  summary: string;
  recommendation: string;
  aiResult: string;
  urgencyReason?: string;
  reasons?: string[];
  facts?: string[];
  missing?: string[];
  suggestedAction?: string;
  model?: string;
  provider?: string;
}

/** Kunci idempotensi: satu form = satu kunci, sehingga kiriman ganda tidak
 *  menghasilkan dua laporan. Kunci baru dibuat saat halaman dibuka ulang. */
function makeClientKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function NewReportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clientKeyRef = useRef<string | null>(null);
  if (!clientKeyRef.current) clientKeyRef.current = makeClientKey();
  const submittingRef = useRef(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    location: '',
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysis | null>(null);
  const [aiError, setAiError] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Ukuran foto maksimal 10MB');
      return;
    }
    setPhoto(file);
    setError('');
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || loading) return;
    setError('');
    setAiError('');

    if (!form.title.trim() || !form.description.trim() || !form.location.trim()) {
      setError('Judul, deskripsi, dan lokasi wajib diisi');
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('title', form.title);
      formData.append('description', form.description);
      formData.append('location', form.location);
      formData.append('clientKey', clientKeyRef.current || makeClientKey());
      if (photo) formData.append('photo', photo);

      setAiLoading(true);
      const res = await fetch('/api/reports', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      setAiLoading(false);

      if (!res.ok) {
        setError(data.error || 'Gagal mengirim laporan');
        submittingRef.current = false;
        return;
      }

      if (data.aiAnalysis) {
        setAiResult(data.aiAnalysis);
      } else {
        setAiError(data.aiError || 'Analisis AI belum berhasil. Laporan tetap tersimpan dan dapat dianalisis ulang oleh Admin.');
      }
      setSubmitted(true);

      // Redirect ke dashboard setelah 4 detik
      setTimeout(() => router.push('/dashboard'), 4000);

    } catch (err) {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
      submittingRef.current = false;
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  }

  const severityConfig: Record<string, { label: string; color: string; bg: string }> = {
    RENDAH:  { label: 'Rendah',  color: 'var(--success-text)', bg: 'rgba(16,185,129,0.16)' },
    SEDANG:  { label: 'Sedang',  color: 'var(--warning-text)', bg: 'rgba(245,158,11,0.18)' },
    TINGGI:  { label: 'Tinggi',  color: 'var(--danger-text)', bg: 'rgba(239,68,68,0.16)' },
    KRITIS:  { label: 'Kritis',  color: '#7c3aed', bg: 'rgba(124,58,237,0.16)' },
  };

  if (submitted && !aiResult) {
    return (
      <div className="new-report-container">
        <div className="success-wrapper">
          <div className="success-icon-circle">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Laporan Berhasil Dikirim!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Laporan sudah tersimpan. Anda akan diarahkan ke dashboard dalam beberapa detik...
          </p>
          <div
            className="glass"
            style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--warning-color)', textAlign: 'left', maxWidth: '640px' }}
          >
            <p style={{ margin: '0 0 0.35rem', fontWeight: 700, color: 'var(--warning-text)' }}>
              ⚠️ Analisis AI belum berhasil
            </p>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {aiError}
            </p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Laporan tetap tersimpan dan tidak hilang. Admin dapat menjalankan “Analisis Ulang” dari halaman detail laporan.
            </p>
          </div>
          <Link href="/dashboard" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
            Kembali ke Dashboard →
          </Link>
        </div>
      </div>
    );
  }

  if (submitted && aiResult) {
    const sev = severityConfig[aiResult.severity] || severityConfig.SEDANG;
    return (
      <div className="new-report-container">
        <div className="success-wrapper">
          <div className="success-icon-circle">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Laporan Berhasil Dikirim!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
            AI telah menganalisis laporan Anda. Anda akan diarahkan ke dashboard dalam beberapa detik...
          </p>

          <div className="ai-result-card">
            <div className="ai-result-header">
              <div className="ai-badge-icon">🤖</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'white' }}>Hasil Analisis AI</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.8, color: 'white' }}>
                  {aiResult.model ? `Model: ${aiResult.model}` : 'Hasil analisis tersimpan'}
                </p>
              </div>
            </div>

            <div className="ai-result-body">
              <div className="ai-info-grid">
                <div className="ai-info-item">
                  <span className="ai-info-label">Kategori Fasilitas</span>
                  <span className="ai-info-value">{aiResult.category}</span>
                </div>
                <div className="ai-info-item">
                  <span className="ai-info-label">Jenis Kerusakan</span>
                  <span className="ai-info-value">{aiResult.damageType}</span>
                </div>
                <div className="ai-info-item">
                  <span className="ai-info-label">Tingkat Keparahan</span>
                  <span
                    className="ai-severity-badge"
                    style={{ background: sev.bg, color: sev.color }}
                  >
                    {sev.label}
                  </span>
                </div>
                <div className="ai-info-item">
                  <span className="ai-info-label">Tingkat Kepercayaan AI</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="confidence-bar-bg">
                      <div
                        className="confidence-bar-fill"
                        style={{ width: `${aiResult.confidence}%` }}
                      />
                    </div>
                    <span className="ai-info-value">{aiResult.confidence}%</span>
                  </div>
                </div>
              </div>

              <div className="ai-summary-box">
                <p className="ai-summary-label">📋 Ringkasan Analisis</p>
                <p className="ai-summary-text">{aiResult.summary}</p>
              </div>
              <div className="ai-recommendation-box">
                <p className="ai-summary-label">💡 Rekomendasi Tindakan</p>
                <p className="ai-summary-text">{aiResult.recommendation}</p>
              </div>

              {!!aiResult.urgencyReason && (
                <div className="ai-summary-box">
                  <p className="ai-summary-label">⚡ Alasan Tingkat Urgensi</p>
                  <p className="ai-summary-text">{aiResult.urgencyReason}</p>
                </div>
              )}

              {!!aiResult.reasons?.length && (
                <div className="ai-summary-box">
                  <p className="ai-summary-label">🧠 Alasan Klasifikasi</p>
                  <ul className="ai-summary-text" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {aiResult.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {!!aiResult.facts?.length && (
                <div className="ai-summary-box">
                  <p className="ai-summary-label">📌 Fakta dari Laporan</p>
                  <ul className="ai-summary-text" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {aiResult.facts.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {!!aiResult.missing?.length && (
                <div className="ai-summary-box">
                  <p className="ai-summary-label">❓ Informasi Belum Tersedia</p>
                  <ul className="ai-summary-text" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {aiResult.missing.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              {!!aiResult.suggestedAction && (
                <div className="ai-recommendation-box">
                  <p className="ai-summary-label">✅ Tindakan Disarankan (bukan keputusan final)</p>
                  <p className="ai-summary-text">{aiResult.suggestedAction}</p>
                </div>
              )}
            </div>
          </div>

          <Link href="/dashboard" className="btn btn-primary" style={{ display: 'inline-block', marginTop: '1.5rem' }}>
            Kembali ke Dashboard →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="new-report-container">
      <div className="flex items-center gap-2" style={{ marginBottom: '1.5rem' }}>
        <Link href="/dashboard" style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          ← Kembali
        </Link>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>Buat Laporan Baru</span>
      </div>

      <div className="glass" style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
            📝 Buat Laporan Kerusakan
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Laporkan kerusakan fasilitas umum di sekitar Anda. AI akan menganalisis laporan secara otomatis.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Judul */}
          <div className="form-group">
            <label className="form-label">Judul Laporan *</label>
            <input
              type="text"
              className="form-input"
              placeholder="Contoh: Jalan Berlubang di Depan SDN 5"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              disabled={loading}
              maxLength={200}
            />
          </div>

          {/* Deskripsi */}
          <div className="form-group">
            <label className="form-label">Deskripsi Kerusakan *</label>
            <textarea
              className="form-input form-textarea"
              placeholder="Deskripsikan kerusakan secara detail: ukuran, kondisi, dampak, dll."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              disabled={loading}
              rows={4}
              maxLength={2000}
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {form.description.length}/2000 karakter
            </span>
          </div>

          {/* Lokasi */}
          <div className="form-group">
            <label className="form-label">Lokasi *</label>
            <input
              type="text"
              className="form-input"
              placeholder="Contoh: Jl. Sudirman No.10, Kel. Kebon Jeruk, Kec. Kebon Jeruk"
              value={form.location}
              onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
              disabled={loading}
              maxLength={500}
            />
          </div>

          {/* Upload Foto */}
          <div className="form-group">
            <label className="form-label">
              Foto Kerusakan
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                (Disarankan — Meningkatkan akurasi AI)
              </span>
            </label>

            {!photoPreview ? (
              <div
                className="photo-upload-area"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="upload-icon">📷</div>
                <p style={{ margin: '0.5rem 0', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  Klik untuk upload foto
                </p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  JPG, PNG, WebP — Maks. 10MB
                </p>
              </div>
            ) : (
              <div className="photo-preview-wrapper">
                <img
                  src={photoPreview}
                  alt="Preview foto"
                  className="photo-preview-img"
                />
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                >
                  ✕ Hapus Foto
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handlePhotoChange}
              style={{ display: 'none' }}
            />
          </div>

          {error && (
            <div className="error-banner">
              ⚠️ {error}
            </div>
          )}

          {/* AI Notice */}
          <div className="ai-notice">
            <span>🤖</span>
            <p>
              <strong>Analisis AI Otomatis</strong> — Setelah laporan dikirim, Google Gemini AI akan
              menganalisis foto dan deskripsi untuk menentukan kategori, jenis kerusakan, dan tingkat keparahan.
            </p>
          </div>

          <div className="flex" style={{ gap: '1rem', justifyContent: 'flex-end' }}>
            <Link href="/dashboard" className="btn" style={{ background: 'rgba(0,0,0,0.05)' }}>
              Batal
            </Link>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ minWidth: '160px', position: 'relative' }}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                  <span className="spinner" />
                  {aiLoading ? 'AI Menganalisis...' : 'Mengirim...'}
                </span>
              ) : (
                '🚀 Kirim Laporan'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

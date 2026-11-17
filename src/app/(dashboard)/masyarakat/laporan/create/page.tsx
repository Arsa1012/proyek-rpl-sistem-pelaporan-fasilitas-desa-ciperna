'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  'Jalan',
  'Lampu Jalan',
  'Trotoar',
  'Drainase',
  'Taman',
  'Jembatan',
  'Fasilitas Umum Lainnya',
];

export default function BuatLaporanPage() {
  const router = useRouter();
  const clientKeyRef = useRef<string | null>(null);
  if (!clientKeyRef.current) {
    clientKeyRef.current =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const submittingRef = useRef(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoReading, setPhotoReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accountInactive, setAccountInactive] = useState(false);
  const [suspendReason, setSuspendReason] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/profile', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!alive || !data?.user) return;
        setAccountInactive(data.user.isActive === false);
        setSuspendReason(data.user.suspendReason ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const processFile = (file: File | undefined | null) => {
    setError('');
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('File harus berupa gambar (JPG, PNG, atau WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Ukuran file maksimal 10MB.');
      return;
    }

    setPhotoReading(true);
    setPhoto(file);
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
      setPhotoReading(false);
    };
    reader.onerror = () => {
      setError('Gagal membaca file gambar.');
      setPhoto(null);
      setPhotoReading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFile(e.target.files?.[0]);
    // Izinkan memilih file yang sama dua kali berturut-turut
    e.target.value = '';
  };

  const clearPhoto = () => {
    setPhoto(null);
    setPhotoPreview(null);
    setPhotoReading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || submittingRef.current) return;
    setError('');

    if (accountInactive) {
      setError(
        'Akun Anda sedang nonaktif sehingga tidak dapat membuat laporan baru. ' +
          'Silakan hubungi Admin Desa Ciperna di 082118727522.'
      );
      return;
    }

    if (!title || !description || !category || !location) {
      setError('Semua field wajib diisi.');
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('description', description);
      formData.append('category', category);
      formData.append('location', location);
      formData.append('clientKey', clientKeyRef.current || '');
      if (photo) formData.append('photo', photo);

      const res = await fetch('/api/reports', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal mengirim laporan.');
        submittingRef.current = false;
        return;
      }

      router.push(`/masyarakat/laporan/${data.report.id}?success=true`);
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="new-report-container">
      <div className="page-header">
        <div>
          <h2>Buat Laporan Baru</h2>
          <p>Laporkan fasilitas umum yang rusak di sekitar Anda.</p>
        </div>
      </div>

      {accountInactive && (
        <div className="village-alert" role="alert">
          <strong>Akun Anda sedang NONAKTIF.</strong>{' '}
          {suspendReason
            ? `Alasan penonaktifan dari Admin: "${suspendReason}".`
            : 'Alasan penonaktifan belum dicatat oleh Admin.'}{' '}
          Anda tidak dapat membuat laporan baru. Silakan hubungi Admin Desa Ciperna di <strong>082118727522</strong>.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={handleSubmit} className="glass" style={{ padding: '1.5rem' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="title">Judul Laporan</label>
          <input
            id="title"
            type="text"
            className="form-input"
            placeholder="Contoh: Jalan berlubang di depan sekolah"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="description">Deskripsi Kerusakan</label>
          <textarea
            id="description"
            className="form-input form-textarea"
            placeholder="Jelaskan kondisi kerusakan secara detail..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            maxLength={5000}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="category">Kategori Fasilitas</label>
          <select
            id="category"
            className="form-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">-- Pilih Kategori --</option>
            {CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="location">Lokasi</label>
          <input
            id="location"
            type="text"
            className="form-input"
            placeholder="Contoh: Jl. Merdeka No. 1, Jakarta"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            required
            maxLength={300}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="photo">Foto Kerusakan</label>
          {!photoPreview && !photoReading ? (
            <label
              className={`photo-upload-area${dragging ? ' dragging' : ''}`}
              htmlFor="photo"
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files?.[0]); }}
            >
              <div className="upload-icon" aria-hidden="true">📷</div>
              <p style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Klik untuk upload atau seret foto ke sini</p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>JPG, PNG, atau WebP (Maksimal 10MB)</p>
            </label>
          ) : (
            <div className="photo-preview-wrapper">
              {photoReading ? (
                <div className="photo-loading" role="status" aria-label="Memuat foto">
                  <span className="photo-spinner" aria-hidden="true" />
                  <p>Memuat foto...</p>
                </div>
              ) : (
                photoPreview && (
                  <img src={photoPreview} alt="Pratinjau foto kerusakan" className="photo-preview-img" />
                )
              )}
              <div className="photo-preview-actions">
                <label className="photo-change-btn" htmlFor="photo">🔄 Ganti Foto</label>
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={clearPhoto}
                  aria-label="Hapus foto"
                >
                  ✕ Hapus
                </button>
              </div>
            </div>
          )}
          <input
            id="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-label="Pilih foto kerusakan"
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || accountInactive}
          style={{ width: '100%', justifyContent: 'center', padding: '0.875rem' }}
        >
          {accountInactive ? 'Akun Nonaktif' : loading ? 'Mengirim...' : 'Kirim Laporan'}
        </button>
      </form>
    </div>
  );
}

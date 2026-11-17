'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError, describeFailure } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

export interface VillageProfileFormData {
  name: string;
  district: string;
  regency: string;
  province: string;
  postalCode: string;
  address: string;
  phone: string;
  email: string;
  mapLink: string;
  mapEmbedUrl: string;
  latitude: string;
  longitude: string;
  coordinateSource: string;
  heroPhoto: string;
  history: string;
  historySource: string;
  geography: string;
  potential: string;
  demographics: string;
  vision: string;
  mission: string;
  serviceHours: string;
  dataStatus: string;
  sourceUrl: string;
  verifiedAt: string;
}

const EMPTY: VillageProfileFormData = {
  name: 'Desa Ciperna',
  district: 'Talun',
  regency: 'Cirebon',
  province: 'Jawa Barat',
  postalCode: '',
  address: '',
  phone: '',
  email: '',
  mapLink: '',
  mapEmbedUrl: '',
  latitude: '',
  longitude: '',
  coordinateSource: '',
  heroPhoto: '',
  history: '',
  historySource: '',
  geography: '',
  potential: '',
  demographics: '',
  vision: '',
  mission: '',
  serviceHours: '',
  dataStatus: 'UNVERIFIED',
  sourceUrl: '',
  verifiedAt: '',
};

export function VillageProfileForm({ initial }: { initial?: Partial<VillageProfileFormData> | null }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<VillageProfileFormData>({ ...EMPTY, ...(initial || {}) });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [missing, setMissing] = useState<string[]>([]);

  const set = (key: keyof VillageProfileFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess('');
  };

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    setError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'hero');
      const res = await fetch('/api/admin/village/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
        if (failure.retryable) toast.failure(failure, () => uploadPhoto(file));
        return;
      }
      set('heroPhoto', data.path || '');
      toast.success('Foto desa berhasil diunggah.');
    } catch (err) {
      const failure = describeError(err);
      setError(failure.message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform();
  };

  const perform = async () => {
    if (loading) return;
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/village/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          latitude: form.latitude === '' ? null : Number(form.latitude),
          longitude: form.longitude === '' ? null : Number(form.longitude),
          verifiedAt: form.verifiedAt || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
        if (failure.retryable) toast.failure(failure, perform);
        return;
      }
      setSuccess('Profil desa berhasil disimpan.');
      toast.success('Profil Desa berhasil disimpan.');
      setMissing(Array.isArray(data.missingFields) ? data.missingFields : []);
      router.refresh();
    } catch (err) {
      const failure = describeError(err);
      setError(failure.message);
      if (failure.retryable) toast.failure(failure, perform);
    } finally {
      setLoading(false);
    }
  };

  const field = (
    key: keyof VillageProfileFormData,
    label: string,
    opts: { required?: boolean; type?: string; placeholder?: string; help?: string; maxLength?: number } = {}
  ) => (
    <div className="form-group">
      <label className="form-label" htmlFor={`vp-${key}`}>
        {label} {opts.required && <span style={{ color: 'var(--danger-text)' }}>*</span>}
      </label>
      <input
        id={`vp-${key}`}
        className="form-input"
        type={opts.type || 'text'}
        value={form[key]}
        required={opts.required}
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        onChange={(e) => set(key, e.target.value)}
      />
      {opts.help && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{opts.help}</p>}
    </div>
  );

  const area = (
    key: keyof VillageProfileFormData,
    label: string,
    rows = 4,
    placeholder = '',
    help = ''
  ) => (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label" htmlFor={`vp-${key}`}>{label}</label>
      <textarea
        id={`vp-${key}`}
        className="form-input form-textarea"
        rows={rows}
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
      {help && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{help}</p>}
    </div>
  );

  return (
    <form onSubmit={submit}>
      {error && (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--danger-text)', color: 'var(--danger-text)' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="glass" role="status" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', borderLeft: '4px solid var(--success-text)', color: 'var(--success-text)' }}>
          {success}
        </div>
      )}
      {missing.length > 0 && (
        <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <strong>Belum diisi:</strong> {missing.join(', ')}. Bagian ini tidak akan dipublikasikan sebagai data resmi.
        </div>
      )}

      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Identitas Desa</h3>
        <div className="portal-form-grid">
          {field('name', 'Nama resmi desa', { required: true, maxLength: 120 })}
          {field('district', 'Kecamatan', { required: true, maxLength: 120 })}
          {field('regency', 'Kabupaten', { required: true, maxLength: 120 })}
          {field('province', 'Provinsi', { required: true, maxLength: 120 })}
          {field('postalCode', 'Kode pos', { placeholder: 'mis. 45151', maxLength: 6 })}
          {field('phone', 'Kontak resmi', { placeholder: 'Nomor kantor desa (jika terverifikasi)' })}
          {field('email', 'Email resmi', { type: 'email', placeholder: 'email kantor desa (jika ada)' })}
          {field('serviceHours', 'Jam pelayanan', { placeholder: 'mis. Senin–Jumat 08.00–15.00 WIB' })}
          <div style={{ gridColumn: '1 / -1' }}>
            {area('address', 'Alamat kantor desa', 2, 'Alamat lengkap kantor desa (jika sudah terverifikasi)')}
          </div>
        </div>
      </section>

      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Lokasi & Peta</h3>
        <div className="portal-form-grid">
          {field('mapLink', 'Tautan Google Maps', { placeholder: 'https://maps.app.goo.gl/...', help: 'Dipakai tombol "Lihat Lokasi" dan "Petunjuk Arah".' })}
          {field('mapEmbedUrl', 'URL peta tertanam (opsional)', { placeholder: 'https://www.google.com/maps?...&output=embed', help: 'Hanya Google Maps/OpenStreetMap dengan https.' })}
          {field('latitude', 'Latitude', { placeholder: 'mis. -6.7703', help: 'Hanya jika sudah diverifikasi.' })}
          {field('longitude', 'Longitude', { placeholder: 'mis. 108.5278' })}
          <div style={{ gridColumn: '1 / -1' }}>
            {field('coordinateSource', 'Sumber koordinat', { placeholder: 'mis. Wikipedia / pengukuran resmi desa' })}
          </div>
        </div>
      </section>

      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Sejarah, Kondisi, dan Potensi</h3>
        <div className="portal-form-grid">
          {area('history', 'Sejarah singkat desa', 5, 'Tulis hanya berdasarkan sumber yang dapat dipertanggungjawabkan.')}
          {field('historySource', 'Sumber sejarah', { placeholder: 'https://...', help: 'Sumber wajib dicatat untuk informasi sejarah.' })}
          {area('geography', 'Kondisi geografis', 3)}
          {area('potential', 'Potensi ekonomi/sosial/lingkungan', 3)}
          {area('demographics', 'Data demografi', 3, 'Kosongkan bila belum ada sumber resmi.')}
        </div>
      </section>

      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Visi & Misi</h3>
        <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Kosongkan bila belum ada dokumen resmi. Sistem tidak akan menampilkan visi/misi kosong sebagai data resmi.
        </p>
        <div className="portal-form-grid">
          {area('vision', 'Visi', 3)}
          {area('mission', 'Misi', 5, 'Satu poin per baris bila memungkinkan.')}
        </div>
      </section>

      <section className="glass" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Foto & Status Verifikasi</h3>
        <div className="portal-form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="vp-heroPhoto">Foto desa / kantor desa</label>
            <input
              id="vp-heroPhoto"
              className="form-input"
              type="text"
              value={form.heroPhoto}
              placeholder="/images/desa-ciperna/hero-desa.jpg atau /uploads/..."
              onChange={(e) => set('heroPhoto', e.target.value)}
            />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}
              onChange={(e) => uploadPhoto(e.target.files?.[0] || null)}
              disabled={uploading}
            />
            {uploading && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mengunggah…</p>}
            {form.heroPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.heroPhoto} alt="Pratinjau foto desa" style={{ marginTop: '0.5rem', maxWidth: '100%', maxHeight: '160px', borderRadius: '8px', objectFit: 'cover' }} />
            )}
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Jangan mengunggah foto yang bukan milik/berhak dipakai desa.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="vp-dataStatus">Status data</label>
            <select id="vp-dataStatus" className="form-input" value={form.dataStatus} onChange={(e) => set('dataStatus', e.target.value)}>
              <option value="UNVERIFIED">Belum diverifikasi</option>
              <option value="PARTIAL">Sebagian dari referensi awal</option>
              <option value="VERIFIED">Terverifikasi</option>
            </select>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Pilih “Terverifikasi” hanya jika Admin memiliki dasar/dokumen resmi.
            </p>
          </div>
          {field('sourceUrl', 'Sumber utama', { placeholder: 'https://...', help: 'Contoh: situs pemerintah desa/kecamatan.' })}
          {field('verifiedAt', 'Tanggal verifikasi', { type: 'date', help: 'Diisi otomatis saat status Terverifikasi bila kosong.' })}
        </div>
      </section>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary" disabled={loading || uploading}>
          {loading ? 'Menyimpan…' : 'Simpan Profil Desa'}
        </button>
        <button type="button" className="btn" onClick={() => { setForm({ ...EMPTY, ...(initial || {}) }); setError(''); setSuccess(''); }}>
          Batalkan Perubahan
        </button>
      </div>
    </form>
  );
}

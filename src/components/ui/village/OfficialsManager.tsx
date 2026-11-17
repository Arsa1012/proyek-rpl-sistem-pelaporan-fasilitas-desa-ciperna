'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError, describeFailure } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

export interface OfficialDTO {
  id: string;
  name: string;
  position: string;
  category: string;
  level: number;
  order: number;
  area: string | null;
  period: string | null;
  photo: string | null;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: string | null;
  archivedAt: string | null;
}

interface FormState {
  name: string;
  position: string;
  category: string;
  level: string;
  order: string;
  area: string;
  period: string;
  photo: string;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string;
}

const EMPTY: FormState = {
  name: '',
  position: '',
  category: 'LAINNYA',
  level: '1',
  order: '0',
  area: '',
  period: '',
  photo: '',
  isActive: true,
  isVerified: false,
  sourceUrl: '',
};

const CATEGORY_LABELS: Record<string, string> = {
  KEPALA_DESA: 'Kepala Desa',
  SEKRETARIAT: 'Sekretariat Desa',
  KASI: 'Kepala Seksi',
  KAUR: 'Kepala Urusan',
  RT_RW: 'Ketua RT / RW',
  LAINNYA: 'Lainnya',
};

export function OfficialsManager({ initial }: { initial: OfficialDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<OfficialDTO[]>(initial);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Tutup sidebar drawer saat modal form dibuka agar tidak tertutup di belakang.
  useEffect(() => {
    if (open) {
      window.dispatchEvent(new Event('close-sidebar'));
    }
  }, [open]);

  const set = (key: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) => o.name.toLowerCase().includes(q) || o.position.toLowerCase().includes(q)
    );
  }, [list, query]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setError('');
    setOpen(true);
  };

  const openEdit = (o: OfficialDTO) => {
    setEditingId(o.id);
    setForm({
      name: o.name,
      position: o.position,
      category: o.category,
      level: String(o.level),
      order: String(o.order),
      area: o.area || '',
      period: o.period || '',
      photo: o.photo || '',
      isActive: o.isActive,
      isVerified: o.isVerified,
      sourceUrl: o.sourceUrl || '',
    });
    setError('');
    setOpen(true);
  };

  const uploadPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'official');
      const res = await fetch('/api/admin/village/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
      } else {
        set('photo', data.path || '');
        toast.success('Foto berhasil diunggah.');
      }
    } catch (err) {
      setError(describeError(err).message);
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
    setLoading(true);
    try {
      const payload = {
        name: form.name,
        position: form.position,
        category: form.category,
        level: Number(form.level) || 0,
        order: Number(form.order) || 0,
        area: form.area,
        period: form.period,
        photo: form.photo,
        isActive: form.isActive,
        isVerified: form.isVerified,
        sourceUrl: form.sourceUrl,
      };
      const res = await fetch(
        editingId ? `/api/admin/village/officials/${editingId}` : '/api/admin/village/officials',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
        if (failure.retryable) toast.failure(failure, perform);
        return;
      }
      const saved: OfficialDTO = data.official;
      setList((prev) =>
        editingId ? prev.map((o) => (o.id === saved.id ? saved : o)) : [saved, ...prev]
      );
      setOpen(false);
      const msg = editingId ? 'Perubahan data perangkat desa disimpan.' : 'Perangkat desa berhasil ditambahkan.';
      setNotice(msg);
      toast.success(msg);
      router.refresh();
    } catch (err) {
      const failure = describeError(err);
      setError(failure.message);
      if (failure.retryable) toast.failure(failure, perform);
    } finally {
      setLoading(false);
    }
  };

  const changeActive = async (o: OfficialDTO) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/village/officials/${o.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: o.isActive ? 'archive' : 'restore' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeFailure(res, data).message);
        return;
      }
      setList((prev) => prev.map((x) => (x.id === o.id ? data.official : x)));
      const msg = data.message || 'Status perangkat desa diperbarui.';
      setNotice(msg);
      toast.success(msg);
      router.refresh();
    } catch (err) {
      setError(describeError(err).message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <input
          className="form-input"
          style={{ maxWidth: '320px' }}
          placeholder="Cari nama atau jabatan…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Cari perangkat desa"
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {list.filter((o) => o.isActive).length} aktif · {list.filter((o) => !o.isActive).length} arsip
        </span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openCreate}>
          ➕ Tambah Perangkat
        </button>
      </div>

      {error && !open && (
        <div className="glass" role="alert" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>{error}</div>
      )}
      {notice && (
        <div className="glass" role="status" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--success-text)', borderLeft: '4px solid var(--success-text)' }}>{notice}</div>
      )}

      <div className="glass" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏛️</p>
            <p>{query ? 'Tidak ada yang cocok dengan pencarian.' : 'Belum ada data perangkat desa. Data tidak ditampilkan ke publik sebelum ditandai terverifikasi.'}</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Jabatan</th>
                  <th>Kategori</th>
                  <th>Wilayah/Tugas</th>
                  <th>Urutan</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} style={!o.isActive ? { opacity: 0.6 } : undefined}>
                    <td style={{ fontWeight: 500 }}>{o.name}</td>
                    <td style={{ fontSize: '0.875rem' }}>{o.position}</td>
                    <td style={{ fontSize: '0.8rem' }}>{CATEGORY_LABELS[o.category] || o.category}</td>
                    <td style={{ fontSize: '0.8rem' }}>{o.area || '-'}</td>
                    <td style={{ fontSize: '0.8rem' }}>L{o.level} · #{o.order}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span className={`badge ${o.isActive ? 'success' : 'danger'}`}>{o.isActive ? 'Aktif' : 'Arsip'}</span>
                        <span className={`badge ${o.isVerified ? 'verified' : 'warning'}`}>{o.isVerified ? 'Terverifikasi' : 'Belum diverifikasi'}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }} onClick={() => openEdit(o)}>Edit</button>
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: o.isActive ? 'rgba(239,68,68,0.1)' : 'rgba(22,163,74,0.1)', color: o.isActive ? 'var(--danger-text)' : 'var(--success-text)' }}
                          onClick={() => changeActive(o)}
                        >
                          {o.isActive ? 'Arsipkan' : 'Aktifkan'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Form perangkat desa">
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>
              {editingId ? 'Edit Perangkat Desa' : 'Tambah Perangkat Desa'}
            </h3>
            {error && <div role="alert" style={{ color: 'var(--danger-text)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
            <form onSubmit={submit} className="portal-form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="of-name">Nama lengkap *</label>
                <input id="of-name" className="form-input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-position">Jabatan *</label>
                <input id="of-position" className="form-input" required placeholder="mis. Kepala Desa" value={form.position} onChange={(e) => set('position', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-category">Kategori</label>
                <select id="of-category" className="form-input" value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-area">Wilayah tugas</label>
                <input id="of-area" className="form-input" placeholder="mis. Dusun 1 / RW 02" value={form.area} onChange={(e) => set('area', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-level">Tingkat hierarki</label>
                <input id="of-level" className="form-input" type="number" min={0} max={20} value={form.level} onChange={(e) => set('level', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-order">Urutan tampil</label>
                <input id="of-order" className="form-input" type="number" min={0} max={9999} value={form.order} onChange={(e) => set('order', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-period">Periode jabatan</label>
                <input id="of-period" className="form-input" placeholder="mis. 2024–2029" value={form.period} onChange={(e) => set('period', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="of-source">Sumber/verifikasi (URL)</label>
                <input id="of-source" className="form-input" placeholder="https://..." value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
              </div>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="of-photo">Foto (opsional)</label>
                <input id="of-photo" className="form-input" placeholder="/uploads/... atau URL https" value={form.photo} onChange={(e) => set('photo', e.target.value)} />
                <input type="file" accept="image/jpeg,image/png,image/webp" style={{ marginTop: '0.4rem', fontSize: '0.8rem' }} onChange={(e) => uploadPhoto(e.target.files?.[0] || null)} disabled={uploading} />
                {uploading && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mengunggah…</p>}
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Aktif (tampil bila terverifikasi)
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={form.isVerified} onChange={(e) => set('isVerified', e.target.checked)} /> Data terverifikasi
                </label>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem' }}>
                <button type="submit" className="btn btn-primary" disabled={loading || uploading}>{loading ? 'Menyimpan…' : 'Simpan'}</button>
                <button type="button" className="btn" onClick={() => setOpen(false)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

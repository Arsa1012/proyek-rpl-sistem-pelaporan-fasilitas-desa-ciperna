'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { describeError, describeFailure } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

export interface ServiceDTO {
  id: string;
  name: string;
  description: string | null;
  requirements: string | null;
  procedure: string | null;
  schedule: string | null;
  contact: string | null;
  link: string | null;
  order: number;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string | null;
  verifiedAt: string | null;
}

interface FormState {
  name: string;
  description: string;
  requirements: string;
  procedure: string;
  schedule: string;
  contact: string;
  link: string;
  order: string;
  isActive: boolean;
  isVerified: boolean;
  sourceUrl: string;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  requirements: '',
  procedure: '',
  schedule: '',
  contact: '',
  link: '',
  order: '0',
  isActive: true,
  isVerified: false,
  sourceUrl: '',
};

export function ServicesManager({ initial }: { initial: ServiceDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<ServiceDTO[]>(initial);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const set = (key: keyof FormState, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openCreate = () => { setEditingId(null); setForm(EMPTY); setError(''); setOpen(true); };

  const openEdit = (s: ServiceDTO) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      description: s.description || '',
      requirements: s.requirements || '',
      procedure: s.procedure || '',
      schedule: s.schedule || '',
      contact: s.contact || '',
      link: s.link || '',
      order: String(s.order),
      isActive: s.isActive,
      isVerified: s.isVerified,
      sourceUrl: s.sourceUrl || '',
    });
    setError('');
    setOpen(true);
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
      const res = await fetch(
        editingId ? `/api/admin/village/services/${editingId}` : '/api/admin/village/services',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, order: Number(form.order) || 0 }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
        if (failure.retryable) toast.failure(failure, perform);
        return;
      }
      const saved: ServiceDTO = data.service;
      setList((prev) => (editingId ? prev.map((s) => (s.id === saved.id ? saved : s)) : [saved, ...prev]));
      setOpen(false);
      const msg = editingId ? 'Perubahan layanan berhasil disimpan.' : 'Layanan desa berhasil ditambahkan.';
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

  const changeActive = async (s: ServiceDTO) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/village/services/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: s.isActive ? 'archive' : 'restore' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const failure = describeFailure(res, data);
        setError(failure.message);
        return;
      }
      setList((prev) => prev.map((x) => (x.id === s.id ? data.service : x)));
      const msg = data.message || 'Status layanan diperbarui.';
      setNotice(msg);
      toast.success(msg);
      router.refresh();
    } catch (err) {
      setError(describeError(err).message);
    }
  };

  const area = (key: keyof FormState, label: string, rows = 3, placeholder = '') => (
    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
      <label className="form-label" htmlFor={`sv-${key}`}>{label}</label>
      <textarea id={`sv-${key}`} className="form-input form-textarea" rows={rows} placeholder={placeholder} value={form[key] as string} onChange={(e) => set(key, e.target.value)} />
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          {list.filter((s) => s.isActive).length} aktif · hanya layanan aktif &amp; terverifikasi tampil ke publik
        </span>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openCreate}>➕ Tambah Layanan</button>
      </div>

      {error && !open && (
        <div className="glass" role="alert" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>{error}</div>
      )}
      {notice && (
        <div className="glass" role="status" style={{ padding: '0.75rem 1rem', marginBottom: '1rem', color: 'var(--success-text)', borderLeft: '4px solid var(--success-text)' }}>{notice}</div>
      )}

      <div className="glass" style={{ overflow: 'hidden' }}>
        {list.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗂️</p>
            <p>Belum ada layanan desa yang dicatat.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Layanan</th><th>Jadwal</th><th>Kontak</th><th>Urutan</th><th>Status</th><th>Aksi</th></tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} style={!s.isActive ? { opacity: 0.6 } : undefined}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{s.name}</div>
                      {s.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', maxWidth: '320px' }}>{s.description}</div>}
                    </td>
                    <td style={{ fontSize: '0.8rem' }}>{s.schedule || '-'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{s.contact || '-'}</td>
                    <td style={{ fontSize: '0.8rem' }}>{s.order}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span className={`badge ${s.isActive ? 'success' : 'danger'}`}>{s.isActive ? 'Aktif' : 'Nonaktif'}</span>
                        <span className={`badge ${s.isVerified ? 'verified' : 'warning'}`}>{s.isVerified ? 'Terverifikasi' : 'Belum diverifikasi'}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }} onClick={() => openEdit(s)}>Edit</button>
                        <button type="button" className="btn" style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: s.isActive ? 'rgba(239,68,68,0.1)' : 'rgba(22,163,74,0.1)', color: s.isActive ? 'var(--danger-text)' : 'var(--success-text)' }} onClick={() => changeActive(s)}>
                          {s.isActive ? 'Nonaktifkan' : 'Aktifkan'}
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
        <div className="modal-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Form layanan desa">
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>{editingId ? 'Edit Layanan' : 'Tambah Layanan'}</h3>
            {error && <div role="alert" style={{ color: 'var(--danger-text)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
            <form onSubmit={submit} className="portal-form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="sv-name">Nama layanan *</label>
                <input id="sv-name" className="form-input" required value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              {area('description', 'Deskripsi singkat')}
              {area('requirements', 'Persyaratan')}
              {area('procedure', 'Prosedur')}
              <div className="form-group">
                <label className="form-label" htmlFor="sv-schedule">Jadwal</label>
                <input id="sv-schedule" className="form-input" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sv-contact">Kontak resmi</label>
                <input id="sv-contact" className="form-input" value={form.contact} onChange={(e) => set('contact', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sv-link">Tautan terkait</label>
                <input id="sv-link" className="form-input" placeholder="/halaman atau https://..." value={form.link} onChange={(e) => set('link', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sv-order">Urutan</label>
                <input id="sv-order" className="form-input" type="number" min={0} max={9999} value={form.order} onChange={(e) => set('order', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sv-source">Sumber (URL)</label>
                <input id="sv-source" className="form-input" placeholder="https://..." value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Aktif
                </label>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={form.isVerified} onChange={(e) => set('isVerified', e.target.checked)} /> Terverifikasi
                </label>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.75rem' }}>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Menyimpan…' : 'Simpan'}</button>
                <button type="button" className="btn" onClick={() => setOpen(false)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

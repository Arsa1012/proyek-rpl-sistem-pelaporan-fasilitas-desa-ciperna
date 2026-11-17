'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ANNOUNCEMENT_STATUS_BADGE,
  ANNOUNCEMENT_STATUS_LABELS,
  deriveAnnouncementStatus,
  type AnnouncementStatus,
} from '@/lib/announcementStatus';
import { ANNOUNCEMENT_TARGET_LABELS, MAX_ANNOUNCEMENT_PHOTOS } from '@/lib/villageInput';
import { describeError, describeFailure } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

export interface DeliverySummary {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
  total: number;
  /** Percobaan kirim WhatsApp untuk pengumuman ini (maks. 15). */
  sendCount?: number;
  sendLimit?: number;
  limitReached?: boolean;
}

export interface AnnouncementDTO {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  category: string | null;
  coverPhoto: string | null;
  photos: string[];
  target: 'ALL' | 'CITIZEN' | 'OFFICER';
  notifyWhatsApp: boolean;
  isPublished: boolean;
  publishedAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  updatedAt: string;
  status: AnnouncementStatus;
  delivery: DeliverySummary;
}

interface FormState {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  category: string;
  coverPhoto: string;
  photos: string[];
  target: 'ALL' | 'CITIZEN' | 'OFFICER';
  notifyWhatsApp: boolean;
  mode: 'DRAFT' | 'NOW' | 'SCHEDULE';
  publishAt: string;
  validFrom: string;
  validUntil: string;
}

const EMPTY: FormState = {
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  category: '',
  coverPhoto: '',
  photos: [],
  target: 'ALL',
  notifyWhatsApp: false,
  mode: 'NOW',
  publishAt: '',
  validFrom: '',
  validUntil: '',
};

const CATEGORY_SUGGESTIONS = ['Informasi', 'Kegiatan', 'Pelayanan', 'Pembangunan', 'Kesehatan', 'Keamanan', 'Sosial'];

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** ISO → nilai untuk <input type="datetime-local"> (waktu lokal peramban). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function uploadPhoto(file: File): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'announcement');
  const res = await fetch('/api/admin/village/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Gagal mengunggah foto');
  return data.path as string;
}

export function AnnouncementsManager({ initial }: { initial: AnnouncementDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<AnnouncementDTO[]>(initial);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AnnouncementStatus>('ALL');
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [waPanel, setWaPanel] = useState<AnnouncementDTO | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const showNotice = (msg: string) => {
    setNotice(msg);
    setError('');
    toast.success(msg);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.title.toLowerCase().includes(q) ||
        (a.category || '').toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q)
      );
    });
  }, [list, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of list) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [list]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY);
    setError('');
    setOpen(true);
  };

  const openEdit = (a: AnnouncementDTO) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      slug: a.slug,
      content: a.content,
      excerpt: a.excerpt || '',
      category: a.category || '',
      coverPhoto: a.coverPhoto || '',
      photos: a.photos,
      target: a.target,
      notifyWhatsApp: a.notifyWhatsApp,
      mode: a.status === 'DRAFT' ? 'DRAFT' : a.status === 'SCHEDULED' ? 'SCHEDULE' : 'NOW',
      publishAt: toLocalInput(a.publishedAt),
      validFrom: toLocalInput(a.validFrom),
      validUntil: toLocalInput(a.validUntil),
    });
    setError('');
    setOpen(true);
  };

  const onCover = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      set('coverPhoto', await uploadPhoto(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengunggah foto');
    } finally {
      setUploading(false);
      if (coverInput.current) coverInput.current.value = '';
    }
  };

  const onAddPhoto = async (file?: File | null) => {
    if (!file) return;
    if (form.photos.length >= MAX_ANNOUNCEMENT_PHOTOS) {
      setError(`Maksimal ${MAX_ANNOUNCEMENT_PHOTOS} foto tambahan`);
      return;
    }
    setUploading(true);
    setError('');
    try {
      const path = await uploadPhoto(file);
      setForm((prev) => ({ ...prev, photos: [...prev.photos, path] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengunggah foto');
    } finally {
      setUploading(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || uploading) return;
    setError('');
    if (form.mode === 'SCHEDULE' && !form.publishAt) {
      setError('Isi waktu publikasi untuk pengumuman terjadwal.');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title: form.title,
        slug: form.slug,
        content: form.content,
        excerpt: form.excerpt,
        category: form.category,
        coverPhoto: form.coverPhoto || null,
        photos: form.photos,
        target: form.target,
        notifyWhatsApp: form.notifyWhatsApp,
        isPublished: form.mode !== 'DRAFT',
        publishedAt: form.mode === 'SCHEDULE' ? toIso(form.publishAt) : undefined,
        validFrom: toIso(form.validFrom),
        validUntil: toIso(form.validUntil),
      };
      const res = await fetch(
        editingId ? `/api/admin/village/announcements/${editingId}` : '/api/admin/village/announcements',
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
        if (failure.retryable) toast.failure(failure);
        return;
      }
      const saved = toDTO(data.announcement);
      setList((prev) => (editingId ? prev.map((a) => (a.id === saved.id ? saved : a)) : [saved, ...prev]));
      setOpen(false);
      showNotice(editingId ? 'Perubahan pengumuman disimpan.' : 'Pengumuman berhasil dibuat.');
      router.refresh();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const patchAction = async (a: AnnouncementDTO, action: 'publish' | 'unpublish' | 'archive' | 'unarchive') => {
    if (busyId) return;
    setBusyId(a.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/village/announcements/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeFailure(res, data).message);
        return;
      }
      const saved = toDTO(data.announcement);
      setList((prev) => prev.map((x) => (x.id === a.id ? saved : x)));
      showNotice(data.message || 'Status pengumuman diperbarui.');
      router.refresh();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/village/announcements/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeFailure(res, data).message);
        return;
      }
      const saved = toDTO(data.announcement);
      setList((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      setDeleteTarget(null);
      showNotice('Pengumuman dihapus. Riwayat pengiriman tetap tersimpan untuk audit.');
      router.refresh();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setDeleting(false);
    }
  };

  const retryWhatsApp = async () => {
    if (!waPanel || waBusy) return;
    setWaBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/village/announcements/${waPanel.id}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyFailed: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeFailure(res, data).message);
        return;
      }
      const status = (data.status || waPanel.delivery) as DeliverySummary;
      setList((prev) => prev.map((x) => (x.id === waPanel.id ? { ...x, delivery: status } : x)));
      setWaPanel((prev) => (prev ? { ...prev, delivery: status } : prev));
      if (status.limitReached) {
        showNotice(
          `Batas ${status.sendLimit ?? 15} percobaan kirim WhatsApp untuk pengumuman ini sudah tercapai. Tidak ada pesan baru yang dikirim.`
        );
      } else {
        showNotice('Percobaan pengiriman ulang selesai.');
      }
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setWaBusy(false);
    }
  };

  return (
    <div>
      <div className="announce-toolbar">
        <span className="announce-counts">
          {counts.PUBLISHED || 0} terbit · {counts.SCHEDULED || 0} terjadwal · {counts.DRAFT || 0} draf ·{' '}
          {counts.EXPIRED || 0} kedaluwarsa · {counts.ARCHIVED || 0} arsip
        </span>
        <input
          className="form-input announce-search"
          placeholder="Cari judul / kategori…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Cari pengumuman"
        />
        <select
          className="form-input announce-search"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | AnnouncementStatus)}
          aria-label="Filter status"
        >
          <option value="ALL">Semua status</option>
          {(['PUBLISHED', 'SCHEDULED', 'DRAFT', 'EXPIRED', 'ARCHIVED', 'DELETED'] as AnnouncementStatus[]).map((s) => (
            <option key={s} value={s}>{ANNOUNCEMENT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={openCreate}>➕ Buat</button>
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
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📣</p>
            <p>{list.length === 0 ? 'Belum ada pengumuman.' : 'Tidak ada pengumuman yang cocok dengan filter.'}</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Judul</th>
                  <th>Status</th>
                  <th>Target</th>
                  <th>Terbit</th>
                  <th>Berlaku s.d.</th>
                  <th>WhatsApp</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        {a.coverPhoto && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.coverPhoto} alt="" className="announce-thumb" />
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 500 }}>{a.title}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            {a.category ? `${a.category} · ` : ''}/pengumuman/{a.slug}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${ANNOUNCEMENT_STATUS_BADGE[a.status]}`}>
                        {ANNOUNCEMENT_STATUS_LABELS[a.status]}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.78rem' }}>{ANNOUNCEMENT_TARGET_LABELS[a.target]}</td>
                    <td style={{ fontSize: '0.78rem' }}>{formatDateTime(a.publishedAt)}</td>
                    <td style={{ fontSize: '0.78rem' }}>{a.validUntil ? formatDateTime(a.validUntil) : '—'}</td>
                    <td style={{ fontSize: '0.78rem' }}>
                      {a.notifyWhatsApp ? (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '0.2rem 0.6rem', minHeight: '2rem', fontSize: '0.72rem' }}
                          onClick={() => setWaPanel(a)}
                          title={a.delivery.limitReached ? 'Batas 15 percobaan kirim tercapai — buka untuk detail' : 'Lihat status pengiriman'}
                        >
                          {a.delivery.sent}✓ {a.delivery.failed > 0 ? `${a.delivery.failed}✗ ` : ''}
                          {a.delivery.pending > 0 ? `${a.delivery.pending}…` : ''}
                          {a.delivery.total === 0 ? 'belum' : ''}
                          {typeof a.delivery.sendCount === 'number' ? ` · ${a.delivery.sendCount}/${a.delivery.sendLimit ?? 15}` : ''}
                          {a.delivery.limitReached ? ' ⚠' : ''}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>nonaktif</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {a.status !== 'DELETED' && (
                          <button type="button" className="btn" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }} onClick={() => openEdit(a)}>
                            Edit
                          </button>
                        )}
                        {a.status === 'DRAFT' && (
                          <button type="button" className="btn btn-primary" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }} disabled={busyId === a.id} onClick={() => patchAction(a, 'publish')}>
                            Terbitkan
                          </button>
                        )}
                        {(a.status === 'PUBLISHED' || a.status === 'SCHEDULED' || a.status === 'EXPIRED') && (
                          <button type="button" className="btn" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem', color: 'var(--danger-text)' }} disabled={busyId === a.id} onClick={() => patchAction(a, 'unpublish')}>
                            Tarik
                          </button>
                        )}
                        {(a.status === 'PUBLISHED' || a.status === 'EXPIRED' || a.status === 'SCHEDULED') && (
                          <button type="button" className="btn" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }} disabled={busyId === a.id} onClick={() => patchAction(a, 'archive')}>
                            Arsipkan
                          </button>
                        )}
                        {a.status === 'ARCHIVED' && (
                          <button type="button" className="btn" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem' }} disabled={busyId === a.id} onClick={() => patchAction(a, 'unarchive')}>
                            Batal arsip
                          </button>
                        )}
                        {a.status !== 'DELETED' && (
                          <button type="button" className="btn" style={{ padding: '0.25rem 0.7rem', fontSize: '0.78rem', color: 'var(--danger-text)' }} onClick={() => setDeleteTarget(a)}>
                            Hapus
                          </button>
                        )}
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
        <div className="modal-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Form pengumuman">
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '760px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem' }}>{editingId ? 'Edit Pengumuman' : 'Buat Pengumuman'}</h3>
            {error && <div role="alert" style={{ color: 'var(--danger-text)', marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
            <form onSubmit={submit}>
              <div className="form-group">
                <label className="form-label" htmlFor="an-title">Judul *</label>
                <input id="an-title" className="form-input" required value={form.title} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="an-category">Kategori</label>
                  <input id="an-category" className="form-input" list="an-category-list" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="mis. Informasi" />
                  <datalist id="an-category-list">
                    {CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="an-target">Target penerima</label>
                  <select id="an-target" className="form-input" value={form.target} onChange={(e) => set('target', e.target.value as FormState['target'])}>
                    <option value="ALL">{ANNOUNCEMENT_TARGET_LABELS.ALL}</option>
                    <option value="CITIZEN">{ANNOUNCEMENT_TARGET_LABELS.CITIZEN}</option>
                    <option value="OFFICER">{ANNOUNCEMENT_TARGET_LABELS.OFFICER}</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="an-content">Isi pengumuman *</label>
                <textarea id="an-content" className="form-input form-textarea" rows={8} required value={form.content} onChange={(e) => set('content', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="an-excerpt">Ringkasan singkat (opsional)</label>
                <input id="an-excerpt" className="form-input" value={form.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Foto sampul (opsional)</label>
                <div className="announce-photo-row">
                  {form.coverPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.coverPhoto} alt="Pratinjau sampul" className="announce-preview" />
                  ) : (
                    <div className="announce-preview announce-preview-empty">Belum ada</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <button type="button" className="btn" onClick={() => coverInput.current?.click()} disabled={uploading}>
                      {uploading ? 'Mengunggah…' : 'Pilih foto sampul'}
                    </button>
                    {form.coverPhoto && (
                      <button type="button" className="btn" onClick={() => set('coverPhoto', '')} style={{ color: 'var(--danger-text)' }}>
                        Hapus sampul
                      </button>
                    )}
                  </div>
                  <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onCover(e.target.files?.[0])} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Foto tambahan (opsional, maks {MAX_ANNOUNCEMENT_PHOTOS})</label>
                <div className="announce-photo-grid">
                  {form.photos.map((p) => (
                    <div key={p} className="announce-photo-item">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt="Foto tambahan" className="announce-preview" />
                      <button type="button" className="announce-photo-remove" aria-label="Hapus foto" onClick={() => setForm((prev) => ({ ...prev, photos: prev.photos.filter((x) => x !== p) }))}>✕</button>
                    </div>
                  ))}
                  {form.photos.length < MAX_ANNOUNCEMENT_PHOTOS && (
                    <button type="button" className="announce-photo-add" onClick={() => photoInput.current?.click()} disabled={uploading}>＋</button>
                  )}
                </div>
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => onAddPhoto(e.target.files?.[0])} />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="an-mode">Status publikasi</label>
                  <select id="an-mode" className="form-input" value={form.mode} onChange={(e) => set('mode', e.target.value as FormState['mode'])}>
                    <option value="DRAFT">Simpan sebagai draf</option>
                    <option value="NOW">Terbitkan sekarang</option>
                    <option value="SCHEDULE">Terjadwal</option>
                  </select>
                </div>
                {form.mode === 'SCHEDULE' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="an-publish">Waktu publikasi *</label>
                    <input id="an-publish" type="datetime-local" className="form-input" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
                  </div>
                )}
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="an-from">Mulai berlaku (opsional)</label>
                  <input id="an-from" type="datetime-local" className="form-input" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="an-until">Akhir berlaku (opsional)</label>
                  <input id="an-until" type="datetime-local" className="form-input" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.87rem' }}>
                  <input type="checkbox" checked={form.notifyWhatsApp} onChange={(e) => set('notifyWhatsApp', e.target.checked)} />
                  Kirim notifikasi WhatsApp ke target saat terbit (Fonnte)
                </label>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.35rem 0 0' }}>
                  Notifikasi dalam aplikasi selalu dibuat. Pengiriman WhatsApp dicatat per penerima dan
                  dapat dikirim ulang jika gagal. Maksimal 15 percobaan kirim per pengumuman; satu
                  penerima yang dicoba dihitung satu. Keberhasilan menyimpan pengumuman ≠ WhatsApp terkirim.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn btn-primary" disabled={loading || uploading}>
                  {loading ? 'Menyimpan…' : 'Simpan'}
                </button>
                <button type="button" className="btn" onClick={() => setOpen(false)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)} role="dialog" aria-modal="true" aria-label="Konfirmasi hapus">
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Hapus pengumuman?</h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Pengumuman <strong>{deleteTarget.title}</strong> akan dihapus dari daftar publik dan admin.
              Riwayat notifikasi &amp; pengiriman tetap tersimpan untuk audit (hapus lunak).
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn" style={{ background: 'var(--danger-color)', color: '#fff' }} disabled={deleting} onClick={confirmDelete}>
                {deleting ? 'Menghapus…' : 'Ya, hapus'}
              </button>
              <button type="button" className="btn" onClick={() => setDeleteTarget(null)}>Batal</button>
            </div>
          </div>
        </div>
      )}

      {waPanel && (
        <div className="modal-overlay" onClick={() => setWaPanel(null)} role="dialog" aria-modal="true" aria-label="Status pengiriman WhatsApp">
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>Status WhatsApp</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 0 }}>{waPanel.title}</p>
            <ul className="announce-wa-list">
              <li><span className="badge success">Terkirim</span> <strong>{waPanel.delivery.sent}</strong></li>
              <li><span className="badge danger">Gagal</span> <strong>{waPanel.delivery.failed}</strong></li>
              <li><span className="badge warning">Menunggu</span> <strong>{waPanel.delivery.pending}</strong></li>
              <li><span className="badge primary">Dilewati</span> <strong>{waPanel.delivery.skipped}</strong></li>
            </ul>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.5rem 0' }}>
              Percobaan kirim: <strong>{waPanel.delivery.sendCount ?? 0}</strong> /{' '}
              {waPanel.delivery.sendLimit ?? 15}
            </p>
            {waPanel.delivery.limitReached && (
              <div
                role="alert"
                style={{
                  padding: '0.6rem 0.75rem',
                  marginBottom: '0.5rem',
                  color: 'var(--danger-text)',
                  borderLeft: '4px solid var(--danger-text)',
                  background: 'rgba(220, 38, 38, 0.06)',
                  fontSize: '0.8rem',
                }}
              >
                Batas {waPanel.delivery.sendLimit ?? 15} percobaan kirim WhatsApp untuk pengumuman ini sudah
                tercapai. Tidak ada pesan baru yang dikirim. Periksa status di atas; penerima yang belum
                terkirim tidak akan dicoba lagi untuk pengumuman ini.
              </div>
            )}
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Status ini mencatat keberhasilan penerimaan oleh penyedia (Fonnte), bukan konfirmasi
              dibaca. Penerima yang sudah berhasil tidak dikirim ulang.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={waBusy || !!waPanel.delivery.limitReached || (waPanel.delivery.failed === 0 && waPanel.delivery.pending === 0)}
                onClick={retryWhatsApp}
              >
                {waBusy ? 'Mengirim…' : waPanel.delivery.limitReached ? 'Batas kirim tercapai' : 'Kirim ulang yang gagal / tertunda'}
              </button>
              <button type="button" className="btn" onClick={() => setWaPanel(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function toDTO(raw: Record<string, unknown>): AnnouncementDTO {
  const a = raw as Record<string, any>;
  const photos = Array.isArray(a.photos)
    ? a.photos
    : typeof a.photos === 'string' && a.photos
      ? safeParse(a.photos)
      : [];
  const status = deriveAnnouncementStatus({
    isPublished: Boolean(a.isPublished),
    publishedAt: a.publishedAt ?? null,
    validUntil: a.validUntil ?? null,
    archivedAt: a.archivedAt ?? null,
    deletedAt: a.deletedAt ?? null,
  });
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    content: a.content,
    excerpt: a.excerpt,
    category: a.category ?? null,
    coverPhoto: a.coverPhoto ?? null,
    photos,
    target: (a.target as AnnouncementDTO['target']) || 'ALL',
    notifyWhatsApp: Boolean(a.notifyWhatsApp),
    isPublished: Boolean(a.isPublished),
    publishedAt: a.publishedAt ?? null,
    validFrom: a.validFrom ?? null,
    validUntil: a.validUntil ?? null,
    archivedAt: a.archivedAt ?? null,
    deletedAt: a.deletedAt ?? null,
    updatedAt: a.updatedAt ?? new Date().toISOString(),
    status,
    delivery: (a.delivery as DeliverySummary) || { sent: 0, failed: 0, skipped: 0, pending: 0, total: 0 },
  };
}

function safeParse(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

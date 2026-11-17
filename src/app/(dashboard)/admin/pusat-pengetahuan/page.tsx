'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSessionClient } from '@/lib/auth-client';
import { redirect } from 'next/navigation';

const CATEGORIES = [
  { code: 'KELUHAN', label: 'Keluhan' },
  { code: 'SARAN', label: 'Saran' },
  { code: 'FASILITAS', label: 'Fasilitas' },
  { code: 'KINERJA_PETUGAS', label: 'Kinerja Petugas' },
  { code: 'KEGIATAN_DESA', label: 'Kegiatan Desa' },
  { code: 'LAINNYA', label: 'Lainnya' },
] as const;

function categoryLabel(code: string): string {
  const c = CATEGORIES.find((x) => x.code === code);
  return c ? c.label : code;
}

/** Tanpa import server-only: format tanggal WIB di sisi klien. */
function wib(value: string | Date): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta',
    }).format(typeof value === 'string' ? new Date(value) : value);
  } catch {
    return String(value);
  }
}

interface Stats {
  total: number;
  verified: number;
  unverified: number;
}

export default function AiKnowledgeCenterPage() {
  const [session, setSession] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, verified: 0, unverified: 0 });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [verifiedFilter, setVerifiedFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'info' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // state edit: null = tertutup
  const [editing, setEditing] = useState<{
    id: string; title: string; content: string; category: string; isPrivate: boolean; wasVerified: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  // Ambil session di useEffect (bukan di level top await)
  useEffect(() => {
    async function fetchSession() {
      const sess = await getSessionClient();
      if (!sess || sess.role !== 'ADMIN') {
        redirect('/login');
      }
      setSession(sess);
    }
    fetchSession();
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      if (verifiedFilter) params.set('verified', verifiedFilter);
      params.set('limit', '50');

      const res = await fetch(`/api/ai/knowledge?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Gagal memuat entri');
      }
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
      if (data.stats) setStats(data.stats as Stats);
    } catch (e: any) {
      setMessage({ text: e.message || 'Gagal memuat entri', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [search, category, verifiedFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleVerify = async (id: string, toVerify: boolean) => {
    const notes = prompt(toVerify ? 'Masukkan catatan verifikasi (opsional):' : 'Masukkan alasan penolakan (opsional):', '');
    if (notes === null) return;
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: toVerify, verificationNotes: notes.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Gagal memverifikasi');
      setMessage({ text: toVerify ? 'Entri berhasil diverifikasi — Asisten AI boleh mengutipnya sebagai fakta resmi.' : 'Entri ditolak — tetap ada, tidak dihapus, tetapi tidak dianggap fakta resmi.', type: 'success' });
      fetchEntries();
    } catch (e: any) {
      setMessage({ text: e.message || 'Gagal memverifikasi', type: 'error' });
    }
  };

  // Kirim edit konten. Server otomatis me-reset status verifikasi bila
  // judul/isi entri yang sudah terverifikasi diubah (karantina ulang).
  const handleSaveEdit = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.content.trim()) {
      setMessage({ text: 'Judul dan isi tidak boleh kosong.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/knowledge/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editing.title,
          content: editing.content,
          category: editing.category,
          isPrivate: editing.isPrivate,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Gagal menyimpan perubahan');
      setMessage({
        text: data?.verificationInvalidated
          ? 'Perubahan tersimpan. Status verifikasi di-reset — tinjau ulang lalu verifikasi kembali agar dianggap fakta resmi.'
          : 'Perubahan tersimpan.',
        type: 'success',
      });
      setEditing(null);
      fetchEntries();
    } catch (e: any) {
      setMessage({ text: e.message || 'Gagal menyimpan perubahan', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Yakin ingin menghapus entri "${title}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Gagal menghapus');
      setMessage({ text: 'Entri berhasil dihapus', type: 'success' });
      fetchEntries();
    } catch (e: any) {
      setMessage({ text: e.message || 'Gagal menghapus', type: 'error' });
    }
  };

  const tagList = (tags: string | null) => {
    if (!tags) return [];
    try { return JSON.parse(tags); } catch { return []; }
  };

  const inputStyle = {
    padding: '0.6rem 0.9rem',
    borderRadius: '8px',
    border: '1px solid var(--input-border, var(--border-color))',
    background: 'var(--input-bg, var(--surface-solid))',
    color: 'var(--text-primary)',
    width: '100%',
  } as const;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '1rem 1.5rem', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      {message.text && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '8px', background: 'var(--muted-bg)', border: `1px solid ${message.type === 'error' ? 'var(--danger-color)' : 'var(--success-color)'}`, color: `var(${message.type === 'error' ? '--danger-text' : '--success-text'})`, fontSize: '0.9rem' }}>
          {message.text}
        </div>
      )}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--text-primary)' }}>Pusat Pengetahuan AI 🧠</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>
          Entri hanya dibuat saat pengguna meminta Asisten AI menyimpan informasi (atau input manual) — tidak ada ekstraksi otomatis diam-diam.
          Sumber dicantumkan per entri (warga/petugas/admin). Entri belum diverifikasi dianggap dugaan/laporan, bukan fakta resmi.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '140px', background: 'var(--card-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Total entri</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{stats.total}</div>
        </div>
        <div style={{ flex: 1, minWidth: '140px', background: 'var(--card-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--success-text)', marginBottom: '0.25rem' }}>Diverifikasi</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success-text)' }}>{stats.verified}</div>
        </div>
        <div style={{ flex: 1, minWidth: '140px', background: 'var(--card-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--warning-text)', marginBottom: '0.25rem' }}>Belum diverifikasi</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--warning-text)' }}>{stats.unverified}</div>
        </div>
      </div>

      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem', alignItems: 'flex-end' }}
      >
        <input
          name="search"
          type="text"
          placeholder="Cari judul atau isi..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: '200px', width: 'auto' }}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ ...inputStyle, width: 'auto', fontSize: '0.9rem' }}
        >
          <option value="">Semua kategori</option>
          {CATEGORIES.map((c) => (
            <option key={c.code} value={c.code}>{categoryLabel(c.code)}</option>
          ))}
        </select>
        <select
          value={verifiedFilter}
          onChange={(e) => setVerifiedFilter(e.target.value)}
          style={{ ...inputStyle, width: 'auto', fontSize: '0.9rem' }}
        >
          <option value="">Semua status</option>
          <option value="true">Sudah diverifikasi</option>
          <option value="false">Belum diverifikasi</option>
        </select>
        <button
          type="button"
          onClick={fetchEntries}
          style={{ padding: '0.6rem 1.2rem', background: 'var(--primary-color)', color: 'var(--on-accent-text, #fff)', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
        >
          Terapkan
        </button>
      </form>

      <div style={{ background: 'var(--surface-solid)', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'var(--muted-bg)', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'left' }}>Judul</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'left' }}>Kategori</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'left' }}>Sumber</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'left' }}>Verifikasi</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'right' }}>Diperbarui</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--divider)', textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Memuat...</td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  Belum ada entri pengetahuan yang cocok dengan filter ini.
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const isVerified = entry.verified;
                const tags = tagList(entry.tags);
                const expanded = expandedId === entry.id;
                // `ed` = salinan const agar narrowing TypeScript tetap berlaku
                // di dalam callback (state `editing` bisa berubah sewaktu-waktu).
                const ed = editing && editing.id === entry.id ? editing : null;
                return (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--divider)' }}>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', verticalAlign: 'top' }}>
                      {ed ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <input
                            value={ed.title}
                            onChange={(e) => setEditing({ ...ed, title: e.target.value })}
                            style={{ ...inputStyle, fontWeight: 600 }}
                          />
                          <textarea
                            value={ed.content}
                            onChange={(e) => setEditing({ ...ed, content: e.target.value })}
                            rows={5}
                            style={{ ...inputStyle, resize: 'vertical' }}
                          />
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select
                              value={ed.category}
                              onChange={(e) => setEditing({ ...ed, category: e.target.value })}
                              style={{ ...inputStyle, width: 'auto', fontSize: '0.85rem' }}
                            >
                              {CATEGORIES.map((c) => (
                                <option key={c.code} value={c.code}>{categoryLabel(c.code)}</option>
                              ))}
                            </select>
                            <label style={{ display: 'flex', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)', alignItems: 'center' }}>
                              <input
                                type="checkbox"
                                checked={ed.isPrivate}
                                onChange={(e) => setEditing({ ...ed, isPrivate: e.target.checked })}
                              />
                              Pribadi (luar role ini tidak dapat melihat)
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              onClick={handleSaveEdit}
                              disabled={saving}
                              style={{ padding: '0.4rem 0.9rem', background: 'var(--primary-color)', color: 'var(--on-accent-text, #fff)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
                            >
                              {saving ? 'Menyimpan...' : 'Simpan'}
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              disabled={saving}
                              style={{ padding: '0.4rem 0.9rem', background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{entry.title}</div>
                          <div
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)',
                              maxWidth: 300,
                              display: expanded ? 'block' : '-webkit-box',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: expanded ? 'pre-wrap' : 'normal',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {entry.content}
                          </div>
                          {!expanded && entry.content.length > 200 && (
                            <button
                              onClick={() => setExpandedId(entry.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent, var(--primary-color))', cursor: 'pointer', padding: 0, fontSize: '0.75rem', marginTop: '0.25rem' }}
                            >
                              Lihat isi lengkap
                            </button>
                          )}
                          {expanded && (
                            <button
                              onClick={() => setExpandedId(null)}
                              style={{ display: 'block', background: 'none', border: 'none', color: 'var(--accent, var(--primary-color))', cursor: 'pointer', padding: 0, fontSize: '0.75rem', marginTop: '0.25rem' }}
                            >
                              Tutup
                            </button>
                          )}
                          {tags.length > 0 && (
                            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              {tags.map((tag: string) => (
                                <span key={tag} style={{ fontSize: '0.7rem', background: 'var(--soft-primary-bg)', color: 'var(--soft-primary-text, var(--primary-color))', padding: '0.15rem 0.5rem', borderRadius: '4px', border: '1px solid var(--soft-primary-border)' }}>{tag}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', verticalAlign: 'top' }}>
                      <span style={{ fontSize: '0.8rem', background: 'var(--soft-primary-bg)', color: 'var(--soft-primary-text, var(--primary-color))', padding: '0.2rem 0.6rem', borderRadius: '6px', border: '1px solid var(--soft-primary-border)' }}>{categoryLabel(entry.category)}</span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', verticalAlign: 'top' }}>
                      <div style={{ fontSize: '0.85rem' }}>{entry.sourceUserName || '-'}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{entry.sourceRole} · {entry.sourceType}</div>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', verticalAlign: 'top' }}>
                      {isVerified ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--success-text)', fontWeight: 600 }}>✓ Diverifikasi</span>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'var(--warning-text)', fontWeight: 600 }}>⚠ Belum diverifikasi</span>
                      )}
                      {entry.verificationNotes && expanded && (
                        <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Catatan: {entry.verificationNotes}</div>
                      )}
                      {entry.isPrivate && (
                        <div style={{ marginTop: '0.2rem', fontSize: '0.7rem', color: 'var(--danger-text)' }}>🔒 Pribadi</div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', fontSize: '0.8rem', textAlign: 'right', verticalAlign: 'top' }}>
                      {wib(entry.updatedAt)}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleVerify(entry.id, !isVerified)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.75rem',
                            borderRadius: '6px',
                            border: 'none',
                            cursor: 'pointer',
                            background: isVerified ? 'var(--danger-color)' : 'var(--success-color)',
                            color: isVerified ? '#fff' : 'var(--on-accent-text, #fff)',
                          }}
                        >
                          {isVerified ? 'Batalkan Verifikasi' : 'Verifikasi'}
                        </button>
                        <button
                          onClick={() =>
                            setEditing({
                              id: entry.id,
                              title: entry.title,
                              content: entry.content,
                              category: entry.category,
                              isPrivate: !!entry.isPrivate,
                              wasVerified: !!entry.verified,
                            })
                          }
                          style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.75rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(entry.id, entry.title)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.75rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'transparent',
                            color: 'var(--danger-text)',
                            cursor: 'pointer',
                          }}
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && entries.length < total && (
        <div style={{ marginTop: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Menampilkan {entries.length} dari {total} entri. Sempitkan filter untuk melihat sisanya.
        </div>
      )}
    </div>
  );
}

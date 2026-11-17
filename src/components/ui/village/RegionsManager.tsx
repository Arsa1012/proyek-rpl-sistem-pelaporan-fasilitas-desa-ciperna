'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { describeError, describeFailure } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

export interface AdminRtDTO {
  id: string;
  number: string;
  name: string | null;
  isActive: boolean;
  order: number;
  userCount: number;
}
export interface AdminRwDTO {
  id: string;
  number: string;
  name: string | null;
  isActive: boolean;
  order: number;
  userCount: number;
  rts: AdminRtDTO[];
}

interface RwForm {
  number: string;
  name: string;
  order: string;
}
const EMPTY_RW: RwForm = { number: '', name: '', order: '0' };

export function RegionsManager({ initial }: { initial: AdminRwDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rws, setRws] = useState<AdminRwDTO[]>(initial);

  const [rwOpen, setRwOpen] = useState(false);
  const [rwEditId, setRwEditId] = useState<string | null>(null);
  const [rwForm, setRwForm] = useState<RwForm>(EMPTY_RW);

  // Form tambah RT: { [rwId]: { number, name, order } | undefined }
  const [rtFormRw, setRtFormRw] = useState<string | null>(null);
  const [rtEditId, setRtEditId] = useState<string | null>(null);
  const [rtForm, setRtForm] = useState<RwForm>(EMPTY_RW);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = async () => {
    const res = await fetch('/api/admin/regions', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.rws)) setRws(data.rws);
  };

  const run = async (fn: () => Promise<Response>) => {
    if (loading) return;
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(describeFailure(res, data).message);
        return false;
      }
      const msg = data.message || 'Data wilayah berhasil disimpan.';
      setNotice(msg);
      toast.success(msg);
      await reload();
      router.refresh();
      return true;
    } catch (err) {
      const failure = describeError(err);
      setError(failure.message);
      if (failure.retryable) toast.failure(failure, () => { void run(fn); });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const openCreateRw = () => {
    setRwEditId(null);
    setRwForm(EMPTY_RW);
    setRtFormRw(null);
    setRtEditId(null);
    setError('');
    setRwOpen(true);
  };

  const openEditRw = (rw: AdminRwDTO) => {
    setRwEditId(rw.id);
    setRwForm({ number: rw.number, name: rw.name || '', order: String(rw.order) });
    setRtFormRw(null);
    setRtEditId(null);
    setError('');
    setRwOpen(true);
  };

  const submitRw = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { number: rwForm.number, name: rwForm.name, order: Number(rwForm.order) || 0 };
    const ok = rwEditId
      ? await run(() =>
          fetch(`/api/admin/regions/${rwEditId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'RW', ...payload }),
          })
        )
      : await run(() =>
          fetch('/api/admin/regions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'RW', ...payload }),
          })
        );
    if (ok) {
      setRwOpen(false);
      setRwEditId(null);
      setRwForm(EMPTY_RW);
    }
  };

  const submitRt = async (e: React.FormEvent, rwId: string) => {
    e.preventDefault();
    const payload = { number: rtForm.number, name: rtForm.name, order: Number(rtForm.order) || 0 };
    const ok = rtEditId
      ? await run(() =>
          fetch(`/api/admin/regions/${rtEditId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'RT', ...payload }),
          })
        )
      : await run(() =>
          fetch('/api/admin/regions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'RT', rwId, ...payload }),
          })
        );
    if (ok) {
      setRtFormRw(null);
      setRtEditId(null);
      setRtForm(EMPTY_RW);
    }
  };

  const openAddRt = (rwId: string) => {
    setRtFormRw(rwId);
    setRtEditId(null);
    setRtForm(EMPTY_RW);
    setRwOpen(false);
    setError('');
  };

  const openEditRt = (rt: AdminRtDTO) => {
    setRtFormRw(rt.id); // penanda: form RT terbuka untuk RT ini
    setRtEditId(rt.id);
    setRtForm({ number: rt.number, name: rt.name || '', order: String(rt.order) });
    setRwOpen(false);
    setError('');
  };

  const toggleActive = (type: 'RW' | 'RT', id: string, isActive: boolean) =>
    run(() =>
      fetch(`/api/admin/regions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, isActive: !isActive }),
      })
    );

  const totalRt = rws.reduce((sum, rw) => sum + rw.rts.length, 0);
  const totalUsers = rws.reduce((sum, rw) => sum + rw.userCount, 0);

  return (
    <div>
      {(error || notice) && (
        <div
          className="glass"
          role={error ? 'alert' : 'status'}
          style={{
            padding: '0.85rem 1rem',
            marginBottom: '1rem',
            borderLeft: `4px solid ${error ? 'var(--danger-text)' : 'var(--success-text)'}`,
            color: error ? 'var(--danger-text)' : 'var(--success-text)',
          }}
        >
          {error || notice}
        </div>
      )}

      <div className="glass" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total RW</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary-color)' }}>{rws.length}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total RT</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary-color)' }}>{totalRt}</p>
          </div>
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Warga tertaut</p>
            <p style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary-color)' }}>{totalUsers}</p>
          </div>
        </div>
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={openCreateRw}>
          + Tambah RW
        </button>
      </div>

      {rwOpen && (
        <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem' }}>{rwEditId ? 'Ubah RW' : 'Tambah RW'}</h3>
          <form onSubmit={submitRw}>
            <div className="region-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="rw-number">Nomor RW (1-3 angka)</label>
                <input id="rw-number" className="form-input" value={rwForm.number} onChange={(e) => setRwForm((p) => ({ ...p, number: e.target.value }))} required maxLength={3} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rw-name">Nama/Label (opsional)</label>
                <input id="rw-name" className="form-input" value={rwForm.name} onChange={(e) => setRwForm((p) => ({ ...p, name: e.target.value }))} maxLength={100} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="rw-order">Urutan tampil</label>
                <input id="rw-order" type="number" className="form-input" value={rwForm.order} onChange={(e) => setRwForm((p) => ({ ...p, order: e.target.value }))} min={0} max={9999} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Menyimpan…' : 'Simpan'}</button>
              <button type="button" className="btn" style={{ background: 'var(--muted-bg)' }} onClick={() => { setRwOpen(false); setRwEditId(null); }}>Batal</button>
            </div>
          </form>
        </div>
      )}

      {rws.length === 0 ? (
        <div className="glass" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️</p>
          <p>Belum ada data RW/RT. Tambahkan RW terlebih dahulu, lalu RT di dalamnya.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Selama data kosong, formulir registrasi warga tidak menampilkan pilihan RT/RW.
          </p>
        </div>
      ) : (
        <div className="region-admin-list">
          {rws.map((rw) => (
            <div key={rw.id} className="glass region-admin-card">
              <div className="region-admin-head">
                <div>
                  <h3 style={{ fontSize: '1.05rem' }}>
                    RW {rw.number}
                    {rw.name ? ` — ${rw.name}` : ''}{' '}
                    {!rw.isActive && <span className="badge" style={{ background: 'var(--muted-bg)', color: 'var(--text-secondary)' }}>Nonaktif</span>}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {rw.rts.length} RT • {rw.userCount} warga tertaut • urutan {rw.order}
                  </p>
                </div>
                <div className="region-admin-actions">
                  <button type="button" className="btn" style={{ background: 'var(--muted-bg)', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={() => openAddRt(rw.id)}>+ RT</button>
                  <button type="button" className="btn" style={{ background: 'var(--muted-bg)', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={() => openEditRw(rw)}>Ubah</button>
                  <button type="button" className="btn" style={{ background: rw.isActive ? 'rgba(239,68,68,0.12)' : 'rgba(22,163,74,0.12)', color: rw.isActive ? 'var(--danger-text)' : 'var(--success-text)', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} disabled={loading} onClick={() => toggleActive('RW', rw.id, rw.isActive)}>
                    {rw.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              </div>

              {rtFormRw === rw.id && !rtEditId && (
                <form onSubmit={(e) => submitRt(e, rw.id)} className="region-rt-form">
                  <input className="form-input" placeholder="No. RT" value={rtForm.number} onChange={(e) => setRtForm((p) => ({ ...p, number: e.target.value }))} required maxLength={3} style={{ maxWidth: '90px' }} />
                  <input className="form-input" placeholder="Nama (opsional)" value={rtForm.name} onChange={(e) => setRtForm((p) => ({ ...p, name: e.target.value }))} maxLength={100} />
                  <input className="form-input" type="number" placeholder="Urutan" value={rtForm.order} onChange={(e) => setRtForm((p) => ({ ...p, order: e.target.value }))} min={0} max={9999} style={{ maxWidth: '110px' }} />
                  <button type="submit" className="btn btn-primary" disabled={loading}>Simpan RT</button>
                  <button type="button" className="btn" style={{ background: 'var(--muted-bg)' }} onClick={() => setRtFormRw(null)}>Batal</button>
                </form>
              )}

              {rw.rts.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>
                  Belum ada RT di RW ini. Tambahkan RT agar warga dapat memilih wilayah.
                </p>
              ) : (
                <ul className="region-rt-list">
                  {rw.rts.map((rt) => (
                    <li key={rt.id} className="region-rt-item">
                      {rtEditId === rt.id ? (
                        <form onSubmit={(e) => submitRt(e, rw.id)} className="region-rt-form" style={{ flex: 1 }}>
                          <input className="form-input" value={rtForm.number} onChange={(e) => setRtForm((p) => ({ ...p, number: e.target.value }))} required maxLength={3} style={{ maxWidth: '90px' }} />
                          <input className="form-input" placeholder="Nama" value={rtForm.name} onChange={(e) => setRtForm((p) => ({ ...p, name: e.target.value }))} maxLength={100} />
                          <input className="form-input" type="number" value={rtForm.order} onChange={(e) => setRtForm((p) => ({ ...p, order: e.target.value }))} min={0} max={9999} style={{ maxWidth: '110px' }} />
                          <button type="submit" className="btn btn-primary" disabled={loading}>Simpan</button>
                          <button type="button" className="btn" style={{ background: 'var(--muted-bg)' }} onClick={() => { setRtEditId(null); setRtFormRw(null); }}>Batal</button>
                        </form>
                      ) : (
                        <>
                          <span style={{ fontWeight: 500 }}>
                            RT {rt.number}
                            {rt.name ? ` — ${rt.name}` : ''}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rt.userCount} warga</span>
                          {!rt.isActive && <span className="badge" style={{ background: 'var(--muted-bg)', color: 'var(--text-secondary)' }}>Nonaktif</span>}
                          <div className="region-admin-actions">
                            <Link
                              href={`/admin/masyarakat?rt=${rt.id}`}
                              className="btn"
                              style={{ background: 'var(--muted-bg)', padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}
                            >
                              Lihat warga
                            </Link>
                            <button type="button" className="btn" style={{ background: 'var(--muted-bg)', padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => openEditRt(rt)}>Ubah</button>
                            <button type="button" className="btn" style={{ background: rt.isActive ? 'rgba(239,68,68,0.12)' : 'rgba(22,163,74,0.12)', color: rt.isActive ? 'var(--danger-text)' : 'var(--success-text)', padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} disabled={loading} onClick={() => toggleActive('RT', rt.id, rt.isActive)}>
                              {rt.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

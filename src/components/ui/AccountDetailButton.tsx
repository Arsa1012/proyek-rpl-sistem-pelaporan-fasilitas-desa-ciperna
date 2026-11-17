'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleLabel } from '@/lib/roles';

interface DetailUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  suspendReason: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  rt?: { id: string; number: string; name: string | null; rw: { number: string } } | null;
}

interface DetailData {
  user: DetailUser;
  counts: { reports: number; assignments: number };
  recentReports: any[];
  recentAssignments: any[];
  auditTrail: any[];
}

const fmtDate = (v: string | null | undefined) => {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return '-';
  return new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Tombol "Lihat Detail" + modal detail akun (warga/petugas).
// Data & aksi diambil dari endpoint server yang dibatasi role ADMIN.
// Tidak pernah menampilkan password/hash/token.
export function AccountDetailButton({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<DetailData | null>(null);

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');

  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  // Pindah wilayah (RT/RW) — khusus akun warga, dengan konfirmasi & audit.
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionRws, setRegionRws] = useState<Array<{ id: string; number: string; name: string | null; rts: Array<{ id: string; number: string; name: string | null }> }>>([]);
  const [regionRwId, setRegionRwId] = useState('');
  const [regionRtId, setRegionRtId] = useState('');
  const [regionSaving, setRegionSaving] = useState(false);
  const [regionMsg, setRegionMsg] = useState('');
  const [regionErr, setRegionErr] = useState('');

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Gagal memuat detail akun');
        return;
      }
      setData(json);
      setName(json.user?.name || '');
      setEmail(json.user?.email || '');
      setPhone(json.user?.phone || '');
    } catch {
      setError('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const close = () => {
    setOpen(false);
    setMode('view');
    setFormError('');
    setFormMsg('');
    setResetError('');
    setTempPassword('');
    setRegionOpen(false);
    setRegionMsg('');
    setRegionErr('');
  };

  const openRegion = async () => {
    setRegionOpen(true);
    setRegionErr('');
    setRegionMsg('');
    setRegionRwId('');
    setRegionRtId('');
    if (regionRws.length === 0) {
      try {
        const res = await fetch('/api/regions', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (Array.isArray(json?.rws)) setRegionRws(json.rws);
      } catch {
        setRegionErr('Gagal memuat data wilayah.');
      }
    }
  };

  const saveRegion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regionSaving) return;
    setRegionErr('');
    setRegionMsg('');
    setRegionSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rtId: regionRtId || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRegionErr(json.error || 'Gagal memindahkan wilayah');
        return;
      }
      setRegionMsg('Wilayah pengguna berhasil diperbarui.');
      await load();
      router.refresh();
    } catch {
      setRegionErr('Gagal terhubung ke server.');
    } finally {
      setRegionSaving(false);
    }
  };

  const regionRts = regionRws.find((r) => r.id === regionRwId)?.rts ?? [];

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setFormError('');
    setFormMsg('');
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json.error || 'Gagal menyimpan perubahan');
        return;
      }
      setFormMsg('Data akun berhasil diperbarui.');
      await load();
      setMode('view');
      router.refresh();
    } catch {
      setFormError('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!data) return;
    const action = data.user.isActive ? 'menonaktifkan' : 'mengaktifkan';
    if (!window.confirm(`Yakin ingin ${action} akun "${data.user.name}"?${data.user.isActive ? ' Akun tidak akan bisa login, tetapi data dan laporannya tetap tersimpan.' : ''}`)) {
      return;
    }
    setFormError('');
    setFormMsg('');
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !data.user.isActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(json.error || 'Gagal memperbarui status akun');
        return;
      }
      setFormMsg(data.user.isActive ? 'Akun dinonaktifkan.' : 'Akun diaktifkan.');
      await load();
      router.refresh();
    } catch {
      setFormError('Gagal terhubung ke server.');
    }
  };

  const resetPassword = async () => {
    if (!data || resetting) return;
    if (!window.confirm(`Reset kata sandi akun "${data.user.name}"? Sistem akan membuat kata sandi sementara yang wajib diganti saat login berikutnya.`)) {
      return;
    }
    setResetting(true);
    setResetError('');
    setTempPassword('');
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(json.error || 'Gagal mereset kata sandi');
        return;
      }
      setTempPassword(json.temporaryPassword || '');
      await load();
    } catch {
      setResetError('Gagal terhubung ke server.');
    } finally {
      setResetting(false);
    }
  };

  const u = data?.user;
  const isAdminAccount = u?.role === 'ADMIN';

  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={() => setOpen(true)}
        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'var(--muted-bg)' }}
        aria-label={`Lihat detail akun ${userName}`}
      >
        Lihat Detail
      </button>

      {open && (
        <div className="modal-overlay" onClick={close} role="dialog" aria-modal="true" aria-label={`Detail akun ${userName}`}>
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px', maxHeight: '88vh', overflowY: 'auto' }}>
            {loading && !data ? (
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Memuat detail akun...</p>
            ) : error ? (
              <>
                <div className="error-banner" style={{ marginBottom: '1rem' }}>⚠️ {error}</div>
                <button type="button" className="btn" onClick={close} style={{ width: '100%', justifyContent: 'center', background: 'var(--muted-bg)' }}>Tutup</button>
              </>
            ) : u ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="officer-avatar" style={{ width: '44px', height: '44px', fontSize: '1.15rem' }}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{u.name}</h3>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{roleLabel(u.role)}</span>
                    </div>
                  </div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', padding: '0.25rem 0.65rem', borderRadius: '999px',
                    background: u.isActive ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)',
                    color: u.isActive ? 'var(--success-text)' : 'var(--danger-text)',
                    fontSize: '0.75rem', fontWeight: 600,
                  }}>
                    {u.isActive ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>

                {formError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>⚠️ {formError}</div>}
                {formMsg && <div className="login-success" style={{ marginBottom: '0.75rem' }}>{formMsg}</div>}
                {resetError && <div className="error-banner" style={{ marginBottom: '0.75rem' }}>⚠️ {resetError}</div>}

                {tempPassword && (
                  <div style={{ padding: '0.85rem 1rem', background: 'var(--hover-bg)', borderRadius: '8px', border: '1px solid var(--divider)', marginBottom: '1rem' }}>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Kata sandi sementara — <strong>hanya ditampilkan sekali</strong>. Sampaikan kepada pengguna secara aman. Wajib diganti saat login berikutnya.
                    </p>
                    <code style={{ fontSize: '1.05rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>{tempPassword}</code>
                  </div>
                )}

                {mode === 'edit' ? (
                  <form onSubmit={saveEdit} autoComplete="off" style={{ marginBottom: '1rem' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ad-name">Nama Lengkap</label>
                      <input id="ad-name" type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ad-email">Email</label>
                      <input id="ad-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="ad-phone">Nomor WhatsApp (opsional)</label>
                      <input id="ad-phone" type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="cth: 081234567890" />
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn" onClick={() => setMode('view')} disabled={saving} style={{ flex: 1, justifyContent: 'center', background: 'var(--muted-bg)' }}>Batal</button>
                      <button type="submit" className="btn btn-primary" disabled={saving} style={{ flex: 2, justifyContent: 'center' }}>{saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.5rem 1rem', marginBottom: '1rem' }}>
                      <InfoRow label="Email" value={u.email} />
                      <InfoRow label="Nomor WhatsApp" value={u.phone || '-'} />
                      <InfoRow label="Peran" value={roleLabel(u.role)} />
                      <InfoRow label="Status Akun" value={u.isActive ? 'Aktif' : 'Nonaktif'} />
                      {!u.isActive && (
                        <InfoRow label="Alasan Nonaktif" value={u.suspendReason || 'Belum dicatat Admin'} />
                      )}
                      <InfoRow label="Terdaftar" value={fmtDate(u.createdAt)} />
                      <InfoRow label="Terakhir Diperbarui" value={fmtDate(u.updatedAt)} />
                      {u.role !== 'ADMIN' && (
                        <InfoRow
                          label="Wilayah (RT/RW)"
                          value={u.rt ? `RT ${u.rt.number} / RW ${u.rt.rw.number}` : 'Belum diisi'}
                        />
                      )}
                      {u.role === 'CITIZEN' && <InfoRow label="Jumlah Laporan" value={String(data?.counts.reports ?? 0)} />}
                      {u.role === 'OFFICER' && <InfoRow label="Jumlah Penugasan" value={String(data?.counts.assignments ?? 0)} />}
                      {u.mustChangePassword && <InfoRow label="Wajib Ganti Kata Sandi" value="Ya" />}
                    </div>

                    {data && data.recentReports.length > 0 && (
                      <Section title="Laporan Terbaru">
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
                          {data.recentReports.map((r) => (
                            <li key={r.id}>{r.title} — <span style={{ color: 'var(--text-secondary)' }}>{r.status} · {fmtDate(r.createdAt)}</span></li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {data && data.recentAssignments.length > 0 && (
                      <Section title="Penugasan Terbaru">
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
                          {data.recentAssignments.map((a) => (
                            <li key={a.id}>
                              {a.report?.title || '-'} —{' '}
                              <span style={{ color: 'var(--text-secondary)' }}>
                                {a.cancelledAt ? 'dibatalkan' : a.completedAt ? 'selesai' : a.report?.status || 'aktif'} · {fmtDate(a.assignedAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {data && data.auditTrail.length > 0 && (
                      <Section title="Riwayat Tindakan Admin">
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.7 }}>
                          {data.auditTrail.map((a) => (
                            <li key={a.id}>{a.action} — <span style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(a.createdAt)}</span></li>
                          ))}
                        </ul>
                      </Section>
                    )}

                    {!isAdminAccount && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
                        <button type="button" className="btn" onClick={() => { setMode('edit'); setFormError(''); setFormMsg(''); }} style={{ background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}>
                          Edit Data
                        </button>
                        {u.role === 'CITIZEN' && (
                          <button type="button" className="btn" onClick={openRegion} style={{ background: 'var(--muted-bg)' }}>
                            Pindahkan Wilayah
                          </button>
                        )}
                        <button type="button" className="btn" onClick={resetPassword} disabled={resetting} style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning-text, #b45309)' }}>
                          {resetting ? 'Memproses...' : 'Reset Kata Sandi'}
                        </button>
                        <button type="button" className="btn" onClick={toggleActive} style={{
                          background: u.isActive ? 'rgba(239,68,68,0.1)' : 'rgba(22,163,74,0.1)',
                          color: u.isActive ? 'var(--danger-text)' : 'var(--success-text)',
                        }}>
                          {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </div>
                    )}

                    {!isAdminAccount && u.role === 'CITIZEN' && regionOpen && (
                      <form onSubmit={saveRegion} style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--divider)' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Pindahkan Wilayah Warga</div>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 0 }}>
                          Pilih RW lalu RT baru untuk warga ini. Perubahan dicatat pada riwayat tindakan Admin.
                        </p>
                        {regionErr && <div className="login-error">{regionErr}</div>}
                        {regionMsg && <div className="login-success">{regionMsg}</div>}
                        <div className="region-grid">
                          <label className="region-control">
                            <span className="region-label">RW</span>
                            <select className="form-input region-select" value={regionRwId} onChange={(e) => { setRegionRwId(e.target.value); setRegionRtId(''); }}>
                              <option value="">— tanpa wilayah —</option>
                              {regionRws.map((rw) => (
                                <option key={rw.id} value={rw.id}>RW {rw.number}{rw.name ? ` — ${rw.name}` : ''}</option>
                              ))}
                            </select>
                          </label>
                          <label className="region-control">
                            <span className="region-label">RT</span>
                            <select className="form-input region-select" value={regionRtId} onChange={(e) => setRegionRtId(e.target.value)} disabled={!regionRwId}>
                              <option value="">{regionRwId ? 'Pilih RT' : 'Pilih RW dahulu'}</option>
                              {regionRts.map((rt) => (
                                <option key={rt.id} value={rt.id}>RT {rt.number}{rt.name ? ` — ${rt.name}` : ''}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                          <button type="button" className="btn" onClick={() => setRegionOpen(false)} style={{ background: 'var(--muted-bg)' }}>Batal</button>
                          <button type="submit" className="btn btn-primary" disabled={regionSaving}>{regionSaving ? 'Menyimpan...' : 'Simpan Wilayah'}</button>
                        </div>
                      </form>
                    )}
                  </>
                )}

                <button type="button" className="btn" onClick={close} style={{ width: '100%', justifyContent: 'center', marginTop: '1.25rem', background: 'var(--muted-bg)' }}>
                  Tutup
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: '0.9rem', wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '0.85rem' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>{title}</div>
      {children}
    </div>
  );
}

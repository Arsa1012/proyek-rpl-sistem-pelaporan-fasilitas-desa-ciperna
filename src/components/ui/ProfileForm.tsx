'use client';

import { useEffect, useMemo, useState } from 'react';

interface ProfileData {
  name: string;
  email: string;
  phone: string | null;
  photo: string | null;
}

interface PublicRt {
  id: string;
  number: string;
  name: string | null;
}
interface PublicRw {
  id: string;
  number: string;
  name: string | null;
  rts: PublicRt[];
}

export function ProfileForm({
  initial,
  roleLabel,
  region,
}: {
  initial: ProfileData;
  roleLabel: string;
  /** Bila diberikan, form menampilkan pemilihan RT/RW (data wilayah). */
  region?: { rtId: string | null };
}) {
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [phone, setPhone] = useState(initial.phone || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initial.photo);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const showRegion = region !== undefined;
  const [rws, setRws] = useState<PublicRw[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(showRegion);
  const [rwId, setRwId] = useState('');
  const [rtId, setRtId] = useState(region?.rtId || '');

  useEffect(() => {
    if (!showRegion) return;
    let alive = true;
    fetch('/api/regions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { rws: [] }))
      .then((d) => {
        if (!alive) return;
        const list: PublicRw[] = Array.isArray(d?.rws) ? d.rws : [];
        setRws(list);
        if (region?.rtId) {
          const owner = list.find((rw) => rw.rts.some((t) => t.id === region.rtId));
          if (owner) {
            setRwId(owner.id);
            setRtId(region.rtId);
          }
        }
      })
      .catch(() => {
        if (alive) setRws([]);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRegion]);

  const selectedRw = useMemo(() => rws.find((r) => r.id === rwId) || null, [rws, rwId]);
  const rts = selectedRw?.rts ?? [];

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setErr('');
    setMsg('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('email', email);
      fd.append('phone', phone);
      if (photoFile) fd.append('photo', photoFile);
      if (showRegion) fd.append('rtId', rtId);
      const res = await fetch('/api/profile', { method: 'PATCH', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || 'Gagal menyimpan profil');
        return;
      }
      setMsg('Profil berhasil diperbarui.');
      setPhotoFile(null);
      if (data.user?.photo) setPhotoPreview(data.user.photo);
    } catch {
      setErr('Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwLoading) return;
    setPwErr('');
    setPwMsg('');
    setPwLoading(true);
    try {
      const res = await fetch('/api/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwErr(data.error || 'Gagal mengubah password');
        return;
      }
      setPwMsg(data.message || 'Password berhasil diubah.');
      setOldPassword('');
      setNewPassword('');
    } catch {
      setPwErr('Gagal terhubung ke server.');
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div>
      <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.3rem' }}>Ubah Data Profil</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Perbarui nama, email, nomor WhatsApp, foto, dan wilayah ({roleLabel}).
        </p>
        {err && <div className="login-error">{err}</div>}
        {msg && <div className="login-success">{msg}</div>}
        <form onSubmit={handleSave} autoComplete="off">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
            <div className="officer-avatar" style={{ width: '64px', height: '64px', fontSize: '1.5rem', overflow: 'hidden' }}>
              {photoPreview ? (
                <img src={photoPreview} alt="Foto profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                name.charAt(0).toUpperCase()
              )}
            </div>
            <label className="btn" style={{ fontSize: '0.8rem', cursor: 'pointer' }}>
              Pilih Foto
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhoto} style={{ display: 'none' }} />
            </label>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pf-name">Nama Lengkap</label>
            <input id="pf-name" type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pf-email">Email</label>
            <input id="pf-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pf-phone">Nomor WhatsApp (cth: 081234567890)</label>
            <input id="pf-phone" type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Kosongkan jika tidak ada" />
          </div>

          {showRegion && (
            <div className="region-fieldset">
              <span className="region-legend">Data Wilayah (RT/RW)</span>
              {regionsLoading ? (
                <p className="field-hint">Memuat data wilayah…</p>
              ) : rws.length === 0 ? (
                <p className="region-notice">
                  Data RT/RW belum tersedia. Hubungi Admin desa untuk melengkapi data wilayah Anda.
                </p>
              ) : (
                <>
                  <div className="region-grid">
                    <label className="region-control">
                      <span className="region-label">RW</span>
                      <select
                        className="form-input region-select"
                        value={rwId}
                        onChange={(e) => {
                          setRwId(e.target.value);
                          setRtId('');
                        }}
                      >
                        <option value="">Pilih RW</option>
                        {rws.map((rw) => (
                          <option key={rw.id} value={rw.id}>
                            RW {rw.number}
                            {rw.name ? ` — ${rw.name}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="region-control">
                      <span className="region-label">RT</span>
                      <select
                        className="form-input region-select"
                        value={rtId}
                        onChange={(e) => setRtId(e.target.value)}
                        disabled={!selectedRw}
                      >
                        <option value="">{selectedRw ? 'Pilih RT' : 'Pilih RW dahulu'}</option>
                        {rts.map((rt) => (
                          <option key={rt.id} value={rt.id}>
                            RT {rt.number}
                            {rt.name ? ` — ${rt.name}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="field-hint">Perbarui bila Anda pindah domisili atau data wilayah belum lengkap.</p>
                </>
              )}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </form>
      </div>

      <div className="glass" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.3rem' }}>Ubah Kata Sandi</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Gunakan kata sandi yang kuat dan tidak dipakai di layanan lain.
        </p>
        {pwErr && <div className="login-error">{pwErr}</div>}
        {pwMsg && <div className="login-success">{pwMsg}</div>}
        <form onSubmit={handlePassword} autoComplete="off">
          <div className="form-group">
            <label className="form-label" htmlFor="pf-oldpw">Password Lama</label>
            <input id="pf-oldpw" type="password" autoComplete="current-password" className="form-input" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="pf-newpw">Password Baru (min. 8 karakter, kapital, kecil & angka)</label>
            <input id="pf-newpw" type="password" autoComplete="new-password" className="form-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pwLoading} style={{ width: '100%', justifyContent: 'center' }}>
            {pwLoading ? 'Memproses...' : 'Ubah Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

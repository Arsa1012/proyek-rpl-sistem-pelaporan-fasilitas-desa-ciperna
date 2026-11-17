'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runRequest } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

// Tombol + modal "Tambah Petugas". Role SELALU ditetapkan OFFICER oleh server.
//
// Tiga mode kredensial:
// - Akun aktivasi (disarankan): tautan ber-token sekali pakai dikirim ke WhatsApp
//   petugas. Kata sandi tidak pernah dikirim/ditampilkan.
// - Kata sandi sementara otomatis: ditampilkan SEKALI kepada Admin.
// - Kata sandi awal ditetapkan Admin.
type Mode = 'ACTIVATION' | 'TEMP' | 'PASSWORD';

export function AddOfficerButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<Mode>('ACTIVATION');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [activationUrl, setActivationUrl] = useState('');
  const [waStatus, setWaStatus] = useState<'sent' | 'failed' | 'skipped' | 'no_phone' | ''>('');
  const [successName, setSuccessName] = useState('');
  const router = useRouter();

  const reset = () => {
    setName('');
    setEmail('');
    setPhone('');
    setMode('ACTIVATION');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setTempPassword('');
    setActivationUrl('');
    setWaStatus('');
    setSuccessName('');
  };

  const close = () => {
    setOpen(false);
    if (successName) router.refresh();
    reset();
  };

  const perform = async () => {
    if (loading) return;
    setError('');

    if (mode === 'PASSWORD' && password !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    if (mode === 'ACTIVATION' && !phone.trim()) {
      setError('Mode aktivasi memerlukan Nomor WhatsApp petugas.');
      return;
    }

    setLoading(true);
    const outcome = await runRequest<{
      officer?: { name?: string };
      temporaryPassword?: string;
      activationUrl?: string;
      whatsapp?: 'sent' | 'failed' | 'skipped' | 'no_phone';
      message?: string;
    }>('/api/admin/officers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        phone,
        credentialMode: mode,
        password: mode === 'PASSWORD' ? password : '',
        confirmPassword: mode === 'PASSWORD' ? confirmPassword : '',
      }),
    });
    setLoading(false);

    if (!outcome.ok) {
      // Validasi → tampilkan di dalam form (data belum hilang). Lainnya → toast.
      if (outcome.failure.kind === 'validation' || outcome.failure.kind === 'conflict') {
        setError(outcome.failure.message);
      } else {
        toast.failure(outcome.failure, perform);
      }
      return;
    }

    const data = outcome.data;
    setSuccessName(data.officer?.name || name);
    setTempPassword(data.temporaryPassword || '');
    setActivationUrl(data.activationUrl || '');
    setWaStatus(data.whatsapp || '');
    toast.success(
      mode === 'ACTIVATION'
        ? 'Akun petugas dibuat dan tautan aktivasi disiapkan.'
        : 'Akun petugas berhasil dibuat.'
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform();
  };

  const waNotice = () => {
    if (waStatus === 'sent') return { text: 'Tautan aktivasi telah dikirim ke WhatsApp petugas.', tone: 'ok' as const };
    if (waStatus === 'failed') return { text: 'Pengiriman WhatsApp gagal. Salin tautan di bawah dan sampaikan secara aman.', tone: 'warn' as const };
    if (waStatus === 'no_phone') return { text: 'Nomor WhatsApp petugas belum diisi, notifikasi tidak dikirim.', tone: 'warn' as const };
    if (waStatus === 'skipped') return { text: 'Fitur WhatsApp belum dikonfigurasi di server, notifikasi tidak dikirim.', tone: 'warn' as const };
    return null;
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <span aria-hidden="true">➕</span> Tambah Petugas
      </button>

      {open && (
        <div
          className="modal-overlay"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Tambah akun petugas"
        >
          <div className="modal-card glass" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            {successName ? (
              <>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span aria-hidden="true">✅</span> Akun Petugas Dibuat
                </h3>
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
                  Akun petugas <strong>{successName}</strong> berhasil dibuat dan langsung tampil pada daftar.
                </p>

                {(() => {
                  const notice = waNotice();
                  if (!notice) return null;
                  return (
                    <div
                      className="glass"
                      style={{
                        padding: '0.6rem 0.75rem',
                        marginBottom: '0.85rem',
                        fontSize: '0.82rem',
                        borderLeft: `4px solid ${notice.tone === 'ok' ? 'var(--success-text)' : 'var(--warning-text, #b45309)'}`,
                        color: notice.tone === 'ok' ? 'var(--success-text)' : 'var(--warning-text, #b45309)',
                      }}
                    >
                      {notice.text}
                    </div>
                  );
                })()}

                {activationUrl && (
                  <div style={{ padding: '0.85rem 1rem', background: 'var(--hover-bg)', borderRadius: '8px', border: '1px solid var(--divider)', marginBottom: '1rem' }}>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Tautan aktivasi (rahasia, sekali pakai, berbatas waktu). Sampaikan HANYA kepada petugas terkait melalui kanal aman.
                    </p>
                    <code style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{activationUrl}</code>
                  </div>
                )}

                {tempPassword && (
                  <div style={{ padding: '0.85rem 1rem', background: 'var(--hover-bg)', borderRadius: '8px', border: '1px solid var(--divider)', marginBottom: '1rem' }}>
                    <p style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Kata sandi sementara — <strong>hanya ditampilkan sekali ini</strong>. Sampaikan kepada
                      petugas secara aman. Petugas wajib menggantinya saat login berikutnya.
                    </p>
                    <code style={{ fontSize: '1.05rem', letterSpacing: '0.05em', wordBreak: 'break-all' }}>{tempPassword}</code>
                  </div>
                )}

                {!activationUrl && !tempPassword && (
                  <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Petugas dapat langsung login memakai kata sandi yang Anda tetapkan.
                  </p>
                )}

                <button type="button" className="btn btn-primary" onClick={close} style={{ width: '100%', justifyContent: 'center' }}>
                  Selesai
                </button>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span aria-hidden="true">👷</span> Tambah Akun Petugas
                </h3>

                <form onSubmit={handleSubmit} autoComplete="off">
                  <div className="form-group">
                    <label className="form-label" htmlFor="of-name">Nama Lengkap <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                    <input id="of-name" type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="of-email">Email <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                    <input id="of-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="of-phone">
                      Nomor WhatsApp {mode === 'ACTIVATION' ? <span style={{ color: 'var(--danger-text)' }}>*</span> : '(opsional)'}
                    </label>
                    <input id="of-phone" type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="cth: 081234567890" required={mode === 'ACTIVATION'} />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="of-mode">Metode kredensial</label>
                    <select id="of-mode" className="form-input" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                      <option value="ACTIVATION">Tautan aktivasi via WhatsApp (disarankan)</option>
                      <option value="TEMP">Kata sandi sementara otomatis</option>
                      <option value="PASSWORD">Kata sandi awal ditetapkan Admin</option>
                    </select>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Tautan aktivasi lebih aman: kata sandi dibuat oleh petugas sendiri dan tidak pernah dikirim melalui WhatsApp.
                    </p>
                  </div>

                  {mode === 'PASSWORD' && (
                    <>
                      <div className="form-group">
                        <label className="form-label" htmlFor="of-pw">Kata Sandi Awal <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                        <input id="of-pw" type="password" autoComplete="new-password" className="form-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 karakter, kapital, kecil & angka" required />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="of-pw2">Konfirmasi Kata Sandi <span style={{ color: 'var(--danger-text)' }}>*</span></label>
                        <input id="of-pw2" type="password" autoComplete="new-password" className="form-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                      </div>
                    </>
                  )}

                  {error && <div className="error-banner" style={{ marginTop: '0.75rem', marginBottom: 0 }}>⚠️ {error}</div>}

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
                    <button type="button" className="btn" onClick={close} disabled={loading} style={{ flex: 1, justifyContent: 'center', background: 'var(--muted-bg)' }}>
                      Batal
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 2, justifyContent: 'center' }}>
                      {loading ? 'Menyimpan...' : 'Simpan Akun Petugas'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

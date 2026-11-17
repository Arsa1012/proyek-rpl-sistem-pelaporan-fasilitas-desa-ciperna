'use client';

/**
 * Kartu pemulihan akun — dipakai halaman /aktivasi, /reset-password, dan
 * /lupa-password. Token dibaca dari query string di sisi klien (setelah mount)
 * agar halaman tidak bergantung pada Suspense useSearchParams.
 *
 * Aturan umpan balik: sukses hanya tampil setelah server mengonfirmasi; pesan
 * gagal mengikuti jenis kesalahan (lib/clientFeedback). Tema terang/gelap.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { runRequest } from '@/lib/clientFeedback';
import { useToast } from '@/components/ui/Toast';

interface SetPasswordProps {
  endpoint: '/api/auth/activate' | '/api/auth/reset-password';
  title: string;
  subtitle: string;
  submitLabel: string;
  /** Pesan sukses setelah server mengonfirmasi. */
  successMessage: string;
}

export function SetPasswordCard({ endpoint, title, subtitle, submitLabel, successMessage }: SetPasswordProps) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') || '');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform();
  };

  const perform = async () => {
    if (loading || done) return;
    setFormError('');

    if (!token) {
      setFormError('Tautan tidak memuat token. Buka kembali tautan terbaru dari pesan WhatsApp Anda.');
      return;
    }
    if (password !== confirm) {
      setFormError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setLoading(true);
    const outcome = await runRequest(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password, confirmPassword: confirm }),
    });
    setLoading(false);

    if (!outcome.ok) {
      // Validasi/koneksi: pesan dari server dipakai bila aman; kegagalan
      // koneksi/server ditampilkan dengan tombol coba lagi.
      if (outcome.failure.kind === 'validation') setFormError(outcome.failure.message);
      else toast.failure(outcome.failure, perform);
      return;
    }

    setDone(true);
    setPassword('');
    setConfirm('');
    toast.success(successMessage);
  };

  return (
    <div className="glass" style={{ maxWidth: '480px', margin: '3rem auto', padding: '1.75rem' }}>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.35rem' }}>{title}</h1>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{subtitle}</p>

      {done ? (
        <div>
          <div className="login-success" style={{ marginBottom: '1rem' }}>{successMessage}</div>
          <Link href="/login" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            Masuk sekarang
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} autoComplete="off">
          <div className="form-group">
            <label className="form-label" htmlFor="ar-pw">Kata sandi baru</label>
            <input
              id="ar-pw"
              type="password"
              className="form-input"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 karakter, kapital, kecil & angka"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ar-pw2">Konfirmasi kata sandi baru</label>
            <input
              id="ar-pw2"
              type="password"
              className="form-input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          {formError && <div className="error-banner">⚠️ {formError}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
            {loading ? 'Memproses…' : submitLabel}
          </button>
          <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Tautan bersifat sekali pakai dan berbatas waktu. Bila sudah kedaluwarsa, minta tautan baru.
          </p>
        </form>
      )}
    </div>
  );
}

export function RequestResetCard() {
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await perform();
  };

  const perform = async () => {
    if (loading) return;
    setLoading(true);
    const outcome = await runRequest('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
    });
    setLoading(false);
    if (!outcome.ok) {
      toast.failure(outcome.failure, perform);
      return;
    }
    // Respons selalu umum (tidak membocorkan apakah akun terdaftar).
    setSent(true);
    toast.success('Permintaan diterima. Periksa WhatsApp Anda bila akun terdaftar.');
  };

  return (
    <div className="glass" style={{ maxWidth: '480px', margin: '3rem auto', padding: '1.75rem' }}>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.35rem' }}>Lupa Kata Sandi</h1>
      <p style={{ margin: '0 0 1.25rem', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
        Masukkan email atau nomor WhatsApp akun Anda. Bila terdaftar, kami akan mengirim tautan
        pembuatan kata sandi baru ke nomor WhatsApp yang tercatat pada akun.
      </p>
      {sent ? (
        <div className="login-success">
          Bila email/nomor tersebut terdaftar, tautan telah dikirim. Periksa WhatsApp Anda.
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="form-group">
            <label className="form-label" htmlFor="fp-id">Email atau Nomor WhatsApp</label>
            <input
              id="fp-id"
              type="text"
              className="form-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="cth: nama@email.com atau 081234567890"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading || !identifier.trim()} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Memproses…' : 'Kirim Tautan Reset'}
          </button>
        </form>
      )}
      <p style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Ingat kata sandi Anda? <Link href="/login">Masuk di sini</Link>.
      </p>
    </div>
  );
}

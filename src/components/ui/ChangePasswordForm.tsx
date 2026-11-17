'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Form wajib ganti kata sandi sementara. Mengirim ke /api/auth/change-password
// (server menentukan akun dari sesi, bukan dari input).
export function ChangePasswordForm({ redirectTo }: { redirectTo: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Gagal memperbarui kata sandi');
        return;
      }
      // Navigasi keras agar dashboard menyajikan data terbaru (status wajib ganti sudah bersih).
      window.location.assign(redirectTo);
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="login-form" autoComplete="off">
      {error && <div className="login-error">{error}</div>}

      <div className="form-group">
        <label className="form-label" htmlFor="cp-new">Kata Sandi Baru</label>
        <input
          id="cp-new"
          type="password"
          autoComplete="new-password"
          className="login-input"
          style={{ paddingLeft: '1rem' }}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Min. 8 karakter, kapital, kecil & angka"
          required
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="cp-confirm">Konfirmasi Kata Sandi Baru</label>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          className="login-input"
          style={{ paddingLeft: '1rem' }}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Ulangi kata sandi baru"
          required
        />
      </div>

      <button type="submit" className="btn btn-primary login-button" disabled={loading}>
        {loading ? 'Menyimpan...' : 'SIMPAN KATA SANDI BARU'}
      </button>
    </form>
  );
}

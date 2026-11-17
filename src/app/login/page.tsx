'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      // Role TIDAK dikirim dari frontend — ditentukan server dari database
      // setelah email/nomor HP + password terverifikasi.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, rememberMe }),
      });

      const data = await res.json();

      if (res.ok) {
        setSuccess(data.message || 'Login berhasil! Mengalihkan...');
        setTimeout(() => {
          router.push(data.redirectUrl || '/');
        }, 1000);
      } else {
        setError(data.error || 'Login gagal');
      }
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card glass-panel">
        <div className="login-icon">🔐</div>
        <h1 className="login-title">Masuk</h1>
        <p className="login-subtitle">Masuk ke Sistem Pelaporan Fasilitas Umum Desa Ciperna</p>

        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}

        <form onSubmit={handleLogin} className="login-form" autoComplete="off">
          <div className="login-input-group">
            <span className="login-input-icon">👤</span>
            <input
              type="text"
              className="login-input"
              placeholder="Email atau Nomor HP (cth: 081234567890)"
              required
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <div className="login-input-group">
            <span className="login-input-icon">🔒</span>
            <input
              type={showPassword ? 'text' : 'password'}
              className="login-input"
              placeholder="Password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="password-toggle"
              aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary login-button"
            disabled={loading}
          >
            {loading ? 'Memproses...' : 'MASUK'}
          </button>

          <label className="remember-me">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>
              Ingat perangkat ini
              <small>Tetap masuk selama 30 hari di perangkat pribadi Anda.</small>
            </span>
          </label>
        </form>

        <div className="login-footer">
          <Link href="/lupa-password">Lupa kata sandi?</Link>
          <br />
          Belum punya akun?{' '}
          <Link href="/register">Daftar di sini</Link>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const ROLES = [
  { value: 'CITIZEN', label: 'Masyarakat', icon: '👤', desc: 'Laporkan fasilitas rusak' },
] as const;

type RoleValue = (typeof ROLES)[number]['value'];

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

export default function RegisterPage() {
  // ---- Tahap 1: formulir ----
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  // Pendaftaran mandiri selalu sebagai Masyarakat; role tidak dapat dipilih.
  const role: RoleValue = 'CITIZEN';
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(false);

  // ---- Tahap 2: verifikasi OTP ----
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [pendingEmail, setPendingEmail] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  // Data wilayah (RT/RW) dari server — bukan angka bebas, bukan pilihan palsu.
  const [rws, setRws] = useState<PublicRw[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [regionsError, setRegionsError] = useState(false);
  const [rwId, setRwId] = useState('');
  const [rtId, setRtId] = useState('');

  const router = useRouter();

  const selectedRole = ROLES.find((r) => r.value === role)!;

  useEffect(() => {
    let alive = true;
    fetch('/api/regions', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad status'))))
      .then((d) => {
        if (!alive) return;
        setRws(Array.isArray(d?.rws) ? d.rws : []);
      })
      .catch(() => {
        if (alive) setRegionsError(true);
      })
      .finally(() => {
        if (alive) setRegionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Penghitung mundur kirim ulang (hanya berjalan di tahap verifikasi).
  useEffect(() => {
    if (step !== 'verify') return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  const selectedRw = useMemo(() => rws.find((r) => r.id === rwId) || null, [rws, rwId]);
  const rts = selectedRw?.rts ?? [];
  const hasRegions = rws.length > 0;
  const rtRequired = hasRegions;

  const secondsLeft = Math.max(0, Math.ceil((resendAt - tick) / 1000));
  const canResend = step === 'verify' && secondsLeft === 0 && !resending && !done;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setInfo('');

    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak sama.');
      return;
    }
    if (!phone.trim()) {
      setError('Nomor WhatsApp wajib diisi untuk menerima kode verifikasi.');
      return;
    }
    if (rtRequired && !rtId) {
      setError('Silakan pilih RW dan RT tempat tinggal Anda.');
      return;
    }
    if (!agree) {
      setError('Anda harus menyetujui ketentuan penggunaan.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          confirmPassword,
          role,
          phone: phone.trim(),
          rtId: rtId || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.step === 'verify') {
        setPendingEmail(data.email || email);
        setPhoneMasked(data.phoneMasked || '');
        setResendAt(Date.now() + (Number(data.resendAfterSeconds) || 60) * 1000);
        setTick(Date.now());
        setCode('');
        setStep('verify');
        setInfo(data.message || 'Kode verifikasi telah dikirim ke WhatsApp Anda.');
      } else {
        if (data?.retryAfter) setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        setError(data?.error || 'Pendaftaran gagal. Silakan coba lagi.');
      }
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying || done) return;
    setError('');
    setInfo('');

    if (!/^\d{6}$/.test(code)) {
      setError('Kode verifikasi harus terdiri dari 6 angka.');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch('/api/auth/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `phone` dikirim ulang agar server dapat memastikan OTP memang milik
        // nomor yang didaftarkan (server tetap membandingkan dengan data sesi,
        // bukan mempercayai nilai dari browser).
        body: JSON.stringify({ email: pendingEmail, code, phone: phone.trim() }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setDone(true);
        setInfo(data?.message || 'Pendaftaran berhasil. Mengalihkan ke halaman masuk…');
        setTimeout(() => router.push('/login'), 1200);
      } else {
        if (data?.retryAfter) setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        if (typeof data?.remainingAttempts === 'number' && data.remainingAttempts <= 0) {
          setResendAt(Date.now());
        }
        setError(data?.error || 'Verifikasi gagal. Silakan coba lagi.');
        setCode('');
      }
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!canResend) return;
    setError('');
    setInfo('');
    setResending(true);
    try {
      const res = await fetch('/api/auth/register/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok) {
        setResendAt(Date.now() + (Number(data.resendAfterSeconds) || 60) * 1000);
        setTick(Date.now());
        setCode('');
        setInfo(data?.message || 'Kode verifikasi baru telah dikirim.');
      } else {
        if (data?.retryAfter) setResendAt(Date.now() + Number(data.retryAfter) * 1000);
        setError(data?.error || 'Gagal mengirim ulang kode.');
      }
    } catch {
      setError('Gagal terhubung ke server. Periksa koneksi internet Anda.');
    } finally {
      setResending(false);
    }
  };

  // ------------------------------ TAHAP 2 ------------------------------
  if (step === 'verify') {
    return (
      <div className="login-container">
        <div className="login-card glass-panel">
          <div className="login-icon">💬</div>
          <h1 className="login-title">Verifikasi WhatsApp</h1>
          <p className="login-subtitle">
            Masukkan 6 angka kode OTP yang dikirim ke WhatsApp{' '}
            <strong>{phoneMasked || 'Anda'}</strong>.
          </p>

          {error && <div className="login-error">{error}</div>}
          {!error && info && (
            <div
              className="login-error"
              style={{
                background: 'var(--muted-bg)',
                borderColor: 'var(--divider)',
                color: 'var(--soft-primary-text)',
              }}
            >
              {info}
            </div>
          )}

          <form onSubmit={handleVerify} className="login-form" autoComplete="off">
            <div className="login-input-group">
              <span className="login-input-icon">🔢</span>
              <input
                type="text"
                className="login-input"
                placeholder="Kode OTP (6 angka)"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                aria-label="Kode OTP 6 angka"
                style={{ letterSpacing: '0.5em', fontWeight: 700, textAlign: 'center' }}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={done}
                required
                autoFocus
              />
            </div>
            <p className="field-hint">
              Kode berlaku 5 menit dan hanya dapat digunakan satu kali. Jangan bagikan kode ini
              kepada siapa pun.
            </p>

            <button
              type="submit"
              className="btn btn-primary login-button"
              disabled={verifying || done || code.length !== 6}
            >
              {done ? 'Berhasil ✓' : verifying ? 'Memverifikasi…' : 'VERIFIKASI'}
            </button>

            <button
              type="button"
              className="btn login-button"
              onClick={handleResend}
              disabled={!canResend}
              style={{ marginTop: '0.5rem' }}
            >
              {resending
                ? 'Mengirim…'
                : secondsLeft > 0
                  ? `KIRIM ULANG (${secondsLeft} dtk)`
                  : 'KIRIM ULANG KODE'}
            </button>
          </form>

          <div className="login-footer">
            Salah memasukkan data?{' '}
            <button
              type="button"
              onClick={() => {
                if (verifying) return;
                setStep('form');
                setError('');
                setInfo('');
                setCode('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary-color)',
                cursor: 'pointer',
                fontWeight: 600,
                padding: 0,
                font: 'inherit',
              }}
            >
              Kembali ke formulir
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------ TAHAP 1 ------------------------------
  return (
    <div className="login-container">
      <div className="login-card glass-panel">
        <div className="login-icon">📝</div>
        <h1 className="login-title">Daftar</h1>
        <p className="login-subtitle">Buat akun Sistem Pelaporan Fasilitas Umum Desa Ciperna</p>

        <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem', textAlign: 'left' }}>
          Daftar sebagai:
        </p>
        <p className="role-hint">
          {selectedRole.icon} Daftar sebagai <strong>{selectedRole.label}</strong>
        </p>
        <p className="admin-notice">
          Akun Petugas dibuat oleh Admin dan akun Admin disediakan sistem — keduanya tidak dapat mendaftar di sini.
        </p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleRegister} className="login-form" autoComplete="off">
          <div className="login-input-group">
            <span className="login-input-icon">👤</span>
            <input
              type="text"
              className="login-input"
              placeholder="Nama Lengkap"
              required
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="login-input-group">
            <span className="login-input-icon">📧</span>
            <input
              type="email"
              className="login-input"
              placeholder="Email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="login-input-group">
            <span className="login-input-icon">📱</span>
            <input
              type="tel"
              className="login-input"
              placeholder="Nomor WhatsApp (wajib, cth: 081234567890)"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <p className="field-hint">
            Kode verifikasi OTP akan dikirim ke nomor WhatsApp ini. Nomor juga digunakan untuk
            komunikasi terkait laporan Anda.
          </p>

          {/* Data wilayah RT/RW — diambil dari master data Admin. */}
          <div className="region-fieldset">
            <span className="region-legend">Alamat Wilayah</span>

            {regionsLoading ? (
              <p className="field-hint">Memuat data RT/RW…</p>
            ) : regionsError ? (
              <p className="region-notice region-notice--warn">
                Gagal memuat data wilayah. Anda tetap dapat mendaftar, lalu melengkapi RT/RW di halaman profil.
              </p>
            ) : !hasRegions ? (
              <p className="region-notice">
                Data RT/RW belum dikonfigurasi Admin. Silakan lanjutkan pendaftaran; Anda dapat melengkapi RT/RW
                nanti melalui halaman profil setelah login.
              </p>
            ) : (
              <>
                <div className="region-grid">
                  <label className="region-control">
                    <span className="region-label">RW</span>
                    <select
                      className="login-input region-select"
                      value={rwId}
                      onChange={(e) => {
                        setRwId(e.target.value);
                        setRtId('');
                      }}
                      required
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
                      className="login-input region-select"
                      value={rtId}
                      onChange={(e) => setRtId(e.target.value)}
                      disabled={!selectedRw}
                      required
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
                <p className="field-hint">Pilih RW terlebih dahulu, lalu pilih RT yang sesuai.</p>
              </>
            )}
          </div>

          <div className="login-input-group">
            <span className="login-input-icon">🔒</span>
            <input
              type={showPassword ? 'text' : 'password'}
              className="login-input"
              placeholder="Password (min. 8 karakter, huruf besar, kecil & angka)"
              required
              autoComplete="new-password"
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

          <div className="login-input-group">
            <span className="login-input-icon">🔒</span>
            <input
              type={showPassword ? 'text' : 'password'}
              className="login-input"
              placeholder="Konfirmasi Password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <label className="terms-row">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
            <span>
              Saya menyetujui data yang saya isi digunakan untuk keperluan pelaporan dan administrasi Desa Ciperna.
            </span>
          </label>

          <button type="submit" className="btn btn-primary login-button" disabled={loading}>
            {loading ? 'Mengirim kode…' : 'DAFTAR & KIRIM OTP'}
          </button>
        </form>

        <div className="login-footer">
          Sudah punya akun? <Link href="/login">Masuk di sini</Link>
        </div>
      </div>
    </div>
  );
}

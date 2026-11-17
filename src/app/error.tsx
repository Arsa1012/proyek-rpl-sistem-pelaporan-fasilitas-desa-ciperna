'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="glass" style={{ padding: '2rem', textAlign: 'center', margin: '2rem auto', maxWidth: '500px' }}>
      <h2 style={{ marginBottom: '0.5rem' }}>Terjadi kesalahan</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        {error.message || 'Gagal memuat halaman. Silakan coba lagi.'}
      </p>
      <button onClick={() => reset()} className="btn btn-primary" style={{ padding: '0.6rem 1.5rem' }}>
        Coba lagi
      </button>
    </div>
  );
}

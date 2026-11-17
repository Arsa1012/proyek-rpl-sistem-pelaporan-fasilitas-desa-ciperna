import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="glass" style={{ padding: '3rem 2rem', textAlign: 'center', margin: '2rem auto', maxWidth: '500px' }}>
      <p style={{ fontSize: '3rem', margin: '0 0 0.5rem' }}>🔍</p>
      <h2 style={{ marginBottom: '0.5rem' }}>Halaman tidak ditemukan</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Data atau halaman yang Anda cari tidak tersedia.
      </p>
      <Link href="/" className="btn btn-primary" style={{ padding: '0.6rem 1.5rem', textDecoration: 'none' }}>
        Kembali ke Beranda
      </Link>
    </div>
  );
}

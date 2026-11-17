import Link from 'next/link';

/**
 * Section Call to Action — Penutup homepage yang mengajak warga berpartisipasi.
 * Visual: background dengan motif batik halus, teks terstruktur, tombol prominent.
 */
export function CallToAction() {
  return (
    <section className="cta-section reveal" id="kontak" aria-labelledby="cta-title">
      <div className="cta-wrap glass">
        {/* Dekorasi motif batik di sudut */}
        <div className="cta-batik-corner" aria-hidden="true">
          <svg viewBox="0 0 160 160" fill="none">
            <defs>
              <pattern id="ctaBatik" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="10" cy="10" r="1.5" fill="currentColor" opacity="0.15" />
                <path d="M0 10 Q5 0 10 10 T20 10" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.1" />
              </pattern>
            </defs>
            <rect width="160" height="160" fill="url(#ctaBatik)" />
          </svg>
        </div>

        <div className="cta-content">
          <span className="cta-badge">Aksi Nyata untuk Desa</span>
          <h2 id="cta-title">Desa yang Lebih Baik Dimulai dari Kepedulian Kita.</h2>
          <p className="cta-desc">
            Laporkan kerusakan fasilitas umum dan bantu membangun lingkungan
            Desa Ciperna yang lebih nyaman bagi seluruh warga.
          </p>
          <Link href="/masyarakat/laporan/create" className="btn btn-primary cta-btn">
            Buat Laporan Sekarang
          </Link>
        </div>
        <div className="cta-decor" aria-hidden="true" />
      </div>
    </section>
  );
}

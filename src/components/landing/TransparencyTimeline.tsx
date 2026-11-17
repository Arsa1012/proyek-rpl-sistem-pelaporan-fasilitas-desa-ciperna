/**
 * Section "Transparansi Penanganan Laporan" — Timeline visual alur laporan.
 * Setiap tahap memiliki ikon illustrasi + label visual + deskripsi teks.
 * Tidak ada data palsu: hanya ilustrasi alur proses yang umum.
 */
export function TransparencyTimeline() {
  const STEPS = [
    {
      no: '01',
      title: 'Masyarakat Mengirim Laporan',
      desc: 'Warga melaporkan kerusakan fasilitas umum dengan foto dan lokasi melalui sistem digital.',
      icon: '📝',
      visual: 'Lapor',
    },
    {
      no: '02',
      title: 'Verifikasi Petugas',
      desc: 'Admin memverifikasi laporan beserta hasil analisis AI sebelum diproses lebih lanjut.',
      icon: '✅',
      visual: 'Verifikasi',
    },
    {
      no: '03',
      title: 'Proses Penanganan',
      desc: 'Petugas lapangan ditugaskan untuk memperbaiki fasilitas dan mengunggah bukti pengerjaan.',
      icon: '👷',
      visual: 'Pengerjaan',
    },
    {
      no: '04',
      title: 'Laporan Selesai',
      desc: 'Hasil pekerjaan diperiksa Admin dan dinyatakan selesai setelah disetujui.',
      icon: '🔔',
      visual: 'Selesai',
    },
  ];

  return (
    <section className="transparency-section reveal" id="transparansi" aria-labelledby="trans-title">
      <div className="trans-head center">
        <span className="section-eyebrow">Transparansi Pelayanan</span>
        <h2 id="trans-title">Dari Laporan hingga Selesai</h2>
        <p className="section-sub">
          Setiap laporan masyarakat diproses secara terstruktur dan dapat dipantau
          secara transparan oleh warga melalui sistem digital Desa Ciperna.
        </p>
      </div>

      <div className="trans-wrap">
        {STEPS.map((step, idx) => (
          <article key={step.no} className="trans-card glass">
            <div className="trans-marker">
              <span className="trans-no">{step.no}</span>
              <span className="trans-dot" aria-hidden="true" />
            </div>
            <div className="trans-body">
              <div className="trans-step-visual" aria-hidden="true">
                <span className="trans-icon">{step.icon}</span>
                <span className="trans-step-label">{step.visual}</span>
              </div>
              <h3 className="trans-title">{step.title}</h3>
              <p className="trans-desc">{step.desc}</p>
            </div>
            {idx < STEPS.length - 1 && (
              <div className="trans-line" aria-hidden="true" />
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

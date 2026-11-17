const STEPS = [
  {
    no: '01',
    icon: '📝',
    title: 'Buat Laporan',
    desc: 'Masyarakat melaporkan fasilitas rusak lengkap dengan foto dan lokasi.',
  },
  {
    no: '02',
    icon: '✅',
    title: 'Admin Memverifikasi',
    desc: 'Admin memeriksa laporan beserta hasil analisis AI sebelum diproses.',
  },
  {
    no: '03',
    icon: '📌',
    title: 'Penugasan Petugas',
    desc: 'Admin menugaskan laporan kepada petugas lapangan yang sesuai.',
  },
  {
    no: '04',
    icon: '👷',
    title: 'Petugas Mengerjakan',
    desc: 'Petugas memperbaiki fasilitas dan mengunggah bukti pengerjaan.',
  },
  {
    no: '05',
    icon: '🔎',
    title: 'Admin Memeriksa Hasil',
    desc: 'Hasil pekerjaan diperiksa Admin sebelum dinyatakan selesai.',
  },
  {
    no: '06',
    icon: '🔔',
    title: 'Warga Menerima Kabar',
    desc: 'Masyarakat menerima pembaruan status dan hasil penanganan laporan.',
  },
];

export function HowItWorks() {
  return (
    <section id="cara-kerja" className="landing-section reveal" aria-labelledby="cara-kerja-title">
      <div className="section-head">
        <span className="section-eyebrow">Alur Layanan</span>
        <h2 id="cara-kerja-title">Cara Kerja</h2>
        <p>Enam langkah sederhana dari laporan masuk hingga tuntas ditangani.</p>
      </div>
      <ol className="timeline">
        {STEPS.map((s) => (
          <li key={s.no} className="step-card">
            <span className="step-no">{s.no}</span>
            <span className="step-icon" aria-hidden="true">{s.icon}</span>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

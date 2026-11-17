import { IconReport, IconTrack, IconSpark, IconCheck, IconBuilding } from './icons';

const ADVANTAGES = [
  {
    icon: <IconReport size={26} />,
    title: 'Pelaporan Mudah',
    desc: 'Cukup isi judul, deskripsi, kategori, foto, dan lokasi. Laporan langsung masuk ke sistem desa.',
  },
  {
    icon: <IconTrack size={26} />,
    title: 'Pemantauan Status',
    desc: 'Pantau perjalanan laporan dari verifikasi, penugasan, pengerjaan, hingga selesai.',
  },
  {
    icon: <IconSpark size={26} />,
    title: 'Dokumentasi Foto',
    desc: 'Foto kondisi awal dan bukti pengerjaan tersimpan sebagai dokumentasi resmi.',
  },
  {
    icon: <IconCheck size={26} />,
    title: 'Verifikasi & Pengawasan',
    desc: 'Setiap laporan diverifikasi Admin dan hasil kerja petugas diperiksa sebelum disetujui.',
  },
  {
    icon: <IconBuilding size={26} />,
    title: 'Transparansi Sesuai Hak Akses',
    desc: 'Masyarakat melihat laporannya sendiri, petugas melihat tugasnya, Admin mengawasi keseluruhan.',
  },
];

export function Advantages() {
  return (
    <section className="landing-section reveal" aria-labelledby="keunggulan-title">
      <div className="section-head">
        <span className="section-eyebrow">Mengapa Sistem Ini</span>
        <h2 id="keunggulan-title">Keunggulan Sistem Pelaporan</h2>
        <p>Dirancang agar pelaporan fasilitas umum desa cepat, jelas, dan dapat dipertanggungjawabkan.</p>
      </div>
      <div className="advantage-grid">
        {ADVANTAGES.map((a) => (
          <article key={a.title} className="advantage-card glass">
            <span className="advantage-icon">{a.icon}</span>
            <h3>{a.title}</h3>
            <p>{a.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

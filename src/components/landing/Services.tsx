import Link from 'next/link';
import { IconReport, IconTrack, IconBot, IconBuilding } from './icons';
import { dashboardHome } from '@/lib/roles';

const SERVICES = [
  {
    icon: <IconReport size={36} />,
    iconBg: '#0F766E',
    title: 'Laporkan Fasilitas Rusak',
    desc: 'Kirim laporan kerusakan fasilitas umum dengan foto dan lokasi dalam hitungan menit.',
    cta: 'Buat Laporan',
    hrefIndex: 0,
  },
  {
    icon: <IconTrack size={36} />,
    iconBg: '#15803D',
    title: 'Pantau Status Laporan',
    desc: 'Lacak perkembangan laporan dari verifikasi, penugasan, hingga selesai secara transparan.',
    cta: 'Lacak Status',
    hrefIndex: 1,
  },
  {
    icon: <IconBot size={36} />,
    iconBg: '#7C3AED',
    title: 'Konsultasi dengan AI',
    desc: 'CipernaBot siap menjawab pertanyaan seputar pelaporan fasilitas umum 24 jam.',
    cta: 'Tanya Bot',
    hrefIndex: 2,
  },
  {
    icon: <IconBuilding size={36} />,
    iconBg: '#0E7490',
    title: 'Informasi Fasilitas Umum',
    desc: 'Lihat data fasilitas umum yang tercatat dan diverifikasi di Desa Ciperna.',
    cta: 'Lihat Fasilitas',
    hrefIndex: 3,
  },
];

function serviceHref(index: number, role: string | undefined): string {
  if (index === 3) return '/#fasilitas';
  if (!role) return index === 0 ? '/register' : '/login';
  if (role === 'CITIZEN') {
    return ['/masyarakat/laporan/create', '/masyarakat/lacak', '/masyarakat/dashboard'][index] ?? '/#fasilitas';
  }
  if (index === 2 && role === 'ADMIN') return '/admin/asisten';
  return dashboardHome(role);
}

export function Services({ session }: { session?: { role: string } | null }) {
  const role = session?.role;
  return (
    <section className="services-section reveal" aria-labelledby="layanan-title" id="layanan">
      <div className="section-head center">
        <span className="section-eyebrow">Layanan Digital Desa</span>
        <h2 id="layanan-title">Layanan untuk Masyarakat Desa Ciperna</h2>
        <p className="section-sub">
          Semua layanan dapat diakses secara digital, dari pelaporan hingga pemantauan
          status, dengan bantuan asisten AI yang terintegrasi.
        </p>
      </div>
      <div className="service-grid">
        {SERVICES.map((s, i) => (
          <Link
            key={s.title}
            href={serviceHref(s.hrefIndex, role)}
            className="service-card glass"
            aria-label={s.title}
          >
            <div className="service-visual">
              <span className="service-icon" style={{ background: s.iconBg }}>
                {s.icon}
              </span>
              <div className="service-icon-ring" aria-hidden="true" />
            </div>
            <div className="service-body">
              <h3 className="service-title">{s.title}</h3>
              <p className="service-desc">{s.desc}</p>
            </div>
            <span className="service-cta">{s.cta} →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

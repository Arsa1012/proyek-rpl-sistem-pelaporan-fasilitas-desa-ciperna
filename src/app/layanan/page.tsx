import Link from 'next/link';
import type { Metadata } from 'next';
import { getPublicServices, getVillageProfile, villageIdentity } from '@/lib/village';
import { EmptyBlock, ServiceCard } from '@/components/village/blocks';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Layanan Desa Ciperna',
  description:
    'Informasi jenis layanan, persyaratan, prosedur, jadwal, dan kontak resmi Desa Ciperna.',
};

export default async function LayananPage() {
  let services: Awaited<ReturnType<typeof getPublicServices>> = [];
  let readError = false;
  try {
    services = await getPublicServices();
  } catch {
    readError = true;
  }

  let identity = villageIdentity(null);
  let serviceHours: string | null = null;
  try {
    const profile = await getVillageProfile();
    identity = villageIdentity(profile);
    serviceHours = profile?.serviceHours || null;
  } catch {
    /* fallback */
  }

  return (
    <div className="portal-page container">
      <header className="portal-hero">
        <span className="section-eyebrow">Pelayanan Publik</span>
        <h1>Layanan {identity.name}</h1>
        <p className="portal-hero-loc">
          Kecamatan {identity.district}, Kabupaten {identity.regency}
        </p>
        <div className="portal-hero-actions">
          <Link href="/profil-desa" className="btn">🏘️ Profil Desa</Link>
          <Link href="/pengumuman" className="btn">📣 Pengumuman</Link>
        </div>
      </header>

      {serviceHours && (
        <p className="portal-note glass">
          <strong>Jam pelayanan:</strong> {serviceHours}
        </p>
      )}

      {readError && (
        <div className="village-alert" role="alert">
          Data layanan belum berhasil dimuat karena kendala membaca database. Coba muat ulang halaman.
        </div>
      )}

      {!readError && services.length === 0 ? (
        <EmptyBlock
          icon="🗂️"
          title="Informasi layanan belum tersedia"
          description="Daftar layanan desa beserta persyaratan dan prosedurnya belum diisi dan diverifikasi di sistem. Silakan hubungi kantor desa untuk informasi lebih lanjut."
        />
      ) : (
        <div className="service-portal-grid">
          {services.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}

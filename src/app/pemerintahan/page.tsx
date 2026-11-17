import Link from 'next/link';
import type { Metadata } from 'next';
import { getPublicOfficials, groupOfficials, villageIdentity, getVillageProfile } from '@/lib/village';
import { EmptyBlock, OfficialCard } from '@/components/village/blocks';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Struktur Pemerintahan Desa Ciperna',
  description:
    'Susunan perangkat Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon, beserta ketua RT dan RW yang sudah diverifikasi.',
};

export default async function PemerintahanPage() {
  let officials: Awaited<ReturnType<typeof getPublicOfficials>> = [];
  let readError = false;
  try {
    officials = await getPublicOfficials();
  } catch {
    readError = true;
  }

  let identity = villageIdentity(null);
  try {
    identity = villageIdentity(await getVillageProfile());
  } catch {
    /* identitas fallback sudah aman */
  }

  const groups = groupOfficials(officials);

  return (
    <div className="portal-page container">
      <header className="portal-hero">
        <span className="section-eyebrow">Pemerintahan Desa</span>
        <h1>Struktur Pemerintahan {identity.name}</h1>
        <p className="portal-hero-loc">
          Kecamatan {identity.district}, Kabupaten {identity.regency}, Provinsi {identity.province}
        </p>
        <div className="portal-hero-actions">
          <Link href="/profil-desa" className="btn">🏘️ Profil Desa</Link>
          <Link href="/layanan" className="btn">🗂️ Layanan Desa</Link>
        </div>
      </header>

      <p className="portal-note glass">
        Hanya data perangkat desa yang sudah <strong>diverifikasi</strong> yang ditampilkan di halaman ini.
        Data yang belum lengkap sengaja tidak dipublikasikan agar tidak menyesatkan.
      </p>

      {readError && (
        <div className="village-alert" role="alert">
          Data perangkat desa belum berhasil dimuat karena kendala membaca database. Coba muat ulang halaman.
        </div>
      )}

      {!readError && groups.length === 0 && (
        <EmptyBlock
          icon="🏛️"
          title="Data struktur pemerintahan belum tersedia"
          description="Nama dan jabatan perangkat desa, ketua RT, dan ketua RW belum diisi dan diverifikasi di sistem. Silakan hubungi Admin Desa Ciperna atau periksa kembali nanti."
        />
      )}

      {groups.map((group) => (
        <section key={group.category} className="portal-section" aria-labelledby={`grup-${group.category}`}>
          <div className="portal-section-head">
            <h2 id={`grup-${group.category}`}>{group.label}</h2>
          </div>
          <div className="official-grid">
            {group.items.map((o) => (
              <OfficialCard key={o.id} official={o} />
            ))}
          </div>
        </section>
      ))}

      {groups.length > 0 && (
        <p className="portal-source portal-source-foot">
          Sumber dan tanggal verifikasi tercantum pada masing-masing profil bila tersedia.
        </p>
      )}
    </div>
  );
}

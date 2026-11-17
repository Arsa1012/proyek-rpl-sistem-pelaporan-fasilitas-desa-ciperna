import Link from 'next/link';
import type { Metadata } from 'next';
import {
  DATA_STATUS_LABELS,
  formatVillageDate,
  fullAddress,
  getVillageProfile,
  hasProfileContent,
  villageIdentity,
} from '@/lib/village';
import { EmptyBlock, PortalSection, VerificationBadge } from '@/components/village/blocks';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Profil Desa Ciperna',
  description:
    'Profil resmi Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon: identitas, sejarah, kondisi, potensi, visi & misi, dan informasi pelayanan.',
};

export default async function ProfilDesaPage() {
  let profile = null;
  let readError = false;
  try {
    profile = await getVillageProfile();
  } catch {
    readError = true;
  }

  const identity = villageIdentity(profile);
  const locationLine = `Kecamatan ${identity.district}, Kabupaten ${identity.regency}, Provinsi ${identity.province}`;
  const address = fullAddress(profile);
  const statusLabel = profile ? DATA_STATUS_LABELS[profile.dataStatus] || 'Belum diverifikasi' : 'Profil belum diisi';
  const verified = profile?.dataStatus === 'VERIFIED';

  return (
    <div className="portal-page container">
      <header className="portal-hero">
        <span className="section-eyebrow">Profil Desa</span>
        <h1>{identity.name}</h1>
        <p className="portal-hero-loc">{locationLine}</p>
        <div className="portal-hero-badges">
          <VerificationBadge verified={verified} label={statusLabel} />
          {profile?.verifiedAt && (
            <span className="village-badge village-badge-info">
              Diverifikasi {formatVillageDate(profile.verifiedAt)}
            </span>
          )}
        </div>
        <div className="portal-hero-actions">
          {profile?.mapLink && (
            <a href={profile.mapLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              📍 Lihat Lokasi
            </a>
          )}
          {profile?.mapLink && (
            <a href={profile.mapLink} target="_blank" rel="noopener noreferrer" className="btn">
              🧭 Petunjuk Arah
            </a>
          )}
          <Link href="/pemerintahan" className="btn">
            🏛️ Struktur Pemerintahan
          </Link>
        </div>
      </header>

      {readError && (
        <div className="village-alert" role="alert">
          Data profil desa belum berhasil dimuat karena kendala membaca database. Coba muat ulang halaman.
        </div>
      )}

      {!readError && !hasProfileContent(profile) && (
        <EmptyBlock
          icon="🏘️"
          title="Profil desa belum lengkap"
          description="Informasi resmi desa (alamat, sejarah, visi & misi, dan lain-lain) belum diisi oleh Admin. Halaman ini akan terisi otomatis setelah data resmi ditambahkan dan diverifikasi."
        />
      )}

      <PortalSection id="identitas" eyebrow="Identitas" title="Identitas Desa">
        <div className="portal-info-grid glass">
          <div><span>Nama resmi</span><strong>{identity.name}</strong></div>
          <div><span>Kecamatan</span><strong>{identity.district}</strong></div>
          <div><span>Kabupaten</span><strong>{identity.regency}</strong></div>
          <div><span>Provinsi</span><strong>{identity.province}</strong></div>
          {profile?.postalCode && <div><span>Kode pos</span><strong>{profile.postalCode}</strong></div>}
          {profile?.phone && <div><span>Kontak resmi</span><strong>{profile.phone}</strong></div>}
          {profile?.email && <div><span>Email resmi</span><strong>{profile.email}</strong></div>}
          {address && <div className="portal-info-wide"><span>Alamat kantor desa</span><strong>{address}</strong></div>}
        </div>
      </PortalSection>

      {profile?.history && (
        <PortalSection id="sejarah" eyebrow="Sejarah" title="Sejarah Desa">
          <div className="glass portal-prose">
            <p>{profile.history}</p>
            {profile.historySource && (
              <p className="portal-source">
                Sumber:{' '}
                <a href={profile.historySource} target="_blank" rel="noopener noreferrer">{profile.historySource}</a>
              </p>
            )}
          </div>
        </PortalSection>
      )}

      {(profile?.geography || profile?.potential || profile?.demographics) && (
        <PortalSection id="kondisi" eyebrow="Kondisi & Potensi" title="Kondisi dan Potensi Desa">
          <div className="portal-two-col">
            {profile?.geography && (
              <div className="glass portal-prose">
                <h3>Kondisi geografis</h3>
                <p>{profile.geography}</p>
              </div>
            )}
            {profile?.potential && (
              <div className="glass portal-prose">
                <h3>Potensi desa</h3>
                <p>{profile.potential}</p>
              </div>
            )}
            {profile?.demographics && (
              <div className="glass portal-prose">
                <h3>Data demografi</h3>
                <p>{profile.demographics}</p>
              </div>
            )}
          </div>
        </PortalSection>
      )}

      {(profile?.vision || profile?.mission) && (
        <PortalSection id="visi" eyebrow="Visi & Misi" title="Visi dan Misi">
          <div className="portal-two-col">
            {profile?.vision && (
              <div className="glass portal-prose">
                <h3>Visi</h3>
                <p>{profile.vision}</p>
              </div>
            )}
            {profile?.mission && (
              <div className="glass portal-prose">
                <h3>Misi</h3>
                {profile.mission.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}
          </div>
        </PortalSection>
      )}

      {(profile?.serviceHours || profile?.mapEmbedUrl) && (
        <PortalSection id="pelayanan" eyebrow="Pelayanan" title="Informasi Pelayanan">
          {profile?.serviceHours && (
            <div className="glass portal-prose">
              <h3>Jam pelayanan</h3>
              <p>{profile.serviceHours}</p>
            </div>
          )}
          {profile?.mapEmbedUrl && (
            <div className="portal-map glass">
              <iframe
                title="Peta lokasi Desa Ciperna"
                src={profile.mapEmbedUrl}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}
          <p className="portal-inline-link">
            Jenis layanan dan persyaratannya dapat dilihat di <Link href="/layanan">halaman Layanan Desa</Link>.
          </p>
        </PortalSection>
      )}

      {profile?.sourceUrl && (
        <p className="portal-source portal-source-foot">
          Sumber data: <a href={profile.sourceUrl} target="_blank" rel="noopener noreferrer">{profile.sourceUrl}</a>
          {profile.coordinateSource ? ` · Koordinat: ${profile.coordinateSource}` : ''}
        </p>
      )}
    </div>
  );
}

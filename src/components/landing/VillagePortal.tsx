import Link from 'next/link';
import type { VillageProfile, VillageOfficial, VillageAnnouncement, VillageService } from '@prisma/client';
import { DATA_STATUS_LABELS, fullAddress, formatVillageDate } from '@/lib/village';
import { AnnouncementCard, OfficialCard, VerificationBadge } from '@/components/village/blocks';

export interface VillageIdentity {
  name: string;
  district: string;
  regency: string;
  province: string;
}

/** Ringkasan profil desa: hanya menampilkan data yang benar-benar ada. */
export function VillageSnapshot({
  identity,
  profile,
  serviceCount,
  readError,
}: {
  identity: VillageIdentity;
  profile: VillageProfile | null;
  serviceCount: number;
  readError?: boolean;
}) {
  const address = fullAddress(profile);
  const statusLabel = profile ? DATA_STATUS_LABELS[profile.dataStatus] || 'Belum diverifikasi' : 'Belum diisi';
  const summary = (profile?.geography || profile?.history || '').slice(0, 320);

  return (
    <section className="landing-section reveal" aria-labelledby="profil-ringkas-title">
      <div className="section-head">
        <span className="section-eyebrow">Tentang Desa</span>
        <h2 id="profil-ringkas-title">Mengenal {identity.name}</h2>
        <p>
          Kecamatan {identity.district}, Kabupaten {identity.regency}, Provinsi {identity.province}.
        </p>
      </div>

      {readError ? (
        <div className="village-alert" role="alert">
          Ringkasan profil desa belum berhasil dimuat dari database. Coba muat ulang halaman.
        </div>
      ) : (
        <div className="village-snapshot-grid">
          <div className="glass village-snapshot-main">
            <div className="village-snapshot-badges">
              <VerificationBadge verified={profile?.dataStatus === 'VERIFIED'} label={statusLabel} />
            </div>
            {summary ? (
              <p>{summary}{summary.length >= 320 ? '…' : ''}</p>
            ) : (
              <p className="village-snapshot-empty">
                Uraian profil desa (sejarah, kondisi, dan potensi) sedang dilengkapi oleh Admin. Halaman profil
                akan terisi otomatis setelah data resmi ditambahkan.
              </p>
            )}
            <Link href="/profil-desa" className="btn btn-primary">Lihat Profil Lengkap →</Link>
          </div>

          <div className="glass village-snapshot-facts">
            <h3>Informasi Singkat</h3>
            <dl>
              <div><dt>Nama desa</dt><dd>{identity.name}</dd></div>
              <div><dt>Kecamatan</dt><dd>{identity.district}</dd></div>
              <div><dt>Kabupaten</dt><dd>{identity.regency}</dd></div>
              <div><dt>Provinsi</dt><dd>{identity.province}</dd></div>
              {profile?.postalCode && <div><dt>Kode pos</dt><dd>{profile.postalCode}</dd></div>}
              {address && <div><dt>Kantor desa</dt><dd>{address}</dd></div>}
              {profile?.serviceHours && <div><dt>Jam pelayanan</dt><dd>{profile.serviceHours}</dd></div>}
              <div><dt>Layanan tercatat</dt><dd>{serviceCount > 0 ? `${serviceCount} layanan` : 'Belum ada data'}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

export function OfficialsPreview({
  officials,
  readError,
}: {
  officials: VillageOfficial[];
  readError?: boolean;
}) {
  return (
    <section className="landing-section reveal" aria-labelledby="pemerintahan-title">
      <div className="section-head">
        <span className="section-eyebrow">Pemerintahan</span>
        <h2 id="pemerintahan-title">Struktur Pemerintahan Desa</h2>
        <p>Profil perangkat desa yang sudah diverifikasi.</p>
      </div>

      {readError ? (
        <div className="village-alert" role="alert">Data perangkat desa belum berhasil dimuat. Coba muat ulang halaman.</div>
      ) : officials.length === 0 ? (
        <div className="glass village-snapshot-main">
          <p className="village-snapshot-empty">
            Data perangkat desa (Kepala Desa, Sekretaris, Kaur/Kasi, RT, dan RW) belum diisi dan diverifikasi
            di sistem. Informasi akan tampil di sini setelah Admin desa melengkapinya.
          </p>
          <Link href="/pemerintahan" className="btn">Halaman Struktur Pemerintahan →</Link>
        </div>
      ) : (
        <>
          <div className="official-grid">
            {officials.slice(0, 6).map((o) => (
              <OfficialCard key={o.id} official={o} />
            ))}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <Link href="/pemerintahan" className="btn">Lihat Struktur Lengkap →</Link>
          </div>
        </>
      )}
    </section>
  );
}

export function ServicesPreview({ services }: { services: VillageService[] }) {
  return (
    <section className="landing-section reveal" aria-labelledby="layanan-desa-title">
      <div className="section-head">
        <span className="section-eyebrow">Pelayanan</span>
        <h2 id="layanan-desa-title">Layanan Desa</h2>
        <p>Informasi layanan yang sudah tercatat dan diverifikasi.</p>
      </div>
      {services.length === 0 ? (
        <div className="portal-empty">
          <span className="portal-empty-icon" aria-hidden="true">🗂️</span>
          <strong>Layanan desa belum dipublikasikan</strong>
          <p>
            Admin desa belum menambahkan data layanan. Informasi akan tampil di sini setelah
            dilengkapi dan diverifikasi.
          </p>
          <Link href="/layanan" className="btn btn-soft">Buka Halaman Layanan →</Link>
        </div>
      ) : (
        <>
          <div className="service-portal-grid">
            {services.slice(0, 3).map((s) => (
              <article key={s.id} className="service-portal-card glass">
                <h3>{s.name}</h3>
                {s.description && <p>{s.description}</p>}
                {s.schedule && <p className="official-meta">Jadwal: {s.schedule}</p>}
                <div className="service-portal-foot">
                  <VerificationBadge verified={s.isVerified} />
                </div>
              </article>
            ))}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <Link href="/layanan" className="btn">Lihat Semua Layanan →</Link>
          </div>
        </>
      )}
    </section>
  );
}

export function AnnouncementsPreview({ announcements }: { announcements: VillageAnnouncement[] }) {
  return (
    <section className="landing-section reveal" aria-labelledby="pengumuman-title">
      <div className="section-head">
        <span className="section-eyebrow">Informasi</span>
        <h2 id="pengumuman-title">Pengumuman Terbaru</h2>
        <p>Kabar terbaru dari pemerintah desa.</p>
      </div>
      {announcements.length === 0 ? (
        <div className="portal-empty">
          <span className="portal-empty-icon" aria-hidden="true">📣</span>
          <strong>Belum ada pengumuman</strong>
          <p>
            Pemerintah desa belum mempublikasikan pengumuman. Kabar terbaru akan muncul di sini
            begitu tersedia.
          </p>
          <Link href="/pengumuman" className="btn btn-soft">Buka Halaman Pengumuman →</Link>
        </div>
      ) : (
        <>
          <div className="announcement-grid">
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} />
            ))}
          </div>
          <div style={{ marginTop: '1rem' }}>
            <Link href="/pengumuman" className="btn">Semua Pengumuman →</Link>
          </div>
        </>
      )}
    </section>
  );
}

export function LocationSection({
  identity,
  profile,
}: {
  identity: VillageIdentity;
  profile: VillageProfile | null;
}) {
  const address = fullAddress(profile);
  const verifiedDate = formatVillageDate(profile?.verifiedAt);

  return (
    <section className="landing-section reveal" id="lokasi" aria-labelledby="lokasi-title">
      <div className="section-head">
        <span className="section-eyebrow">Lokasi</span>
        <h2 id="lokasi-title">Lokasi Desa</h2>
        <p>{address || `Kecamatan ${identity.district}, Kabupaten ${identity.regency}, Provinsi ${identity.province}`}</p>
      </div>

      <div className="village-location glass">
        {profile?.mapEmbedUrl ? (
          <div className="portal-map">
            <iframe
              title="Peta lokasi Desa Ciperna"
              src={profile.mapEmbedUrl}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <div className="village-location-placeholder" aria-hidden="true">🗺️</div>
        )}
        <div className="village-location-actions">
          {profile?.mapLink ? (
            <>
              <a href={profile.mapLink} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                📍 Lihat Lokasi
              </a>
              <a href={profile.mapLink} target="_blank" rel="noopener noreferrer" className="btn">
                🧭 Petunjuk Arah
              </a>
            </>
          ) : (
            <p className="village-snapshot-empty">
              Tautan lokasi belum diatur oleh Admin. Hubungi kantor desa untuk informasi lokasi.
            </p>
          )}
          {profile?.coordinateSource && (
            <p className="portal-source">Sumber koordinat: {profile.coordinateSource}</p>
          )}
          {verifiedDate && <p className="portal-source">Diverifikasi: {verifiedDate}</p>}
        </div>
      </div>
    </section>
  );
}

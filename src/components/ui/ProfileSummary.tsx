import type { ReactNode } from 'react';

export interface ProfileStat {
  label: string;
  value: ReactNode;
  /** Warna aksen angka (memakai token tema, aman di mode terang & gelap). */
  tone?: 'default' | 'primary' | 'success' | 'warning';
}

/**
 * Kartu ringkasan profil yang dipakai bersama oleh halaman profil Masyarakat,
 * Petugas, dan Admin. Menjaga hierarki, jarak, dan label/nilai tetap konsisten
 * sehingga tidak ada markup yang berbeda-beda antar role.
 */
export function ProfileSummary({
  name,
  email,
  phone,
  photo,
  roleLabel,
  memberSince,
  stats = [],
  region,
}: {
  name: string;
  email: string;
  phone?: string | null;
  photo?: string | null;
  roleLabel: string;
  memberSince: string;
  stats?: ProfileStat[];
  /** Wilayah (RT/RW) — hanya untuk Masyarakat yang memiliki data wilayah. */
  region?: { rt: string; rw: string } | null;
}) {
  return (
    <section className="glass profile-summary" aria-label="Ringkasan profil">
      <header className="profile-summary-head">
        <div className="profile-summary-avatar">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={`Foto profil ${name}`} />
          ) : (
            <span aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="profile-summary-identity">
          <h3 className="profile-summary-name">{name}</h3>
          <div className="profile-summary-tags">
            <span className="badge primary">{roleLabel}</span>
            {region ? (
              <span className="badge">
                RT {region.rt} / RW {region.rw}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {stats.length > 0 && (
        <>
          <h4 className="profile-summary-subtitle">Ringkasan Aktivitas</h4>
          <dl className="profile-stat-grid">
            {stats.map((s) => (
              <div key={s.label} className={`profile-stat profile-stat--${s.tone || 'default'}`}>
                <dt>{s.label}</dt>
                <dd>{s.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <h4 className="profile-summary-subtitle">Informasi Akun</h4>
      <dl className="profile-info-list">
        <div>
          <dt>Email</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Nomor WhatsApp</dt>
          <dd>{phone ? phone : <span className="profile-muted">Belum tercatat</span>}</dd>
        </div>
        <div>
          <dt>Wilayah (RT/RW)</dt>
          <dd>{region ? `RT ${region.rt} / RW ${region.rw}` : <span className="profile-muted">Belum diisi</span>}</dd>
        </div>
        <div>
          <dt>Bergabung sejak</dt>
          <dd>{memberSince}</dd>
        </div>
      </dl>
    </section>
  );
}

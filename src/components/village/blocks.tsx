import Link from 'next/link';
import type { VillageOfficial, VillageService, VillageAnnouncement } from '@prisma/client';
import { formatVillageDate } from '@/lib/village';

// Server components murni (tanpa hook) agar dapat dipakai di halaman publik.

export function VerificationBadge({ verified, label }: { verified: boolean; label?: string }) {
  return (
    <span className={`village-badge ${verified ? 'village-badge-verified' : 'village-badge-unverified'}`}>
      <span aria-hidden="true">{verified ? '✓' : '!'}</span>
      {label || (verified ? 'Terverifikasi' : 'Belum diverifikasi')}
    </span>
  );
}

export function EmptyBlock({ icon = '📭', title, description }: { icon?: string; title: string; description?: string }) {
  return (
    <div className="village-empty glass" role="status">
      <p className="village-empty-icon" aria-hidden="true">{icon}</p>
      <p className="village-empty-title">{title}</p>
      {description && <p className="village-empty-desc">{description}</p>}
    </div>
  );
}

export function PortalSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="portal-section" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="portal-section-head">
        {eyebrow && <span className="section-eyebrow">{eyebrow}</span>}
        <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function OfficialCard({ official }: { official: VillageOfficial }) {
  return (
    <article className="official-card glass">
      <div className="official-photo" aria-hidden={!official.photo}>
        {official.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={official.photo} alt={`Foto ${official.name}`} loading="lazy" />
        ) : (
          <span>{official.name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="official-body">
        <h3>{official.name}</h3>
        <p className="official-position">{official.position}</p>
        {official.area && <p className="official-meta">Wilayah: {official.area}</p>}
        {official.period && <p className="official-meta">Periode: {official.period}</p>}
        <div className="official-badges">
          <VerificationBadge verified={official.isVerified} />
          {official.sourceUrl && (
            <a href={official.sourceUrl} target="_blank" rel="noopener noreferrer" className="official-source">
              Sumber
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export function ServiceCard({ service }: { service: VillageService }) {
  return (
    <article className="service-portal-card glass">
      <h3>{service.name}</h3>
      {service.description && <p>{service.description}</p>}
      <dl className="service-portal-detail">
        {service.schedule && (
          <>
            <dt>Jadwal</dt>
            <dd>{service.schedule}</dd>
          </>
        )}
        {service.requirements && (
          <>
            <dt>Persyaratan</dt>
            <dd>{service.requirements}</dd>
          </>
        )}
        {service.procedure && (
          <>
            <dt>Prosedur</dt>
            <dd>{service.procedure}</dd>
          </>
        )}
        {service.contact && (
          <>
            <dt>Kontak</dt>
            <dd>{service.contact}</dd>
          </>
        )}
      </dl>
      <div className="service-portal-foot">
        <VerificationBadge verified={service.isVerified} />
        {service.link &&
          (service.link.startsWith('/') ? (
            <Link href={service.link}>Selengkapnya →</Link>
          ) : (
            <a href={service.link} target="_blank" rel="noopener noreferrer">Selengkapnya →</a>
          ))}
      </div>
    </article>
  );
}

export function AnnouncementCard({ announcement }: { announcement: VillageAnnouncement }) {
  const date = formatVillageDate(announcement.publishedAt);
  const until = formatVillageDate(announcement.validUntil);
  return (
    <article className="announcement-card glass reveal">
      <Link href={`/pengumuman/${announcement.slug}`} className="announcement-link">
        {announcement.coverPhoto && (
          <div className="announcement-cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={announcement.coverPhoto} alt={`Foto pengumuman: ${announcement.title}`} loading="lazy" />
          </div>
        )}
        <div className="announcement-body">
          <div className="announcement-meta">
            {announcement.category && <span className="announcement-category">{announcement.category}</span>}
            {date && <time className="announcement-date">{date}</time>}
          </div>
          <h3>{announcement.title}</h3>
          {announcement.excerpt && <p>{announcement.excerpt}</p>}
          {until && <p className="announcement-until">Berlaku sampai {until}</p>}
          <span className="announcement-cta">Baca selengkapnya →</span>
        </div>
      </Link>
    </article>
  );
}

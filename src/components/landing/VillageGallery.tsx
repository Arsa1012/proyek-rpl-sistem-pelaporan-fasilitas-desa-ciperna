import Link from 'next/link';
import Image from 'next/image';
import { existsSync } from 'fs';
import { join } from 'path';
import type { VillageProfile } from '@prisma/client';
import { ImageCard } from './ImageCard';

interface GalleryItem {
  src: string | null;
  alt: string;
  title: string;
  desc: string;
  hasImage: boolean;
}

const SVG_ILLUSTRATIONS: Record<string, string> = {
  'Lanskap Sawah Desa': `
    <svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#F0FDF4" />
          <stop offset="100%" stop-color="#DCFCE7" />
        </linearGradient>
        <linearGradient id="field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#86EFAC" />
          <stop offset="100%" stop-color="#22C55E" />
        </linearGradient>
      </defs>
      <rect width="400" height="150" fill="url(#sky)" />
      <path d="M0 150 Q100 170 200 150 T400 150 L400 260 H0 Z" fill="url(#field)" />
      <g stroke="#0F766E" strokeWidth="2" fill="none" opacity="0.6">
        <path d="M50 150 L60 110 L70 150" />
        <path d="M120 150 L110 120 L100 150" />
        <path d="M190 150 L210 100 L230 150" />
        <path d="M260 150 L250 130 L240 150" />
        <path d="M330 150 L350 110 L370 150" />
      </g>
      <circle cx="80" cy="80" r="30" fill="#F59E0B" opacity="0.8" />
      <rect x="300" y="180" width="50" height="50" rx="4" fill="#0F766E" opacity="0.8" />
    </svg>
  `,
  'Kegiatan Gotong Royong': `
    <svg viewBox="0 0 400 260" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sky2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#F0FDF4" />
          <stop offset="100%" stop-color="#DCFCE7" />
        </linearGradient>
      </defs>
      <rect width="400" height="260" fill="url(#sky2)" />
      <!-- Rumah sederhana -->
      <path d="M50 140 L90 100 L130 140 L130 200 L50 200 Z" fill="#5D4037" />
      <rect x="75" y="140" width="15" height="40" fill="#0F766E" />
      <path d="M170 160 L210 120 L250 160 L250 200 L170 200 Z" fill="#3E2723" />
      <rect x="195" y="160" width="15" height="40" fill="#15803D" />
      <!-- Orang gotong royong -->
      <circle cx="100" cy="150" r="8" fill="#1F2937" />
      <circle cx="220" cy="150" r="8" fill="#1F2937" />
      <rect x="40" y="180" width="120" height="4" fill="#10B981" />
      <rect x="160" y="180" width="120" height="4" fill="#10B981" />
      <!-- Pohon -->
      <circle cx="300" cy="130" r="25" fill="#15803D" />
      <rect x="290" y="130" width="10" height="40" fill="#5D4037" />
    </svg>
  `,
};

export function VillageGallery({
  identity,
  profile,
}: {
  identity: { name: string; district: string; regency: string; province: string };
  profile: VillageProfile | null;
}) {
  const hasUploadHero = existsSync(join(process.cwd(), 'public', 'uploads', 'village_hero_49c4bc75-eb1d-45db-8e82-8ffe568ae9c4.jpg'));

  const items: GalleryItem[] = [
    {
      src: hasUploadHero ? '/uploads/village_hero_49c4bc75-eb1d-45db-8e82-8ffe568ae9c4.jpg' : null,
      alt: `Kantor Desa ${identity.name}`,
      title: 'Kantor Desa Ciperna',
      desc: 'Pusat pelayanan publik tempat masyarakat dapat mengurus administrasi desa dan melaporkan keluhan fasilitas umum.',
      hasImage: hasUploadHero,
    },
    {
      src: null,
      alt: `Pemandangan sawah ${identity.name}`,
      title: 'Lanskap Sawah Desa',
      desc: 'Pemandangan alami desa dengan sawah hijau yang menjadi sumber kehidupan masyarakat petani Ciperna.',
      hasImage: false,
    },
    {
      src: null,
      alt: `Aktivitas masyarakat ${identity.name}`,
      title: 'Kegiatan Gotong Royong',
      desc: 'Kebersamaan warga dalam menjaga kelestarian fasilitas umum dan lingkungan desa.',
      hasImage: false,
    },
  ];

  return (
    <section className="village-gallery-section reveal" id="profil-desa" aria-labelledby="gallery-title">
      <div className="gallery-head center">
        <span className="gallery-eyebrow">Tentang Desa</span>
        <h2 id="gallery-title">Mengenal Desa Ciperna</h2>
        <p className="gallery-desc">
          Desa yang tumbuh melalui kebersamaan, kepedulian, dan pelayanan untuk masyarakat.
        </p>
      </div>

      <div className="gallery-grid">
        {items.map((item, idx) => (
          <ImageCard
            key={item.title}
            src={item.src}
            alt={item.alt}
            title={item.title}
            desc={item.desc}
            aspect={idx === 0 ? 'landscape' : 'square'}
            svgFallback={item.hasImage ? undefined : SVG_ILLUSTRATIONS[item.title]}
          />
        ))}
      </div>

      {profile && (
        <div className="gallery-facts glass">
          <h3 className="gallery-facts-title">Informasi Singkat</h3>
          <dl className="gallery-facts-list">
            <div className="gallery-fact-item">
              <dt>Nama Desa</dt>
              <dd>{identity.name}</dd>
            </div>
            <div className="gallery-fact-item">
              <dt>Kecamatan</dt>
              <dd>{identity.district}</dd>
            </div>
            <div className="gallery-fact-item">
              <dt>Kabupaten</dt>
              <dd>{identity.regency}</dd>
            </div>
            <div className="gallery-fact-item">
              <dt>Provinsi</dt>
              <dd>{identity.province}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* Dekorasi motif batik di bawah section */}
      <div className="gallery-batik-footer" aria-hidden="true">
        <svg viewBox="0 0 1200 80" preserveAspectRatio="none">
          <defs>
            <pattern id="batikWave" x="0" y="0" width="40" height="80" patternUnits="userSpaceOnUse">
              <path d="M0 40 Q10 0 20 40 T40 40" stroke="rgba(15, 118, 110, 0.15)" strokeWidth="2" fill="none" />
              <circle cx="10" cy="40" r="2" fill="rgba(15, 118, 110, 0.1)" />
            </pattern>
          </defs>
          <rect width="1200" height="80" fill="url(#batikWave)" />
        </svg>
      </div>
    </section>
  );
}

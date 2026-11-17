'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatVillageDate } from '@/lib/villageFormat';

/** Bentuk data ringan (sudah diserialkan) untuk feed pengumuman klien. */
export interface AnnouncementFeedItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  category: string | null;
  coverPhoto: string | null;
  publishedAt: string | null;
  validUntil: string | null;
}

/**
 * Daftar pengumuman publik dengan pencarian & filter kategori (sisi klien).
 * Data sudah dibatasi di server (hanya terbit, belum kedaluwarsa, maks 50).
 */
export function AnnouncementFeed({ items }: { items: AnnouncementFeedItem[] }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('ALL');

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))),
    [items]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => {
      if (category !== 'ALL' && i.category !== category) return false;
      if (!needle) return true;
      return (
        i.title.toLowerCase().includes(needle) ||
        (i.excerpt || '').toLowerCase().includes(needle) ||
        (i.category || '').toLowerCase().includes(needle)
      );
    });
  }, [items, q, category]);

  return (
    <>
      <div className="announce-feed-toolbar">
        <input
          className="form-input"
          type="search"
          placeholder="Cari pengumuman…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Cari pengumuman"
        />
        {categories.length > 1 && (
          <select
            className="form-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter kategori"
          >
            <option value="ALL">Semua kategori</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="village-empty glass" role="status">
          <p className="village-empty-icon" aria-hidden="true">🔍</p>
          <p className="village-empty-title">Tidak ada pengumuman yang cocok</p>
          <p className="village-empty-desc">Coba ubah kata kunci atau filter kategori.</p>
        </div>
      ) : (
        <div className="announcement-grid">
          {filtered.map((a) => {
            const date = formatVillageDate(a.publishedAt);
            const until = formatVillageDate(a.validUntil);
            return (
              <article key={a.id} className="announcement-card glass reveal">
                <Link href={`/pengumuman/${a.slug}`} className="announcement-link">
                  {a.coverPhoto && (
                    <div className="announcement-cover">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.coverPhoto} alt={`Foto pengumuman: ${a.title}`} loading="lazy" />
                    </div>
                  )}
                  <div className="announcement-body">
                    <div className="announcement-meta">
                      {a.category && <span className="announcement-category">{a.category}</span>}
                      {date && <time className="announcement-date">{date}</time>}
                    </div>
                    <h3>{a.title}</h3>
                    {a.excerpt && <p>{a.excerpt}</p>}
                    {until && <p className="announcement-until">Berlaku sampai {until}</p>}
                    <span className="announcement-cta">Baca selengkapnya →</span>
                  </div>
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

import Link from 'next/link';
import Image from 'next/image';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Kartu visual dengan gambar + deskripsi.
 * Setiap foto selalu diiringi penjelasan teks yang terstruktur.
 * Tidak ada hanya teks tanpa gambar, dan tidak ada gambar tanpa keterangan.
 */
interface ImageCardProps {
  src: string | null;
  alt: string;
  title: string;
  desc: string;
  href?: string;
  aspect?: 'portrait' | 'landscape' | 'square';
  /** SVG illustration inline sebagai fallback bila gambar asli tidak tersedia */
  svgFallback?: string;
}

export function ImageCard({
  src,
  alt,
  title,
  desc,
  href,
  aspect = 'landscape',
  svgFallback,
}: ImageCardProps) {
  const hasStatic = src ? existsSync(join(process.cwd(), 'public', src.replace(/^\//, ''))) : false;
  return (
    <article className={`image-card image-card--${aspect} glass`}>
      {href ? (
        <Link href={href} className="image-card-link">
          <div className="image-card-media">
            {hasStatic ? (
              <Image
                src={src as string}
                alt={alt}
                fill
                sizes="(max-width: 768px) 100vw, 50vw"
                className="image-card-photo"
                priority
              />
            ) : (
              <div className="image-card-svg" dangerouslySetInnerHTML={{ __html: svgFallback || '' }} />
            )}
            <div className="image-card-overlay" />
            <div className="image-card-label">{title}</div>
          </div>
        </Link>
      ) : (
        <div className="image-card-media">
          {hasStatic ? (
            <Image
              src={src as string}
              alt={alt}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="image-card-photo"
              priority
            />
          ) : (
            <div className="image-card-svg" dangerouslySetInnerHTML={{ __html: svgFallback || '' }} />
          )}
          <div className="image-card-overlay" />
          <div className="image-card-label">{title}</div>
        </div>
      )}
      <div className="image-card-body">
        <h3 className="image-card-title">{title}</h3>
        <p className="image-card-desc">{desc}</p>
      </div>
    </article>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';

export interface PublicStat {
  value: number;
  label: string;
}

/** Animasi angka ringan: hanya dijalankan sekali saat kartu masuk viewport. */
function useCountUp(target: number, run: boolean): number {
  const [current, setCurrent] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce || target <= 0) {
      setCurrent(target);
      return;
    }

    const duration = 900;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target]);

  return current;
}

function StatItem({
  value,
  label,
  run,
  delay,
}: PublicStat & { run: boolean; delay: number }) {
  const display = useCountUp(value, run);
  return (
    <div className="stat-item" style={{ transitionDelay: `${delay}ms` }}>
      <strong>{display}</strong>
      <span>{label}</span>
    </div>
  );
}

export function StatsBand({
  stats,
  error = false,
}: {
  stats: PublicStat[] | null;
  error?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const unavailable = error || !stats;

  return (
    <section ref={ref} className="stats-band reveal" aria-label="Statistik laporan">
      <div className="stats-grid">
        {unavailable ? (
          <div className="stat-item" role="status">
            <strong aria-hidden="true">—</strong>
            <span>
              {error
                ? 'Data statistik belum dapat dimuat saat ini.'
                : 'Belum ada data statistik yang tersedia.'}
            </span>
          </div>
        ) : (
          stats!.map((s, index) => (
            <StatItem
              key={s.label}
              value={s.value}
              label={s.label}
              run={visible}
              delay={index * 80}
            />
          ))
        )}
      </div>
    </section>
  );
}

/** Fallback pemuatan (Suspense) — menjaga tata letak agar tidak bergeser. */
export function StatsBandSkeleton() {
  return (
    <section className="stats-band" aria-hidden="true">
      <div className="stats-grid">
        {[0, 1, 2, 3].map((i) => (
          <div className="stat-item" key={i}>
            <span className="skeleton skeleton-value" />
            <span className="skeleton skeleton-label" />
          </div>
        ))}
      </div>
    </section>
  );
}

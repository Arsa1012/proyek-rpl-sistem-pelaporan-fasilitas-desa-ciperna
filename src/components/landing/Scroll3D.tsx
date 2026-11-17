'use client';

import { useEffect } from 'react';

/**
 * Efek gulir 3D dekoratif untuk beranda.
 *
 * Cara kerja:
 *  - Menandai <html data-scroll3d="ready"> agar CSS boleh menerapkan
 *    transformasi 3D pada section beranda.
 *  - Menghitung progres gulir tiap section (`--p`, 0..1) memakai rAF,
 *    sehingga section masuk dengan kemiringan/kedalaman lalu menegak saat
 *    berada di tengah layar.
 *  - Menambahkan tilt 3D pada kartu hero mengikuti kursor (khusus perangkat
 *    dengan pointer presisi).
 *
 * Semua efek dimatikan bila pengguna memilih `prefers-reduced-motion`.
 * Tidak ada state React yang diubah, jadi aman terhadap streaming hydration.
 */
export function Scroll3D() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    let frame = 0;

    // Section beranda yang ikut efek 3D. Hero diberi nilai tetap oleh CSS.
    const SECTION_SELECTOR =
      '.landing-home > .landing-section, .landing-home > .stats-band';

    const applyFlag = () => {
      if (reduce.matches) {
        delete root.dataset.scroll3d;
      } else {
        root.dataset.scroll3d = 'ready';
      }
    };

    const update = () => {
      frame = 0;
      if (reduce.matches) return;

      const vh = window.innerHeight || 1;
      // `--p` dihitung ulang tiap frame agar section yang di-streaming
      // (mis. statistik) ikut mendapat efek tanpa perlu observer tambahan.
      const sections = document.querySelectorAll<HTMLElement>(SECTION_SELECTOR);
      for (const el of sections) {
        const rect = el.getBoundingClientRect();
        const raw = (vh - rect.top) / (vh * 0.7);
        const t = Math.min(1, Math.max(0, raw));
        // smoothstep agar transisi terasa halus, bukan linear kaku.
        const p = t * t * (3 - 2 * t);
        el.style.setProperty('--p', p.toFixed(4));
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    applyFlag();
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Tilt 3D pada kartu hero (desktop / perangkat pointer presisi).
    const tiltNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'));
    const cleanups: Array<() => void> = [];

    if (finePointer.matches && !reduce.matches) {
      for (const el of tiltNodes) {
        const move = (event: PointerEvent) => {
          const rect = el.getBoundingClientRect();
          const px = (event.clientX - rect.left) / rect.width - 0.5;
          const py = (event.clientY - rect.top) / rect.height - 0.5;
          el.style.setProperty('--ry', `${(px * 13).toFixed(2)}deg`);
          el.style.setProperty('--rx', `${(-py * 13).toFixed(2)}deg`);
          el.style.setProperty('--mx', `${((px + 0.5) * 100).toFixed(1)}%`);
          el.style.setProperty('--my', `${((py + 0.5) * 100).toFixed(1)}%`);
        };
        const leave = () => {
          el.style.setProperty('--ry', '0deg');
          el.style.setProperty('--rx', '0deg');
          el.style.setProperty('--mx', '50%');
          el.style.setProperty('--my', '50%');
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerleave', leave);
        cleanups.push(() => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerleave', leave);
        });
      }
    }

    const onPreferenceChange = () => {
      applyFlag();
      update();
    };
    reduce.addEventListener?.('change', onPreferenceChange);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      reduce.removeEventListener?.('change', onPreferenceChange);
      cleanups.forEach((fn) => fn());
      delete root.dataset.scroll3d;
    };
  }, []);

  return null;
}

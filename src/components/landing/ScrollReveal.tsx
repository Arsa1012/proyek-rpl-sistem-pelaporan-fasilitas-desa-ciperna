'use client';

import { useEffect } from 'react';

/**
 * Penanda progresif untuk efek gulir dekoratif.
 *
 * Efek reveal/parallax kini sepenuhnya memakai CSS scroll-driven animation
 * (lihat `globals.css`). Komponen ini hanya menandai bahwa JavaScript sudah
 * aktif; komponen tidak lagi menambah class atau inline style ke elemen yang
 * dirender React. Dengan begitu tidak ada mutasi DOM sebelum streaming
 * hydration selesai (penyebab mismatch `className`/`style`).
 *
 * Tanpa JavaScript, elemen `.reveal` tetap tampil lewat animasi CSS biasa.
 * `prefers-reduced-motion` dihormati: penanda tidak dipasang sehingga efek
 * gulir tambahan tidak aktif.
 */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;

    const apply = () => {
      if (reduce.matches) {
        delete root.dataset.reveal;
      } else {
        root.dataset.reveal = 'ready';
      }
    };

    // Tunggu satu frame agar penanda tidak ikut proses hydration awal.
    frame = requestAnimationFrame(apply);

    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    reduce.addEventListener?.('change', onChange);

    return () => {
      cancelAnimationFrame(frame);
      reduce.removeEventListener?.('change', onChange);
      delete root.dataset.reveal;
    };
  }, []);

  return null;
}

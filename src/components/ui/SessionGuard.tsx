'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-validasi sesi di sisi server saat halaman dipulihkan dari bfcache
 * (tombol Back/Forward browser). Server tetap menjadi sumber kebenaran:
 * bila sesi sudah tidak valid, layout dashboard akan mengalihkan ke /login.
 *
 * Tidak mengubah tampilan apa pun (render null) dan tidak menyembunyikan
 * konten — hanya memicu pemeriksaan ulang server.
 */
export function SessionGuard() {
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  return null;
}

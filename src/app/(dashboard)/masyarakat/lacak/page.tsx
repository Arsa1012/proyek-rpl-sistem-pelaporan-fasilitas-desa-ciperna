import { redirect } from 'next/navigation';

/**
 * Menu "Lacak Status" digabung ke "Laporan Saya" — keduanya memakai data
 * (laporan milik pengguna) dan fungsi (status + detail) yang sama.
 * Route lama tetap dipertahankan sebagai redirect agar bookmark tidak rusak.
 */
export default function MasyarakatLacakRedirect() {
  redirect('/masyarakat/laporan');
}

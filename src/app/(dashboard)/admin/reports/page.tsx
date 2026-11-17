import { redirect } from 'next/navigation';

/**
 * `/admin/reports` duplikat dari `/admin/laporan` (filter, tabel, dan aksi
 * identik). Halaman kanonik adalah `/admin/laporan`; route lama dipertahankan
 * sebagai redirect (query filter tetap diteruskan) agar bookmark tidak rusak.
 */
export default function AdminReportsRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, v));
    } else if (value != null) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  redirect(`/admin/laporan${query ? `?${query}` : ''}`);
}

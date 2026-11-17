import { redirect } from 'next/navigation';

/**
 * Detail laporan kanonik ada di `/admin/laporan/[id]`. Route ini duplikat,
 * dipertahankan sebagai redirect agar tautan lama tetap berfungsi.
 */
export default function AdminReportDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/laporan/${params.id}`);
}

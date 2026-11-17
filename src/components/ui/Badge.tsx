import { reportStatusViewLabel, reportStatusViewTone } from '@/lib/status';

/**
 * Badge status laporan. Label & warna diambil dari sumber terpusat
 * (`src/lib/status.ts`) agar konsisten di semua halaman.
 *
 * `reviewStatus` opsional: saat berisi 'REVISION' dan status laporan
 * IN_PROGRESS, badge menampilkan "Perlu Perbaikan".
 */
export function Badge({ status, reviewStatus }: { status: string; reviewStatus?: string | null }) {
  return (
    <span className={`badge ${reportStatusViewTone(status, reviewStatus)}`}>
      {reportStatusViewLabel(status, reviewStatus)}
    </span>
  );
}

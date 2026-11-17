/**
 * Status laporan terpusat — SATU sumber kebenaran untuk label & warna status
 * laporan di seluruh UI (Masyarakat, Admin, Petugas).
 *
 * Nilai kunci mengikuti kolom `Report.status` di database
 * (SUBMITTED, VERIFIED, ASSIGNED, IN_PROGRESS, REVIEW, COMPLETED, REJECTED).
 * Jangan menambah label yang membuat status database berbeda dari status UI.
 */

/** Label Bahasa Indonesia yang mudah dipahami untuk setiap status laporan. */
export const REPORT_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Menunggu Verifikasi',
  VERIFIED: 'Menunggu Penugasan',
  ASSIGNED: 'Ditugaskan ke Petugas',
  IN_PROGRESS: 'Sedang Ditangani',
  REVIEW: 'Menunggu Verifikasi Bukti',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
};

/** Nada warna badge (kelas CSS `.badge.<tone>`). */
export const REPORT_STATUS_TONES: Record<string, string> = {
  SUBMITTED: 'primary',
  VERIFIED: 'verified',
  ASSIGNED: 'assigned',
  IN_PROGRESS: 'progress',
  REVIEW: 'review',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

/** Warna grafik/statistik (hex) per status. */
export const REPORT_STATUS_COLORS: Record<string, string> = {
  SUBMITTED: '#0f766e',
  VERIFIED: '#2563eb',
  ASSIGNED: '#8b5cf6',
  IN_PROGRESS: '#06b6d4',
  REVIEW: '#f59e0b',
  COMPLETED: '#10b981',
  REJECTED: '#ef4444',
};

/** Status yang dianggap "sedang berjalan" (belum selesai/ditolak). */
export const ACTIVE_REPORT_STATUSES = ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'];

export function reportStatusLabel(status: string | null | undefined): string {
  if (!status) return '-';
  return REPORT_STATUS_LABELS[status] || status;
}

export function reportStatusTone(status: string | null | undefined): string {
  if (!status) return 'primary';
  return REPORT_STATUS_TONES[status] || 'primary';
}

export function reportStatusColor(status: string | null | undefined): string {
  if (!status) return '#6b7280';
  return REPORT_STATUS_COLORS[status] || '#6b7280';
}

/**
 * Label efektif sebuah laporan, termasuk kondisi "Perlu Perbaikan" yang
 * diturunkan dari `Assignment.reviewStatus === 'REVISION'`.
 * Tidak menambah nilai status baru di database — hanya tampilan.
 */
export function reportStatusViewLabel(
  status: string | null | undefined,
  reviewStatus?: string | null
): string {
  if (status === 'IN_PROGRESS' && reviewStatus === 'REVISION') return 'Perlu Perbaikan';
  return reportStatusLabel(status);
}

/** Nada warna badge untuk label efektif (termasuk "Perlu Perbaikan"). */
export function reportStatusViewTone(
  status: string | null | undefined,
  reviewStatus?: string | null
): string {
  if (status === 'IN_PROGRESS' && reviewStatus === 'REVISION') return 'revision';
  return reportStatusTone(status);
}

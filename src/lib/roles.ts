/**
 * Label peran terpusat — SATU sumber kebenaran untuk tampilan di
 * navbar, sidebar, profil, dan halaman akun. Nilai mengikuti
 * kolom `role` di database (ADMIN/OFFICER/CITIZEN).
 */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  OFFICER: 'Petugas',
  CITIZEN: 'Masyarakat',
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '-';
  return ROLE_LABELS[role] || role;
}

/** Halaman beranda dashboard sesuai peran — dipakai navbar & footer publik. */
export function dashboardHome(role: string | null | undefined): string {
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'OFFICER') return '/petugas/dashboard';
  return '/masyarakat/dashboard';
}

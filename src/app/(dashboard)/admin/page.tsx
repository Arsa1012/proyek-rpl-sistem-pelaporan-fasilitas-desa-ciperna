import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import AdminDashboardClient from '@/components/ui/AdminDashboardClient';

export const metadata = {
  title: 'Dashboard Admin — Sistem Pelaporan Infrastruktur',
  description: 'Ringkasan statistik dan monitoring laporan infrastruktur secara real-time',
};

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  return <AdminDashboardClient />;
}

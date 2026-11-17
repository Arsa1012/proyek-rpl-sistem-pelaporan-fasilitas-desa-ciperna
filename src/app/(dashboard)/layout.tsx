import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { Chatbot } from '@/components/ui/Chatbot';
import { SessionGuard } from '@/components/ui/SessionGuard';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId }
  });

  if (!user) {
    redirect('/login');
  }

  // Kata sandi sementara (hasil reset Admin) wajib diganti sebelum memakai dashboard.
  if (user.mustChangePassword) {
    redirect('/ubah-password');
  }

  return (
    <div className="dashboard-layout">
      <SessionGuard />
      <Sidebar
        role={user.role}
        userName={user.name}
        userPhoto={user.photo}
        isActive={user.isActive !== false}
      />
      <div className="main-content">
        <Navbar userName={user.name} role={user.role} userPhoto={user.photo} />
        <div className="page-content">
          {children}
        </div>
        {/* Widget mengambang hanya untuk Masyarakat.
            Admin memakai menu sidebar "Asisten AI"; Petugas fokus pada tugas. */}
        {user.role === 'CITIZEN' && <Chatbot role={user.role} userName={user.name} />}
      </div>
    </div>
  );
}

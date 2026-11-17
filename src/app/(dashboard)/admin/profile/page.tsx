import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { ProfileForm } from '@/components/ui/ProfileForm';
import { ProfileSummary } from '@/components/ui/ProfileSummary';

export default async function AdminProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, phone: true, photo: true, role: true, createdAt: true },
  });

  if (!user) redirect('/login');

  const totalReports = await prisma.report.count();
  const pendingReports = await prisma.report.count({ where: { status: 'SUBMITTED' } });

  return (
    <div className="profile-layout">
      <div className="page-header">
        <div>
          <h2>Profil Saya</h2>
          <p>Kelola data akun admin Anda.</p>
        </div>
      </div>

      <div className="profile-grid">
        <ProfileSummary
          name={user.name}
          email={user.email}
          phone={user.phone}
          photo={user.photo}
          roleLabel="Admin"
          memberSince={new Date(user.createdAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          stats={[
            { label: 'Total Laporan', value: totalReports, tone: 'primary' },
            { label: 'Menunggu Verifikasi', value: pendingReports, tone: 'warning' },
          ]}
        />

        <ProfileForm
          initial={{ name: user.name, email: user.email, phone: user.phone, photo: user.photo }}
          roleLabel="Admin"
        />
      </div>
    </div>
  );
}

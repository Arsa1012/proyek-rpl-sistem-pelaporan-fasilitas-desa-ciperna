import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { ProfileForm } from '@/components/ui/ProfileForm';
import { ProfileSummary } from '@/components/ui/ProfileSummary';

export default async function MasyarakatProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      photo: true,
      role: true,
      createdAt: true,
      rtId: true,
      rt: { select: { number: true, rw: { select: { number: true } } } },
    },
  });

  if (!user) redirect('/login');

  const totalReports = await prisma.report.count({ where: { userId: user.id } });

  return (
    <div className="profile-layout">
      <div className="page-header">
        <div>
          <h2>Profil Saya</h2>
          <p>Kelola data akun dan wilayah domisili Anda.</p>
        </div>
      </div>

      <div className="profile-grid">
        <ProfileSummary
          name={user.name}
          email={user.email}
          phone={user.phone}
          photo={user.photo}
          roleLabel="Masyarakat"
          memberSince={new Date(user.createdAt).toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          stats={[{ label: 'Total Laporan', value: totalReports, tone: 'primary' }]}
          region={user.rt ? { rt: user.rt.number, rw: user.rt.rw.number } : null}
        />

        <ProfileForm
          initial={{ name: user.name, email: user.email, phone: user.phone, photo: user.photo }}
          roleLabel="Masyarakat"
          region={{ rtId: user.rtId }}
        />
      </div>
    </div>
  );
}

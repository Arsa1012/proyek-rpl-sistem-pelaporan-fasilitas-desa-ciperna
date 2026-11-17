import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { ChangePasswordForm } from '@/components/ui/ChangePasswordForm';

const roleHome: Record<string, string> = {
  CITIZEN: '/masyarakat/dashboard',
  ADMIN: '/admin/dashboard',
  OFFICER: '/petugas/dashboard',
};

// Halaman wajib ganti kata sandi sementara (hasil Reset Kata Sandi oleh Admin).
// Berada di luar layout dashboard sehingga tetap dapat diakses meski dashboard
// menolak akses selama mustChangePassword aktif.
export default async function UbahPasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true, role: true, mustChangePassword: true },
  });
  if (!user) redirect('/login');
  // Sudah tidak wajib ganti -> langsung ke dashboard sesuai peran.
  if (!user.mustChangePassword) redirect(roleHome[user.role] || '/');

  return (
    <div className="login-container">
      <div className="login-card glass-panel">
        <div className="login-icon">🔑</div>
        <h1 className="login-title">Ganti Kata Sandi</h1>
        <p className="login-subtitle">
          Halo {user.name}, kata sandi akun Anda baru saja direset oleh Admin. Buat kata sandi baru
          sebelum melanjutkan.
        </p>
        <ChangePasswordForm redirectTo={roleHome[user.role] || '/'} />
      </div>
    </div>
  );
}

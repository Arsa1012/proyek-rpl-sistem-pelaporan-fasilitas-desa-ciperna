import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AdminAiFloatingChatbot } from '@/components/ui/AdminAiFloatingChatbot';
import { prisma } from '@/lib/prisma';

/**
 * Layout untuk seluruh route /admin/*.
 *
 * Tujuannya:
 * 1. Enkapsulasi tampilan admin (Sidebar + Navbar + konten halaman) — dipegang
 *    oleh layout dashboard untuk CITIZEN/OFFICER.
 * 2. Hanya Admin yang berhak masuk objek layout ini.
 * 3. Rendered tombol chatbot AI mengambang (AdminAiFloatingChatbot) di seluruh
 *    halaman Admin yang sudah login, tanpa harus membuka menu "Asisten AI".
 *
 * Nota: clipboard router Admin memakai route group `(dashboard)` yang juga
 * menampung CITIZEN & OFFICER. Mengembalikan layout yang terpisah untuk
 * mencegah tombol Admin bercampur dengan kekhasan CITIZEN/OFFICER.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  if (session.role !== 'ADMIN') {
    redirect('/login');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
  });

  return (
    <>
      {children}
      {/* Tombol mengambang ADMIN — hanya muncul bila session.role === 'ADMIN'. */}
      <AdminAiFloatingChatbot userName={user?.name} />
    </>
  );
}

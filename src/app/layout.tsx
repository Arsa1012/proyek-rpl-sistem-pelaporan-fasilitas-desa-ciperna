import './globals.css';
import type { Metadata, Viewport } from 'next';
import { LandingNav } from './landing-nav';
import { ScrollReveal } from '@/components/landing/ScrollReveal';
import { Scroll3D } from '@/components/landing/Scroll3D';
import { ToastProvider } from '@/components/ui/Toast';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Sistem Pelaporan Fasilitas Umum Desa Ciperna',
  description:
    'Laporkan kerusakan fasilitas umum Desa Ciperna dengan mudah, pantau tindak lanjutnya, dan bantu bangun desa yang lebih baik.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Sesi dibaca server-side agar navbar publik langsung menyesuaikan
  // kondisi login (tanpa menyembunyikan tombol sebagai pengamanan akses).
  const session = await getSession();
  let navSession:
    | { role: string; name: string | null; photo: string | null }
    | null = null;

  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, photo: true },
    });
    navSession = {
      role: session.role,
      name: user?.name ?? null,
      photo: user?.photo ?? null,
    };
  }

  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ciperna-theme');if(t==='dark'){document.documentElement.dataset.theme='dark';}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ToastProvider>
          <LandingNav session={navSession} />
          <main className="app-main">{children}</main>
          <ScrollReveal />
          <Scroll3D />
        </ToastProvider>
      </body>
    </html>
  );
}

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import AdminDashboardClient from '@/components/ui/AdminDashboardClient';
import { whatsappConfigStatus } from '@/lib/whatsapp';
import { isMockDelivery } from '@/lib/whatsappDelivery';

export const metadata = {
  title: 'Dashboard Admin — Sistem Pelaporan Fasilitas Umum',
  description: 'Ringkasan statistik dan monitoring laporan infrastruktur secara real-time',
};

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const admin = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  });

  const wa = await whatsappConfigStatus();
  const waFailed = await prisma.whatsAppLog.count({ where: { status: 'FAILED' } });
  const waLast = await prisma.whatsAppLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { kind: true, status: true, error: true, createdAt: true },
  });
  // Bukti pengiriman NYATA (bukan uji/mock) — dipakai agar dashboard tidak
  // menampilkan "terkirim" hanya karena pengujian otomatis.
  const waLastReal = await prisma.whatsAppLog.findFirst({
    where: { status: 'SENT' },
    orderBy: { createdAt: 'desc' },
    select: { kind: true, createdAt: true, providerMessageId: true, dedupeKey: true },
  });
  const waReal = waLastReal && !isMockDelivery(waLastReal) ? waLastReal : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Selamat Datang, {admin?.name || 'Admin'} 👋</h2>
          <p>Dashboard Administrator Desa Ciperna.</p>
          <p className="login-identity">Anda login sebagai <strong>Admin</strong></p>
        </div>
      </div>
      <div className="glass" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.25rem' }} aria-hidden="true">📲</span>
          <div style={{ flex: 1, minWidth: '220px' }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              Notifikasi WhatsApp Admin:{' '}
              {wa.configured ? (
                <span style={{ color: 'var(--success-text)' }}>Aktif</span>
              ) : (
                <span style={{ color: 'var(--danger-text)' }}>Belum dikonfigurasi</span>
              )}
            </div>
            {!wa.configured ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                Kurang: {wa.missing.join(', ')}. Periksa dan lengkapi perangkat WhatsApp di menu
                Admin → Pusat WhatsApp Admin (nama perangkat, nomor admin, dan token Fonnte).
              </p>
            ) : (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                {waLast
                  ? `Terakhir: ${waLast.kind} — ${waLast.status}${waLast.error ? ` (${waLast.error})` : ''}.`
                  : 'Belum ada pengiriman tercatat.'}{' '}
                {waFailed > 0 && `${waFailed} pengiriman gagal tercatat.`}{' '}
                {waReal
                  ? `Bukti pengiriman nyata terakhir: ${waReal.kind} (${waReal.createdAt.toLocaleString('id-ID')}).`
                  : 'Belum ada bukti pengiriman nyata (uji otomatis tidak dihitung).'}
              </p>
            )}
          </div>
        </div>
      </div>
      <AdminDashboardClient />
    </div>
  );
}

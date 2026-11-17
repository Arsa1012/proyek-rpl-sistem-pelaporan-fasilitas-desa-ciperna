import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import WhatsAppRecipientsManager from '@/components/ui/admin/WhatsAppRecipientsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Penerima Notifikasi WhatsApp — Admin',
  description:
    'Kelola nomor penerima notifikasi WhatsApp untuk Admin. Terpisah dari nomor perangkat pengirim Fonnte.',
};

/**
 * HALAMAN PENERIMA NOTIFIKASI WHATSAPP (Admin).
 *
 * Terpisah dari "Pusat WhatsApp Admin" (`/admin/whatsapp-config`) yang
 * mengelola perangkat PENGIRIM (token Fonnte). Halaman ini mengelola nomor
 * PENERIMA notifikasi Admin.
 *
 * Aturan:
 *  - Hanya SATU nomor berstatus aktif (dijamin partial UNIQUE INDEX + transaksi).
 *  - Tidak ada fallback diam-diam: tanpa penerima aktif → notifikasi dihentikan.
 *  - Nomor lama tidak dihapus permanen (nonaktifkan = soft-delete).
 */
export default async function AdminWhatsAppRecipientsPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Penerima Notifikasi WhatsApp</h2>
          <p>
            Kelola nomor tujuan notifikasi Admin. Nomor ini terpisah dari nomor perangkat pengirim
            Fonnte yang diatur di{' '}
            <a href="/admin/whatsapp-config" style={{ color: 'var(--primary-color)' }}>
              Pusat WhatsApp Admin
            </a>
            . Hanya satu nomor aktif; nomor lain dapat diaktifkan kembali kapan saja.
          </p>
        </div>
      </div>

      <WhatsAppRecipientsManager />
    </div>
  );
}

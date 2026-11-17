import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllRegions } from '@/lib/region';
import { RegionsManager } from '@/components/ui/village/RegionsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Wilayah RT/RW — Admin',
  description: 'Kelola master data RW dan RT Desa Ciperna.',
};

export default async function AdminWilayahPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  let rws: Awaited<ReturnType<typeof getAllRegions>> = [];
  let readError = false;
  try {
    rws = await getAllRegions();
  } catch {
    readError = true;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Wilayah RT/RW</h2>
          <p>
            Kelola master data wilayah yang dipakai pada registrasi dan profil warga. Wilayah tidak dihapus permanen —
            cukup dinonaktifkan agar histori tetap utuh.
          </p>
        </div>
      </div>

      {readError ? (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>
          Gagal membaca data wilayah. Coba muat ulang halaman.
        </div>
      ) : (
        <RegionsManager initial={rws} />
      )}
    </div>
  );
}

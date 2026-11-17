import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllOfficials } from '@/lib/village';
import { OfficialsManager, type OfficialDTO } from '@/components/ui/village/OfficialsManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Struktur Pemerintahan — Admin',
  description: 'Kelola data perangkat desa, RT, dan RW Desa Ciperna.',
};

function toDTO(o: Awaited<ReturnType<typeof getAllOfficials>>[number]): OfficialDTO {
  return {
    id: o.id,
    name: o.name,
    position: o.position,
    category: o.category,
    level: o.level,
    order: o.order,
    area: o.area,
    period: o.period,
    photo: o.photo,
    isActive: o.isActive,
    isVerified: o.isVerified,
    sourceUrl: o.sourceUrl,
    verifiedAt: o.verifiedAt ? o.verifiedAt.toISOString() : null,
    archivedAt: o.archivedAt ? o.archivedAt.toISOString() : null,
  };
}

export default async function AdminPemerintahanPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  let officials: OfficialDTO[] = [];
  let readError = false;
  try {
    officials = (await getAllOfficials()).map(toDTO);
  } catch {
    readError = true;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Struktur Pemerintahan Desa</h2>
          <p>
            Kelola data perangkat desa, ketua RT, dan ketua RW. Hanya data yang ditandai
            <strong> terverifikasi</strong> yang tampil di halaman publik dan dijawab AI.
          </p>
        </div>
      </div>

      {readError ? (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>
          Gagal membaca data perangkat desa. Coba muat ulang halaman.
        </div>
      ) : (
        <OfficialsManager initial={officials} />
      )}
    </div>
  );
}

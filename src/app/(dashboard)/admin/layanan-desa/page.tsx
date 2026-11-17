import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getAllServices } from '@/lib/village';
import { ServicesManager, type ServiceDTO } from '@/components/ui/village/ServicesManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Layanan Desa — Admin',
  description: 'Kelola informasi pelayanan Desa Ciperna.',
};

function toDTO(s: Awaited<ReturnType<typeof getAllServices>>[number]): ServiceDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    requirements: s.requirements,
    procedure: s.procedure,
    schedule: s.schedule,
    contact: s.contact,
    link: s.link,
    order: s.order,
    isActive: s.isActive,
    isVerified: s.isVerified,
    sourceUrl: s.sourceUrl,
    verifiedAt: s.verifiedAt ? s.verifiedAt.toISOString() : null,
  };
}

export default async function AdminLayananDesaPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  let services: ServiceDTO[] = [];
  let readError = false;
  try {
    services = (await getAllServices()).map(toDTO);
  } catch {
    readError = true;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Layanan Desa</h2>
          <p>Kelola jenis layanan, persyaratan, prosedur, jadwal, dan kontak resmi.</p>
        </div>
      </div>

      {readError ? (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>
          Gagal membaca data layanan. Coba muat ulang halaman.
        </div>
      ) : (
        <ServicesManager initial={services} />
      )}
    </div>
  );
}

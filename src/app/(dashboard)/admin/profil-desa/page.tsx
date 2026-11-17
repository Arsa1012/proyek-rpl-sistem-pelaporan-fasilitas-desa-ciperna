import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getVillageProfile } from '@/lib/village';
import {
  VillageProfileForm,
  type VillageProfileFormData,
} from '@/components/ui/village/VillageProfileForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Profil Desa — Admin',
  description: 'Kelola identitas, sejarah, lokasi, dan informasi resmi Desa Ciperna.',
};

export default async function AdminProfilDesaPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  let initial: Partial<VillageProfileFormData> | null = null;
  let readError = false;
  try {
    const profile = await getVillageProfile();
    if (profile) {
      initial = {
        name: profile.name,
        district: profile.district,
        regency: profile.regency,
        province: profile.province,
        postalCode: profile.postalCode || '',
        address: profile.address || '',
        phone: profile.phone || '',
        email: profile.email || '',
        mapLink: profile.mapLink || '',
        mapEmbedUrl: profile.mapEmbedUrl || '',
        latitude: profile.latitude != null ? String(profile.latitude) : '',
        longitude: profile.longitude != null ? String(profile.longitude) : '',
        coordinateSource: profile.coordinateSource || '',
        heroPhoto: profile.heroPhoto || '',
        history: profile.history || '',
        historySource: profile.historySource || '',
        geography: profile.geography || '',
        potential: profile.potential || '',
        demographics: profile.demographics || '',
        vision: profile.vision || '',
        mission: profile.mission || '',
        serviceHours: profile.serviceHours || '',
        dataStatus: profile.dataStatus,
        sourceUrl: profile.sourceUrl || '',
        verifiedAt: profile.verifiedAt ? profile.verifiedAt.toISOString().slice(0, 10) : '',
      };
    }
  } catch {
    readError = true;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Profil Desa</h2>
          <p>Kelola identitas, sejarah, lokasi, dan informasi resmi Desa Ciperna.</p>
        </div>
      </div>

      {readError && (
        <div className="glass" role="alert" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', color: 'var(--danger-text)', borderLeft: '4px solid var(--danger-text)' }}>
          Gagal membaca profil desa dari database. Coba muat ulang halaman.
        </div>
      )}

      <div className="glass" style={{ padding: '0.85rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        Hanya isi informasi yang benar-benar dapat dipertanggungjawabkan. Data kosong tidak akan dipublikasikan
        sebagai data resmi, dan AI tidak akan mengarang isinya.
      </div>

      <VillageProfileForm initial={initial} />
    </div>
  );
}

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AddOfficerButton } from '@/components/ui/AddOfficerButton';
import { AccountDetailButton } from '@/components/ui/AccountDetailButton';
import { UserDisableButton } from '@/components/ui/UserDisableButton';

export default async function AdminPetugasPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const q = (searchParams.q || '').trim();
  const page = Math.max(1, parseInt(searchParams.page || '1', 10) || 1);
  const limit = 15;
  const skip = (page - 1) * limit;

  const where: any = { role: 'OFFICER' };
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const [officers, total, officerTotal] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        _count: { select: { assignments: true } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'OFFICER' } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const query = q ? `&q=${encodeURIComponent(q)}` : '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Data Petugas</h2>
          <p>Daftar petugas lapangan yang terdaftar. Total {officerTotal} petugas.</p>
        </div>
        <AddOfficerButton />
      </div>

      <div className="glass" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <form className="flex items-center gap-4" style={{ flexWrap: 'wrap' }} action="/admin/petugas" method="GET">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '200px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Cari:</label>
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Nama atau email petugas..."
              className="filter-select"
              style={{ flex: '1 1 160px', minWidth: 0 }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>Cari</button>
          </div>
          {q && (
            <Link href="/admin/petugas" style={{ fontSize: '0.875rem', color: 'var(--danger-text)' }}>
              ✕ Reset
            </Link>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {total} petugas ditemukan
          </span>
        </form>
      </div>

      <div className="glass" style={{ overflow: 'hidden' }}>
        {officers.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>WhatsApp</th>
                  <th>Tugas</th>
                  <th>Status</th>
                  <th>Bergabung</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {officers.map((officer, i) => (
                  <tr key={officer.id}>
                    <td style={{ fontSize: '0.8rem' }}>{skip + i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="officer-avatar" style={{ width: '32px', height: '32px', fontSize: '0.875rem' }}>
                          {officer.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{officer.name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{officer.email}</td>
                    <td style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>{officer.phone || '-'}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        background: 'rgba(37, 99, 235, 0.1)',
                        color: 'var(--primary-color)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}>
                        {officer._count.assignments} tugas
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        background: officer.isActive ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)',
                        color: officer.isActive ? 'var(--success-text)' : 'var(--danger-text)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}>
                        {officer.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(officer.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        <AccountDetailButton userId={officer.id} userName={officer.name} />
                        <Link
                          href={`/admin/assign?officerId=${officer.id}`}
                          className="btn"
                          style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(37,99,235,0.1)', color: 'var(--primary-color)' }}
                        >
                          Tugaskan
                        </Link>
                        <UserDisableButton userId={officer.id} userName={officer.name} isActive={officer.isActive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👷</p>
            <p>{q ? 'Tidak ada petugas yang cocok dengan pencarian.' : 'Belum ada petugas terdaftar.'}</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between" style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--divider)' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Halaman {page} dari {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {page > 1 && (
                <Link
                  href={`/admin/petugas?page=${page - 1}${query}`}
                  className="btn"
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'var(--muted-bg)' }}
                >
                  ← Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/admin/petugas?page=${page + 1}${query}`}
                  className="btn btn-primary"
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                >
                  Next →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

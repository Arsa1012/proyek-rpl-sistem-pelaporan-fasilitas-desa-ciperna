import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAllRegions } from '@/lib/region';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { UserDisableButton } from '@/components/ui/UserDisableButton';
import { AccountDetailButton } from '@/components/ui/AccountDetailButton';

export default async function AdminMasyarakatPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; rt?: string };
}) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const q = (searchParams.q || '').trim();
  const rtFilter = (searchParams.rt || '').trim();
  const page = Math.max(1, parseInt(searchParams.page || '1', 10) || 1);
  const limit = 15;
  const skip = (page - 1) * limit;

  const where: any = { role: 'CITIZEN' };
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }
  if (rtFilter) {
    where.rtId = rtFilter;
  }

  const [users, total, citizenTotal, regions] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        rt: { select: { number: true, rw: { select: { number: true } } } },
        _count: { select: { reports: true } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { role: 'CITIZEN' } }),
    getAllRegions(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const query = `${q ? `&q=${encodeURIComponent(q)}` : ''}${rtFilter ? `&rt=${encodeURIComponent(rtFilter)}` : ''}`;
  const activeRegion = rtFilter ? regions.flatMap((rw) => rw.rts).find((rt) => rt.id === rtFilter) : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Data Warga</h2>
          <p>Daftar akun Masyarakat yang terdaftar. Total {citizenTotal} warga.</p>
        </div>
      </div>

      <div className="glass" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem' }}>
        <form className="flex items-center gap-4" style={{ flexWrap: 'wrap' }} action="/admin/masyarakat" method="GET">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: '200px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>Cari:</label>
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Nama atau email warga..."
              className="filter-select"
              style={{ flex: '1 1 140px', minWidth: 0 }}
            />
            <label htmlFor="filter-wilayah" style={{ fontSize: '0.875rem', fontWeight: 500 }}>Wilayah:</label>
            <select
              id="filter-wilayah"
              name="rt"
              defaultValue={rtFilter}
              className="filter-select"
              style={{ flex: '1 1 160px', minWidth: '160px' }}
            >
              <option value="">Semua wilayah</option>
              {regions.map((rw) => (
                <optgroup key={rw.id} label={`RW ${rw.number}${rw.name ? ` — ${rw.name}` : ''}`}>
                  {rw.rts.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      RT {rt.number}
                      {rt.name ? ` — ${rt.name}` : ''} ({rt.userCount})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 1rem' }}>Cari</button>
          </div>
          {(q || rtFilter) && (
            <Link href="/admin/masyarakat" style={{ fontSize: '0.875rem', color: 'var(--danger-text)' }}>
              ✕ Reset
            </Link>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {total} warga ditemukan{activeRegion ? ` (RT ${activeRegion.number})` : ''}
          </span>
        </form>
      </div>

      <div className="glass" style={{ overflow: 'hidden' }}>
        {users.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama</th>
                  <th>Email</th>
                  <th>Wilayah</th>
                  <th>WhatsApp</th>
                  <th>Laporan</th>
                  <th>Status</th>
                  <th>Terdaftar</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, i) => (
                  <tr key={user.id}>
                    <td style={{ fontSize: '0.8rem' }}>{skip + i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div className="officer-avatar" style={{ width: '32px', height: '32px', fontSize: '0.875rem' }}>
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{user.name}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: '0.875rem' }}>{user.email}</td>
                    <td style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                      {user.rt ? `RT ${user.rt.number} / RW ${user.rt.rw.number}` : '—'}
                    </td>
                    <td style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>{user.phone || '-'}</td>
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
                        {user._count.reports} laporan
                      </span>
                    </td>
                    <td>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0.25rem 0.65rem',
                        borderRadius: '999px',
                        background: user.isActive ? 'rgba(22,163,74,0.1)' : 'rgba(239,68,68,0.1)',
                        color: user.isActive ? 'var(--success-text)' : 'var(--danger-text)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}>
                        {user.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {new Date(user.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        <AccountDetailButton userId={user.id} userName={user.name} />
                        <UserDisableButton userId={user.id} userName={user.name} isActive={user.isActive} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</p>
            <p>{q ? 'Tidak ada warga yang cocok dengan pencarian.' : 'Belum ada warga terdaftar.'}</p>
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
                  href={`/admin/masyarakat?page=${page - 1}${query}`}
                  className="btn"
                  style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'var(--muted-bg)' }}
                >
                  ← Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/admin/masyarakat?page=${page + 1}${query}`}
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

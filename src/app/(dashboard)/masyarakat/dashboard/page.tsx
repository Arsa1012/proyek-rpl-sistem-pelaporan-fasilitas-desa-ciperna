import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getPublishedAnnouncements, formatVillageDate } from '@/lib/village';
import Link from 'next/link';

export default async function MasyarakatDashboard() {
  // Baca session dari cookie
  const session = await getSession();

  // Jika belum login, tampilkan halaman kosong (akan diarahkan ke login oleh middleware)
  if (!session) {
    return <div>Silakan login terlebih dahulu <a href="/login">di sini</a></div>;
  }

  try {
    // Ambil data pengguna dari database
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, isActive: true, suspendReason: true },
    });
    const accountInactive = user?.isActive === false;

    const userId = session.userId;

    // Hitung laporan dengan error handling
    const totalReports = await prisma.report.count({ where: { userId } }).catch(() => 0);
    const submittedReports = await prisma.report.count({
      where: { userId, status: 'SUBMITTED' }
    }).catch(() => 0);
    const activeReports = await prisma.report.count({
      where: { userId, status: { in: ['REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS'] } }
    }).catch(() => 0);
    const completedReports = await prisma.report.count({
      where: { userId, status: 'COMPLETED' }
    }).catch(() => 0);

    // Ambil laporan terbaru dengan error handling
    const recentReports = await prisma.report.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }).catch(() => []);

    // Ambil pengumuman dengan error handling
    const announcements = await getPublishedAnnouncements(3).catch(() => []);

    return (
      <div>
        <div className="page-header">
          <div>
            <h2>Selamat Datang, {user?.name || 'Warga'} 👋</h2>
            <p>Dashboard Masyarakat Desa Ciperna. Pantau status laporan fasilitas umum yang Anda kirimkan.</p>
            <p className="login-identity">Anda login sebagai <strong>Masyarakat</strong></p>
          </div>
          {accountInactive ? (
            <div className="village-alert" role="alert">
              <strong>Akun Anda sedang NONAKTIF.</strong>{' '}
              {user?.suspendReason
                ? `Alasan penonaktifan dari Admin: "${user.suspendReason}".`
                : 'Alasan penonaktifan belum dicatat oleh Admin.'}{' '}
              Anda masih dapat login dan melihat status laporan, tetapi <strong>tidak dapat membuat laporan baru</strong>.
              Silakan hubungi Admin Desa Ciperna di <strong>082118727522</strong> untuk informasi lebih lanjut.
            </div>
          ) : (
            <Link href="/masyarakat/laporan/create" className="btn btn-primary">
              Buat Laporan
            </Link>
          )}
          {accountInactive && (
            <button
              type="button"
              className="btn btn-primary"
              disabled
              aria-disabled="true"
              style={{ opacity: 0.6, cursor: 'not-allowed' }}
              title="Akun Anda sedang nonaktif. Hubungi Admin Desa Ciperna untuk mengaktifkan kembali."
            >
              Buat Laporan (Nonaktif)
            </button>
          )}
        </div>

        {accountInactive && (
          <div className="village-alert" role="alert">
            <strong>Akun Anda sedang NONAKTIF.</strong>{' '}
            {user?.suspendReason
              ? `Alasan penonaktifan dari Admin: "${user.suspendReason}".`
              : 'Alasan penonaktifan belum dicatat oleh Admin.'}{' '}
            Anda masih dapat login dan melihat status laporan, tetapi <strong>tidak dapat membuat laporan baru</strong>.
            Silakan hubungi Admin Desa Ciperna di <strong>082118727522</strong> untuk informasi lebih lanjut.
          </div>
        )}

        <div className="stat-grid">
          <Card title="Total Laporan" value={totalReports} />
          <Card title="Laporan Baru" value={submittedReports} description="Menunggu verifikasi" />
          <Card title="Sedang Diproses" value={activeReports} description="Dalam penanganan" />
          <Card title="Laporan Selesai" value={completedReports} description="Masalah teratasi" />
        </div>

        <div className="glass reveal" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Laporan Terbaru</h3>
          {recentReports.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Judul</th>
                    <th>Lokasi</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentReports.map(report => (
                    <tr key={report.id}>
                      <td>{new Date(report.createdAt).toLocaleDateString('id-ID')}</td>
                      <td>
                        <Link href={`/masyarakat/laporan/${report.id}`} style={{ color: 'var(--primary-color)', fontWeight: 500 }}>
                          {report.title}
                        </Link>
                      </td>
                      <td>{report.location}</td>
                      <td><Badge status={report.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Belum ada laporan yang dibuat.</p>
          )}
        </div>

        <div className="glass reveal" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>📢 Pengumuman Terbaru</h3>
          {announcements.length > 0 ? (
            <ul className="citizen-announce-list">
              {announcements.map((a) => (
                <li key={a.id}>
                  <Link href={`/pengumuman/${a.slug}`}>{a.title}</Link>
                  <span>{formatVillageDate(a.publishedAt) || ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Belum ada pengumuman terbaru untuk Anda.</p>
          )}
        </div>
      </div>
    );
  } catch (error) {
    // Jika terjadi error saat mengambil data, tampilkan pesan error dan tombol coba lagi
    return (
      <div className="alert alert-error">
        <h3>⚠️ Terjadi Kesalahan</h3>
        <p>Tidak dapat memuat dashboard saat ini. Terjadi kesalahan: {error instanceof Error ? error.message : 'Unknown error'}</p>
        <p>Kami sedang menyelesaikan masalah ini. Silakan coba lagi beberapa menit atau hubungi Admin Desa Ciperna di 082118727522.</p>
        <div style={{ marginTop: '1rem' }}>
          <Link href="/masyarakat/dashboard" className="btn">
            Coba Lagi
          </Link>
        </div>
      </div>
    );
  }
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Sinkronisasi riwayat status awal untuk laporan yang sudah ada...');
  const reports = await prisma.report.findMany({
    include: {
      histories: true,
      assignments: { include: { officer: true }, orderBy: { assignedAt: 'asc' } },
    },
  });

  for (const r of reports) {
    if (r.histories.length === 0) {
      console.log(`Mengisi riwayat dasar untuk laporan: ${r.title} (${r.status})`);
      
      // History 1: SUBMITTED (selalu ada)
      await prisma.reportStatusHistory.create({
        data: {
          reportId: r.id,
          status: 'SUBMITTED',
          notes: 'Laporan berhasil dibuat dan diajukan ke sistem.',
          actorName: 'Masyarakat (Pelapor)',
          actorRole: 'CITIZEN',
          createdAt: r.createdAt,
        },
      });

      // Jika REJECTED
      if (r.status === 'REJECTED') {
        await prisma.reportStatusHistory.create({
          data: {
            reportId: r.id,
            status: 'REJECTED',
            notes: r.rejectionReason || 'Laporan tidak memenuhi kriteria kelayakan.',
            actorName: 'Admin Verifikator',
            actorRole: 'ADMIN',
            createdAt: r.updatedAt,
          },
        });
        continue;
      }

      // Jika VERIFIED atau lebih lanjut
      if (['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status)) {
        await prisma.reportStatusHistory.create({
          data: {
            reportId: r.id,
            status: 'VERIFIED',
            notes: 'Laporan telah diperiksa dan diverifikasi oleh Admin.',
            actorName: 'Admin Verifikator',
            actorRole: 'ADMIN',
            createdAt: new Date(r.createdAt.getTime() + 1000 * 60 * 15),
          },
        });
      }

      // Jika ASSIGNED atau lebih lanjut
      if (['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status)) {
        const officerName = r.assignments[0]?.officer?.name || 'Petugas Lapangan';
        await prisma.reportStatusHistory.create({
          data: {
            reportId: r.id,
            status: 'ASSIGNED',
            notes: `Laporan telah ditugaskan kepada petugas lapangan (${officerName}).`,
            actorName: 'Admin Penugasan',
            actorRole: 'ADMIN',
            createdAt: r.assignments[0]?.assignedAt || new Date(r.createdAt.getTime() + 1000 * 60 * 30),
          },
        });
      }

      // Jika IN_PROGRESS atau lebih lanjut
      if (['IN_PROGRESS', 'COMPLETED'].includes(r.status)) {
        const officerName = r.assignments[0]?.officer?.name || 'Petugas Lapangan';
        await prisma.reportStatusHistory.create({
          data: {
            reportId: r.id,
            status: 'IN_PROGRESS',
            notes: 'Petugas telah memulai penanganan perbaikan di lokasi.',
            actorName: `Petugas Lapangan (${officerName})`,
            actorRole: 'OFFICER',
            createdAt: new Date(r.createdAt.getTime() + 1000 * 60 * 60),
          },
        });
      }

      // Jika COMPLETED
      if (r.status === 'COMPLETED') {
        const officerName = r.assignments[0]?.officer?.name || 'Petugas Lapangan';
        await prisma.reportStatusHistory.create({
          data: {
            reportId: r.id,
            status: 'COMPLETED',
            notes: 'Pekerjaan perbaikan telah selesai dilaksanakan dan bukti penyelesaian telah tersimpan.',
            actorName: `Petugas Lapangan (${officerName})`,
            actorRole: 'OFFICER',
            createdAt: r.assignments[0]?.completedAt || r.updatedAt,
          },
        });
      }
    }
  }

  console.log('✅ Sinkronisasi riwayat status selesai.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

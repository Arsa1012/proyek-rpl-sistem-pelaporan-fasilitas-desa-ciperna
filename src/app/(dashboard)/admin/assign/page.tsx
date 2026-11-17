import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { AssignBoard } from '@/components/ui/AssignBoard';

export default async function AdminAssignPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  // Laporan VERIFIED = menunggu penugasan (tidak punya assignment aktif)
  const verifiedReports = await prisma.report.findMany({
    where: {
      status: 'VERIFIED',
      assignments: { none: { completedAt: null, cancelledAt: null } },
    },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  });

  // Penugasan aktif (belum selesai & belum dibatalkan)
  const activeAssignments = await prisma.assignment.findMany({
    where: { completedAt: null, cancelledAt: null },
    orderBy: { assignedAt: 'desc' },
    include: {
      report: {
        select: { id: true, title: true, location: true, status: true, severity: true },
      },
      officer: { select: { id: true, name: true, email: true } },
    },
  });

  // Riwayat terbaru: selesai atau dibatalkan (15 terakhir)
  const finishedAssignments = await prisma.assignment.findMany({
    where: { OR: [{ completedAt: { not: null } }, { cancelledAt: { not: null } }] },
    orderBy: { assignedAt: 'desc' },
    take: 15,
    include: {
      report: {
        select: { id: true, title: true, location: true, status: true, severity: true },
      },
      officer: { select: { id: true, name: true, email: true } },
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Assign Petugas</h2>
          <p>Tugaskan laporan kepada petugas lapangan dan kelola penugasan aktif.</p>
        </div>
      </div>

      <AssignBoard
        waitingReports={verifiedReports.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          location: r.location,
          severity: r.severity,
          category: r.category,
          user: r.user,
        }))}
        activeAssignments={activeAssignments.map((a) => ({
          id: a.id,
          assignedAt: a.assignedAt.toISOString(),
          completedAt: null,
          cancelledAt: null,
          cancelReason: null,
          notes: a.notes,
          report: a.report,
          officer: a.officer,
        }))}
        finishedAssignments={finishedAssignments.map((a) => ({
          id: a.id,
          assignedAt: a.assignedAt.toISOString(),
          completedAt: a.completedAt ? a.completedAt.toISOString() : null,
          cancelledAt: a.cancelledAt ? a.cancelledAt.toISOString() : null,
          cancelReason: a.cancelReason,
          notes: a.notes,
          report: a.report,
          officer: a.officer,
        }))}
      />
    </div>
  );
}

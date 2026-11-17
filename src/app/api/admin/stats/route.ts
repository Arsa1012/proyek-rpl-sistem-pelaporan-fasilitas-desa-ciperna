import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }

  // Satu batch query paralel — sangat efisien
  const now = new Date();
  const [
    statusCounts,
    categoryCounts,
    severityCounts,
    monthlyData,
    locationData,
    recentReports,
    officerStats,
    pendingVerification,
    recentAnnouncements,
    waLogStatus,
  ] = await Promise.all([
    // Status breakdown
    prisma.report.groupBy({
      by: ['status'],
      _count: { id: true },
    }),

    // Category breakdown (top 8)
    prisma.report.groupBy({
      by: ['category'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 8,
    }),

    // Severity breakdown
    prisma.report.groupBy({
      by: ['severity'],
      _count: { id: true },
      where: { severity: { not: null } },
    }),

    // Monthly data — last 6 months (SQLite raw query)
    prisma.$queryRaw<{ month: string; count: number }[]>`
      SELECT 
        strftime('%Y-%m', createdAt) as month,
        COUNT(*) as count
      FROM Report
      WHERE createdAt >= datetime('now', '-6 months')
      GROUP BY month
      ORDER BY month ASC
    `,

    // Location/wilayah data — group by location
    prisma.report.groupBy({
      by: ['location'],
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    }),

    // Recent reports (8 terbaru)
    prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        severity: true,
        location: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),

    // Officer stats
    prisma.user.findMany({
      where: { role: 'OFFICER' },
      select: {
        id: true,
        name: true,
        assignments: {
          select: {
            id: true,
            completedAt: true,
            cancelledAt: true,
          },
        },
      },
    }),

    // Laporan menunggu verifikasi (tabel admin)
    prisma.report.findMany({
      where: { status: { in: ['SUBMITTED', 'VERIFIED'] } },
      orderBy: { createdAt: 'asc' },
      take: 8,
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        location: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),

    // Pengumuman terbaru yang sudah terbit
    prisma.villageAnnouncement.findMany({
      where: {
        isPublished: true,
        deletedAt: null,
        archivedAt: null,
        publishedAt: { not: null, lte: now },
      },
      orderBy: { publishedAt: 'desc' },
      take: 5,
      select: { id: true, title: true, slug: true, category: true, publishedAt: true },
    }),

    // Ringkasan status pengiriman WhatsApp (semua jenis)
    prisma.whatsAppLog.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  // Olah status counts ke object
  const statusMap: Record<string, number> = {};
  for (const s of statusCounts) {
    statusMap[s.status] = s._count.id;
  }

  const total = Object.values(statusMap).reduce((a, b) => a + b, 0);

  // Format officer stats
  const officers = officerStats.map((o) => ({
    id: o.id,
    name: o.name,
    total: o.assignments.filter((a) => !a.cancelledAt).length,
    active: o.assignments.filter((a) => !a.completedAt && !a.cancelledAt).length,
    completed: o.assignments.filter((a) => !!a.completedAt).length,
  }));

  // Normalisasi monthly data
  const months = (monthlyData as { month: string; count: number | bigint }[]).map((m) => ({
    month: m.month,
    count: Number(m.count),
  }));

  // Ringkasan pengiriman WhatsApp
  const waDelivery = { sent: 0, failed: 0 };
  for (const w of waLogStatus) {
    if (w.status === 'SENT') waDelivery.sent += w._count._all;
    else if (w.status === 'FAILED') waDelivery.failed += w._count._all;
  }

  return NextResponse.json({
    total,
    byStatus: {
      SUBMITTED: statusMap['SUBMITTED'] || 0,
      VERIFIED: statusMap['VERIFIED'] || 0,
      REJECTED: statusMap['REJECTED'] || 0,
      ASSIGNED: statusMap['ASSIGNED'] || 0,
      IN_PROGRESS: statusMap['IN_PROGRESS'] || 0,
      COMPLETED: statusMap['COMPLETED'] || 0,
    },
    byCategory: categoryCounts.map((c) => ({
      category: c.category || 'Tidak Terkategori',
      count: c._count.id,
    })),
    bySeverity: severityCounts.map((s) => ({
      severity: s.severity || 'Tidak diketahui',
      count: s._count.id,
    })),
    byMonth: months,
    byLocation: locationData
      .filter((l) => l.location)
      .slice(0, 8)
      .map((l) => ({
        location: l.location,
        count: l._count.id,
      })),
    recentReports,
    officers,
    pendingVerification,
    recentAnnouncements,
    waDelivery,
  });
}

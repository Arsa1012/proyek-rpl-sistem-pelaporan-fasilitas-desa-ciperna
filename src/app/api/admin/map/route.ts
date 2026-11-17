import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const category = searchParams.get('category');
  const severity = searchParams.get('severity');

  const where: any = {
    // Hanya ambil laporan yang punya koordinat
    latitude: { not: null },
    longitude: { not: null },
  };

  if (status) where.status = status;
  if (category) where.category = category;
  if (severity) where.severity = severity;

  const reports = await prisma.report.findMany({
    where,
    select: {
      id: true,
      title: true,
      status: true,
      category: true,
      severity: true,
      location: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      // Tidak ekspos data pribadi masyarakat (no user info)
    },
    orderBy: { createdAt: 'desc' },
    take: 500, // limit wajar untuk performa peta
  });

  // Ambil filter options
  const [categories, statuses] = await Promise.all([
    prisma.report.findMany({
      where: { category: { not: null }, latitude: { not: null } },
      select: { category: true },
      distinct: ['category'],
    }),
    prisma.report.findMany({
      where: { latitude: { not: null } },
      select: { status: true },
      distinct: ['status'],
    }),
  ]);

  return NextResponse.json({
    reports,
    filters: {
      categories: categories.map((c) => c.category).filter(Boolean),
      statuses: statuses.map((s) => s.status),
    },
  });
}

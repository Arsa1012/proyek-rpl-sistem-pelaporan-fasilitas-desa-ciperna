import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rateLimit';

/**
 * GET /api/ai/knowledge — Daftar entri pengetahuan AI sesuai hak akses.
 * Query: ?search=kata&kunci&category=KELUHAN&verified=true&limit=20
 * Admin: semua entri. Non-Admin: hanya entri non-private + milik sendiri.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const rate = rateLimit(`ai-knowledge-list:${session.userId}`, 30, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || undefined;
  const category = searchParams.get('category') || undefined;
  const verified = searchParams.get('verified');
  const limit = Math.min(Number(searchParams.get('limit') || 20), 100);
  const offset = Number(searchParams.get('offset') || 0);

  const where: Record<string, unknown> = {};

  // Filter pencarian/kategori/status disimpan di kondisi AND agar tidak saling
  // menimpa batasan role (Prisma: satu kunci `OR` per where).
  const listConditions: Record<string, unknown>[] = [];
  if (search) {
    listConditions.push({
      // CATATAN: `mode: 'insensitive'` TIDAK didukung Prisma untuk SQLite
      // ("Unknown argument mode") → endpoint ini balas HTTP 500 saat memakai
      // ?search=. SQLite LIKE sudah case-insensitive untuk karakter ASCII.
      OR: [
        { title: { contains: search } },
        { content: { contains: search } },
      ],
    });
  }
  if (category) where.category = category;
  if (verified !== undefined) where.verified = verified === 'true';

  // Role-based access control
  const statsWhere: Record<string, unknown> = {};
  if (session.role === 'ADMIN') {
    // Admin lihat semua
  } else if (session.role === 'OFFICER') {
    // Petugas: lihat non-private, atau entri milik sendiri
    statsWhere.OR = [{ isPrivate: false }, { sourceUserId: session.userId }];
    listConditions.push({ OR: [{ isPrivate: false }, { sourceUserId: session.userId }] });
  } else {
    // CITIZEN: hanya non-private, atau entri milik sendiri
    statsWhere.OR = [{ isPrivate: false }, { sourceUserId: session.userId }];
    listConditions.push({ OR: [{ isPrivate: false }, { sourceUserId: session.userId }] });
  }
  if (listConditions.length > 0) where.AND = listConditions;

  const [entries, total, statsRows] = await Promise.all([
    prisma.aiKnowledgeEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        sourceType: true,
        sourceId: true,
        sourceRole: true,
        sourceUserId: true,
        sourceUserName: true,
        verified: true,
        verifiedBy: true,
        verifiedAt: true,
        verificationNotes: true,
        isPrivate: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.aiKnowledgeEntry.count({ where }),
    // Statistik TANPA filter pencarian/kategori agar kartu ringkasan selalu
    // menampilkan cakupan penuh sesuai hak akses role, bukan hasil filter aktif.
    prisma.aiKnowledgeEntry.groupBy({
      by: ['verified'],
      where: statsWhere,
      _count: { _all: true },
    }),
  ]);

  const verifiedStat = statsRows.find((s) => s.verified === true)?._count._all ?? 0;
  const unverifiedStat = statsRows.find((s) => s.verified === false)?._count._all ?? 0;

  return NextResponse.json({
    entries,
    total,
    limit,
    offset,
    hasMore: offset + entries.length < total,
    stats: {
      total: verifiedStat + unverifiedStat,
      verified: verifiedStat,
      unverified: unverifiedStat,
    },
  });
}

/**
 * POST /api/ai/knowledge — Simpan entri pengetahuan baru dari percakapan AI.
 * Body: { title, content, category, sourceType, sourceId, sourceRole, tags? }
 * Semua role yang login boleh menyimpan.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }

  const rate = rateLimit(`ai-knowledge-create:${session.userId}`, 10, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.toUpperCase() : 'LAINNYA';
  const sourceType = typeof body?.sourceType === 'string' ? body.sourceType : 'CHAT';
  const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : null;
  const tags = Array.isArray(body?.tags) ? JSON.stringify(body.tags) : null;

  if (!title || !content) {
    return NextResponse.json({ error: 'Judul dan isi wajib diisi' }, { status: 400 });
  }

  const validCategories = ['KELUHAN', 'SARAN', 'FASILITAS', 'KINERJA_PETUGAS', 'KEGIATAN_DESA', 'LAINNYA'];
  if (!validCategories.includes(category)) {
    return NextResponse.json({ error: 'Kategori tidak valid' }, { status: 400 });
  }

  const validSourceTypes = ['CHAT', 'REPORT', 'MANUAL', 'SYSTEM'];
  if (!validSourceTypes.includes(sourceType)) {
    return NextResponse.json({ error: 'Tipe sumber tidak valid' }, { status: 400 });
  }

  // Ambil nama pengguna dari database untuk sourceUserName
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { name: true },
  });

  const entry = await prisma.aiKnowledgeEntry.create({
    data: {
      title,
      content,
      category,
      sourceType,
      sourceId,
      sourceRole: session.role,
      sourceUserId: session.userId,
      sourceUserName: user?.name || null,
      tags,
    },
    select: {
      id: true,
      title: true,
      category: true,
      verified: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
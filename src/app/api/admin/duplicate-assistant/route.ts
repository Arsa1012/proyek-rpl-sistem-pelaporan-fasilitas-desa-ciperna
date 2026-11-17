import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { rateLimit } from '@/lib/rateLimit';
import {
  findDuplicateCandidates,
  judgePairWithAI,
  confidenceBand,
  scoreSimilarity,
} from '@/lib/duplicates';

export const dynamic = 'force-dynamic';

const ASSISTANT_RATE_LIMIT = 10;
const ASSISTANT_RATE_WINDOW = 60 * 1000;

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  jalan: ['jalan'],
  lampu: ['lampu'],
  trotoar: ['trotoar'],
  drainase: ['drainase', 'selokan', 'got'],
  taman: ['taman'],
  jembatan: ['jembatan'],
};

function shortId(id: string) {
  return `#${id.slice(0, 8)}`;
}

function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// POST /api/admin/duplicate-assistant — AI Assistant duplikat (ADMIN only)
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (session.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
    }

    const rate = rateLimit(`dup-assistant:${session.userId}`, ASSISTANT_RATE_LIMIT, ASSISTANT_RATE_WINDOW);
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ error: 'Pesan maksimal 500 karakter' }, { status: 400 });
    }

    const lower = message.toLowerCase();
    const wantsAI = /cek|analis|periksa|teliti|nilai|pindai|scan|tampil|apakah|ada|carikan/.test(lower);

    // 1. Mode laporan spesifik: "cek laporan ID 125" / "#a1b2c3d4" / uuid
    const idMatch =
      message.match(/#?([0-9a-f]{8,}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ||
      message.match(/(?:laporan|id)\s*#?\s*([0-9a-f]{8})/i) ||
      message.match(/#([0-9a-f]{8})/i);

    if (idMatch) {
      return await analyzeSingleReport(idMatch[1]);
    }

    // 2. Mode pindai: filter hari ini / kategori
    const todayOnly = /hari ini|today/.test(lower);
    let categoryFilter: string | null = null;
    for (const [key, variants] of Object.entries(CATEGORY_KEYWORDS)) {
      if (variants.some((v) => lower.includes(v))) {
        categoryFilter = key;
        break;
      }
    }

    const where: any = { duplicateStatus: 'POSSIBLE_DUPLICATE' };
    if (todayOnly) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      where.createdAt = { gte: start };
    }
    if (categoryFilter) {
      where.category = { contains: categoryFilter };
    }

    const flagged = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { user: { select: { id: true, name: true } } },
    });

    if (flagged.length === 0) {
      return NextResponse.json({
        success: true,
        reply:
          'Belum ditemukan laporan lain yang memiliki kemiripan signifikan' +
          (todayOnly ? ' untuk hari ini' : '') +
          (categoryFilter ? ` pada kategori ${categoryFilter}` : '') +
          '.',
        groups: [],
      });
    }

    const mainIds = Array.from(new Set(flagged.map((r) => r.duplicateOfReportId).filter(Boolean))) as string[];
    const mains = mainIds.length
      ? await prisma.report.findMany({
          where: { id: { in: mainIds } },
          include: { user: { select: { id: true, name: true } } },
        })
      : [];
    const mainMap = new Map(mains.map((m) => [m.id, m]));

    // Jalankan AI judge untuk maksimal 3 grup bila diminta analisis
    const groups = [];
    for (const r of flagged.slice(0, 5)) {
      const main = r.duplicateOfReportId ? mainMap.get(r.duplicateOfReportId) || null : null;
      let confidence = r.duplicateConfidence ?? 0;
      let reasons: string[] = r.duplicateReason ? r.duplicateReason.split('; ') : [];
      let aiAssessed = false;

      if (wantsAI && main) {
        const fallback = scoreSimilarity(
          {
            category: r.category, location: r.location, latitude: r.latitude,
            longitude: r.longitude, title: r.title, description: r.description, createdAt: r.createdAt,
          },
          {
            category: main.category, location: main.location, latitude: main.latitude,
            longitude: main.longitude, title: main.title, description: main.description, createdAt: main.createdAt,
          }
        );
        const judged = await judgePairWithAI(
          {
            id: r.id, category: r.category, location: r.location, latitude: r.latitude,
            longitude: r.longitude, title: r.title, description: r.description, createdAt: r.createdAt,
          },
          {
            id: main.id, category: main.category, location: main.location, latitude: main.latitude,
            longitude: main.longitude, title: main.title, description: main.description, createdAt: main.createdAt,
          },
          fallback
        );
        confidence = judged.confidence;
        reasons = judged.reasons;
        aiAssessed = !judged.aiFailed;
      }

      groups.push({
        report: {
          id: r.id, title: r.title, location: r.location, category: r.category,
          status: r.status, duplicateStatus: r.duplicateStatus, createdAt: r.createdAt,
          reporter: r.user?.name || 'Masyarakat',
        },
        main: main
          ? {
              id: main.id, title: main.title, location: main.location,
              category: main.category, status: main.status, createdAt: main.createdAt,
              reporter: (main as any).user?.name || 'Masyarakat',
            }
          : null,
        confidence,
        band: (r as any).duplicateBand || confidenceBand(confidence),
        reasons,
        aiAssessed,
      });
    }

    const lines = [
      `Ditemukan ${groups.length} kandidat yang perlu ditinjau${todayOnly ? ' (hari ini)' : ''}${categoryFilter ? ` (kategori ${categoryFilter})` : ''}.`,
      'Catatan: kemiripan bukan keputusan. Tidak ada laporan yang dihapus atau digabung otomatis.',
      '',
      ...groups.flatMap((g, i) => [
        `${i + 1}. Laporan utama: ${shortId(g.main?.id || '')} - ${g.main?.title || '-'} (${g.main?.location || '-'}, ${g.main ? formatDate(g.main.createdAt) : '-'})`,
        `   Laporan terkait: ${shortId(g.report.id)} - ${g.report.title} (pelapor: ${g.report.reporter}, ${formatDate(g.report.createdAt)})`,
        `   Tingkat kemiripan: ${g.confidence}% (${g.band})${g.aiAssessed ? ' — dinilai AI' : ''}`,
        '   Keputusan akhir tetap berada pada Admin.',
        '',
      ]),
    ];

    return NextResponse.json({ success: true, reply: lines.join('\n').trim(), groups });
  } catch (error) {
    console.error('[POST /api/admin/duplicate-assistant]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

async function analyzeSingleReport(idFragment: string) {
  // Cari laporan berdasarkan awalan ID atau ID penuh
  const candidates = await prisma.report.findMany({
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: { user: { select: { id: true, name: true } } },
  });
  const target =
    candidates.find((c) => c.id === idFragment) ||
    candidates.find((c) => c.id.toLowerCase().startsWith(idFragment.toLowerCase()));

  if (!target) {
    return NextResponse.json({
      success: true,
      reply: `Laporan dengan ID ${idFragment} tidak ditemukan.`,
      groups: [],
    });
  }

  const found = await findDuplicateCandidates(target.id, 40, 3);
  if (!found || found.matches.length === 0) {
    return NextResponse.json({
      success: true,
      reply: `Untuk laporan ${shortId(target.id)} ("${target.title}"), belum ditemukan laporan lain yang memiliki kemiripan signifikan.`,
      groups: [],
    });
  }

  const groups = [];
  for (const m of found.matches) {
    const fallback = scoreSimilarity(
      {
        category: target.category, location: target.location, latitude: target.latitude,
        longitude: target.longitude, title: target.title, description: target.description, createdAt: target.createdAt,
      },
      {
        category: m.category, location: m.location, latitude: m.latitude,
        longitude: m.longitude, title: m.title, description: m.description, createdAt: m.createdAt,
      }
    );
    const judged = await judgePairWithAI(
      {
        id: target.id, category: target.category, location: target.location, latitude: target.latitude,
        longitude: target.longitude, title: target.title, description: target.description, createdAt: target.createdAt,
      },
      {
        id: m.id, category: m.category, location: m.location, latitude: m.latitude,
        longitude: m.longitude, title: m.title, description: m.description, createdAt: m.createdAt,
      },
      fallback
    );
    const mainUser = await prisma.user.findUnique({
      where: { id: m.userId },
      select: { name: true },
    });
    groups.push({
      report: {
        id: target.id, title: target.title, location: target.location, category: target.category,
        status: target.status, duplicateStatus: target.duplicateStatus, createdAt: target.createdAt,
        reporter: (target as any).user?.name || 'Masyarakat',
      },
      main: {
        id: m.id, title: m.title, location: m.location, category: m.category,
        status: m.status, createdAt: m.createdAt, reporter: mainUser?.name || 'Masyarakat',
      },
      confidence: judged.confidence,
      band: confidenceBand(judged.confidence),
      reasons: judged.reasons,
      aiAssessed: !judged.aiFailed,
    });
  }

  const best = groups[0];
  const hasStrongEvidence = best.confidence >= 75 && best.band === 'Kemungkinan duplikat';
  const lines = [
    `Hasil analisis untuk laporan ${shortId(target.id)} ("${target.title}"):`,
    '',
    ...groups.flatMap((g, i) => [
      `${i + 1}. Kandidat: ${shortId(g.main.id)} - ${g.main.title} (${g.main.location}, ${formatDate(g.main.createdAt)})`,
      `   Tingkat kemiripan: ${g.confidence}% (${g.band})${g.aiAssessed ? ' — dinilai AI' : ''}`,
      '   Alasan:',
      ...g.reasons.map((r) => `   - ${r}`),
      '',
    ]),
    hasStrongEvidence
      ? `Saran: tinjau pasangan di atas. Bila Admin yakin satu kejadian, konfirmasi melalui tombol Tinjau Duplikat. Tidak ada data yang dihapus.`
      : `Belum cukup bukti untuk menyatakan duplikat. Laporan tetap diproses sebagai laporan mandiri sampai Admin memutuskan sebaliknya.`,
  ];

  return NextResponse.json({ success: true, reply: lines.join('\n').trim(), groups });
}

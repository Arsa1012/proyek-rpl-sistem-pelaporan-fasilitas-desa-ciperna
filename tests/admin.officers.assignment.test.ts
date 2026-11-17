/**
 * Tes pertanyaan PETUGAS & PENUGASAN untuk Admin.
 *
 * Fokus regresi:
 * - "Siapa saja petugas di sini?" tidak boleh jatuh ke daftar laporan.
 * - "Apakah semua sudah ada tugas?" / "Siapa yang belum?" memakai konteks
 *   percakapan dan data penugasan (Assignment), bukan daftar laporan.
 * - Jumlah/daftar yang dipotong selalu menyebut total sebenarnya.
 * - Kegagalan query tidak disamarkan sebagai "tidak ada data".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import * as T from '../src/lib/aiTools';
import { resolveIntent, type ChatTurn } from '../src/lib/aiIntent';
import { formatDeterministicAnswer, formatFallbackAnswer } from '../src/lib/aiChat';
import { executeTools, isToolAllowed } from '../src/lib/aiToolRegistry';

function first(q: string, history: ChatTurn[] = []) {
  return resolveIntent('ADMIN', q, history).tools[0];
}
function user(text: string): ChatTurn {
  return { role: 'user', content: text };
}
function assistant(text: string): ChatTurn {
  return { role: 'assistant', content: text };
}

test('1. "Siapa saja petugas di sini?" memakai direktori petugas, bukan laporan', () => {
  const tool = first('Siapa saja petugas di sini?');
  assert.equal(tool?.name, 'getOfficerWorkload');
  assert.equal(tool?.args?.limit, 10);
});

test('1a. "Berapa jumlah petugas?" memakai direktori petugas untuk total', () => {
  const tool = first('Berapa jumlah petugas?');
  assert.equal(tool?.name, 'getOfficerWorkload');
});

test('1b. "detail petugas Budi" memakai data satu petugas, bukan direktori', () => {
  const tool = first('detail petugas Budi');
  assert.equal(tool?.name, 'getOfficerDetail');
  assert.equal(String(tool?.args?.name).toLowerCase(), 'budi');
});

test('1c. "Berapa tugas petugas Budi?" memfilter nama petugas, bukan semua petugas', () => {
  const tool = first('Berapa tugas petugas Budi?');
  assert.equal(tool?.name, 'getOfficerTaskCounts');
  assert.deepEqual(tool?.args?.names, ['budi']);
});

test('2. "Siapa nama petugas yang aktif?" memfilter status akun petugas', () => {
  const tool = first('Siapa nama petugas yang aktif?');
  assert.equal(tool?.name, 'getOfficerWorkload');
  assert.equal(tool?.args?.isActive, true);
});

test('2b. "Siapa petugas tidak aktif?" memfilter akun nonaktif', () => {
  const tool = first('Siapa petugas tidak aktif?');
  assert.equal(tool?.name, 'getOfficerWorkload');
  assert.equal(tool?.args?.isActive, false);
});

test('3. "Apakah semua sudah ada tugas?" memakai konteks petugas + data penugasan', () => {
  const history = [
    user('Siapa saja petugas di sini?'),
    assistant('Berikut daftar petugas desa...'),
  ];
  const tool = first('Apakah semua sudah ada tugas?', history);
  assert.equal(tool?.name, 'getOfficerTaskCounts');
  assert.equal(tool?.args?.assignment, 'all');
});

test('4. petugas tanpa tugas aktif memakai filter without_active', () => {
  const tool = first('Siapa petugas yang belum memiliki tugas aktif?');
  assert.equal(tool?.name, 'getOfficerTaskCounts');
  assert.equal(tool?.args?.assignment, 'without_active');
  // "tugas AKTIF" bukan filter status akun petugas.
  assert.equal(tool?.args?.isActive, undefined);
});

test('4b. petugas yang sudah punya tugas aktif memakai filter with_active', () => {
  const tool = first('Siapa petugas yang sudah memiliki tugas?');
  assert.equal(tool?.name, 'getOfficerTaskCounts');
  assert.equal(tool?.args?.assignment, 'with_active');
});

test('5. laporan belum ditugaskan memakai antrean penugasan laporan', () => {
  const tool = first('Berapa jumlah laporan yang belum ditugaskan?');
  assert.equal(tool?.name, 'getPendingAssignment');
});

test('6. "Tampilkan laporan terbaru" tetap daftar laporan, bukan data petugas', () => {
  const tool = first('Tampilkan laporan terbaru');
  assert.equal(tool?.name, 'listReports');
});

test('7. pengumuman hari ini difilter tanggal terbit hari ini (WIB)', async () => {
  const tool = first('Apakah ada pengumuman hari ini?');
  assert.equal(tool?.name, 'getVillageAnnouncements');
  assert.equal(tool?.args?.period, 'today');

  const result: any = await T.getVillageAnnouncements(10, { period: 'today' });
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  const start = new Date(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - 7 * 3600 * 1000
  );
  const expected = await prisma.villageAnnouncement.count({
    where: {
      isPublished: true,
      deletedAt: null,
      archivedAt: null,
      publishedAt: { gte: start, lte: now },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    },
  });
  assert.equal(result.total, expected);
  for (const item of result.items) {
    const row = await prisma.villageAnnouncement.findFirst({
      where: { slug: item.slug },
      select: { publishedAt: true },
    });
    assert.ok(row?.publishedAt);
    assert.ok(row!.publishedAt!.getTime() >= start.getTime());
    assert.ok(row!.publishedAt!.getTime() <= now.getTime());
  }
});

test('8. "Siapa warga yang nonaktif?" tetap pencarian akun warga', () => {
  const tool = first('Siapa warga yang nonaktif?');
  assert.equal(tool?.name, 'searchAccounts');
  assert.equal(tool?.args?.role, 'CITIZEN');
  assert.equal(tool?.args?.isActive, false);
});

test('9. "Siapa saya?" memakai profil dari sesi, bukan direktori akun', () => {
  assert.equal(first('Siapa saya?')?.name, 'getMyProfile');
});

test('10. "Siapa yang belum?" setelah daftar petugas memakai konteks penugasan', () => {
  const history = [
    user('Siapa saja petugas di sini?'),
    assistant('Berikut daftar petugas desa...'),
    user('Apakah semua sudah ada tugas?'),
    assistant('Belum semua, ada yang belum memiliki tugas aktif.'),
  ];
  const tool = first('Siapa yang belum?', history);
  assert.equal(tool?.name, 'getOfficerTaskCounts');
  assert.equal(tool?.args?.assignment, 'without_active');
});

test('10b. \"Siapa yang belum?\" tanpa konteks meminta klarifikasi, bukan menebak', () => {
  const tool = first('Siapa yang belum?');
  assert.equal(tool?.name, 'askClarification');
});

test('15. \"sedang diproses\" adalah status IN_PROGRESS, bukan severity SEDANG', () => {
  const tool = first('Berapa laporan yang sedang diproses?');
  assert.equal(tool?.name, 'countReports');
  assert.deepEqual(tool?.args?.status, ['IN_PROGRESS']);
  assert.equal(tool?.args?.severity, undefined);
});

test('15b. \"Laporan yang ditangani petugas\" memakai daftar laporan berjalan', () => {
  const tool = first('Laporan yang ditangani petugas');
  assert.equal(tool?.name, 'listReports');
  assert.deepEqual(tool?.args?.status, ['IN_PROGRESS']);
});

test('15c. \"Statistik dashboard\" memakai ringkasan sistem', () => {
  assert.equal(first('Statistik dashboard')?.name, 'getSystemStats');
});

test('11. kegagalan query petugas tidak disamarkan sebagai data kosong', () => {
  const text = formatFallbackAnswer(
    [{ name: 'getOfficerTaskCounts', result: { error: 'query gagal' } }],
    '22 Oktober 2026, 10:00 (WIB)',
    undefined,
    'ADMIN',
    'Siapa petugas tanpa tugas aktif?'
  );
  assert.match(text, /belum dapat memastikan data .*petugas/i);
  assert.doesNotMatch(text, /tidak ada petugas|0 petugas/i);
});

test('12. daftar petugas terpotong menyebut "Menampilkan X dari Y", bukan "semua"', () => {
  const officers = Array.from({ length: 10 }, (_, i) => ({
    name: `Petugas ${i + 1}`,
    isActive: true,
    activeTasks: i,
    reports: [],
  }));
  const text = formatDeterministicAnswer(
    [],
    [
      {
        name: 'getOfficerWorkload',
        result: {
          totalOfficers: 13,
          allOfficers: 13,
          activeOfficers: 12,
          inactiveOfficers: 1,
          returned: 10,
          hasMore: true,
          isActive: null,
          officers,
        },
      },
    ],
    'Siapa saja petugas di sini?'
  );
  assert.ok(text);
  assert.match(text!, /Menampilkan 10 dari 13 petugas/);
  assert.doesNotMatch(text!, /semua petugas/i);
});

test('12b. rekap "semua sudah ada tugas?" menjawab belum semuanya + nama yang belum', () => {
  const text = formatDeterministicAnswer(
    [],
    [
      {
        name: 'getOfficerTaskCounts',
        result: {
          totalOfficers: 13,
          allOfficers: 13,
          matchedOfficers: 13,
          withActiveTasks: 5,
          withoutActiveTasks: 8,
          assignmentFilter: 'all',
          hasMore: false,
          officers: [],
          withoutActiveNames: ['Petugas QA', 'Joko', 'Trio'],
          withActiveNames: [],
        },
      },
    ],
    'Apakah semua sudah ada tugas?'
  );
  assert.ok(text);
  assert.match(text!, /Belum semua/);
  assert.match(text!, /5 sudah memiliki/);
  assert.match(text!, /8 belum/);
  assert.match(text!, /Petugas QA/);
});

test('12c. rekap tanpa tugas aktif menampilkan jumlah halaman yang benar', () => {
  const text = formatDeterministicAnswer(
    [],
    [
      {
        name: 'getOfficerTaskCounts',
        result: {
          totalOfficers: 13,
          allOfficers: 13,
          matchedOfficers: 8,
          withActiveTasks: 5,
          withoutActiveTasks: 8,
          assignmentFilter: 'without_active',
          hasMore: true,
          officers: [
            { name: 'Petugas QA', isActive: true, total: 0, active: 0, completed: 0 },
            { name: 'Joko', isActive: true, total: 0, active: 0, completed: 0 },
          ],
          withoutActiveNames: ['Petugas QA', 'Joko'],
          withActiveNames: [],
        },
      },
    ],
    'Siapa petugas yang belum memiliki tugas aktif?'
  );
  assert.ok(text);
  assert.match(text!, /8 belum memiliki tugas aktif/);
  assert.match(text!, /Menampilkan 2 dari 8 petugas/);
});

test('12d. filter kosong tidak diklaim sebagai "belum ada petugas terdaftar"', () => {
  const text = formatDeterministicAnswer(
    [],
    [
      {
        name: 'getOfficerTaskCounts',
        result: {
          totalOfficers: 0,
          allOfficers: 13,
          matchedOfficers: 0,
          withActiveTasks: 0,
          withoutActiveTasks: 0,
          assignmentFilter: 'without_active',
          hasMore: false,
          officers: [],
          withoutActiveNames: [],
          withActiveNames: [],
        },
      },
    ],
    'Siapa petugas nonaktif yang belum punya tugas?'
  );
  assert.ok(text);
  assert.match(text!, /Tidak ada petugas yang cocok/);
  assert.match(text!, /Total petugas.*13/);
  assert.doesNotMatch(text!, /Belum ada akun petugas/i);
});

test('13. akun warga tidak boleh mengeksekusi tool data petugas', async () => {
  assert.equal(isToolAllowed('CITIZEN', 'getOfficerWorkload'), false);
  const [result] = await executeTools('CITIZEN', 'test-citizen', [
    { name: 'getOfficerWorkload', args: {} },
  ]);
  assert.equal((result.result as any).error, 'forbidden');
});

test('14. hitungan tugas per petugas konsisten dengan relasi Assignment aktif', async () => {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER' },
    select: { id: true },
  });
  const active = await prisma.assignment.findMany({
    where: {
      officerId: { in: officers.map((o) => o.id) },
      completedAt: null,
      cancelledAt: null,
    },
    select: { officerId: true },
  });
  const activeIds = new Set(active.map((a) => a.officerId));

  const all: any = await T.getOfficerTaskCounts({ assignment: 'all', limit: 50 });
  assert.equal(all.totalOfficers, officers.length);
  assert.equal(all.withActiveTasks, activeIds.size);
  assert.equal(all.withoutActiveTasks, officers.length - activeIds.size);

  const without: any = await T.getOfficerTaskCounts({
    assignment: 'without_active',
    limit: 50,
  });
  assert.equal(without.matchedOfficers, officers.length - activeIds.size);
  for (const officer of without.officers) {
    assert.equal(officer.active, 0);
  }

  const workload: any = await T.getOfficerWorkload({ limit: 5 });
  assert.equal(workload.totalOfficers, officers.length);
  assert.equal(workload.officers.length, Math.min(5, officers.length));
  assert.equal(workload.hasMore, officers.length > 5);
});

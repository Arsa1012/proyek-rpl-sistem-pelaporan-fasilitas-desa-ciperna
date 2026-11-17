/**
 * SKENARIO WAJIB CIPERNA AI ASSISTANT (tanpa LLM / tanpa jaringan).
 *
 * Fokus:
 * - pemahaman ejaan santai & typo ringan,
 * - pertanyaan lanjutan ("kenapa?", "terus?") memakai konteks yang benar,
 * - batas akses masyarakat/petugas/admin,
 * - pencarian kata kunci & rentang tanggal eksplisit,
 * - permintaan tindakan tulis ditolak dengan panduan (tidak dieksekusi),
 * - fallback jujur saat database/LLM gagal.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import { countReports, searchMyReports, searchReportsByKeyword } from '../src/lib/aiTools';

import {
  resolveIntent,
  normalizeIndonesian,
  detectDateRange,
  detectFollowUp,
  extractContext,
  type ChatTurn,
} from '../src/lib/aiIntent';
import { isToolAllowed, TOOL_REGISTRY } from '../src/lib/aiToolRegistry';
import {
  detectChatIntent,
  formatDeterministicAnswer,
  formatEmergencyFallback,
  formatFallbackAnswer,
} from '../src/lib/aiChat';
import { loadLiveChatContext } from '../src/lib/aiContext';
import type { ChatRole } from '../src/lib/aiTools';

function tools(role: ChatRole, q: string, history: ChatTurn[] = []) {
  return resolveIntent(role, q, history).tools;
}
function names(role: ChatRole, q: string, history: ChatTurn[] = []): string[] {
  return tools(role, q, history).map((t) => t.name);
}
function first(role: ChatRole, q: string, history: ChatTurn[] = []) {
  return tools(role, q, history)[0];
}
function user(text: string): ChatTurn {
  return { role: 'user', content: text };
}
function assistant(text: string): ChatTurn {
  return { role: 'assistant', content: text };
}

// ---------------------------------------------------------------------------
// Normalisasi bahasa sehari-hari
// ---------------------------------------------------------------------------
test('normalisasi typo/singkatan tanpa mengubah angka atau tanda baca', () => {
  assert.equal(normalizeIndonesian('Laporan SYA gmna???'), 'laporan saya gimana???');
  assert.equal(normalizeIndonesian('knp ditolak, brp lama?'), 'kenapa ditolak, berapa lama?');
  assert.equal(normalizeIndonesian('udah selesai blm'), 'sudah selesai belum');
  assert.equal(normalizeIndonesian('selesaaaai'), 'selesai');
  assert.equal(normalizeIndonesian('ID a1b2c3d4'), 'id a1b2c3d4');
});

test('detectFollowUp tidak salah menganggap "bulan lalu" sebagai lanjutan', () => {
  assert.equal(detectFollowUp('kenapa?'), true);
  assert.equal(detectFollowUp('terus gimana'), true);
  assert.equal(detectFollowUp('laporan bulan lalu'), false);
});

// ---------------------------------------------------------------------------
// A. Masyarakat
// ---------------------------------------------------------------------------
test('A1/A2: "laporan sya gmna?" dan "laporan saya gimana?" menuju data milik sendiri', () => {
  for (const q of ['laporan sya gmna?', 'laporan saya gimana?', 'laporan saya bagaimana?']) {
    const n = names('CITIZEN', q);
    assert.ok(n.includes('getMyReportCounts'), `harus menghitung laporan sendiri: ${q}`);
    assert.ok(n.includes('getMyRecentReports'), `harus menampilkan laporan sendiri: ${q}`);
    // Tidak boleh menyeberang ke tool Admin/publik.
    for (const name of n) assert.equal(isToolAllowed('CITIZEN', name), true, `${name} tidak boleh untuk warga`);
  }
});

test('A3: "kenapa?" setelah status laporan memakai status dari konteks', () => {
  const { tools: t, context } = resolveIntent('CITIZEN', 'kenapa?', [user('laporan saya ditolak')]);
  assert.equal(t[0]?.name, 'searchMyReports');
  assert.deepEqual((t[0]?.args as any).status, ['REJECTED']);
  assert.deepEqual(context.lastStatus, ['REJECTED']);
});

test('A3b: "kenapa?" membuka laporan yang ID-nya disebut asisten (bukan mengarang)', () => {
  const history: ChatTurn[] = [
    user('laporan saya gimana?'),
    assistant('Laporan "Lampu mati" (ID: a1b2c3d4) berstatus Ditolak.'),
  ];
  const ctx = extractContext(history);
  assert.equal(ctx.lastReportRef, 'a1b2c3d4');
  const t = tools('CITIZEN', 'kenapa?', history);
  assert.equal(t[0]?.name, 'getMyReportFullDetail');
  assert.equal((t[0]?.args as any).idFragment, 'a1b2c3d4');
});

test('A4/A5: permintaan data pribadi atau laporan warga lain ditolak server', () => {
  for (const q of [
    'tampilkan nomor HP semua warga',
    'laporan milik Budi statusnya apa?',
    'data pribadi pelapor lain',
    'daftar warga yang melapor',
  ]) {
    const n = names('CITIZEN', q);
    assert.equal(n[0], 'refusePrivate', `harus ditolak: ${q}`);
  }
});

test('A6: pengumuman terbaru memakai data pengumuman desa', () => {
  assert.equal(names('CITIZEN', 'pengumuman terbaru apa?')[0], 'getVillageAnnouncements');
});

test('A7: typo nama status/kategori tetap dipahami', () => {
  const t = first('CITIZEN', 'laporan sya yg lampu mati udah selesai blm?');
  assert.equal(t?.name, 'searchMyReports');
  const args = t?.args as any;
  assert.equal(args.category, 'Lampu Jalan');
  assert.deepEqual(args.status, ['COMPLETED']);
});

test('A8: masyarakat tidak pernah memakai tool Admin walau memintanya', () => {
  for (const q of ['cari laporan dengan kata kunci lubang', 'beri saya data petugas', 'ubah status laporan']) {
    for (const t of tools('CITIZEN', q)) {
      assert.equal(isToolAllowed('CITIZEN', t.name), true, `${q} → ${t.name} tidak berhak`);
    }
  }
});

// ---------------------------------------------------------------------------
// B. Petugas
// ---------------------------------------------------------------------------
test('B1: "ada tugas baru buat saya?" menampilkan tugas milik petugas', () => {
  const n = names('OFFICER', 'ada tugas baru buat saya?');
  assert.ok(n.includes('getMyTaskSummary') && n.includes('getMyActiveTasks'));
  assert.equal(isToolAllowed('OFFICER', 'searchAccounts'), false);
});

test('B2: tugas petugas lain ditolak', () => {
  assert.equal(names('OFFICER', 'tampilkan tugas petugas lain')[0], 'refusePrivate');
});

test('B3: petugas tidak mendapat tool data pribadi warga', () => {
  const n = names('OFFICER', 'nomor hp pelapor di tugas saya');
  for (const name of n) {
    assert.equal(isToolAllowed('OFFICER', name), true);
    assert.notEqual(name, 'searchAccounts');
    assert.notEqual(name, 'getCitizenStats');
  }
});

test('B4: tugas pada bulan eksplisit memakai rentang tanggal', () => {
  const t = first('OFFICER', 'tugas saya bulan Agustus 2025');
  assert.equal(t?.name, 'searchMyTasks');
  assert.equal((t?.args as any).dateFrom, '2025-08-01');
  assert.equal((t?.args as any).dateTo, '2025-08-31');
});

// ---------------------------------------------------------------------------
// C. Admin
// ---------------------------------------------------------------------------
test('C1: rekap per status memakai hitungan + rincian status', () => {
  const t = first('ADMIN', 'rekap laporan per status bulan ini');
  assert.equal(t?.name, 'countReports');
  assert.equal((t?.args as any).period, 'month');
});

test('C2: pencarian kata kunci bebas memakai tool kata kunci (bukan tebakan)', () => {
  const t = first('ADMIN', 'Cari laporan dengan kata kunci lubang');
  assert.equal(t?.name, 'searchReportsByKeyword');
  assert.equal((t?.args as any).keyword, 'lubang');
  assert.equal(t?.name === 'searchReportsByKeyword' && isToolAllowed('ADMIN', t.name), true);
});

test('C3: data warga sesuai kewenangan Admin', () => {
  const t = first('ADMIN', 'Siapa warga yang akunnya dinonaktifkan?');
  assert.equal(t?.name, 'searchAccounts');
  assert.equal((t?.args as any).isActive, false);
  assert.equal((t?.args as any).role, 'CITIZEN');
});

test('C4: pengumuman & petugas memakai tool yang tepat', () => {
  assert.equal(first('ADMIN', 'Ringkas pengumuman aktif')?.name, 'getAnnouncementOverview');
  assert.equal(first('ADMIN', 'Siapa saja petugas desa?')?.name, 'getOfficerWorkload');
});

test('C5: rentang tanggal eksplisit diteruskan ke filter database', () => {
  const t = first('ADMIN', 'Berapa laporan bulan Agustus 2025?');
  assert.equal(t?.name, 'countReports');
  assert.equal((t?.args as any).dateFrom, '2025-08-01');
  assert.equal((t?.args as any).dateTo, '2025-08-31');

  const r = detectDateRange('laporan tanggal 1-15 Agustus 2025', new Date('2026-10-20T05:00:00Z'));
  assert.deepEqual(r, { from: '2025-08-01', to: '2025-08-15', label: '1–15 Agustus 2025' });
});

test('C6: kegagalan database tidak pernah disamarkan sebagai "data kosong"', () => {
  const answer = formatFallbackAnswer([{ name: 'getSystemStats', result: { error: 'query gagal' } }]);
  assert.match(answer, /kendala/i);
  assert.doesNotMatch(answer, /tidak ada data|data kosong|0 laporan/i);
});

test('C6b: statistik menyajikan status eksklusif, bukan jumlah tumpang tindih', () => {
  const answer = formatFallbackAnswer([
    {
      name: 'getSystemStats',
      result: {
        total: 69,
        submitted: 30,
        notFinalInclusive: 49,
        completed: 15,
        rejected: 5,
        byStatus: [
          { status: 'SUBMITTED', label: 'Menunggu Verifikasi', count: 30 },
          { status: 'COMPLETED', label: 'Selesai', count: 15 },
          { status: 'REJECTED', label: 'Ditolak', count: 5 },
        ],
      },
    },
  ]);
  assert.match(answer, /Terdapat 69 laporan/);
  assert.match(answer, /saling terpisah/i);
  assert.doesNotMatch(answer, /49 belum selesai/, 'agregat tumpang tindih tidak boleh tampil sebagai total');
});

test('C6c: daftar laporan terbaru memuat judul, status, lokasi, pelapor, dan tanggal', () => {
  const answer = formatFallbackAnswer([
    {
      name: 'listReports',
      result: {
        total: 2,
        returned: 2,
        items: [
          {
            id: 'a1b2c3d4',
            title: 'Lampu Jalan Mati',
            status: 'SUBMITTED',
            statusLabel: 'Menunggu Verifikasi',
            location: 'RT 01 / RW 02',
            reporter: 'Arsa',
            createdAtWib: '22 Oktober 2026 10.15 WIB',
          },
          {
            id: 'b2c3d4e5',
            title: 'Saluran Tersumbat',
            status: 'COMPLETED',
            statusLabel: 'Selesai',
            location: 'RT 03 / RW 01',
            reporter: 'Budi',
            createdAtWib: '21 Oktober 2026 09.00 WIB',
          },
        ],
      },
    },
  ]);
  assert.match(answer, /Lampu Jalan Mati/);
  assert.match(answer, /Menunggu Verifikasi/);
  assert.match(answer, /RT 01 \/ RW 02/);
  assert.match(answer, /pelapor Arsa/);
  assert.match(answer, /22 Oktober 2026/);
});

test('C6d: hasil pencarian akun tetap ditampilkan, bukan diganti prompt generik', () => {
  const answer = formatFallbackAnswer(
    [
      {
        name: 'searchAccounts',
        result: {
          total: 1,
          hasMore: false,
          items: [
            {
              name: 'Arsa',
              roleLabel: 'Masyarakat',
              isActive: false,
              email: 'arsa@example.com',
              phone: '0812****',
            },
          ],
        },
      },
    ],
    undefined,
    undefined,
    'ADMIN',
    'Siapa saja warga yang akunnya nonaktif?'
  );
  assert.match(answer, /Arsa/);
  assert.doesNotMatch(answer, /Silakan sebutkan kriteria/i);
});

test('C7: permintaan tindakan mengubah data ditolak dengan panduan, bukan dieksekusi', () => {
  const verify = first('ADMIN', 'verifikasi laporan a1b2c3d4');
  assert.equal(verify?.name, 'refuseWrite');
  assert.equal((verify?.args as any).action, 'verify');

  const del = first('ADMIN', 'tolong hapus laporan a1b2c3d4');
  assert.equal(del?.name, 'refuseWrite');
  assert.equal((del?.args as any).action, 'delete');

  const status = first('ADMIN', 'ubah status laporan a1b2c3d4 jadi selesai');
  assert.equal(status?.name, 'refuseWrite');
  assert.equal((status?.args as any).action, 'status');

  // Warga/petugas juga tidak mendapat jalan pintas.
  assert.equal(first('CITIZEN', 'tolong hapus laporan saya')?.name, 'refuseWrite');
  assert.equal(first('OFFICER', 'verifikasi laporan ini')?.name, 'refuseWrite');
});

test('C8: filter severity tidak hilang saat digabung "belum selesai" (regresi)', () => {
  const t = first('ADMIN', 'Tampilkan laporan severity tinggi yang belum selesai');
  assert.equal(t?.name, 'listReports');
  const args = t?.args as any;
  assert.deepEqual(args.severity, ['TINGGI', 'KRITIS']);
  assert.equal(args.statusNotFinal, true);
});

// ---------------------------------------------------------------------------
// D. Integritas jawaban & keamanan
// ---------------------------------------------------------------------------
test('D1: penolakan tulis menyebut tidak ada perubahan dan tidak membocorkan kredensial', () => {
  const r = first('ADMIN', 'reset kata sandi warga bernama Budi');
  assert.equal(r?.name, 'refuseWrite');
  const message = formatDeterministicAnswer([], [{ name: 'refuseWrite', result: { refused: true, message: 'Saya hanya dapat membaca data. Tidak ada perubahan data yang saya lakukan.' } }]);
  assert.ok(message);
  assert.match(message!, /tidak ada perubahan/i);
  assert.doesNotMatch(message!, /password|hash|token/i);
});

test('D2: fallback hanya merangkum data yang benar-benar ada dan tetap ramah', () => {
  const answer = formatFallbackAnswer([
    { name: 'countReports', result: { total: 3, byStatus: [{ label: 'Selesai', count: 2 }, { label: 'Ditolak', count: 1 }] } },
  ]);
  assert.match(answer, /Total 3 laporan/);
  assert.match(answer, /Selesai: 2/);
  // assert.match(answer, /082118727522/); // WA number removed from concise format
  assert.doesNotMatch(answer, /tidak dapat menyusun jawaban naratif|layanan AI|error|stack trace/i);
  assert.doesNotMatch(answer, /berhasil (diubah|dihapus|diverifikasi)/i);
});

test('D2b: fallback tanpa tool tetap menjawab kontak, lokasi, dan status laporan user', async () => {
  const contact = formatEmergencyFallback('CITIZEN', 'Di mana lokasi Desa Ciperna dan WA admin?');
  assert.match(contact, /Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon, Jawa Barat/);
  assert.match(contact, /082118727522/);
  assert.match(contact, /@syajehh/);
  assert.doesNotMatch(contact, /tidak dapat menyusun jawaban naratif|layanan AI|error/i);

  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');
  const context = await loadLiveChatContext('CITIZEN', citizen.id);
  const answer = formatFallbackAnswer([], undefined, context, 'CITIZEN', 'Laporan saya bagaimana?');
  assert.match(answer, /Anda memiliki \d+ laporan/);
  assert.match(answer, /Laporan terbaru:/);
  // assert.match(answer, /082118727522/); // WA number removed from concise format
  assert.doesNotMatch(answer, /tidak dapat menyusun jawaban naratif|layanan AI|error/i);
});

test('D2c: sapaan, identitas, dan kontak tidak dibalas dump laporan/statistik', async () => {
  assert.equal(detectChatIntent('Halo', 'CITIZEN'), 'GREETING');
  assert.equal(detectChatIntent('Kamu siapa?', 'CITIZEN'), 'IDENTITY');
  assert.equal(detectChatIntent('IG admin', 'CITIZEN'), 'CONTACT');
  assert.equal(detectChatIntent('Halo, laporan saya bagaimana?', 'CITIZEN'), 'MY_REPORT');
  assert.equal(detectChatIntent('Berapa total laporan desa?', 'ADMIN'), 'STATS');

  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');
  const context = await loadLiveChatContext('CITIZEN', citizen.id);

  const greeting = formatFallbackAnswer(
    [{ name: 'getMyReportCounts', result: { total: 1, pending: 1, processing: 0, completed: 0, rejected: 0 } }],
    undefined,
    context,
    'CITIZEN',
    'Halo'
  );
  assert.match(greeting, /Saya Asisten AI Desa Ciperna/);
  // assert.match(greeting, new RegExp(context.user.name || 'Warga')); // concise format does not include name in greeting
  assert.doesNotMatch(greeting, /Ringkasan laporan|Laporan terbaru|Total laporan/i);

  const identity = formatEmergencyFallback('CITIZEN', 'Kamu siapa?');
  assert.match(identity, /Asisten AI Desa Ciperna/);
  assert.doesNotMatch(identity, /Ringkasan laporan|Laporan terbaru|Total laporan/i);

  const contact = formatEmergencyFallback('CITIZEN', 'IG admin dan no WA?');
  assert.match(contact, /WhatsApp Admin: 082118727522/);
  assert.match(contact, /@syajehh/);
  assert.doesNotMatch(contact, /Ringkasan laporan|Laporan terbaru|Total laporan/i);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin, 'fixture: butuh admin');
  const adminContext = await loadLiveChatContext('ADMIN', admin.id);
  const stats = formatFallbackAnswer([], undefined, adminContext, 'ADMIN', 'Berapa total laporan desa?');
  assert.match(stats, /Total laporan:/);
  assert.match(stats, /menunggu verifikasi/);;
  assert.doesNotMatch(stats, /Laporan yang perlu ditindaklanjuti/);
});

test('D3: jawaban deterministik laporan + daftar terbaru memakai angka database', () => {
  const answer = formatDeterministicAnswer([], [
    { name: 'getMyReportCounts', result: { total: 2, completed: 1, active: 1, rejected: 0 } },
    { name: 'getMyRecentReports', result: [{ title: 'Lampu mati', statusLabel: 'Selesai', location: 'RT 01', createdAtWib: '1 Agustus 2025' }] },
  ]);
  assert.ok(answer);
  assert.match(answer!, /total 2 laporan/);
  assert.match(answer!, /Lampu mati/);
});

test('D4: semua tool yang bisa dipilih router terdaftar dan role-nya dihormati', () => {
  for (const [role, q] of [
    ['CITIZEN', 'laporan saya gimana?'],
    ['OFFICER', 'tampilkan tugas saya'],
    ['ADMIN', 'rekap laporan per status'],
  ] as [ChatRole, string][]) {
    for (const t of tools(role, q)) {
      assert.ok(TOOL_REGISTRY[t.name], `tool tidak terdaftar: ${t.name}`);
      assert.equal(isToolAllowed(role, t.name), true, `${t.name} tidak boleh untuk ${role}`);
    }
  }
});

test('D5: tool pencarian kata kunci hanya untuk Admin, refuseWrite untuk semua role', () => {
  assert.equal(isToolAllowed('ADMIN', 'searchReportsByKeyword'), true);
  assert.equal(isToolAllowed('CITIZEN', 'searchReportsByKeyword'), false);
  assert.equal(isToolAllowed('OFFICER', 'searchReportsByKeyword'), false);
  for (const role of ['CITIZEN', 'OFFICER', 'ADMIN'] as ChatRole[]) {
    assert.equal(isToolAllowed(role, 'refuseWrite'), true);
  }
});

test('D6: pertanyaan informasi tidak salah dianggap perintah tulis', () => {
  assert.equal(first('ADMIN', 'Bagaimana cara admin memverifikasi laporan?')?.name, 'getWebsiteInfo');
  assert.equal(first('ADMIN', 'Bagaimana cara reset kata sandi warga?')?.args?.topic, 'adminAccounts');
  const unverified = first('ADMIN', 'Berapa laporan yang menunggu verifikasi?');
  assert.equal(unverified?.name, 'countReports');
  assert.deepEqual(unverified?.args?.status, ['SUBMITTED']);
});

// ---------------------------------------------------------------------------
// E. Verifikasi nyata terhadap database (read-only)
// ---------------------------------------------------------------------------
after(async () => {
  await prisma.$disconnect();
});

test('E1: rentang tanggal countReports sama dengan hitungan Prisma', async () => {
  const [all, ranged] = await Promise.all([
    prisma.report.count(),
    countReports({ dateFrom: '2020-01-01', dateTo: '2030-12-31' }),
  ]);
  assert.equal(ranged.total, all);
  assert.equal(ranged.appliedFilters.some((f) => /tanggal/i.test(f)), true);
});

test('E2: pencarian kata kunci dibatasi dan hasilnya konsisten dengan total', async () => {
  const res = await searchReportsByKeyword('jalan', { limit: 5 });
  assert.ok(res.items.length <= 5);
  assert.ok(res.total >= res.items.length);
  assert.equal(res.returned, res.items.length);
});

test('E3: pencarian laporan warga tidak pernah mengembalikan laporan orang lain', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  const res = await searchMyReports(citizen.id, {
    dateFrom: '2020-01-01',
    dateTo: '2030-12-31',
    limit: 10,
  });
  assert.ok(res.items.length > 0);
  assert.equal(res.total > 0, true);

  // Semua ID yang dikembalikan harus benar-benar milik warga tersebut.
  const owned = await prisma.report.findMany({
    where: { userId: citizen.id },
    select: { id: true },
  });
  const ownedPrefixes = new Set(owned.map((r) => r.id.slice(0, 8)));
  for (const item of res.items) {
    assert.equal(ownedPrefixes.has(item.id), true, `laporan ${item.id} bukan milik warga`);
  }
});






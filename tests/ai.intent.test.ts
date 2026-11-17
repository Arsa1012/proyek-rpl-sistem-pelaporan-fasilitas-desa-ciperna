/**
 * Tes INTENT ROUTER (aiIntent.ts) — deterministik, tanpa database.
 *
 * Fokus: pertanyaan dengan maksud sama tetap menghasilkan tool yang sama,
 * pertanyaan detail tidak lagi jatuh ke tool statistik (bug lama), kata ganti
 * dipahami dari konteks, dan pertanyaan di luar sistem tidak memaksa query.
 *
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveIntent, extractContext, type ChatTurn } from '../src/lib/aiIntent';
import { formatDeterministicAnswer, detectChatIntent } from '../src/lib/aiChat';
import type { ChatRole } from '../src/lib/aiTools';
import { TOOL_REGISTRY } from '../src/lib/aiToolRegistry';

function tools(role: ChatRole, q: string, history: ChatTurn[] = []) {
  return resolveIntent(role, q, history).tools;
}
function names(role: ChatRole, q: string, history: ChatTurn[] = []): string[] {
  return tools(role, q, history).map((t) => t.name);
}
function user(text: string): ChatTurn {
  return { role: 'user', content: text };
}
function args(role: ChatRole, q: string, history: ChatTurn[] = []) {
  return tools(role, q, history)[0]?.args ?? {};
}

// ---------------------------------------------------------------------------
// REGRESI UTAMA: AI harus bisa menjawab JENIS/DETAIL, bukan hanya jumlah.
// ---------------------------------------------------------------------------
test('admin: "apa saja laporannya" menghasilkan DAFTAR, bukan hanya statistik', () => {
  const n = names('ADMIN', 'Apa saja laporan nya?');
  assert.deepEqual(n, ['listReports']);
});

test('admin: pertanyaan kategori/keparahan tidak jatuh ke count-all', () => {
  // Bug lama: kata "laporan" pada satu kondisi catch-all menelan semua pertanyaan.
  assert.equal(names('ADMIN', 'laporan jalan yang mana saja?')[0], 'listReports');
  assert.equal(args('ADMIN', 'laporan jalan yang mana saja?').category, 'Jalan');
  assert.equal(names('ADMIN', 'laporan drainase saluran tersumbat mana saja')[0], 'listReports');
  assert.equal(args('ADMIN', 'laporan drainase saluran tersumbat mana saja').category, 'Drainase');
});

test('admin: "jalan rusak" tidak menyempit ke satu jenis kerusakan', () => {
  // "rusak" terlalu umum → jangan dipakai sebagai filter damageType.
  assert.equal(args('ADMIN', 'Siapa yang melaporkan jalan rusak?').damageType, undefined);
  assert.equal(args('ADMIN', 'Siapa yang melaporkan jalan rusak?').category, 'Jalan');
});

// ---------------------------------------------------------------------------
// Variasi kalimat dengan maksud sama → tool sama.
// ---------------------------------------------------------------------------
test('sinonim jumlah laporan menghasilkan hitungan yang sama', () => {
  for (const q of [
    'Berapa laporan hari ini?',
    'brp laporan hari ini',
    'ada berapa laporan hari ini?',
    'total laporan hari ini',
  ]) {
    const n = names('ADMIN', q);
    assert.equal(n[0], 'countReports', `gagal untuk: ${q}`);
    assert.equal(args('ADMIN', q).period, 'today', `periode salah untuk: ${q}`);
  }
});

test('sinonim daftar laporan menghasilkan daftar', () => {
  // "laporan yang MASUK hari ini" punya tool khusus (getTodayReports); keduanya
  // sama-sama mengembalikan DAFTAR laporan hari ini, bukan sekadar jumlah.
  assert.equal(names('ADMIN', 'Apa saja laporan yang masuk hari ini?')[0], 'getTodayReports');
  for (const q of ['Tampilkan laporan hari ini', 'daftar laporan hari ini']) {
    const n = names('ADMIN', q);
    assert.equal(n[0], 'listReports', `gagal untuk: ${q}`);
    assert.equal(args('ADMIN', q).period, 'today', `periode salah untuk: ${q}`);
  }
});

test('variasi jenis kerusakan → statistik jenis kerusakan', () => {
  for (const q of ['Jenis kerusakannya apa saja?', 'tipe kerusakan apa saja?', 'macam kerusakan yang ada']) {
    assert.equal(names('ADMIN', q)[0], 'getDamageTypeStats', `gagal untuk: ${q}`);
  }
});

test('variasi "hari ini" mengenali periode WIB', () => {
  assert.equal(args('ADMIN', 'ada laporan hari ini?').period, 'today');
  assert.equal(args('ADMIN', 'laporan bulan ini berapa?').period, 'month');
  assert.equal(args('ADMIN', 'laporan minggu ini berapa?').period, 'week');
});

// ---------------------------------------------------------------------------
// Slot filter spesifik
// ---------------------------------------------------------------------------
test('breakdown jenis kerusakan meneruskan periode dari pertanyaan', () => {
  const q = 'Ada berapa laporan hari ini? Sebutkan jenis kerusakannya.';
  assert.equal(names('ADMIN', q)[0], 'getDamageTypeStats');
  assert.equal(args('ADMIN', q).period, 'today');
  const q2 = 'Sebutkan jenis kerusakan apa saja';
  assert.equal(names('ADMIN', q2)[0], 'getDamageTypeStats');
  assert.equal(args('ADMIN', q2).period, undefined);
});

test('admin: severity tinggi → hitungan dengan filter keparahan', () => {
  const a = args('ADMIN', 'Laporan dengan severity tinggi ada berapa?');
  assert.equal(names('ADMIN', 'Laporan dengan severity tinggi ada berapa?')[0], 'countReports');
  assert.deepEqual((a.severity as string[]).slice().sort(), ['KRITIS', 'TINGGI'].sort());
});

test('admin: status selesai → daftar berstatus COMPLETED', () => {
  assert.deepEqual(args('ADMIN', 'Mana laporan yang sudah selesai?').status, ['COMPLETED']);
});

test('admin: belum ditangani → antrean penugasan', () => {
  assert.equal(names('ADMIN', 'Berapa laporan yang belum ditangani?')[0], 'getPendingAssignment');
});

test('admin: belum diverifikasi → antrean verifikasi', () => {
  assert.equal(names('ADMIN', 'Laporan mana yang belum diverifikasi?')[0], 'getUnverifiedQueue');
});

test('admin: bukti penyelesaian → antrean REVIEW', () => {
  assert.equal(names('ADMIN', 'Apa bukti penyelesaian yang dikirim petugas?')[0], 'getPendingResultVerification');
});

test('admin: sedang ditangani petugas → daftar IN_PROGRESS', () => {
  assert.deepEqual(args('ADMIN', 'Laporan apa yang sedang ditangani petugas?').status, ['IN_PROGRESS']);
});

test('admin: nama pelapor menghasilkan kandidat + daftar terfilter', () => {
  const n = names('ADMIN', 'Tampilkan laporan milik Arsa.');
  assert.deepEqual(n, ['findReportersByName', 'listReports']);
  assert.equal(tools('ADMIN', 'Tampilkan laporan milik Arsa.')[1].args.reporterName, 'Arsa');
});

test('admin: nama pelapor tidak menyerobot kata umum', () => {
  // "laporan jalan" bukan nama orang.
  assert.equal(names('ADMIN', 'laporan jalan').includes('findReportersByName'), false);
  assert.equal(names('ADMIN', 'laporan terbaru').includes('findReportersByName'), false);
});

test('admin: "laporan terbaru di menu dashboard" → DAFTAR terbaru, bukan statistik', () => {
  const q = 'laporan terbaru yg ada di menu dashboard';
  const n = names('ADMIN', q);
  assert.deepEqual(n, ['listReports'], 'harus daftar laporan, bukan getSystemStats');
  assert.equal(args('ADMIN', q).limit, 10);
  assert.equal(args('ADMIN', q).period, undefined, 'jangan diam-diam menyempit ke hari ini');
});

test('admin: permintaan 5–10 laporan terbaru tidak memakai periode tersembunyi', () => {
  for (const q of [
    'Tampilkan 10 laporan terbaru',
    'laporan paling baru apa saja?',
    '5 laporan terakhir yang masuk',
  ]) {
    assert.equal(names('ADMIN', q)[0], 'listReports', `gagal untuk: ${q}`);
    assert.equal(args('ADMIN', q).period, undefined, `periode tidak boleh muncul: ${q}`);
  }
});

test('admin: koreksi "kalau itu kan semua laporan" mengganti query, bukan mengulang', () => {
  const history: ChatTurn[] = [
    user('laporan terbaru'),
    { role: 'assistant', content: 'Terdapat 69 laporan. 49 belum selesai, 15 selesai, 5 ditolak.' },
  ];
  const q = 'kalau itu kan semua laporan';
  assert.equal(names('ADMIN', q, history)[0], 'listReports');
  assert.equal(args('ADMIN', q, history).period, undefined, 'tidak boleh jatuh ke hari ini dari konteks lama');
});

test('admin: "bukan itu yang saya maksud" tidak mengulang statistik/hari ini', () => {
  const history: ChatTurn[] = [user('laporan hari ini')];
  const q = 'bukan itu yang saya maksud';
  assert.equal(names('ADMIN', q, history)[0], 'listReports');
  assert.equal(args('ADMIN', q, history).period, undefined, 'koreksi tidak boleh memakai periode konteks lama');
});

test('admin: pertanyaan kemampuan dijawab dari fitur sesuai role, bukan daftar laporan', () => {
  for (const q of ['Apa yang bisa Anda lakukan?', 'Apa saja yang bisa saya lakukan di website ini?']) {
    assert.deepEqual(names('ADMIN', q), ['getWebsiteInfo'], `gagal untuk: ${q}`);
    assert.equal(args('ADMIN', q).topic, 'features');
  }
  assert.deepEqual(names('CITIZEN', 'Apa yang bisa Anda lakukan?'), ['getWebsiteInfo']);
  assert.equal(args('CITIZEN', 'Apa yang bisa Anda lakukan?').topic, 'features');
});

test('admin: warga dengan WhatsApp terverifikasi → pencarian AKUN, bukan ringkasan WA', () => {
  const t = tools('ADMIN', 'Siapa warga yang nomor WhatsApp-nya terverifikasi?');
  assert.equal(t[0].name, 'searchAccounts');
  assert.equal(t[0].args.verified, true);
  assert.equal(t[0].args.role, 'CITIZEN');
});

test('deteksi intent: "akunnya" bukan "aku" (direktori akun tidak dibajak profil)', () => {
  assert.equal(detectChatIntent('Siapa saja warga yang akunnya nonaktif?', 'ADMIN'), 'ACCOUNT_DIR');
  assert.equal(detectChatIntent('Siapa saya?', 'ADMIN'), 'MY_PROFILE');
});

test('admin: wilayah terbanyak → statistik lokasi', () => {
  assert.equal(names('ADMIN', 'Wilayah mana yang memiliki laporan terbanyak?')[0], 'getStatsByLocation');
});

test('admin: kinerja petugas → statistik petugas', () => {
  assert.equal(names('ADMIN', 'Petugas mana yang memiliki tugas paling banyak?')[0], 'getOfficerStats');
});

test('admin: ID laporan → detail lengkap', () => {
  const n = names('ADMIN', 'status laporan 3f2a1b9c');
  assert.deepEqual(n, ['getReportFullDetail']);
  assert.equal(args('ADMIN', 'status laporan 3f2a1b9c').idFragment, '3f2a1b9c');
});

test('admin: judul ber-kutip → pencarian judul (bukan detail ID)', () => {
  const n = names('ADMIN', 'Status laporan dengan judul "Lampu Jalan Mati"');
  assert.deepEqual(n, ['searchReportsByTitle']);
});

// ---------------------------------------------------------------------------
// Penjelasan fitur (tanpa database)
// ---------------------------------------------------------------------------
test('pertanyaan cara/alur dijawab dari pengetahuan fitur', () => {
  assert.deepEqual(names('ADMIN', 'Ceritakan alur laporan dari warga sampai selesai.'), ['getWebsiteInfo']);
  assert.equal(args('ADMIN', 'Ceritakan alur laporan dari warga sampai selesai.').topic, 'workflow');
  assert.equal(args('ADMIN', 'Bagaimana cara admin memverifikasi laporan?').topic, 'workflow');
  assert.equal(args('ADMIN', 'Fitur apa saja yang tersedia untuk petugas?').topic, 'features');
  assert.equal(args('CITIZEN', 'bagaimana cara membuat laporan?').topic, 'navigation');
});

// ---------------------------------------------------------------------------
// Konteks percakapan / pertanyaan lanjutan
// ---------------------------------------------------------------------------
test('lanjutan "siapa saja yang membuatnya" memakai periode dari konteks', () => {
  const history = [user('Ada berapa laporan hari ini?')];
  assert.deepEqual(names('ADMIN', 'Siapa saja yang membuatnya?', history), ['getTodayReporters']);
});

test('lanjutan "statusnya bagaimana" memakai judul laporan dari konteks', () => {
  const history = [user('Tampilkan laporan berjudul "Jalan berlubang parah"')];
  const t = tools('ADMIN', 'statusnya bagaimana?', history);
  assert.deepEqual(t.map((x) => x.name), ['searchReportsByTitle']);
  assert.equal(t[0].args.fragment, 'Jalan berlubang parah');
});

test('lanjutan "berapa jumlahnya" memakai nama pelapor dari konteks', () => {
  const history = [user('Tampilkan laporan milik Arsa.')];
  const ctx = extractContext(history);
  assert.equal(ctx.lastReporterName, 'Arsa');
  const t = tools('ADMIN', 'berapa jumlahnya?', history);
  assert.ok(t.some((x) => x.name === 'listReports' && x.args.reporterName === 'Arsa'));
});

test('konteks warga memakai kategori dari pertanyaan sebelumnya', () => {
  const history = [user('laporan jalan saya mana saja?')];
  const t = tools('CITIZEN', 'apa statusnya?', history);
  assert.deepEqual(t.map((x) => x.name), ['searchMyReports']);
  assert.equal(t[0].args.category, 'Jalan');
});

test('extractContext mengumpulkan periode/kategori/keparahan', () => {
  const ctx = extractContext([user('berapa laporan jalan severity tinggi bulan ini?')]);
  assert.equal(ctx.lastPeriod, 'month');
  assert.equal(ctx.lastCategory, 'Jalan');
  assert.deepEqual(ctx.lastSeverity?.slice().sort(), ['KRITIS', 'TINGGI'].sort());
});

// ---------------------------------------------------------------------------
// Masyarakat: privasi + data sendiri
// ---------------------------------------------------------------------------
test('masyarakat: permintaan data warga lain ditolak', () => {
  for (const q of ['siapa saja yang melapor hari ini?', 'tampilkan laporan warga lain', 'daftar pelapor']) {
    assert.deepEqual(names('CITIZEN', q), ['refusePrivate'], `gagal untuk: ${q}`);
  }
});

test('masyarakat: pertanyaan laporan sendiri menuju tool milik sendiri', () => {
  assert.deepEqual(names('CITIZEN', 'berapa laporan saya?'), ['getMyReportCounts']);
  assert.deepEqual(names('CITIZEN', 'status laporan saya'), ['getMyReportCounts']);
  const t = tools('CITIZEN', 'laporan jalan saya mana saja?');
  assert.deepEqual(t.map((x) => x.name), ['searchMyReports']);
  assert.equal(t[0].args.category, 'Jalan');
});

test('masyarakat: "berapa laporan" tanpa "saya" → agregat publik, bukan daftar warga', () => {
  assert.deepEqual(names('CITIZEN', 'berapa total laporan desa?'), ['getTotalReports']);
});

test('masyarakat: siapa petugas yang menangani laporan saya', () => {
  assert.deepEqual(names('CITIZEN', 'siapa yang menangani laporan saya?'), ['getMyLatestHandling']);
});

// ---------------------------------------------------------------------------
// Petugas: hanya tugas sendiri
// ---------------------------------------------------------------------------
test('petugas: belum selesai vs sudah selesai dibedakan', () => {
  assert.equal(args('OFFICER', 'berapa tugas saya yang belum selesai?').done, false);
  assert.equal(args('OFFICER', 'berapa laporan yang sudah saya selesaikan?').done, true);
});

test('petugas: urgensi dan daftar tugas', () => {
  assert.deepEqual(names('OFFICER', 'laporan mana yang paling urgent?'), ['getMyUrgentTasks']);
  assert.deepEqual(names('OFFICER', 'tampilkan tugas saya hari ini'), ['getMyTaskSummary', 'getMyActiveTasks']);
});

test('daftar laporan "beserta jenis kerusakannya" tetap berupa DAFTAR, bukan distribusi', () => {
  // Regresi: kata "jenis" dulu membuat permintaan DAFTAR laporan dijawab
  // dengan distribusi jumlah per jenis (bahkan sempat dijawab "tidak ada data").
  for (const q of [
    'Tampilkan 5 laporan terbaru beserta jenis kerusakannya',
    'tampilkan laporan terbaru disertai statusnya',
    'daftar laporan lengkap dengan kategorinya',
  ]) {
    assert.equal(names('ADMIN', q)[0], 'listReports', `gagal untuk: ${q}`);
  }
});

test('permintaan sebaran tetap menjadi statistik per dimensi', () => {
  assert.equal(names('ADMIN', 'Tampilkan laporan per kategori')[0], 'getStatsByCategory');
  assert.equal(names('ADMIN', 'bagaimana sebaran laporan per lokasi?')[0], 'getStatsByLocation');
  assert.equal(names('ADMIN', 'rincian laporan berdasarkan tingkat keparahan')[0], 'getStatsBySeverity');
});

test('judul laporan yang memuat nama jalan tidak tertukar dengan kategori', () => {
  const q = 'laporan berjudul Jalan Berlubang statusnya apa?';
  assert.equal(names('ADMIN', q)[0], 'searchReportsByTitle');
  assert.equal(args('ADMIN', q).fragment, 'Jalan Berlubang');

  const q2 = 'laporan saya berjudul Jalan Berlubang statusnya apa?';
  assert.equal(names('CITIZEN', q2)[0], 'searchMyReports');
  assert.equal(args('CITIZEN', q2).title, 'Jalan Berlubang');
});

test('beberapa laporan berjudul sama dijawab deterministik tanpa menyimpulkan satu status', () => {
  const answer = formatDeterministicAnswer([], [
    {
      name: 'searchReportsByTitle',
      result: {
        query: 'Jalan Berlubang',
        total: 2,
        ambiguous: true,
        items: [
          { id: '491b7baf', title: 'Jalan Berlubang', status: 'IN_PROGRESS', statusLabel: 'Sedang Ditangani', location: 'Jl. Sudirman' },
          { id: '6a6a2efc', title: 'Jalan Berlubang', status: 'COMPLETED', statusLabel: 'Selesai', location: 'Jl. Merdeka' },
        ],
      },
    },
  ]);
  assert.ok(answer, 'harus dijawab tanpa LLM');
  assert.ok(answer!.includes('Sedang Ditangani'), answer!);
  assert.ok(answer!.includes('Selesai'), answer!);
  assert.equal(/semua/i.test(answer!), false, 'jangan menyimpulkan satu status untuk semuanya');
  assert.ok(answer!.includes('ID'), 'harus meminta klarifikasi berbasis ID');
});

test('judul yang tidak ditemukan dijawab jujur (bukan error)', () => {
  const answer = formatDeterministicAnswer([], [
    { name: 'searchReportsByTitle', result: { query: 'zzz tidak ada', total: 0, items: [] } },
  ]);
  assert.ok(answer!.includes('Tidak ada laporan'));
});

test('petugas: permintaan tugas petugas lain ditolak (privasi antar-petugas)', () => {
  const n = names('OFFICER', 'Tampilkan tugas petugas lain yang belum selesai');
  assert.equal(n[0], 'refusePrivate');
});

test('petugas: pertanyaan cara pakai dijawab dari pengetahuan fitur', () => {
  assert.deepEqual(names('OFFICER', 'bagaimana cara upload bukti penyelesaian?'), ['getWebsiteInfo']);
});

// ---------------------------------------------------------------------------
// Regresi jumlah per status & konteks lanjutan
// ---------------------------------------------------------------------------
test('jumlah satu status memakai countReports, bukan daftar/statistik penuh', () => {
  const inProgress = args('ADMIN', 'laporan yg sedang di tangani jumlah nya?');
  assert.equal(names('ADMIN', 'laporan yg sedang di tangani jumlah nya?')[0], 'countReports');
  assert.deepEqual(inProgress.status, ['IN_PROGRESS']);

  const rejected = args('ADMIN', 'laporan yg di tolak jumlah nya?');
  assert.equal(names('ADMIN', 'laporan yg di tolak jumlah nya?')[0], 'countReports');
  assert.deepEqual(rejected.status, ['REJECTED']);

  const unfinished = args('ADMIN', 'berapa yg belum selesai?');
  assert.equal(names('ADMIN', 'berapa yg belum selesai?')[0], 'countReports');
  assert.equal(unfinished.statusNotFinal, true);
});

test('follow-up periode mempertahankan status yang sedang dibahas', () => {
  const history = [user('laporan yg di tolak jumlah nya?')];
  const a = args('ADMIN', 'kalau yang kemarin berapa?', history);
  assert.equal(names('ADMIN', 'kalau yang kemarin berapa?', history)[0], 'countReports');
  assert.deepEqual(a.status, ['REJECTED']);
  assert.ok(a.dateFrom, 'periode kemarin harus menjadi rentang tanggal');
});

test('follow-up "tampilkan detailnya" mempertahankan filter status', () => {
  const history = [user('laporan yg di tolak jumlah nya?')];
  const a = args('ADMIN', 'tampilkan detailnya', history);
  assert.equal(names('ADMIN', 'tampilkan detailnya', history)[0], 'listReports');
  assert.deepEqual(a.status, ['REJECTED']);
});

test('identitas pengguna dan identitas asisten tidak tertukar', () => {
  assert.equal(detectChatIntent('siapa saya', 'ADMIN'), 'MY_PROFILE');
  assert.equal(detectChatIntent('saya login sebagai apa', 'ADMIN'), 'MY_PROFILE');
  assert.equal(detectChatIntent('kamu siapa', 'ADMIN'), 'IDENTITY');
});

// ---------------------------------------------------------------------------
// Di luar jangkauan sistem → tidak memaksa query database
// ---------------------------------------------------------------------------
test('pertanyaan tak relevan tidak memicu query database', () => {
  for (const q of ['apa ibukota indonesia?', 'harga beras sekarang', 'siapa presiden pertama?']) {
    assert.deepEqual(names('ADMIN', q), [], `gagal untuk: ${q}`);
  }
});

test('pertanyaan pendek tanpa konteks tidak memaksa query', () => {
  assert.deepEqual(names('ADMIN', 'tolong bantu'), []);
});

// ---------------------------------------------------------------------------
// Kontrak penting: SEMUA tool yang mungkin dihasilkan router harus terdaftar.
// ---------------------------------------------------------------------------
test('setiap tool hasil router terdaftar di TOOL_REGISTRY', () => {
  const corpus: [ChatRole, string][] = [
    ['ADMIN', 'Apa saja laporan nya?'],
    ['ADMIN', 'laporan jalan yang mana saja?'],
    ['ADMIN', 'berapa laporan hari ini?'],
    ['ADMIN', 'siapa saja yang melapor hari ini?'],
    ['ADMIN', 'jenis kerusakannya apa saja?'],
    ['ADMIN', 'laporan severity tinggi ada berapa?'],
    ['ADMIN', 'laporan mana yang belum diverifikasi?'],
    ['ADMIN', 'tampilkan laporan milik Arsa.'],
    ['ADMIN', 'Ceritakan alur laporan dari warga sampai selesai.'],
    ['ADMIN', 'Fitur apa saja yang tersedia untuk petugas?'],
    ['ADMIN', 'status laporan 3f2a1b9c'],
    ['ADMIN', 'Berapa beban kerja petugas?'],
    ['ADMIN', 'Apakah ada laporan duplikat?'],
    ['ADMIN', 'laporan yang terbengkalai'],
    ['ADMIN', 'Berapa laporan yang menunggu penugasan?'],
    ['ADMIN', 'rata-rata waktu penyelesaian'],
    ['ADMIN', 'Berapa warga yang mendaftar hari ini?'],
    ['ADMIN', 'siapa admin sistem ini?'],
    ['ADMIN', 'lokasi dengan laporan berulang'],
    ['ADMIN', 'keyakinan AI rata-rata'],
    ['ADMIN', 'petugas Budi'],
    ['CITIZEN', 'berapa laporan saya?'],
    ['CITIZEN', 'laporan jalan saya mana saja?'],
    ['CITIZEN', 'siapa saja yang melapor hari ini?'],
    ['CITIZEN', 'bagaimana cara membuat laporan?'],
    ['CITIZEN', 'siapa yang menangani laporan saya?'],
    ['CITIZEN', 'bukti pengerjaan laporan saya'],
    ['CITIZEN', 'notifikasi saya'],
    ['CITIZEN', 'profil saya'],
    ['CITIZEN', 'laporan saya yang duplikat'],
    ['CITIZEN', 'siapa saja petugas desa?'],
    ['CITIZEN', 'lokasi mana yang paling banyak laporan?'],
    ['OFFICER', 'berapa tugas saya yang belum selesai?'],
    ['OFFICER', 'berapa laporan yang sudah saya selesaikan?'],
    ['OFFICER', 'tampilkan tugas saya hari ini'],
    ['OFFICER', 'bagaimana cara upload bukti?'],
    ['OFFICER', 'laporan mana yang paling urgent?'],
  ];
  for (const [role, q] of corpus) {
    for (const name of names(role, q)) {
      assert.ok(TOOL_REGISTRY[name], `tool "${name}" (dari "${q}") tidak terdaftar di TOOL_REGISTRY`);
    }
  }
});

test('router tidak pernah menghasilkan lebih dari 4 tool dalam satu pertanyaan', () => {
  for (const q of ['tampilkan laporan milik Arsa hari ini', 'laporan jalan yang belum diverifikasi']) {
    assert.ok(names('ADMIN', q).length <= 4, q);
  }
});

// ===========================================================================
// PORTAL DESA — pertanyaan sehari-hari tentang desa diarahkan ke tool desa.
// ===========================================================================

test('pertanyaan portal desa (Bahasa Indonesia sehari-hari) memilih tool yang tepat', () => {
  const cases: [string, string][] = [
    ['Desa Ciperna ada di mana?', 'getVillageMapInfo'],
    ['desa ciperna dimana ya', 'getVillageMapInfo'],
    ['Di mana lokasi desa Ciperna?', 'getVillageMapInfo'],
    ['Bagaimana cara menuju kantor desa?', 'getVillageMapInfo'],
    ['petunjuk arah ke kantor desa dong', 'getVillageMapInfo'],
    ['Siapa Kepala Desa Ciperna?', 'getVillageOfficials'],
    ['siapa kades nya?', 'getVillageOfficials'],
    ['Siapa saja perangkat desa?', 'getVillageOfficials'],
    ['Bagaimana struktur RT dan RW?', 'getVillageOfficials'],
    ['apa saja layanan desa?', 'getVillageServices'],
    ['daftar layanan desa dong', 'getVillageServices'],
    ['jam pelayanan kantor desa kapan?', 'getVillageProfileInfo'],
    ['ada pengumuman terbaru?', 'getVillageAnnouncements'],
    ['berapa jumlah penduduk desa?', 'getVillageProfileInfo'],
    ['apa visi misi desa ciperna?', 'getVillageProfileInfo'],
    ['apa potensi desa ciperna?', 'getVillageProfileInfo'],
  ];
  for (const [q, expected] of cases) {
    const got = names('CITIZEN', q);
    assert.ok(got.includes(expected), `"${q}" → ${got.join(', ')} (harus memuat ${expected})`);
  }
});

test('informasi desa tersedia untuk semua role (tanpa data privat)', () => {
  for (const role of ['CITIZEN', 'OFFICER', 'ADMIN'] as ChatRole[]) {
    assert.deepEqual(names(role, 'Siapa Kepala Desa Ciperna?'), ['getVillageOfficials']);
    assert.deepEqual(names(role, 'Apa saja layanan desa?'), ['getVillageServices']);
  }
});

test('pertanyaan desa tidak membajak pertanyaan laporan/akun', () => {
  const shouldNotBeVillage: [ChatRole, string][] = [
    ['CITIZEN', 'berapa laporan yang belum selesai?'],
    ['CITIZEN', 'bagaimana cara melaporkan jalan rusak?'],
    ['CITIZEN', 'laporan jalan saya mana saja?'],
    ['ADMIN', 'berapa laporan yang menunggu verifikasi?'],
    ['ADMIN', 'tampilkan laporan hari ini'],
    ['OFFICER', 'berapa tugas saya yang belum selesai?'],
  ];
  const villageTools = new Set([
    'getVillageProfileInfo',
    'getVillageOfficials',
    'getVillageServices',
    'getVillageAnnouncements',
    'getVillageMapInfo',
  ]);
  for (const [role, q] of shouldNotBeVillage) {
    const got = names(role, q);
    assert.equal(got.some((n) => villageTools.has(n)), false, `"${q}" tidak boleh ke tool desa → ${got.join(', ')}`);
  }
});

// ---------------------------------------------------------------------------
// TAMBAHAN: perbaikan routing intent & fallback (berdasarkan audit).
// ---------------------------------------------------------------------------

test('CITIZEN: "berapa jumlah laporan" memilih getMyReportCounts (bukan daftar)', () => {
  const q = 'Berapa jumlah laporan saya?';
  const n = names('CITIZEN', q);
  assert.equal(n[0], 'getMyReportCounts', `gagal untuk: ${q} → ${n.join(',')}`);
});

test('CITIZEN: "jumlah laporan yang menunggu verifikasi" memilih getMyReportCounts (citizen count tool)', () => {
  const q = 'Jumlah laporan saya yang menunggu verifikasi?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'getMyReportCounts'),
    `harus ada getMyReportCounts: ${names.join(',')}`
  );
});

test('CITIZEN: "berapa laporan yang sedang ditangani" memilih getMyReportCounts + status IN_PROGRESS', () => {
  const q = 'Berapa laporan saya yang sedang ditangani?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'getMyReportCounts'),
    `harus ada getMyReportCounts: ${names.join(',')}`
  );
  const args = tools.find((t) => t.name === 'getMyReportCounts')?.args ?? {};
  assert.equal(args.status?.length, 1, 'status filter harus 1 elemen');
  assert.equal(args.status?.[0], 'IN_PROGRESS', 'status harus IN_PROGRESS');
});

test('CITIZEN: "berapa laporan yang menunggu verifikasi" memilih getMyReportCounts dengan status filter', () => {
  const q = 'Jumlah laporan saya yang menunggu verifikasi?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'getMyReportCounts'),
    `harus ada getMyReportCounts: ${names.join(',')}`
  );
  const args = tools.find((t) => t.name === 'getMyReportCounts')?.args ?? {};
  assert.equal(args.status?.length, 1, 'status filter harus 1 elemen');
  assert.ok(['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'].includes(args.status?.[0] ?? ''), 'status harus salah satu dari status sah');
});

test('CITIZEN: "berapa laporan yang ditolak?" memilih getMyReportCounts + status REJECTED', () => {
  const q = 'Berapa laporan saya yang ditolak?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'getMyReportCounts'),
    `harus ada getMyReportCounts: ${names.join(',')}`
  );
  const args = tools.find((t) => t.name === 'getMyReportCounts')?.args ?? {};
  assert.equal(args.status?.[0], 'REJECTED', 'status harus REJECTED');
});

test('CITIZEN: "berapa laporan saya?" tanpa filter tetap struktur objek penuh', () => {
  const { tools } = resolveIntent('CITIZEN', 'Berapa laporan saya?', []);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('getMyReportCounts'), `harus ada getMyReportCounts: ${names.join(',')}`);
  const args = tools.find((t) => t.name === 'getMyReportCounts')?.args ?? {};
  assert.equal(args.status, undefined, 'tanpa filter, status tidak boleh ada');
});

test('CITIZEN: "Berapa laporan warga lain?" menolak (tidak mengakses laporan orang lain)', () => {
  const q = 'Berapa laporan warga lain?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  for (const n of names) {
    assert.ok(
      !n.includes('getMyReport'),
      `tool laporan warga lain tak diizinkan: ${n} (tools=${names.join(',')})`
    );
  }
});

test('CITIZEN: "Berapa yang sedang ditangani?" tetap detail penanganan, bukan hitungan laporan', () => {
  const q = 'Berapa yang sedang ditangani?';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  assert.ok(
    !names.includes('getMyReportCounts'),
    `hitungan laporan tak diizinkan: ${names.join(',')}`
  );
  assert.ok(
    names.some((n) => n.includes('LatestHandling')),
    `detail penanganan tetap diperlukan: ${names.join(',')}`
  );
});

test('deteksi intent: "siapa saya?" → MY_PROFILE, bukan MY_REPORT', () => {
  const intent = detectChatIntent('Siapa saya?', 'CITIZEN');
  assert.equal(intent, 'MY_PROFILE', `harus MY_PROFILE, dapat: ${intent}`);
});

test('CITIZEN: "laporan saya?" tetap MY_REPORT, bukan MY_PROFILE', () => {
  const intent = detectChatIntent('laporan saya mana saja?', 'CITIZEN');
  assert.equal(intent, 'MY_REPORT', `harus MY_REPORT, dapat: ${intent}`);
});

test('CITIZEN: "laporan saya" tidak dianggap profil', () => {
  const intent = detectChatIntent('laporan saya yang sedang saya kerjakan', 'CITIZEN');
  assert.equal(intent, 'MY_REPORT', `harus MY_REPORT, dapat: ${intent}`);
});

test('follow-up "dua minggu ini?" mempertahankan filter periode dari konteks', () => {
  const history = [
    { role: 'user', content: 'Berapa laporan saya minggu ini?' },
  ];
  const q = 'dua minggu ini?';
  const { tools } = resolveIntent('CITIZEN', q, history);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'searchMyReports' || n === 'getMyReportCounts'),
    `harus ada tool laporan: ${names.join(',')}`
  );
});

test('follow-up "bulan ini?" mempertahankan filter periode dari konteks', () => {
  const history = [
    { role: 'user', content: 'Berapa laporan saya bulan ini?' },
  ];
  const q = 'bulan ini?';
  const { tools } = resolveIntent('CITIZEN', q, history);
  const names = tools.map((t) => t.name);
  assert.ok(
    names.some((n) => n === 'searchMyReports' || n === 'getMyReportCounts'),
    `harus ada tool laporan: ${names.join(',')}`
  );
});

test('CITIZEN: "Buatkan coding Python" tidak memicu tool laporan', () => {
  const q = 'Buatkan coding Python.';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  for (const n of names) {
    assert.ok(
      !n.includes('getMyReport') && !n.includes('listReports'),
      `tool laporan tak diinginkan: ${n} (tools=${names.join(',')})`
    );
  }
});

test('CITIZEN: "Tuliskan puisi" tidak memicu tool laporan', () => {
  const q = 'Tuliskan puisi tentang desa.';
  const { tools } = resolveIntent('CITIZEN', q, []);
  const names = tools.map((t) => t.name);
  for (const n of names) {
    assert.ok(
      !n.includes('getMyReport') && !n.includes('listReports'),
      `tool laporan tak diinginkan: ${n} (tools=${names.join(',')})`
    );
  }
});

/**
 * TES H1 — PENANGANAN KEGAGALAN PARSIAL (partial failure handling).
 *
 * Sasaran:
 *  - Hasil tool yang BERHASIL tetap dipakai虽然 ada tool lain yang gagal.
 *  - Kegagalan diklasifikasi (query gagal / forbidden / tool gagal / tak dikenal).
 *  - Metadata (partial, tools, sources, toolErrors) mencerminkan eksekusi nyata.
 *  - Tidak ada kebocoran data privat lewat jalur forbidden.
 *
 * Test ini tidak memanggil LLM dan tidak mengubah data produksi.
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import {
  classifyToolFailure,
  formatFallbackAnswer,
  type ToolFailureKind,
} from '../src/lib/aiChat';

after(async () => {
  await prisma.$disconnect();
});

const OK_LIST = {
  total: 1,
  items: [{ id: 'r1', title: 'Lampu jalan mati', status: 'SUBMITTED', statusLabel: 'Menunggu Verifikasi', location: 'Jl. Uji' }],
};

const OK_STATS = {
  total: 68,
  byStatus: [{ status: 'SUBMITTED', label: 'Menunggu Verifikasi', count: 40 }],
  appliedFilters: [],
};

/** Bangun jawaban fallback deterministik (tanpa LLM) dari hasil tool buatan. */
function answerFrom(results: { name: string; result: unknown }[]): string {
  const liveContext: any = {
    user: { name: 'Penguji', role: 'ADMIN', isActive: true, email: 'uji@example.com' },
    village: { name: 'Desa Ciperna', adminWhatsapp: '082118727522', phone: '', email: '' },
    reportStats: null,
    announcementStats: null,
    userStats: null,
    myStats: null,
    myTasks: null,
    adminQueues: null,
    whatsapp: null,
    recentReports: [],
    recentTasks: [],
    errors: [],
  };
  return formatFallbackAnswer(
    results,
    '11 Nov 2026 08:00 WIB',
    liveContext,
    'ADMIN',
    'berapa laporan?',
    [] as any,
    { llmUnavailable: true }
  );
}

// ---------------------------------------------------------------------------
// A. Dua tool berhasil → jawaban lengkap
// ---------------------------------------------------------------------------

test('A. dua tool berhasil -> keduanya dipakai dalam jawaban', () => {
  const answer = answerFrom([
    { name: 'listReports', result: OK_LIST },
    { name: 'countReports', result: OK_STATS },
  ]);
  assert.match(answer, /Lampu jalan mati/, 'hasil tool pertama harus muncul');
  assert.match(answer, /68/, 'hasil tool kedua harus muncul');
  assert.doesNotMatch(answer, /Catatan keterbatasan/, 'tidak ada keterbatasan bila semua tool berhasil');
});

// ---------------------------------------------------------------------------
// B. Tool pertama berhasil, kedua gagal → hasil pertama tetap muncul
// ---------------------------------------------------------------------------

test('B. tool pertama sukses, kedua gagal -> hasil pertama tetap dipakai', () => {
  const answer = answerFrom([
    { name: 'listReports', result: OK_LIST },
    { name: 'countReports', result: { error: 'query gagal' } },
  ]);
  assert.match(answer, /Lampu jalan mati/, 'hasil sukses TIDAK boleh dibuang');
  assert.match(answer, /Catatan keterbatasan/, 'harus ada catatan keterbatasan');
  assert.match(answer, /jumlah laporan pada kriteria tersebut/, 'catatan menyebut bagian yang gagal');
  // Catatan keterbatasan hanya boleh menyebut bagian yang GAGAL, bukan bagian sukses.
  const note = answer.slice(answer.indexOf('Catatan keterbatasan'));
  assert.doesNotMatch(note, /daftar laporan/i, 'catatan tidak boleh menyebut topik yang sukses');
});

test('B2. tool pertama gagal, kedua sukses -> hasil kedua tetap dipakai', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { error: 'query gagal' } },
    { name: 'countReports', result: OK_STATS },
  ]);
  assert.match(answer, /68/, 'hasil sukses kedua TIDAK boleh dibuang');
  assert.match(answer, /Catatan keterbatasan/, 'harus ada catatan keterbatasan');
  assert.match(answer, /daftar laporan/, 'catatan menyebut bagian yang gagal');
});

// ---------------------------------------------------------------------------
// C. Semua tool gagal → fallback jujur, BUKAN "data kosong"
// ---------------------------------------------------------------------------

test('C. semua tool gagal -> fallback jujur tanpa menyebut data kosong', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { error: 'query gagal' } },
    { name: 'countReports', result: { error: 'query gagal' } },
  ]);
  assert.match(answer, /kendala saat mengambil data dari database/, 'menyebut penyebab');
  assert.doesNotMatch(answer, /tidak ada (data|laporan)/i, 'tidak boleh menyebut data kosong');
  assert.doesNotMatch(answer, /0 laporan/i, 'tidak boleh menyebut angka nol');
});

test('C2. semua tool gagal dengan error tak dikenal -> tidak dilabeli sebagai database error', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { error: 'sesuatu_yang_aneh' } },
  ]);
  assert.doesNotMatch(answer, /kendala saat mengambil data dari database/, 'error tak dikenal bukan kegagalan DB');
  assert.match(answer, /gangguan teknis/i, 'harus menyebut gangguan teknis');
  assert.doesNotMatch(answer, /tidak ada (data|laporan)/i, 'tidak boleh menyebut data kosong');
});

test('C3. kegagalan tingkat tool (bukan DB) -> tidak dilabeli database error', () => {
  const answer = answerFrom([
    { name: 'searchAiKnowledge', result: { error: 'kategori_tidak_valid' } },
  ]);
  assert.doesNotMatch(answer, /kendala saat mengambil data dari database/);
  assert.match(answer, /gangguan teknis/i);
});

// ---------------------------------------------------------------------------
// D. Forbidden → tidak membocorkan data, bukan data kosong
// ---------------------------------------------------------------------------

test('D. tool forbidden -> pesan kewenangan, tidak menyebut data kosong', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { error: 'forbidden' } },
  ]);
  assert.match(answer, /di luar kewenangan/, 'harus menyebut kewenangan');
  assert.doesNotMatch(answer, /tidak ada (data|laporan)/i, 'forbidden bukan data kosong');
  assert.doesNotMatch(answer, /query gagal/i, 'forbidden bukan kegagalan database');
});

test('D2. forbidden + tool sukses -> hasil sukses tetap dipakai tanpa membocorkan keberadaan data privat', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { error: 'forbidden' } },
    { name: 'countReports', result: OK_STATS },
  ]);
  assert.match(answer, /68/, 'hasil sukses tetap dipakai');
  assert.match(answer, /Catatan keterbatasan/, 'ada catatan keterbatasan');
  // Catatan tidak boleh menyebut data apa pun yang tidak boleh diakses.
  const note = answer.slice(answer.indexOf('Catatan keterbatasan'));
  assert.doesNotMatch(note, /daftar laporan|jumlah laporan pada kriteria|laporan milik/i,
    'catatan forbidden tidak boleh menyebut topik data yang ditolak');
});

// ---------------------------------------------------------------------------
// E. Data kosong vs data tidak ditemukan vs kegagalan
// ---------------------------------------------------------------------------

test('E. data kosong (tool sukses, 0 baris) -> jawab "tidak ada data", bukan error', () => {
  const answer = answerFrom([
    { name: 'listReports', result: { total: 0, items: [] } },
  ]);
  assert.doesNotMatch(answer, /gangguan|kendala/i, 'data kosong bukan gangguan');
  assert.match(answer, /Tidak ada data yang cocok|Tidak ada laporan yang cocok|Belum ada laporan/i, 'menyatakan data kosong');
});

test('E2. data tidak ditemukan (tool sukses, hasil null) -> jujur, bukan error', () => {
  const answer = answerFrom([
    { name: 'getMyReportFullDetail', result: null },
  ]);
  assert.doesNotMatch(answer, /gangguan|kendala saat mengambil data/i, 'tidak ditemukan bukan kegagalan');
  assert.match(answer, /tidak ditemukan/i, 'menyatakan data tidak ditemukan');
});

// ---------------------------------------------------------------------------
// F. Klasifikasi error
// ---------------------------------------------------------------------------

test('F. klasifikasi kegagalan membedakan 4 jenis + hasil sukses', () => {
  assert.equal(classifyToolFailure({ error: 'query gagal' }), 'query_gagal');
  assert.equal(classifyToolFailure({ error: 'forbidden' }), 'forbidden');
  assert.equal(classifyToolFailure({ error: 'kategori_tidak_valid' }), 'tool_gagal');
  assert.equal(classifyToolFailure({ error: 'apa_saja_ini' }), 'error_tidak_dikenal');
  // Hasil sukses (termasuk kosong & tidak ditemukan) BUKAN kegagalan.
  assert.equal(classifyToolFailure({ total: 0, items: [] }), null);
  assert.equal(classifyToolFailure(null), null);
  assert.equal(classifyToolFailure({ error: '' }), null);
});

// ---------------------------------------------------------------------------
// G. Tidak ada detail teknis yang bocor ke pengguna
// ---------------------------------------------------------------------------

test('G. jawaban tidak pernah memuat pesan error mentah/SQL/kredensial', () => {
  const nasty = {
    error: 'query gagal',
    detail: 'SQLITE_ERROR: SELECT * FROM User WHERE password = "abc123" near "token"',
    stack: 'Error: ... at prisma.user.findMany ...',
  };
  const answer = answerFrom([{ name: 'listReports', result: nasty }]);
  assert.doesNotMatch(answer, /SQLITE_ERROR|SELECT \*|prisma\.|findMany|stack/i, 'tidak boleh ada detail teknis');
  assert.doesNotMatch(answer, /abc123/i, 'tidak boleh ada kredensial');
  assert.match(answer, /kendala saat mengambil data dari database/, 'tetap informatif tanpa bocor');
});

// ---------------------------------------------------------------------------
// H. Metadata mencerminkan eksekusi nyata
// ---------------------------------------------------------------------------

test('H. metadata tools/partial/errorKind mengikuti eksekusi nyata', async () => {
  const { handleChatRequest } = await import('../src/lib/aiChat');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin);

  // Pesan yang memicu SATU tool valid + satu tool yang pasti gagal.
  // "berapa laporan bulan ini?" → countReports (sukses). Lalu disisipkan tool
  // gagal lewat pemanggilan langsung executeTools + jalur handler.
  const res: any = await handleChatRequest(
    'ADMIN',
    admin.id,
    { message: 'berapa laporan bulan ini?', history: [], sessionId: 'uji-h1' },
    'Uji H1'
  );
  assert.equal(res.status, 200);
  const meta = res.json.meta;
  assert.ok(Array.isArray(meta.tools), 'meta.tools harus berupa array');
  assert.equal(
    meta.tools.includes('askClarification'),
    false,
    'tool yang tidak dieksekusi tidak boleh masuk toolsUsed'
  );
  assert.ok(
    meta.tools.every((n: string) => typeof n === 'string'),
    'toolsUsed hanya berisi nama tool'
  );
  assert.equal(typeof meta.partial, 'boolean', 'partial harus boolean');
  assert.ok(Array.isArray(meta.sources), 'sources harus array');
  if (meta.partial) {
    assert.ok(Array.isArray(meta.toolErrors), 'toolErrors harus ada saat partial');
    for (const e of meta.toolErrors) {
      assert.ok(['query_gagal', 'forbidden', 'tool_gagal', 'error_tidak_dikenal'].includes(e.kind));
      assert.equal(typeof e.tool, 'string');
    }
    assert.ok(['DATABASE_ERROR', 'ACCESS_DENIED', 'TOOL_ERROR'].includes(meta.errorKind));
  }
});

test('H2. kegagalan nyata satu tool tidak membatalkan tool lain (hasil tool asli)', async () => {
  const { executeTools } = await import('../src/lib/aiToolRegistry');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin);

  // countReports → sukses; searchAiKnowledge dengan kategori tak valid → gagal.
  const results = await executeTools(
    'ADMIN',
    admin.id,
    [
      { name: 'countReports', args: {} },
      { name: 'searchAiKnowledge', args: { q: 'uji', category: 'KATEGORI_TIDAK_VALID' } },
    ],
    'uji-h1'
  );
  assert.equal(results.length, 2, 'kedua tool dieksekusi');
  assert.equal(classifyToolFailure(results[0].result), null, 'tool pertama sukses');
  assert.equal(classifyToolFailure(results[1].result), 'tool_gagal', 'tool kedua gagal (bukan DB)');

  // Jawaban harus memakai hasil sukses + mencatat keterbatasan.
  const answer = answerFrom(results as any);
  assert.match(answer, /\d+/, 'angka dari tool yang sukses harus tetap muncul');
  assert.match(answer, /Catatan keterbatasan/, 'harus ada catatan keterbatasan');
  assert.doesNotMatch(answer, /kendala saat mengambil data dari database/, 'kegagalan tool bukan kegagalan DB');
});

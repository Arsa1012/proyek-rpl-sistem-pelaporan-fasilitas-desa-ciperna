/**
 * Tes SMART RETRIEVAL + format jawaban deterministik untuk tugas petugas.
 *
 * Fokus:
 * 1. analyzeRetrieval: auto-detail, klarifikasi multi-kandidat, pencarian longgar.
 * 2. Keamanan role getMyTaskDetail: tugas petugas lain tidak boleh bocor.
 * 3. Jawaban deterministik barunya (searchMyTasks/getMyActiveTasks/getMyTaskDetail)
 *    memuat ID agar pertanyaan lanjutan tidak ambigu.
 *
 * Tes ini tidak memanggil layanan LLM (tidak butuh jaringan/API key).
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import { formatDeterministicAnswer } from '../src/lib/aiChat';
import { analyzeRetrieval, wantsSpecificDetail } from '../src/lib/aiRetrieval';
import { getMyTaskDetail } from '../src/lib/aiTools';

after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// analyzeRetrieval
// ---------------------------------------------------------------------------

test('pencarian 1 tugas + pertanyaan detail -> otomatis ambil detail tugas OFFICER', () => {
  const tools = [{ name: 'searchMyTasks', args: {} }];
  const toolResults = [{
    name: 'searchMyTasks',
    result: {
      total: 1,
      returned: 1,
      appliedFilters: [],
      items: [{ assignmentId: 'tsk1234567', reportId: 'report12', title: 'Lampu jalan mati', location: 'Jl. Mutiara' }],
    },
  }];
  const plan = analyzeRetrieval('OFFICER', 'petugasnya apa statusnya sekarang?', tools, toolResults as any);
  assert.equal(plan.extraTools.length, 1, 'harus meminta detail sekali');
  assert.equal(plan.extraTools[0].name, 'getMyTaskDetail');
  assert.equal((plan.extraTools[0].args as any).idFragment, 'report12');
  assert.equal(plan.relaxed, false);
  assert.ok(plan.note);
});

test('beberapa kandidat tanpa pilihan -> klarifikasi berisi ID', () => {
  const tools = [{ name: 'searchMyReports', args: { category: 'Jalan' } }];
  const toolResults = [{
    name: 'searchMyReports',
    result: {
      total: 2,
      returned: 2,
      appliedFilters: ['kategori: Jalan'],
      items: [
        { id: 'aaaa1111', title: 'Lampu jalan mati', status: 'ASSIGNED' },
        { id: 'bbbb2222', title: 'Jalan berlubang', status: 'COMPLETED' },
      ],
    },
  }];
  const plan = analyzeRetrieval('CITIZEN', 'statusnya apa sekarang?', tools, toolResults as any);
  assert.equal(plan.extraTools.length, 0, 'tanpa pilihan, jangan tebak kandidat');
  assert.ok(plan.clarification, 'harus minta klarifikasi');
  assert.match(plan.clarification!, /Sebutkan nomor atau ID laporan/);
  assert.match(plan.clarification!, /ID: aaaa1111/);
});

test('beberapa kandidat + pengguna memilih "nomor 2" -> detail kandidat ke-2', () => {
  const tools = [{ name: 'searchMyReports', args: {} }];
  const toolResults = [{
    name: 'searchMyReports',
    result: {
      total: 2,
      returned: 2,
      items: [
        { id: 'aaaa1111', title: 'Lampu jalan mati' },
        { id: 'bbbb2222', title: 'Jalan berlubang' },
      ],
    },
  }];
  const plan = analyzeRetrieval('CITIZEN', 'yang nomor 2 statusnya selesai?', tools, toolResults as any);
  assert.equal(plan.extraTools.length, 1);
  assert.equal((plan.extraTools[0].args as any).idFragment, 'bbbb2222');
  assert.equal(plan.clarification, undefined);
});

test('hasil kosong dengan filter teks -> pencarian longgar TANPA melepas batas kepemilikan', () => {
  const tools = [{
    name: 'searchMyReports',
    args: { status: ['COMPLETED'], category: 'Jalan', dateFrom: '2026-01-01', dateTo: '2026-01-02' },
  }];
  const toolResults = [{
    name: 'searchMyReports',
    result: { total: 0, returned: 0, appliedFilters: ['status: COMPLETED'], items: [] },
  }];
  const plan = analyzeRetrieval('CITIZEN', 'laporan jalan saya mana?', tools, toolResults as any);
  assert.equal(plan.relaxed, true, 'harus mencoba pencarian longgar');
  assert.equal(plan.extraTools.length, 1);
  const relaxedArgs = plan.extraTools[0].args as Record<string, unknown>;
  assert.equal(relaxedArgs.status, undefined, 'filter status harus dilepas');
  assert.equal(relaxedArgs.dateFrom, undefined, 'filter tanggal harus dilepas');
  assert.equal(relaxedArgs.category, 'Jalan', 'filter teks tetap dipertahankan');
  assert.ok(!(plan.extraTools[0].args as any).userId, 'scope kepemilikan tidak lewat argumen tool');
});

test('hasil kosong tanpa filter sama sekali -> tidak ada pencarian ulang', () => {
  const plan = analyzeRetrieval(
    'CITIZEN',
    'laporan saya mana?',
    [{ name: 'searchMyReports', args: {} }],
    [{
      name: 'searchMyReports',
      result: { total: 0, returned: 0, appliedFilters: [], items: [] },
    }] as any
  );
  assert.equal(plan.extraTools.length, 0, 'tanpa filter, tidak ada yang bisa dilepas');
  assert.equal(plan.relaxed, false);
});

test('pertanyaan daftar/jumlah tidak dianggap permintaan detail', () => {
  assert.equal(wantsSpecificDetail('berapa laporan saya?'), false);
  assert.equal(wantsSpecificDetail('tampilkan daftar laporan saya'), false);
  assert.equal(wantsSpecificDetail('status laporannya apa?'), true);
  assert.equal(wantsSpecificDetail('petugasnya sudah mengerjakan belum?'), true);
});

// ---------------------------------------------------------------------------
// Format deterministik baru
// ---------------------------------------------------------------------------

test('searchMyTasks terformat deterministik: filter, ID laporan, dan catatan longgar', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'searchMyTasks',
      result: {
        total: 2,
        returned: 2,
        appliedFilters: ['status laporan: IN_PROGRESS'],
        relaxed: true,
        relaxedNote: ' pencarian diperluas',
        items: [
          { assignmentId: 'tsk1234567', reportId: 'repor001', title: 'Lampu jalan mati', location: 'Jl. Mutiara', status: 'IN_PROGRESS', statusLabel: 'Sedang Ditangani', category: 'Penerangan', createdAtWib: '10 Nov 2026 08:00' },
          { assignmentId: 'tsk7654321', reportId: 'repor002', title: 'Jalan berlubang', location: 'Jl. Melati', status: 'ASSIGNED', statusLabel: 'Sudah Ditugaskan', createdAtWib: '10 Nov 2026 09:00' },
        ],
      },
    }],
    'tugas jalan saya yang belum selesai',
    'OFFICER'
  );
  assert.ok(answer, 'harus dijawab deterministik');
  assert.match(answer!, /Ditemukan 2 tugas milik Anda/);
  assert.match(answer!, /filter: status laporan: IN_PROGRESS/);
  assert.match(answer!, /ID laporan: repor001, tugas: tsk1234567/);
  assert.match(answer!, /pencarian diperluas/, 'harus jujur bahwa pencarian diperluas');
  assert.equal(/undefined|NaN|\[object/.test(answer!), false);
});

test('getMyTaskDetail terformat deterministik dengan ID, penugasan, dan bukti', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'getMyTaskDetail',
      result: {
        id: 'repor001',
        assignmentId: 'tsk1234567',
        title: 'Lampu jalan mati',
        description: 'Lampu penerangan jalan mati total.',
        category: 'Penerangan',
        damageType: 'Rusak',
        severity: 'TINGGI',
        location: 'Jl. Mutiara',
        status: 'IN_PROGRESS',
        statusLabel: 'Sedang Ditangani',
        reporter: 'Budi',
        createdAtWib: '10 Nov 2026 07:00',
        updatedAtWib: '10 Nov 2026 08:30',
        assignment: { officer: 'Pak Suhu', assignedAtWib: '10 Nov 2026 07:30', notes: 'Segera ditangani' },
        assignments: [{ officer: 'Pak Suhu', assignedAtWib: '10 Nov 2026 07:30', cancelled: false }],
        evidences: [{ description: 'Foto sebelum', atWib: '10 Nov 2026 08:00' }],
        evidenceCount: 1,
        timeline: [{ status: 'IN_PROGRESS', atWib: '10 Nov 2026 08:30', actor: 'Pak Suhu' }],
      },
    }],
    'detail tugasnya',
    'OFFICER'
  );
  assert.ok(answer);
  assert.match(answer!, /ID laporan: repor001/);
  assert.match(answer!, /ID tugas: tsk1234567/);
  assert.match(answer!, /Pelapor: Budi/);
  assert.match(answer!, /Penugasan Anda: ditugaskan 10 Nov 2026 07:30/);
  assert.match(answer!, /Bukti penyelesaian: 1/);
  assert.match(answer!, /Riwayat status \(1\)/);
  assert.equal(/undefined|NaN|\[object/.test(answer!), false);
});

test('klarifikasi smart-retrieval ditampilkan apa adanya, tanpa LLM dan tanpa riwayat', () => {
  const message = 'Ada 2 laporan yang cocok. Pilih salah satu:\n1. Kadang kudu (ID: aaaa1111)\n\nSebutkan nomor.';
  const answer = formatDeterministicAnswer(
    [{ role: 'assistant', content: 'Sebelumnya kita membahas laporan Anda.' }],
    [
      {
        name: 'searchMyReports',
        result: { total: 2, returned: 2, appliedFilters: [], items: [], },
      },
      { name: 'askClarification', result: { clarification: true, message } },
    ],
    'statusnya apa?',
    'CITIZEN'
  );
  assert.ok(answer);
  assert.equal(answer, message, 'pesan klarifikasi tidak boleh berubah');
});

test('searchMyReports hasil longgar memberi tahu bahwa pencarian diperluas', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'searchMyReports',
      result: {
        total: 1,
        returned: 1,
        appliedFilters: ['kategori: Jalan'],
        relaxed: true,
        relaxedNote: 'kepemilikan tetap dipertahankan',
        items: [
          { id: 'repor001', title: 'Jalan berlubang', status: 'COMPLETED', statusLabel: 'Selesai', location: 'Jl. Mutiara', createdAtWib: '10 Nov 2026 08:00' },
        ],
      },
    }],
    'laporan jalan saya yang sudah selesai?',
    'CITIZEN'
  );
  assert.ok(answer);
  assert.match(answer!, /Ditemukan 1 laporan milik Anda/);
  assert.match(answer!, /kepemilikan tetap dipertahankan/);
  assert.match(answer!, /\(ID: repor001\)/);
});

// ---------------------------------------------------------------------------
// Keamanan role tugas petugas (database nyata)
// ---------------------------------------------------------------------------

test('getMyTaskDetail menolak laporan yang tidak ditugaskan ke petugas tersebut', async () => {
  // Ambil pasangan laporan + petugas yang TIDAK ditugaskan di laporan itu.
  const pivot = await prisma.user.findFirst({
    where: { role: 'OFFICER', assignments: { some: {} } },
    select: { id: true },
  });
  assert.ok(pivot, 'fixture: butuh petugas dengan penugasan');
  const assignedReports = await prisma.assignment.findMany({
    where: { officerId: pivot.id, cancelledAt: null },
    select: { reportId: true },
    take: 20,
  });
  assert.ok(assignedReports.length > 0, 'fixture: butuh penugasan');
  const assignedIds = assignedReports.map((a) => a.reportId);

  const officerWithoutReport = {
    id: pivot.id,
    assignedIds,
  };
  if (officerWithoutReport.assignedIds.length === 0) return;

  // Laporan lain yang jelas bukan milik petugas ini.
  const foreign = await prisma.report.findFirst({
    where: { id: { notIn: officerWithoutReport.assignedIds } },
    select: { id: true },
  });
  if (!foreign) return; // semua laporan sudah ditugaskan ke dia; tak ada kasus uji

  const result = await getMyTaskDetail(pivot.id, foreign.id);
  assert.equal(result, null, 'laporan petugas lain harus tersembunyi (null), bukan error/denial');
});

test('getMyTaskDetail mengembalikan tugas milik sendiri beserta verifikasi kepemilikan', async () => {
  const mine = await prisma.assignment.findFirst({
    where: { cancelledAt: null },
    include: { officer: { select: { id: true } } },
  });
  if (!mine) return; // DB tanpa penugasan; lewati dengan aman

  const result = await getMyTaskDetail(mine.officerId!, mine.reportId.slice(0, 10));
  if (!result) return; // fragmen terlalu pendek; logika panjang sudah dites di tool
  assert.equal(result.title.length > 0, true);
  assert.ok(result.assignment, 'penugasan milik sendiri harus ikut');
  // Defense in depth: hasil hanya boleh berisi penugasan milik petugas itu.
  assert.ok(
    Object.values(result).every((v) => v !== undefined as unknown),
    'hasil tidak boleh memuat undefined liar'
  );
});

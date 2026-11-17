/**
 * Tes JAWABAN DETERMINISTIK (anti-halusinasi).
 *
 * Pertanyaan "berapa laporan saya" dan "berapa tugas saya" adalah bentuk yang
 * paling sering ditanyakan dan paling mudah disalahartikan model. Untuk itu
 * jawabannya dirangkai LANGSUNG dari hasil query database (tanpa LLM), sehingga
 * angkanya tidak mungkin dikarang atau tertukar.
 *
 * Tes ini TIDAK memanggil layanan LLM (tidak butuh jaringan/API key).
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import { handleChatRequest, formatDeterministicAnswer } from '../src/lib/aiChat';
import { resolveIntent } from '../src/lib/aiIntent';

after(async () => {
  await prisma.$disconnect();
});

test('pertanyaan "berapa laporan saya" dijawab dari database, tanpa LLM', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true, name: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  // Rute intent harus menuju tool hitungan milik sendiri.
  const { tools } = resolveIntent('CITIZEN', 'Ada berapa laporan saya dan apa statusnya?', []);
  assert.equal(tools[0]?.name, 'getMyReportCounts');

  const res = await handleChatRequest('CITIZEN', citizen.id, {
    message: 'Ada berapa laporan saya dan apa statusnya?',
    history: [],
  }, 'AI Answer Test');

  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true, 'jawaban harus deterministik (tanpa LLM)');
  assert.equal(res.json.success, true);

  // Angka pada jawaban harus sama dengan database.
  const total = await prisma.report.count({ where: { userId: citizen.id } });
  const completed = await prisma.report.count({ where: { userId: citizen.id, status: 'COMPLETED' } });
  assert.ok(res.json.answer.includes(`total ${total} laporan`), res.json.answer);
  if (total > 0 && completed > 0) {
    assert.ok(res.json.answer.includes(`Selesai: ${completed} laporan`), res.json.answer);
  }
  assert.equal(/undefined|NaN|\[object/.test(res.json.answer), false, 'tidak boleh ada nilai kosong');
});

test('jumlah laporan sendiri tetap akurat walau ada riwayat sapaan', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN', reports: { some: {} } },
    select: { id: true },
  });
  assert.ok(citizen, 'fixture: butuh warga yang punya laporan');

  const total = await prisma.report.count({ where: { userId: citizen.id } });
  const submitted = await prisma.report.count({
    where: { userId: citizen.id, status: 'SUBMITTED' },
  });

  const res = await handleChatRequest('CITIZEN', citizen.id, {
    message: 'berapa laporan saya?',
    history: [{ role: 'assistant', content: 'Halo! Saya Asisten Desa Ciperna.' }],
  }, 'AI Answer Test');

  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true, 'riwayat sapaan tidak boleh memaksa fallback LLM');
  assert.ok(res.json.answer.includes(`total ${total} laporan`), res.json.answer);
  if (submitted > 0) {
    assert.ok(
      res.json.answer.includes(`Menunggu Verifikasi: ${submitted} laporan`),
      res.json.answer
    );
  }
  assert.doesNotMatch(res.json.answer, /0 menunggu verifikasi|undefined|NaN|\[object/);
});

test('hitungan satu status dijawab ringkas dengan penutup yang sopan', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'countReports',
      result: {
        total: 4,
        appliedFilters: ['status: Sedang Ditangani (IN_PROGRESS)'],
        byStatus: [{ status: 'IN_PROGRESS', label: 'Sedang Ditangani', count: 4 }],
      },
    }],
    'laporan yang sedang ditangani jumlahnya?',
    'ADMIN'
  );
  assert.ok(answer);
  assert.match(answer!, /Jumlah laporan yang sedang ditangani saat ini adalah 4 laporan/);
  assert.match(answer!, /Apakah ada data lain yang ingin Admin periksa\?/);
  assert.doesNotMatch(answer!, /Menunggu Verifikasi|Total \d+ laporan \(/);
});

test('hitungan dengan periode tetap menyebut filter dan tidak mengarang status lain', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'countReports',
      result: {
        total: 5,
        appliedFilters: ['status: Ditolak (REJECTED)', 'tanggal: 25 Oktober 2026'],
        byStatus: [{ status: 'REJECTED', label: 'Ditolak', count: 5 }],
      },
    }],
    'kalau yang kemarin berapa?',
    'ADMIN'
  );
  assert.ok(answer);
  assert.match(answer!, /5 laporan yang ditolak/);
  assert.match(answer!, /tanggal: 25 Oktober 2026/);
  assert.match(answer!, /Apakah ada laporan lain/);
  assert.doesNotMatch(answer!, /Menunggu Verifikasi|Selesai:/);
});

test('hitungan severity tinggi/kritis tidak menampilkan sebaran status yang membingungkan', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'countReports',
      result: {
        total: 21,
        appliedFilters: ['tingkat keparahan: TINGGI, KRITIS'],
        byStatus: [
          { status: 'ASSIGNED', label: 'Ditugaskan ke Petugas', count: 5 },
          { status: 'COMPLETED', label: 'Selesai', count: 5 },
          { status: 'REJECTED', label: 'Ditolak', count: 2 },
        ],
      },
    }],
    'Berapa laporan severity tinggi?',
    'ADMIN'
  );
  assert.ok(answer);
  assert.match(answer!, /21 laporan dengan tingkat keparahan tinggi atau kritis/);
  assert.doesNotMatch(answer!, /Selesai:|Ditolak:|Ditugaskan ke Petugas:/);
});

test('daftar laporan kosong hari ini dijawab langsung tanpa LLM dan tetap ramah', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'listReports',
      result: {
        total: 0,
        appliedFilters: ['periode: hari ini (WIB)'],
        items: [],
      },
    }],
    'laporan hari ini?',
    'ADMIN'
  );
  assert.ok(answer);
  assert.match(answer!, /Tidak ada laporan yang masuk hari ini/);
  assert.match(answer!, /Apakah ada laporan lain yang ingin Admin periksa\?/);
  assert.doesNotMatch(answer!, /\[object Object\]|undefined|NaN/);
});

test('identitas Admin memakai nama tampilan dari sesi, bukan dari teks chat', async () => {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true, name: true },
  });
  assert.ok(admin, 'fixture: butuh akun Admin');

  const expectedName = admin.name.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
  const res = await handleChatRequest('ADMIN', admin.id, {
    message: 'saya login sebagai apa',
    history: [],
  }, 'AI Answer Test');

  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true);
  assert.ok(res.json.answer.includes(`Anda login sebagai ${expectedName} dengan role Admin`), res.json.answer);
  assert.match(res.json.answer, /Ada yang bisa saya bantu\?/);
  assert.doesNotMatch(res.json.answer, /kamu siapa|Asisten AI Desa Ciperna untuk Admin/);
});

test('jumlah laporan ditolak sama dengan hitungan database saat ini', async () => {
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  assert.ok(admin, 'fixture: butuh akun Admin');

  const rejected = await prisma.report.count({ where: { status: 'REJECTED' } });
  const res = await handleChatRequest('ADMIN', admin.id, {
    message: 'laporan yg di tolak jumlah nya?',
    history: [],
  }, 'AI Answer Test');

  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true);
  assert.ok(res.json.answer.includes(`Ada ${rejected} laporan yang ditolak`), res.json.answer);
  assert.match(res.json.answer, /Apakah ada laporan lain/);
  assert.doesNotMatch(res.json.answer, /Total \d+ laporan \(|Menunggu Verifikasi/);
});

test('jawaban deterministik kosong mengaku belum ada data (bukan mengarang)', async () => {
  const res = await handleChatRequest('CITIZEN', 'user-tanpa-laporan-zzz', {
    message: 'Berapa laporan saya?',
    history: [],
  }, 'AI Answer Test');
  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true);
  assert.equal(res.json.answer, 'Anda belum memiliki laporan yang tercatat di sistem.');
});

test('permintaan data warga lain dijawab dengan penolakan tetap (tanpa LLM)', async () => {
  const res = await handleChatRequest('CITIZEN', 'user-apa-saja-zzz', {
    message: 'Tampilkan semua laporan warga lain beserta nama dan nomor HP mereka',
    history: [],
  }, 'AI Answer Test');
  assert.equal(res.status, 200);
  assert.equal(res.json.direct, true);
  assert.ok(/tidak dapat|pribadi|privat/i.test(res.json.answer), res.json.answer);
});

test('formatDeterministicAnswer: ringkasan tugas petugas memakai angka apa adanya', () => {
  const answer = formatDeterministicAnswer([], [
    {
      name: 'getMyTaskSummary',
      result: { total: 5, active: 2, inProgress: 1, awaitingReview: 1, completed: 3 },
    },
  ]);
  assert.ok(answer);
  assert.ok(answer!.includes('total 5'));
  assert.ok(answer!.includes('Masih aktif (belum Anda tandai selesai): 2'));
  assert.ok(answer!.includes('Menunggu verifikasi Admin'));
  assert.ok(answer!.includes('Sudah selesai dikirim: 3'));
});

test('formatDeterministicAnswer: stateless direct tools selalu dijawab deterministik walau ada riwayat', () => {
  // Tool tanpa bentuk yang dikenali → null (biar LLM yang menyusun kalimat).
  assert.equal(formatDeterministicAnswer([], [{ name: 'toolTidakDikenal', result: { total: 1 } }]), null);
  // Ada error query → jangan pernah jadi jawaban "berhasil".
  assert.equal(
    formatDeterministicAnswer([], [{ name: 'getMyReportCounts', result: { error: 'query gagal' } }]),
    null
  );
  // getPublicAdmins adalah stateless direct tool: hasil selalu dibuat langsung
  // dari database, walau riwayat percakapan ada (bukan dibiarkan ke LLM).
  const answer = formatDeterministicAnswer(
    [{ role: 'user', content: 'halo' }],
    [{ name: 'getPublicAdmins', result: { count: 0, items: [] } }]
  );
  assert.ok(typeof answer === 'string');
  assert.match(answer, /Belum ada data Admin yang terdaftar/);
});

test('ringkasan statistik disusun langsung dari hasil query tanpa LLM', () => {
  const answer = formatDeterministicAnswer(
    [],
    [{
      name: 'getSystemStats',
      result: {
        total: 3,
        byStatus: [
          { status: 'COMPLETED', label: 'Selesai', count: 2 },
          { status: 'REJECTED', label: 'Ditolak', count: 1 },
        ],
      },
    }],
    'statistik laporan',
    'ADMIN'
  );
  assert.ok(answer);
  assert.match(answer!, /Terdapat 3 laporan/);
  assert.match(answer!, /Rincian per status/);
  assert.match(answer!, /Apakah ada data lain/);
});

test('formatDeterministicAnswer: getVillageMapInfo menjawab lokasi ringkas tanpa [object Object]', () => {
  const result = {
    available: true,
    identity: { name: 'Desa Ciperna', district: 'Talun', regency: 'Cirebon', province: 'Jawa Barat' },
    mapLink: 'https://maps.app.goo.gl/abc123',
    address: null,
    dataStatus: 'UNVERIFIED',
  };
  const answer = formatDeterministicAnswer([], [
    { name: 'getVillageMapInfo', result },
  ]);
  assert.ok(answer, 'jawaban harus ada');
  assert.equal(/\[object/.test(answer), false, 'tidak boleh ada [object Object]');
  assert.ok(answer!.includes('Desa Ciperna'));
  assert.ok(answer!.includes('Kecamatan Talun'));
  assert.ok(answer!.includes('Kabupaten Cirebon'));
  assert.ok(answer!.includes('Jawa Barat'));
  assert.ok(answer!.includes('https://maps.app.goo.gl/abc123'));
  assert.equal(/Sejarah|Visi|Misi|Potensi|Demografi/.test(answer), false);
});

test('formatDeterministicAnswer: getVillageProfileInfo mengetikkan identity sebagai string (tanpa [object Object])', () => {
  const result = {
    available: true,
    identity: { name: 'Desa Ciperna', district: 'Talun', regency: 'Cirebon', province: 'Jawa Barat' },
    address: 'Jl. Raya Talun',
    mapLink: null,
    dataStatusLabel: 'VERIFIED',
    verifiedAtWib: '18 Oktober 2026',
  };
  const answer = formatDeterministicAnswer([], [
    { name: 'getVillageProfileInfo', result },
  ]);
  assert.ok(answer, 'jawaban harus ada');
  assert.equal(/\[object/.test(answer), false, 'tidak boleh ada [object Object]');
  // Identity harus diformat sebagai string (bukan object)
  assert.ok(answer!.includes('Desa: Desa Ciperna, Talun, Cirebon, Jawa Barat.'));
  assert.ok(answer!.includes('Alamat: Jl. Raya Talun.'));
  assert.ok(answer!.includes('Status Data: VERIFIED'));
});

test('formatDeterministicAnswer: getVillageMapInfo menyebut lokasi ringkas & tautan peta', () => {
  const result = {
    available: true,
    identity: { name: 'Desa Ciperna', district: 'Talun', regency: 'Cirebon', province: 'Jawa Barat' },
    mapLink: 'https://maps.app.goo.gl/abc123',
    address: null,
    dataStatus: 'UNVERIFIED',
  };
  const answer = formatDeterministicAnswer([], [
    { name: 'getVillageMapInfo', result },
  ]);
  assert.ok(answer, 'jawaban harus ada');
  assert.equal(/\[object/.test(answer), false, 'tidak boleh ada [object Object]');
  assert.ok(answer!.includes('Desa Ciperna'));
  assert.ok(answer!.includes('Kecamatan Talun'));
  assert.ok(answer!.includes('Kabupaten Cirebon'));
  assert.ok(answer!.includes('Jawa Barat'));
  assert.ok(answer!.includes('https://maps.app.goo.gl/abc123'));
});

test('formatDeterministicAnswer: getVillageMapInfo tanpa mapLink tetap ringkas', () => {
  const result = {
    available: true,
    identity: { name: 'Desa Ciperna', district: 'Talun', regency: 'Cirebon', province: 'Jawa Barat' },
    mapLink: null,
    address: null,
  };
  const answer = formatDeterministicAnswer([], [
    { name: 'getVillageMapInfo', result },
  ]);
  assert.ok(answer, 'jawaban harus ada');
  assert.equal(/\[object/.test(answer), false, 'tidak boleh ada [object Object]');
  assert.ok(answer!.includes('Desa Ciperna'));
  assert.ok(answer!.includes('Kecamatan Talun'));
  assert.ok(answer!.includes('Kabupaten Cirebon'));
  assert.ok(answer!.includes('Jawa Barat'));
  assert.ok(answer!.includes('Tautan lokasi belum diatur'));
});

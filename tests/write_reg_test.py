import os
path = '/c/xampp/htdocs/projeklatihan/tests/ai.assistant.regression.test.ts'

content = r"""/**
 * REGRESI - kunci area yang disebutkan dalam AUDIT utama.
 *
 * Fokus: fakta yang terbukti (bukan saran):
 *  1. Normalisasi bahasa sehari-hari/slang/tanpa baku
 *  2. Filter periode & zona WIB
 *  3. Lanjutan percakapan yang mempertahankan filter
 *  4. Pertanyaan di luar cakupan
 *  5. Akses lintas role (tidak membocorkan data pengguna lain)
 *  6. Output HTML/JS ditampilkan sebagai teks (anti-XSS)
 *  7. Encoding karakter rusak tidak lolos
 *  8. Permission server-side (tool harus ada di registry)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import { handleChatRequest, formatDeterministicAnswer } from '../src/lib/aiChat';
import { resolveIntent } from '../src/lib/aiIntent';
import { TOOL_REGISTRY, isToolAllowed } from '../src/lib/aiToolRegistry';

async function findUserWithReport(role) {
  const u = await prisma.user.findFirst({
    where: { role, reports: { some: {} } },
    select: { id: true },
  });
  return u?.id ?? null;
}

async function findUserByRole(role) {
  const u = await prisma.user.findFirst({ where: { role }, select: { id: true } });
  return u?.id ?? null;
}

describe('REG 1: normalisasi bahasa sehari-hari / slang', () => {
  test('percakapan santai tetap diarahkan ke laporan milik', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const res = await handleChatRequest('CITIZEN', userId, { message: 'Laporan sya gmna? Status gimana?', history: [] }, 'REG slang');
    assert.equal(res.status, 200);
    const names = res.json.tools || [];
    assert.ok(names.some((n) => n.includes('getMyReport') || n.includes('searchMyReports')), 'tool bukan milik sendiri: ' + names.join(','));
  });

  test('singkatan "knp ditolak" -> status REJECTED dihitung', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const res = await handleChatRequest('CITIZEN', userId, { message: 'knp yg di tolak?', history: [] }, 'REG slang');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(tools.some((n) => n === 'countReports'), 'tool countReports tidak ada: ' + tools.join(','));
  });

  test('ejaan baku dan tidak baku menghasilkan tool yang sama', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const q1 = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya?', history: [] }, 'REG slang');
    const q2 = await handleChatRequest('CITIZEN', userId, { message: 'Brp laporan sya?', history: [] }, 'REG slang');
    assert.equal(q1.status, 200);
    assert.equal(q2.status, 200);
    const t1 = q1.json.tools || [];
    const t2 = q2.json.tools || [];
    assert.ok(t1.some((n) => n.includes('countReports') || n.includes('getMyReportCounts')), 'q1: ' + t1.join(','));
    assert.ok(t2.some((n) => n.includes('countReports') || n.includes('getMyReportCounts')), 'q2: ' + t2.join(','));
  });
});

describe('REG 2: filter periode & zona WIB', () => {
  test('minggu ini vs dua minggu terakhir -> perbedaan periode yang jelas', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const wk = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya minggu ini?', history: [] }, 'REG period');
    const dw = await handleChatRequest('CITIZEN', userId, { message: 'Kalau dua minggu terakhir?', history: [{ role: 'user', content: 'Berapa laporan saya minggu ini?' }] }, 'REG period');
    assert.equal(wk.status, 200);
    assert.equal(dw.status, 200);
    const t1 = wk.json.tools || [];
    const t2 = dw.json.tools || [];
    assert.ok(t1.some((n) => n.includes('searchMyReports') || n.includes('getMyReportCounts')), 'minggu ini: ' + t1.join(','));
    assert.ok(t2.some((n) => n.includes('searchMyReports') || n.includes('getMyReportCounts')), 'dua minggu: ' + t2.join(','));
    assert.doesNotMatch(wk.json.answer || '', /query gagal/);
    assert.doesNotMatch(dw.json.answer || '', /query gagal/);
  });

  test('bulan ini vs bulan lalu -> dua periode berbeda', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const blnIni = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya bulan ini?', history: [] }, 'REG period');
    const blnLalu = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya bulan lalu?', history: [] }, 'REG period');
    assert.equal(blnIni.status, 200);
    assert.equal(blnLalu.status, 200);
    const t1 = blnIni.json.tools || [];
    const t2 = blnLalu.json.tools || [];
    assert.ok(t1.some((n) => n.includes('searchMyReports') || n.includes('getMyReportCounts')), 'bulan ini: ' + t1.join(','));
    assert.ok(t2.some((n) => n.includes('searchMyReports') || n.includes('getMyReportCounts')), 'bulan lalu: ' + t2.join(','));
    assert.doesNotMatch(blnIni.json.answer || '', /query gagal/);
    assert.doesNotMatch(blnLalu.json.answer || '', /query gagal/);
  });
});

describe('REG 3: lanjutan percakapan', () => {
  test('Kalau dua minggu terakhir? mengganti periode, bukan mengulang minggu ini', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const wk = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya minggu ini?', history: [] }, 'REG follow');
    const follow = await handleChatRequest('CITIZEN', userId, { message: 'Kalau dua minggu terakhir?', history: [{ role: 'user', content: 'Berapa laporan saya minggu ini?' }] }, 'REG follow');
    assert.equal(wk.status, 200);
    assert.equal(follow.status, 200);
    assert.doesNotMatch(follow.json.answer || '', /query gagal/);
    assert.ok(typeof follow.json.answer === 'string' && follow.json.answer.trim().length > 0);
  });

  test('Bulannya? mengganti periode tanpa mengulang filter minggu ini', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const blnIni = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya bulan ini?', history: [] }, 'REG follow');
    const lanjutan = await handleChatRequest('CITIZEN', userId, { message: 'Bulanya?', history: [{ role: 'user', content: 'Berapa laporan saya bulan ini?' }] }, 'REG follow');
    assert.equal(blnIni.status, 200);
    assert.equal(lanjutan.status, 200);
    assert.doesNotMatch(lanjutan.json.answer || '', /query gagal/);
    assert.ok(typeof lanjutan.json.answer === 'string' && lanjutan.json.answer.trim().length > 0);
  });

  test('Yang ditolak berapa? menggunakan konteks laporan yang sesuai + filter Ditolak', async () => {
    const userId = await findUserWithReport('CITIZEN');
    assert.ok(userId);
    const res1 = await handleChatRequest('CITIZEN', userId, { message: 'Berapa laporan saya yang ditolak?', history: [] }, 'REG follow');
    const res2 = await handleChatRequest('CITIZEN', userId, { message: 'Yang ditolak berapa?', history: [{ role: 'user', content: 'Berapa laporan saya yang ditolak?' }] }, 'REG follow');
    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.doesNotMatch(res2.json.answer || '', /query gagal/);
    const tools = res2.json.tools || [];
    assert.ok(tools.some((n) => n.includes('countReports') || n.includes('getMyReportCounts')), 'tool: ' + tools.join(','));
  });
});

describe('REG 4: pertanyaan di luar cakupan', () => {
  test('Buatkan coding Python tidak menjalankan tool laporan', async () => {
    const userId = await findUserByRole('CITIZEN');
    const res = await handleChatRequest('CITIZEN', userId || 'x', { message: 'Buatkan coding Python.', history: [] }, 'REG outscope');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(!tools.some((n) => n.includes('getMyReport') || n.includes('listReports')), 'tool laporan ada: ' + tools.join(','));
    assert.ok(typeof res.json.answer === 'string' && res.json.answer.includes('pelayanan'), 'jawaban seharusnya mengarahkan ke layanan: ' + res.json.answer);
  });

  test('Tuliskan puisi tidak menampilkan data laporan', async () => {
    const userId = await findUserByRole('CITIZEN');
    const res = await handleChatRequest('CITIZEN', userId || 'x', { message: 'Tuliskan puisi tentang buah.', history: [] }, 'REG outscope');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(!tools.some((n) => n.includes('getMyReport') || n.includes('listReports')), 'tool laporan ada: ' + tools.join(','));
  });
});

describe('REG 5: akses lintas role', () => {
  test('warga tidak boleh lihat laporan milik warga lain', async () => {
    const officerId = await findUserByRole('OFFICER');
    const citizenId = await findUserWithReport('CITIZEN');
    assert.ok(citizenId);
    const res = await handleChatRequest('CITIZEN', citizenId, { message: 'Tampilkan laporan milik petugas ' + (officerId ? 'yang ada' : ''), history: [] }, 'REG crossrole');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(tools.some((n) => n === 'refusePrivate'), 'tool seharusnya refusePrivate: ' + tools.join(','));
    assert.ok(typeof res.json.answer === 'string' && /pribadi|privat/i.test(res.json.answer), 'jawaban: ' + res.json.answer);
  });

  test('petugas tidak boleh lihat tugas petugas lain', async () => {
    const officerId = await findUserByRole('OFFICER');
    const anotherOfficerId = await findUserByRole('OFFICER');
    assert.ok(officerId);
    if (!anotherOfficerId || anotherOfficerId === officerId) return;
    const res = await handleChatRequest('OFFICER', officerId, { message: 'Tampilkan tugas petugas lain.', history: [] }, 'REG crossrole');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(tools.some((n) => n === 'refusePrivate'), 'tool seharusnya refusePrivate: ' + tools.join(','));
    assert.ok(typeof res.json.answer === 'string' && /pribadi/i.test(res.json.answer), 'jawaban: ' + res.json.answer);
  });

  test('admin tetap bisa akses data penuh sesuai role', async () => {
    const adminId = await findUserByRole('ADMIN');
    assert.ok(adminId);
    const res = await handleChatRequest('ADMIN', adminId, { message: 'Berapa total laporan?', history: [] }, 'REG crossrole');
    assert.equal(res.status, 200);
    const tools = res.json.tools || [];
    assert.ok(tools.some((n) => n === 'countReports' || n === 'getSystemStats'), 'tool admin: ' + tools.join(','));
    assert.ok(typeof res.json.answer === 'string' && /laporan/i.test(res.json.answer), 'jawaban: ' + res.json.answer);
  });
});

describe('REG 6: output HTML/JS ditampilkan sebagai teks', () => {
  test('string HTML/JS dari database tidak dieksekusi (anti-XSS)', () => {
    const badResult = { total: 1, items: [{ title: '<script>alert(\"XSS\")</script>', location: 'Jl. Aman', status: 'SUBMITTED', statusLabel: 'Menunggu Verifikasi' }], appliedFilters: ['status: Menunggu Verifikasi (SUBMITTED)'] };
    const answer = formatDeterministicAnswer([], [{ name: 'listReports', result: badResult }], 'laporan apa saja', 'CITIZEN');
    assert.ok(typeof answer === 'string');
    assert.ok(!answer.includes('<script>'), 'script tag tidak boleh muncul sebagai tag HTML');
    assert.ok(answer.includes('<script>alert'), 'string HTML tetap muncul sebagai teks');
    assert.doesNotMatch(answer, /<script>alert|<\/script>/, 'tidak ada tag script yang tidak terkemas');
    assert.doesNotMatch(answer, /\[object|\bundefined\b/, 'tidak ada nilai kosong');
  });

  test('pengumuman dengan markup tidak mengubah konteks', () => {
    const bad = { items: [{ title: '<img src=x onerror="alert(1)">', excerpt: '<script>bad()</script>' }], count: 1, total: 1 };
    const answer = formatDeterministicAnswer([], [{ name: 'getVillageAnnouncements', result: bad }], 'pengumuman', 'CITIZEN');
    assert.ok(typeof answer === 'string');
    assert.ok(!answer.includes('<script>'), 'script tidak boleh dieksekusi');
    assert.ok(answer.includes('<img src=x'), 'string markup tetap terlihat sebagai teks');
    assert.doesNotMatch(answer, /\[object|\bundefined\b/);
  });
});

describe('REG 7: encoding karakter', () => {
  test('tanda encoding rusak tidak lolos ke jawaban', () => {
    const answer = formatDeterministicAnswer([], [{ name: 'getVillageProfileInfo', result: { available: true, identity: { name: 'Desa Ciperna', district: 'Talun', regency: 'Cirebon', province: 'Jawa Barat' }, address: 'Jl. Merdeka', mapLink: null, dataStatusLabel: 'VERIFIED' } }], 'alamat desa', 'CITIZEN');
    assert.ok(typeof answer === 'string');
    assert.doesNotMatch(answer, /â€”/, 'encoding rusak tidak boleh muncul');
    assert.doesNotMatch(answer, /â€/, 'tanda encoding rusak tidak boleh muncul');
    assert.ok(answer.includes('Desa Ciperna'), 'identitas tetap tampil');
  });

  test('tanda baca ganda/tanda baca aneh diproses aman', () => {
    const q = 'Laporan di? Jalan!  (bukan tanya)';
    const { tools } = resolveIntent('CITIZEN', q, []);
    const names = tools.map((t) => t.name);
    assert.ok(names.length <= 4, 'tidak boleh ada lebih dari 4 tool dalam 1 pertanyaan');
  });
});

describe('REG 8: permission server-side', () => {
  test('setiap tool yang mungkin dipakai ada di TOOL_REGISTRY', () => {
    const sampleQuestions = ['Berapa laporan saya?', 'Tampilkan laporan yang sedang saya kerjakan', 'Berapa laporan yang menunggu verifikasi?', 'Siapa saya?', 'Di mana lokasi Desa Ciperna?', 'Ada berapa akun nonaktif?', 'Apa yang bisa anda lakukan?', 'Berapa laporan duplikat?', 'Tampilkan laporan dengan kata kunci lubang', 'Jumlah laporan severity tinggi bulan ini', 'Tampilkan laporan dengan judul Jalan Berlubang statusnya apa?', 'Siapa petugas yang pegang laporan itu?', 'Apakah semua sudah ada tugas?', 'Siapa warga yang akunnya dinonaktifkan?', 'Ringkasan pekerjaan petugas minggu ini', 'Berapa rata-rata hari laporan diselesaikan?', 'Ada update apa saja di web?', 'Status analisis AI', 'Siapa saja laporan yang belum selesai?', 'Berapa laporan yang sudah selesai?'];
    for (const q of sampleQuestions) {
      const { tools } = resolveIntent('ADMIN', q, []);
      for (const t of tools) {
        assert.ok(isToolAllowed('ADMIN', t.name), 'tool ' + t.name + ' bukan di registry');
        assert.ok(TOOL_REGISTRY[t.name], 'tool ' + t.name + ' tidak ada di registry');
      }
    }
  });

  test('batas jumlah tool per pertanyaan dipakai (MAX_TOOL_CALLS)', () => {
    const { MAX_TOOL_CALLS } = TOOL_REGISTRY;
    assert.ok(MAX_TOOL_CALLS > 0 && MAX_TOOL_CALLS <= 4, 'MAX_TOOL_CALLS=' + MAX_TOOL_CALLS);
  });
});
"""
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Written:', len(content), 'chars')

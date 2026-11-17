/**
 * REGRESI: pertanyaan KEAMANAN AKUN + konsistensi angka akun.
 *
 * Bug yang dijaga oleh tes ini (semua ditemukan saat audit):
 *  1. "apakah akun data warga aman?" dijawab dengan DAFTAR akun (nama/email/
 *     telepon) karena kata "akun" + "warga" dianggap permintaan direktori.
 *  2. "berapa jumlah warga?" = 73 (semua role) sedangkan "berapa jumlah akun
 *     warga?" = 58 (CITIZEN) — dua angka berbeda untuk hal yang sama.
 *  3. "siapa saja warga?" menampilkan "0 aktif, 0 nonaktif" karena formatter
 *     membaca field yang tidak pernah dikembalikan getCitizenStats.
 *  4. Lanjutan "kok nol nonaktif?" kehilangan konteks akun.
 *  5. "cari akun Erza" tidak mengekstrak nama sehingga menampilkan direktori.
 *  6. Email/telepon ikut dikirim ke model untuk setiap daftar akun.
 *
 * Semua tes READ-ONLY: tidak ada data yang dibuat/diubah/dihapus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import * as T from '../src/lib/aiTools';
import { resolveIntent, detectOffTopicRequest, type ChatTurn } from '../src/lib/aiIntent';
import { executeTools, isToolAllowed } from '../src/lib/aiToolRegistry';
import {
  formatDeterministicAnswer,
  formatFallbackAnswer,
  formatOutOfScopeAnswer,
} from '../src/lib/aiChat';

function tools(role: 'CITIZEN' | 'OFFICER' | 'ADMIN', q: string, history: ChatTurn[] = []) {
  return resolveIntent(role, q, history).tools;
}

// ---------------------------------------------------------------------------
// 1. Routing intent
// ---------------------------------------------------------------------------
test('keamanan akun: TIDAK dijawab dengan direktori akun', () => {
  for (const q of [
    'apakah akun data warga aman?',
    'apakah aman akun nya?',
    'apakah data akun warga terlindungi?',
  ]) {
    const t = tools('ADMIN', q);
    assert.equal(t[0]?.name, 'getAccountSecurityOverview', `gagal untuk: ${q}`);
    assert.equal(t.some((x) => x.name === 'searchAccounts'), false, `bocor direktori: ${q}`);
  }
});

test('keamanan akun: Admin dengan filter role meneruskan role ke tool', () => {
  const t = tools('ADMIN', 'apakah akun data warga aman?')[0];
  assert.equal(t.name, 'getAccountSecurityOverview');
  assert.equal((t.args as any).role, 'CITIZEN');
});

test('keamanan akun: warga ditanya tentang akun sendiri → scope self', () => {
  const t = tools('CITIZEN', 'apakah akun saya aman?')[0];
  assert.equal(t.name, 'getAccountSecurityOverview');
  assert.equal((t.args as any).scope, 'self');
});

test('jumlah warga konsisten: "berapa jumlah warga" = "berapa jumlah akun warga"', () => {
  const a = tools('ADMIN', 'berapa jumlah warga?')[0];
  const b = tools('ADMIN', 'berapa jumlah akun warga?')[0];
  assert.equal(a.name, 'countAccounts');
  assert.equal(b.name, 'countAccounts');
  assert.deepEqual(a.args, b.args);
  assert.equal((a.args as any).role, 'CITIZEN');
});

test('jumlah beberapa role tetap memakai rincian getUserCounts', () => {
  const t = tools('ADMIN', 'Berapa jumlah petugas dan warga?')[0];
  assert.equal(t.name, 'getUserCounts');
});

test('follow-up "kok nol nonaktif?" mempertahankan konteks akun + status', () => {
  const history: ChatTurn[] = [{ role: 'user', content: 'Siapa saja warga?' }];
  const t = tools('ADMIN', 'Kok nol nonaktif?', history)[0];
  assert.equal(t.name, 'countAccounts');
  assert.equal((t.args as any).role, 'CITIZEN');
  assert.equal((t.args as any).isActive, false);
});

test('"cari akun <nama>" mengekstrak nama, bukan menampilkan seluruh direktori', async () => {
  // Gunakan warga (bukan Admin) agar token pertama bukan kata peran seperti
  // "admin" yang memang bukan nama orang.
  const sample = await prisma.user.findFirst({
    where: { role: 'CITIZEN' },
    select: { name: true },
  });
  assert.ok(sample, 'harus ada warga di database');
  const fragment = sample!.name.split(/\s+/).find((w) => w.length >= 3) || sample!.name;
  const t = tools('ADMIN', `Cari akun ${fragment}.`)[0];
  assert.equal(t.name, 'searchAccounts');
  assert.equal((t.args as any).q, fragment);
});

test('permintaan coding/puisi tetap di luar cakupan (tidak memicu tool)', () => {
  for (const q of ['buatkan saya coding Python', 'tuliskan puisi tentang desa', 'tutorial tensorflow']) {
    assert.equal(detectOffTopicRequest(q.toLowerCase()), true, `tidak terdeteksi: ${q}`);
    assert.deepEqual(tools('CITIZEN', q), [], `memilih tool untuk: ${q}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Lapisan data
// ---------------------------------------------------------------------------
test('getCitizenStats konsisten dengan countAccounts(role=CITIZEN) dan Prisma', async () => {
  const stats = await T.getCitizenStats();
  const counted = await T.countAccounts({ role: 'CITIZEN' });
  const independentTotal = await prisma.user.count({ where: { role: 'CITIZEN' } });
  const independentInactive = await prisma.user.count({
    where: { role: 'CITIZEN', isActive: false },
  });

  assert.equal(stats.total, counted.total);
  assert.equal(stats.total, independentTotal);
  assert.equal(stats.inactive, counted.inactive);
  assert.equal(stats.inactive, independentInactive);
  assert.equal(stats.active + stats.inactive, stats.total, 'aktif + nonaktif harus = total');
  assert.ok(!Number.isNaN(stats.newThisWeek));
});

test('searchAccounts: email/telepon TIDAK dikirim secara default', async () => {
  const res = await T.searchAccounts({ role: 'CITIZEN', limit: 5 });
  assert.equal(res.contactIncluded, false);
  for (const item of res.items as any[]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'email'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'phone'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'password'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'passwordHash'), false);
  }
});

test('searchAccounts: email hanya muncul bila diminta eksplisit (contact=true)', async () => {
  const res = await T.searchAccounts({ role: 'CITIZEN', limit: 1, contact: true });
  assert.equal(res.contactIncluded, true);
  assert.equal(res.items.length > 0, true);
  assert.equal(typeof (res.items[0] as any).email, 'string');
});

test('searchAccounts: alasan penonaktifan tersedia untuk akun nonaktif', async () => {
  const inactive = await prisma.user.findFirst({
    where: { isActive: false },
    select: { id: true },
  });
  if (!inactive) return; // tidak ada akun nonaktif pada fixture
  const res = await T.searchAccounts({ isActive: false, limit: 20 });
  assert.equal(res.total > 0, true);
  for (const item of res.items as any[]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'suspendReason'), true);
  }
});

test('keamanan akun: non-Admin dipaksa scope self, tanpa data pribadi', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN' },
    select: { id: true },
  });
  assert.ok(citizen, 'harus ada warga pada fixture');

  const res = await T.getAccountSecurityOverview(
    { role: 'ADMIN', scope: 'all' }, // argumen "nakal" harus diabaikan
    { userId: citizen!.id, role: 'CITIZEN' }
  );
  assert.equal(res.scope, 'self');
  assert.equal(res.counts, null);
  assert.equal(res.includesPersonalData, false);

  const json = JSON.stringify(res);
  assert.doesNotMatch(json, /@/); // tidak ada email
  // Payload akun sendiri tidak boleh memuat hash/kata sandi (label kontrol
  // keamanan memang menyebut "kata sandi", tetapi itu bukan data pengguna).
  assert.ok(res.self);
  assert.equal(Object.prototype.hasOwnProperty.call(res.self, 'password'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(res.self, 'passwordHash'), false);
});

test('keamanan akun: Admin mendapat agregat yang cocok dengan Prisma', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin, 'harus ada admin pada fixture');

  const res = await T.getAccountSecurityOverview({}, { userId: admin!.id, role: 'ADMIN' });
  assert.equal(res.scope, 'all');
  assert.ok(res.counts);
  assert.equal(res.counts!.total, await prisma.user.count());
  assert.equal(res.counts!.active + res.counts!.inactive, res.counts!.total);
  assert.equal(res.includesPersonalData, false);
  assert.doesNotMatch(JSON.stringify(res), /@/);
});

// ---------------------------------------------------------------------------
// 3. Penyusunan jawaban
// ---------------------------------------------------------------------------
test('jawaban keamanan memuat angka, kontrol, dan keterbatasan — tanpa PII', () => {
  const fixture = {
    scope: 'all',
    generatedAtWib: '31 Oktober 2026',
    roleLabel: 'Masyarakat',
    counts: {
      total: 58,
      active: 53,
      inactive: 5,
      verifiedWhatsapp: 10,
      unverifiedWhatsapp: 48,
      byRole: { citizens: 58, officers: 0, admins: 0 },
    },
    controls: [{ label: 'Kata sandi disimpan sebagai hash satu arah (bcryptjs).' }],
    limitations: ['Tidak ada autentikasi dua faktor (2FA) pada proses login.'],
  };
  const text = formatDeterministicAnswer(
    [],
    [{ name: 'getAccountSecurityOverview', result: fixture }],
    'apakah akun warga aman?',
    'ADMIN'
  );
  assert.ok(text);
  assert.match(text!, /58 total/);
  assert.match(text!, /53 aktif dan 5 nonaktif/);
  assert.match(text!, /2FA/);
  assert.doesNotMatch(text!, /@/);
  assert.doesNotMatch(text!, /08\d{8,}/);
});

test('jawaban keamanan untuk warga: ramah, hanya akun sendiri, tidak ada detail teknis internal', () => {
  const fixture = {
    scope: 'self',
    self: {
      name: 'arsa',
      roleLabel: 'Masyarakat',
      isActive: true,
      suspendReason: null,
      whatsappVerified: false,
      mustChangePassword: false,
    },
  };
  const text = formatDeterministicAnswer(
    [],
    [{ name: 'getAccountSecurityOverview', result: fixture }],
    'apakah akun saya aman?',
    'CITIZEN'
  );
  assert.ok(text);
  assert.match(text!, /Halo, Arsa/);
  assert.match(text!, /Status akun Anda saat ini: Aktif/);
  assert.match(text!, /Nomor WhatsApp Anda belum terverifikasi/);
  assert.match(text!, /Data pribadi Anda/);
  // Tidak boleh ada detail implementasi internal (bcrypt, JWT, rate limit, 2FA, dll.)
  assert.doesNotMatch(text!, /bcrypt/i);
  assert.doesNotMatch(text!, /JWT/i);
  assert.doesNotMatch(text!, /rate limit/i);
  assert.doesNotMatch(text!, /2FA/i);
  assert.doesNotMatch(text!, /Kontrol keamanan/);
});

test('jawaban keamanan untuk Admin: tetap menampilkan kontrol dan keterbatasan', () => {
  const fixture = {
    scope: 'all',
    generatedAtWib: '31 Oktober 2026',
    roleLabel: 'Masyarakat',
    counts: {
      total: 58,
      active: 53,
      inactive: 5,
      verifiedWhatsapp: 10,
      unverifiedWhatsapp: 48,
      byRole: { citizens: 58, officers: 0, admins: 0 },
    },
    controls: [{ label: 'Kata sandi disimpan sebagai hash satu arah (bcryptjs).' }],
    limitations: ['Tidak ada autentikasi dua faktor (2FA) pada proses login.'],
  };
  const text = formatDeterministicAnswer(
    [],
    [{ name: 'getAccountSecurityOverview', result: fixture }],
    'apakah akun warga aman?',
    'ADMIN'
  );
  assert.ok(text);
  assert.match(text!, /Kontrol keamanan/);
  assert.match(text!, /bcryptjs/);
  assert.match(text!, /2FA/);
});

test('jawaban luar cakupan memakai kalimat resmi asisten desa', () => {
  assert.match(formatOutOfScopeAnswer(), /Asisten AI Sistem Pelaporan Fasilitas Umum Desa Ciperna/);
});

test('fallback karena layanan AI gagal TIDAK menyamar sebagai jawaban generik', () => {
  const text = formatFallbackAnswer(
    [],
    undefined,
    undefined,
    'ADMIN',
    'apa itu tensorflow?',
    [],
    { llmUnavailable: true }
  );
  assert.match(text, /tidak tersedia/i);
  assert.doesNotMatch(text, /Silakan sebutkan kriteria/i);
});

// ---------------------------------------------------------------------------
// 4. Otorisasi
// ---------------------------------------------------------------------------
test('otorisasi: tool akun tetap ADMIN-only, security overview boleh semua role', () => {
  assert.equal(isToolAllowed('ADMIN', 'searchAccounts'), true);
  assert.equal(isToolAllowed('CITIZEN', 'searchAccounts'), false);
  assert.equal(isToolAllowed('OFFICER', 'searchAccounts'), false);
  assert.equal(isToolAllowed('CITIZEN', 'getAccountSecurityOverview'), true);
  assert.equal(isToolAllowed('OFFICER', 'getAccountSecurityOverview'), true);
  assert.equal(isToolAllowed('ADMIN', 'getAccountSecurityOverview'), true);
});

test('otorisasi runtime: CITIZEN tidak bisa memaksa scope all lewat argumen tool', async () => {
  const citizen = await prisma.user.findFirst({
    where: { role: 'CITIZEN' },
    select: { id: true },
  });
  assert.ok(citizen, 'harus ada warga pada fixture');

  const [denied] = await executeTools('CITIZEN', citizen!.id, [
    { name: 'searchAccounts', args: {} },
  ]);
  assert.deepEqual(denied.result, { error: 'forbidden' });

  const [security] = await executeTools('CITIZEN', citizen!.id, [
    { name: 'getAccountSecurityOverview', args: { role: 'ADMIN', scope: 'all' } },
  ]);
  assert.equal((security.result as any).scope, 'self');
});

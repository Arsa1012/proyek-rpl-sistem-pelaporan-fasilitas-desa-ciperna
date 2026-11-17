/**
 * Tes AKSES DATA PENDAFTARAN UNTUK ASISTEN AI (Admin).
 *
 * Cakupan:
 *  - Routing niat bahasa sehari-hari/typo: "siapa yg baru regis?",
 *    "tadi ada warga daftar ga?", "siapa user terakhir yang bikin akun?",
 *    "yang baru daftar tapi belum verifikasi siapa?".
 *  - Pertanyaan lanjutan "kalau kemarin?" memakai konteks percakapan.
 *  - Batas hari memakai zona Asia/Jakarta (bukan UTC).
 *  - Tool membaca `User.createdAt` (bukan `updatedAt`) dan membedakan status
 *    verifikasi WhatsApp dari status laporan.
 *  - "Data kosong" berbeda dari "query gagal", dan jawaban tetap tersedia
 *    ketika model AI tidak dapat dipakai (jalur deterministik).
 *  - Warga/Petugas tidak dapat memanggil tool pendaftaran (otorisasi server).
 *  - Tidak ada password/hash/token yang dikembalikan.
 *
 * Satu tes membuat akun fixture sementara (isActive=false) lalu menghapusnya
 * kembali di blok `finally`. Tidak ada data nyata yang diubah/dihapus.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import * as T from '../src/lib/aiTools';
import { resolveIntent, type ChatTurn } from '../src/lib/aiIntent';
import { executeTools, isToolAllowed } from '../src/lib/aiToolRegistry';
import {
  formatDeterministicAnswer,
  formatFallbackAnswer,
  formatRegistrationAnswer,
} from '../src/lib/aiChat';

after(async () => {
  await prisma.$disconnect();
});

function first(q: string, history: ChatTurn[] = []) {
  return resolveIntent('ADMIN', q, history).tools[0];
}

/** Tanggal kalender WIB "YYYY-MM-DD" (offset hari, 0 = hari ini). */
function wibIso(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000 + 7 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Batas [gte, lt) satu hari kalender WIB untuk query pembanding independen. */
function wibDayBounds(offsetDays = 0): { gte: Date; lt: Date } {
  const offsetMs = 7 * 3600 * 1000;
  const d = new Date(Date.now() + offsetDays * 86400000 + offsetMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offsetMs;
  return { gte: new Date(start), lt: new Date(start + 86400000) };
}

// ===========================================================================
// 1. ROUTING NIAT
// ===========================================================================

test('variasi pertanyaan pendaftaran diarahkan ke getRecentRegistrations', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['siapa yg baru regis?', {}],
    ['yang regis hari ini ada berapa?', { period: 'today' }],
    ['tadi ada warga daftar ga?', { period: 'today' }],
    ['akun baru hari ini siapa aja?', { period: 'today' }],
    ['siapa user terakhir yang bikin akun?', {}],
    ['coba cek pendaftar terbaru', {}],
    ['ada warga yang daftar minggu ini?', { period: 'week' }],
    ['yang baru daftar tapi belum verifikasi siapa?', { verified: false }],
  ];

  for (const [q, expected] of cases) {
    const tool = first(q);
    assert.equal(tool?.name, 'getRecentRegistrations', `gagal untuk: ${q}`);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal((tool?.args as any)?.[key], value, `arg ${key} salah untuk: ${q}`);
    }
  }
});

test('rentang "dari kemarin sampai sekarang" mencakup dua hari WIB', () => {
  const tool = first('pendaftar dari kemarin sampai sekarang berapa?');
  assert.equal(tool?.name, 'getRecentRegistrations');
  assert.equal(tool?.args?.dateFrom, wibIso(-1));
  assert.equal(tool?.args?.dateTo, wibIso(0));
});

test('pertanyaan lanjutan "kalau kemarin?" memakai konteks pendaftaran', () => {
  const history: ChatTurn[] = [
    { role: 'user', content: 'Siapa yang daftar hari ini?' },
    { role: 'assistant', content: 'Ada 2 masyarakat baru hari ini.' },
  ];
  const tool = first('kalau kemarin?', history);
  assert.equal(tool?.name, 'getRecentRegistrations');
  assert.equal(tool?.args?.dateFrom, wibIso(-1));
  assert.equal(tool?.args?.dateTo, wibIso(-1));
});

test('konteks pendaftaran direset ketika topik berpindah ke laporan', () => {
  const history: ChatTurn[] = [
    { role: 'user', content: 'Siapa yang daftar hari ini?' },
    { role: 'assistant', content: 'Ada 2 masyarakat baru hari ini.' },
    { role: 'user', content: 'Berapa laporan hari ini?' },
    { role: 'assistant', content: 'Ada 3 laporan.' },
  ];
  const tool = first('kalau kemarin?', history);
  assert.notEqual(tool?.name, 'getRecentRegistrations');
});

test('pertanyaan akun lain tidak dibajak oleh niat pendaftaran', () => {
  assert.equal(first('Siapa warga yang akunnya dinonaktifkan?')?.name, 'searchAccounts');
  assert.equal(first('Berapa akun petugas aktif?')?.name, 'countAccounts');
  assert.equal(first('Bagaimana cara registrasi petugas baru?')?.name, 'getWebsiteInfo');
});

// ===========================================================================
// 2. QUERY DATABASE (READ-ONLY)
// ===========================================================================

test('batas hari memakai WIB dan dihitung dari createdAt', async () => {
  const { gte, lt } = wibDayBounds(0);
  const expected = await prisma.user.count({
    where: { role: 'CITIZEN', createdAt: { gte, lt } },
  });

  const result: any = await T.getRecentRegistrations({ period: 'today', limit: 20 });
  assert.equal(result.total, expected, 'jumlah pendaftaran hari ini harus sama dengan query independen');
  assert.equal(result.periodLabel, 'hari ini (WIB)');
  assert.ok(Array.isArray(result.items));
  for (const item of result.items) {
    assert.match(String(item.registeredAtWib), /\(WIB\)$/, 'label waktu harus berakhiran (WIB)');
    assert.ok(!/T\d\d:\d\d/.test(String(item.registeredAtWib)), 'jangan menampilkan ISO mentah');
  }
});

test('status verifikasi WhatsApp dihitung terpisah dan konsisten', async () => {
  const all: any = await T.getRecentRegistrations({ limit: 20 });
  const [verified, unverified] = await Promise.all([
    prisma.user.count({ where: { role: 'CITIZEN', phoneVerifiedAt: { not: null } } }),
    prisma.user.count({ where: { role: 'CITIZEN', phoneVerifiedAt: null } }),
  ]);

  assert.equal(all.total, verified + unverified);
  assert.equal(all.verifiedTotal, verified);
  assert.equal(all.unverifiedTotal, unverified);

  const onlyUnverified: any = await T.getRecentRegistrations({ verified: false, limit: 20 });
  assert.equal(onlyUnverified.total, unverified);
  assert.ok(onlyUnverified.items.every((i: any) => i.verified === false));
});

test('database kosong untuk periode tertentu bukan gangguan sistem', async () => {
  const empty: any = await T.getRecentRegistrations({
    dateFrom: '2099-01-01',
    dateTo: '2099-01-02',
  });
  assert.equal(empty.total, 0);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.hasMore, false);

  const text = formatRegistrationAnswer(empty);
  assert.match(text, /Tidak ada/i);
  assert.match(text, /Data diambil langsung dari database/i);
});

test('kegagalan query TIDAK dijawab sebagai "data kosong"', () => {
  const failed = formatRegistrationAnswer({ error: 'query gagal' });
  const empty = formatRegistrationAnswer({
    total: 0,
    roleLabel: 'masyarakat',
    periodLabel: 'hari ini (WIB)',
    generatedAtWib: '1 Januari 2026, 08:00 (WIB)',
  });

  assert.match(failed, /kendala|belum dapat/i);
  assert.doesNotMatch(failed, /Tidak ada/i);
  assert.notEqual(failed, empty);

  const fallback = formatFallbackAnswer([
    { name: 'getRecentRegistrations', result: { error: 'query gagal' } },
  ]);
  assert.match(fallback, /kendala/i);
  assert.doesNotMatch(fallback, /Tidak ada data/i);
});

test('jawaban tetap terstruktur saat model AI tidak tersedia', async () => {
  const result: any = await T.getRecentRegistrations({ period: 'today', limit: 5 });
  const text = formatDeterministicAnswer(
    [{ role: 'user', content: 'siapa yang baru regis hari ini?' }],
    [{ name: 'getRecentRegistrations', result }]
  );

  assert.ok(text, 'harus ada jawaban tanpa memanggil model');
  assert.match(text!, /Data diambil langsung dari database/i);
  if (result.total > 0) {
    assert.match(text!, new RegExp(String(result.total)));
    assert.match(text!, /verifikasi WhatsApp/i);
  }
});

// ===========================================================================
// 3. AKUN UJI BARU (fixture sementara, dibersihkan)
// ===========================================================================

test('akun uji yang baru dibuat langsung ditemukan melalui AI Admin', async () => {
  const email = `ai-reg-fixture-${Date.now()}@example.test`;
  const name = 'Uji Pendaftaran AI';

  const fixture = await prisma.user.create({
    data: {
      name,
      email,
      password: 'fixture-tidak-untuk-login',
      role: 'CITIZEN',
      // Dinonaktifkan agar tetap tidak bisa login walau pembersihan gagal.
      isActive: false,
      phoneVerifiedAt: null,
    },
  });

  try {
    const tool = first('siapa yang baru daftar hari ini?');
    assert.equal(tool?.name, 'getRecentRegistrations');

    const results = await executeTools('ADMIN', 'fixture-admin', [
      { name: tool!.name, args: (tool!.args || {}) as Record<string, unknown> },
    ]);
    const data: any = results[0].result;

    assert.ok(data.total >= 1, 'jumlah pendaftaran hari ini minimal 1');
    const found = data.items.find((i: any) => i.email === email);
    assert.ok(found, 'akun uji harus muncul pada hasil database');
    assert.equal(found.name, name);
    assert.equal(found.verified, false);
    assert.equal(found.verificationLabel, 'Belum verifikasi WhatsApp');

    const text = formatDeterministicAnswer([], [{ name: 'getRecentRegistrations', result: data }]);
    assert.match(text!, /Uji Pendaftaran AI/);
  } finally {
    await prisma.user.delete({ where: { id: fixture.id } });
  }
});

// ===========================================================================
// 4. PRIVASI & OTORISASI
// ===========================================================================

test('tool pendaftaran hanya untuk Admin dan menolak role lain', async () => {
  assert.equal(isToolAllowed('ADMIN', 'getRecentRegistrations'), true);
  assert.equal(isToolAllowed('CITIZEN', 'getRecentRegistrations'), false);
  assert.equal(isToolAllowed('OFFICER', 'getRecentRegistrations'), false);

  const cursor = await executeTools('CITIZEN', 'fixture-citizen', [
    { name: 'getRecentRegistrations', args: {} },
  ]);
  assert.deepEqual(cursor[0].result, { error: 'forbidden' });

  const officer = await executeTools('OFFICER', 'fixture-officer', [
    { name: 'getRecentRegistrations', args: {} },
  ]);
  assert.deepEqual(officer[0].result, { error: 'forbidden' });

  const intent = resolveIntent('CITIZEN', 'siapa yang baru daftar hari ini?');
  assert.notEqual(intent.tools[0]?.name, 'getRecentRegistrations');
  assert.match(formatRegistrationAnswer({ error: 'forbidden' }), /hanya dapat diakses oleh Admin/i);
});

test('hasil pendaftaran tidak memuat password/hash/token', async () => {
  const result: any = await T.getRecentRegistrations({ limit: 10 });
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /password|passwordHash|hash|token|secret/i);
  assert.equal(result.safeFieldsOnly, true);
});

test('offset/limit dibatasi agar konteks model tidak meledak', async () => {
  const result: any = await T.getRecentRegistrations({ limit: 999, offset: -5 });
  assert.ok(result.returned <= 20, 'limit maksimum 20');
  assert.equal(result.offset, 0);
});

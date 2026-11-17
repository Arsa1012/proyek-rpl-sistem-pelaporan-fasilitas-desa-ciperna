/**
 * Tes KEMAMPUAN AI MEMBACA DATA AKUN (Admin) — end-to-end lapisan data.
 *
 * Cakupan:
 *  - Routing niat untuk pertanyaan akun bahasa sehari-hari (aktif/nonaktif,
 *    role, kata kunci nama/email/telepon) dan pertanyaan lanjutan ("mereka",
 *    "tadi").
 *  - Tool searchAccounts / countAccounts / getOfficerTaskCounts benar-benar
 *    membaca database: angka dibandingkan dengan query Prisma INDEPENDEN.
 *  - Tidak ada field rahasia (password/hash/token) yang pernah dikembalikan.
 *  - Otorisasi: tool akun hanya untuk ADMIN.
 *  - Diagnostik AI (runAiDiagnostics) berjalan dan READ-ONLY.
 *
 * Semua tes READ-ONLY: tidak ada data yang dibuat/diubah/dihapus.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import * as T from '../src/lib/aiTools';
import { resolveIntent, extractContext, type ChatTurn } from '../src/lib/aiIntent';
import { executeTools, isToolAllowed, TOOL_REGISTRY } from '../src/lib/aiToolRegistry';
import { formatDeterministicAnswer } from '../src/lib/aiChat';

after(async () => {
  await prisma.$disconnect();
});

function tools(q: string, history: ChatTurn[] = []) {
  return resolveIntent('ADMIN', q, history).tools;
}
function first(q: string, history: ChatTurn[] = []) {
  return tools(q, history)[0];
}
function user(text: string): ChatTurn {
  return { role: 'user', content: text };
}

const NEW_TOOLS = ['searchAccounts', 'countAccounts', 'getOfficerTaskCounts', 'runAiDiagnostics'];

// ===========================================================================
// 1. ROUTING NIAT — bahasa sehari-hari, typo ringan, sinonim
// ===========================================================================

test('akun nonaktif: "siapa warga yang akunnya dinonaktifkan" → searchAccounts terfilter', () => {
  const t = first('Siapa warga yang akunnya dinonaktifkan?');
  assert.equal(t?.name, 'searchAccounts');
  assert.equal(t?.args?.isActive, false);
  assert.equal(t?.args?.role, 'CITIZEN');
});

test('sinonim nonaktif (cari/nonaktif/tdk aktif/diblokir) → searchAccounts', () => {
  for (const q of ['Cari warga yang nonaktif.', 'tampilkan akun yang tidak aktif', 'akun yang diblokir']) {
    const t = first(q);
    assert.equal(t?.name, 'searchAccounts', `gagal untuk: ${q}`);
    assert.equal(t?.args?.isActive, false, `status salah untuk: ${q}`);
  }
});

test('hitung akun terfilter: "ada berapa akun petugas aktif" → countAccounts', () => {
  const t = first('Ada berapa akun petugas aktif?');
  assert.equal(t?.name, 'countAccounts');
  assert.equal(t?.args?.role, 'OFFICER');
  assert.equal(t?.args?.isActive, true);
});

test('hitung akun per role tanpa status → countAccounts role saja', () => {
  const t = first('Berapa akun warga?');
  assert.equal(t?.name, 'countAccounts');
  assert.equal(t?.args?.role, 'CITIZEN');
  assert.equal(t?.args?.isActive, undefined);
});

test('kombinasi beberapa role tetap memakai getUserCounts (ringkasan per-role)', () => {
  assert.equal(first('Berapa jumlah petugas dan warga?')?.name, 'getUserCounts');
});

test('pertanyaan akun tidak menyerobot pertanyaan laporan/tugas/pendaftaran', () => {
  assert.notEqual(first('Berapa laporan dari petugas?')?.name, 'countAccounts');
  assert.notEqual(first('Berapa beban kerja petugas?')?.name, 'countAccounts');
  // Registrasi harian memakai query pendaftaran (createdAt WIB) yang khusus.
  assert.equal(first('Berapa warga yang mendaftar hari ini?')?.name, 'getRecentRegistrations');
  assert.equal(first('Bagaimana cara reset kata sandi warga?')?.args?.topic, 'adminAccounts');
});

test('kata kunci nama/email pada pertanyaan akun ikut menjadi filter', () => {
  assert.equal(first('Cari warga bernama Budi')?.args?.q, 'Budi');
  assert.equal(first('Cari akun dengan email budi@example.com')?.args?.q, 'budi@example.com');
});

// ===========================================================================
// 2. PERTANYAAN LANJUTAN (konteks percakapan)
// ===========================================================================

test('lanjutan "berapa tugas mereka" memakai konteks petugas aktif', () => {
  const history = [user('Siapa saja petugas aktif?')];
  const t = first('Berapa tugas mereka?', history);
  assert.equal(t?.name, 'getOfficerTaskCounts');
  assert.equal(t?.args?.isActive, true);
});

test('lanjutan "tadi yang kamu sebut siapa saja" mengulang daftar akun dari konteks', () => {
  const history = [user('Cari warga nonaktif')];
  const t = first('Tadi yang kamu sebut siapa saja?', history);
  assert.equal(t?.name, 'searchAccounts');
  assert.equal(t?.args?.isActive, false);
  assert.equal(t?.args?.role, 'CITIZEN');
});

test('extractContext menyimpan role/status akun dari pertanyaan sebelumnya', () => {
  const ctx = extractContext([user('Cari warga yang nonaktif')]);
  assert.equal(ctx.lastAccountRole, 'CITIZEN');
  assert.equal(ctx.lastAccountActive, false);
});

// ===========================================================================
// 3. REGISTRY & OTORISASI
// ===========================================================================

test('tool akun baru terdaftar dan hanya boleh dipakai ADMIN', () => {
  for (const name of NEW_TOOLS) {
    assert.ok(TOOL_REGISTRY[name], `${name} harus terdaftar`);
    assert.equal(isToolAllowed('ADMIN', name), true, `${name} harus boleh untuk ADMIN`);
    assert.equal(isToolAllowed('CITIZEN', name), false, `${name} tidak boleh untuk masyarakat`);
    assert.equal(isToolAllowed('OFFICER', name), false, `${name} tidak boleh untuk petugas`);
  }
});

test('otorisasi ditegakkan saat eksekusi (bukan hanya di registry)', async () => {
  const res = await executeTools('CITIZEN', 'x', [{ name: 'searchAccounts', args: {} }]);
  assert.deepEqual(res[0].result, { error: 'forbidden' });
});

// ===========================================================================
// 4. AKURASI DATA (dibandingkan query Prisma independen)
// ===========================================================================

test('countAccounts: total & nonaktif sama persis dengan query Prisma', async () => {
  const [expectedTotal, expectedInactive, expectedActive] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: false } }),
    prisma.user.count({ where: { isActive: true } }),
  ]);
  const all = await T.countAccounts();
  assert.equal(all.total, expectedTotal);
  assert.equal(all.inactive, expectedInactive);
  assert.equal(all.active, expectedActive);

  const inactive = await T.countAccounts({ isActive: false });
  assert.equal(inactive.total, expectedInactive);
  assert.equal(inactive.active, 0);
});

test('searchAccounts: jumlah & status konsisten, serta aman (tanpa password/hash)', async () => {
  const officers = await T.searchAccounts({ role: 'OFFICER', limit: 20 });
  const expected = await prisma.user.count({ where: { role: 'OFFICER' } });
  assert.equal(officers.total, expected);
  assert.ok(officers.appliedFilters.some((f) => f.includes('petugas')));
  assert.equal(officers.safeFieldsOnly, true);

  const json = JSON.stringify(officers.items);
  assert.equal(/"password"\s*:/i.test(json), false, 'tidak boleh ada field password');
  assert.equal(/\$2[aby]\$/.test(json), false, 'tidak boleh ada hash bcrypt');
  for (const item of officers.items as any[]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'password'), false);
    assert.equal(typeof item.isActive, 'boolean');
    assert.ok(['Aktif', 'Nonaktif'].includes(item.statusLabel));
  }
});

test('searchAccounts: pencarian nama mengembalikan hanya yang cocok', async () => {
  const sample = await prisma.user.findFirst({ select: { name: true } });
  assert.ok(sample, 'harus ada pengguna di database');
  const fragment = sample!.name.slice(0, 3);
  // `contact: true` karena email kini hanya disertakan bila diminta eksplisit
  // (minimisasi data). Tes ini memverifikasi hasil pencarian berdasarkan
  // nama/email, jadi email perlu ikut agar pencocokan dapat diperiksa.
  const res = await T.searchAccounts({ q: fragment, limit: 20, contact: true });
  const expected = await prisma.user.count({
    where: { OR: [{ name: { contains: fragment } }, { email: { contains: fragment } }] },
  });
  assert.equal(res.total, expected);
  for (const item of res.items as any[]) {
    const hay = `${item.name} ${item.email} ${item.phone || ''}`.toLowerCase();
    assert.ok(hay.includes(fragment.toLowerCase()), `hasil tidak cocok: ${item.name}`);
  }
});

test('getOfficerTaskCounts: rekap tugas per petugas sesuai data penugasan', async () => {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER', isActive: true },
    select: { id: true, name: true },
  });
  const rows = await prisma.assignment.findMany({
    where: { officerId: { in: officers.map((o) => o.id) } },
    select: { officerId: true, completedAt: true, cancelledAt: true },
  });
  const expected = new Map<string, { total: number; active: number; completed: number }>();
  for (const o of officers) expected.set(o.name, { total: 0, active: 0, completed: 0 });
  const idToName = new Map(officers.map((o) => [o.id, o.name]));
  for (const r of rows) {
    const name = idToName.get(r.officerId);
    if (!name) continue;
    const s = expected.get(name)!;
    s.total += 1;
    if (!r.cancelledAt && r.completedAt) s.completed += 1;
    if (!r.cancelledAt && !r.completedAt) s.active += 1;
  }

  const res = await T.getOfficerTaskCounts({ isActive: true });
  assert.equal(res.totalOfficers, officers.length);
  for (const o of res.officers as any[]) {
    const e = expected.get(o.name);
    assert.ok(e, `petugas tak dikenal: ${o.name}`);
    assert.equal(o.total, e!.total, `total tugas ${o.name}`);
    assert.equal(o.active, e!.active, `tugas aktif ${o.name}`);
    assert.equal(o.completed, e!.completed, `tugas selesai ${o.name}`);
  }
});

// ===========================================================================
// 5. DIAGNOSTIK (READ-ONLY)
// ===========================================================================

test('runAiDiagnostics membaca semua domain dan menandai kegagalan dengan jujur', async () => {
  const report = await T.runAiDiagnostics();
  assert.equal(report.readOnly, true);
  assert.ok(report.totalDomains >= 8);
  assert.ok(report.okDomains >= 1);
  assert.ok(Array.isArray(report.domains));
  for (const d of report.domains as any[]) {
    assert.equal(typeof d.ok, 'boolean');
    if (d.ok) assert.equal(typeof d.count, 'number');
    else assert.equal(d.error, 'query gagal');
  }
  assert.equal(report.domains.find((d: any) => d.key === 'reports')?.count, await prisma.report.count());
});

test('jawaban diagnostik deterministik (tanpa LLM) berbentuk ringkas & aman', () => {
  const answer = formatDeterministicAnswer([], [
    {
      name: 'runAiDiagnostics',
      result: {
        generatedAtWib: '18 Oktober 2026, 09:00 (WIB)',
        totalDomains: 2,
        okDomains: 1,
        failedDomains: ['evidences'],
        domains: [
          { key: 'reports', label: 'Laporan (total)', ok: true, count: 64, ms: 3 },
          { key: 'evidences', label: 'Bukti penyelesaian', ok: false, error: 'query gagal', ms: 2 },
        ],
      },
    },
  ]);
  assert.ok(answer, 'harus dijawab deterministik');
  assert.ok(answer!.includes('1/2'));
  assert.ok(answer!.includes('GAGAL dibaca'));
  assert.ok(answer!.includes('evidences'));
});

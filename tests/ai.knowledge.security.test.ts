/**
 * TES KEAMANAN PENCARIAN PENGETAHUAN AI (C1 + C2).
 *
 * C1 — entri privat pengguna lain TIDAK boleh bocor lewat pencarian pengetahuan.
 * C2 — pencarian REST /api/ai/knowledge?search=... tidak boleh 500
 *      (Prisma SQLite tidak mendukung mode:'insensitive').
 *
 * Fixture: satu entri privat dibuat di awal dan DIHAPUS kembali di akhir
 * (tidak ada fixture permanen, tidak ada data produksi yang diubah).
 *
 * Jalankan: npm test
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import { searchAiKnowledge } from '../src/lib/aiTools';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

let marker = '';
let secret = '';
let ownerId = '';
let otherId = '';
let entryId = '';

before(async () => {
  // Dua akun berbeda (warga/petugas) sebagai pemilik & pengecek.
  const users = await prisma.user.findMany({
    where: { role: { in: ['CITIZEN', 'OFFICER'] } },
    select: { id: true, role: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });
  assert.ok(users.length >= 2, 'fixture: butuh minimal 2 akun warga/petugas');
  ownerId = users[0].id;
  otherId = users[1].id;

  marker = `markersprivat${Date.now().toString(36)}`;
  // `secret` hanya ada di ISI entri (tidak di judul) → dipakai untuk membuktikan
  // isi privat tidak pernah bocor ke akun lain.
  secret = `isirahasia${Date.now().toString(36)}`;
  const created = await prisma.aiKnowledgeEntry.create({
    data: {
      title: `Catatan privat ${marker}`,
      content: `Isi privat ${secret}`,
      category: 'LAINNYA',
      sourceType: 'MANUAL',
      sourceRole: users[0].role,
      sourceUserId: ownerId,
      sourceUserName: 'Pemilik Uji',
      verified: false,
      isPrivate: true,
    },
    select: { id: true },
  });
  entryId = created.id;
});

after(async () => {
  if (entryId) {
    await prisma.aiKnowledgeEntry.deleteMany({ where: { id: entryId } });
  }
  await prisma.$disconnect();
});

function hasEntry(result: any): boolean {
  return Array.isArray(result?.items) && result.items.some((x: any) => x.id === entryId);
}

// ---------------------------------------------------------------------------
// C1 — tidak ada kebocoran ke akun lain
// ---------------------------------------------------------------------------

test('C1.1 warga lain mencari marker privat -> hasil kosong & total tidak menghitungnya', async () => {
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50 },
    { userId: otherId, role: 'CITIZEN' }
  );
  assert.equal(result.error, undefined, `tidak boleh error: ${result.error}`);
  assert.equal(hasEntry(result), false, 'entri privat orang lain TIDAK boleh muncul');
  assert.equal(result.total, 0, 'total tidak boleh menghitung entri privat orang lain');
  assert.equal(result.returned, 0, 'returned tidak boleh menghitung entri privat orang lain');
});

test('C1.2 warga lain mencari TANPA keyword -> entri privat tetap tidak terlihat', async () => {
  const result: any = await searchAiKnowledge(
    { limit: 50 },
    { userId: otherId, role: 'CITIZEN' }
  );
  assert.equal(result.error, undefined);
  assert.equal(hasEntry(result), false, 'entri privat harus tetap tersembunyi tanpa keyword');
  assert.equal(result.total, 0, 'total harus tetap 0');
});

test('C1.3 warga lain mencoba includePrivate -> tetap tidak terlihat', async () => {
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50, includePrivate: true },
    { userId: otherId, role: 'CITIZEN' }
  );
  assert.equal(result.error, undefined);
  assert.equal(hasEntry(result), false, 'includePrivate tidak boleh menjadi jalur bypass');
  assert.equal(result.total, 0);
});

test('C1.4 petugas lain juga tidak bisa membaca entri privat warga', async () => {
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50, includePrivate: true },
    { userId: otherId, role: 'OFFICER' }
  );
  assert.equal(hasEntry(result), false, 'petugas tidak boleh membaca entri privat warga lain');
  assert.equal(result.total, 0);
});

test('C1.5 pemilik sendiri tetap bisa membaca entri privately-nya', async () => {
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50 },
    { userId: ownerId, role: 'CITIZEN' }
  );
  assert.equal(hasEntry(result), true, 'pemilik sah tetap bisa menemukan catatannya');
  assert.ok(result.total >= 1);
});

test('C1.6 metadata tidak membocorkan entri privat (appliedFilters & metadata)', async () => {
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50 },
    { userId: otherId, role: 'CITIZEN' }
  );
  const blob = JSON.stringify(result);
  // Isi privat TIDAK boleh bocor. (Keyword yang dicari user sendiri boleh
  // muncul kembali di appliedFilters — itu input user, bukan data orang lain.)
  assert.equal(blob.includes(secret), false, 'isi entri privat tidak boleh muncul di metadata');
  assert.equal(blob.includes(entryId), false, 'id entri privat tidak boleh muncul');
  assert.ok(
    result.appliedFilters.some((f: string) => /non-pribadi/.test(f)),
    'harus mencatat filter akses pada appliedFilters'
  );
});

test('C1.7 pagination tidak bisa menembus lewat offset', async () => {
  const page1: any = await searchAiKnowledge(
    { limit: 1, offset: 0 },
    { userId: otherId, role: 'CITIZEN' }
  );
  const page2: any = await searchAiKnowledge(
    { limit: 1, offset: 5 },
    { userId: otherId, role: 'CITIZEN' }
  );
  for (const page of [page1, page2]) {
    assert.equal(hasEntry(page), false, 'entri privat tidak boleh muncul di halaman mana pun');
    assert.equal(page.total, 0, 'total tidak boleh menghitung entri privat di halaman mana pun');
  }
});

// ---------------------------------------------------------------------------
// C1 — kebijakan akses ADMIN (harus dipertahankan, tidak diubah)
// ---------------------------------------------------------------------------

test('C1.8 ADMIN tanpa includePrivate tidak melihat entri privat orang lain', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin, 'fixture: butuh admin');
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50 },
    { userId: admin.id, role: 'ADMIN' }
  );
  assert.equal(result.error, undefined);
  assert.equal(hasEntry(result), false, 'ADMIN tanpa includePrivate hanya melihat entri non-private');
});

test('C1.9 ADMIN dengan includePrivate melihat seluruh entri (termasuk privat)', async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  assert.ok(admin);
  const result: any = await searchAiKnowledge(
    { q: marker, limit: 50, includePrivate: true },
    { userId: admin.id, role: 'ADMIN' }
  );
  assert.equal(result.error, undefined);
  assert.equal(hasEntry(result), true, 'ADMIN dengan includePrivate berhak melihat entri privat');
  assert.ok(result.total >= 1);
});

// ---------------------------------------------------------------------------
// C2 — route REST tidak boleh 500 dan tidak boleh bocor
// ---------------------------------------------------------------------------

test('C2.1 route REST knowledge tidak memakai mode insensitive (tak didukung SQLite)', () => {
  const src = read('src/app/api/ai/knowledge/route.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /contains:\s*[^,}]+,\s*mode\s*:/.test(code),
    false,
    'route tidak boleh memakai mode pada filter contains (Prisma SQLite menolaknya)'
  );
  // Pola AND untuk keyword + akses tetap dipertahankan.
  assert.match(code, /where\.AND\s*=\s*listConditions/, 'filter keyword & akses harus terpisah (AND)');
});

test('C2.2 query dengan bentuk yang sama seperti route tidak error di SQLite', async () => {
  // Replikasi bentuk where yang dibangun route (keyword AND akses).
  const where: any = {
    AND: [
      { OR: [{ title: { contains: marker } }, { content: { contains: marker } }] },
      { OR: [{ isPrivate: false }] },
    ],
  };
  const rows = await prisma.aiKnowledgeEntry.findMany({ where, take: 5 });
  assert.ok(Array.isArray(rows), 'query harus berhasil (tanpa Unknown argument mode)');
  assert.equal(
    rows.some((r) => r.id === entryId),
    false,
    'entri privat tidak boleh masuk lewat query admin tanpa filter privat'
  );
});

test('C2.3 tool AI memakai struktur AND (bukan OR-merge) untuk keyword + akses', () => {
  const src = read('src/lib/aiTools.ts');
  const block = (src.split('export async function searchAiKnowledge')[1] || '').split('export async function analyzeAiKnowledge')[0] || '';
  assert.match(block, /where\.AND\s*=\s*conditions/, 'harus memakai where.AND');
  assert.equal(
    /where\.OR\s*=/.test(block),
    false,
    'tidak boleh ada where.OR yang menggabungkan keyword dan hak akses'
  );
  // includePrivate hanya berlaku untuk ADMIN.
  assert.match(block, /ctx\.role\s*===\s*'ADMIN'\s*&&\s*includePrivate/, 'includePrivate hanya untuk ADMIN');
});

/**
 * Tes MANAJEMEN AKUN (Admin) — pendaftaran petugas, detail akun, reset kata sandi.
 *
 * Cakupan:
 *  - KEBIJAKAN kata sandi terpusat (validasi + generator kata sandi sementara).
 *  - KEAMANAN endpoint (role server, tanpa password di respons, audit, tanpa role dari body)
 *    diperiksa secara statis terhadap kode route yang sebenarnya.
 *  - ROUTING niat AI untuk pertanyaan pengelolaan akun.
 *  - Pengetahuan fitur `getWebsiteInfo('adminAccounts')` per role.
 *
 * Tes ini tidak memanggil LLM dan tidak menulis ke database.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { validatePassword, generateTemporaryPassword, PASSWORD_MIN_LENGTH } from '../src/lib/password';
import { resolveIntent } from '../src/lib/aiIntent';
import { TOOL_REGISTRY, isToolAllowed } from '../src/lib/aiToolRegistry';
import * as T from '../src/lib/aiTools';
import { prisma } from '../src/lib/prisma';

after(async () => {
  await prisma.$disconnect();
});

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

// ---------------------------------------------------------------------------
// 1. Kebijakan kata sandi terpusat
// ---------------------------------------------------------------------------

test('validatePassword: menerima kata sandi yang memenuhi kebijakan', () => {
  assert.equal(validatePassword('Ciperna123'), null);
  assert.equal(validatePassword('Abcdef1x'), null);
});

test('validatePassword: menolak dengan pesan yang jelas', () => {
  assert.equal(validatePassword('Ab1'), 'Password minimal 8 karakter');
  assert.equal(validatePassword('abcdefg1'), 'Password harus mengandung minimal 1 huruf kapital');
  assert.equal(validatePassword('ABCDEFG1'), 'Password harus mengandung minimal 1 huruf kecil');
  assert.equal(validatePassword('Abcdefgh'), 'Password harus mengandung minimal 1 angka');
  assert.equal(validatePassword(undefined), 'Password minimal 8 karakter');
});

test('generateTemporaryPassword: selalu memenuhi kebijakan & acak', () => {
  const pw = generateTemporaryPassword();
  assert.ok(pw.length >= PASSWORD_MIN_LENGTH);
  assert.equal(validatePassword(pw), null, 'kata sandi sementara harus valid menurut kebijakan');
  assert.notEqual(generateTemporaryPassword(), generateTemporaryPassword(), 'harus acak');
});

// ---------------------------------------------------------------------------
// 2. Keamanan endpoint (statis terhadap kode nyata)
// ---------------------------------------------------------------------------

test('POST /api/admin/officers: role ADMIN, role petugas dipaksa server, tanpa password di respons', () => {
  const src = read('src/app/api/admin/officers/route.ts');
  assert.ok(/getSession\s*\(/.test(src), 'wajib memakai sesi server');
  assert.ok(/session\.role !== 'ADMIN'/.test(src), 'wajib membatasi role ADMIN');
  assert.ok(/role:\s*'OFFICER'/.test(src), 'role petugas harus dipaksa di server');
  assert.equal(/requestedRole/.test(src), false, 'role tidak boleh diambil dari input pengguna');
  assert.equal(/password:\s*true/.test(src), false, 'tidak boleh memilih field password');
  assert.ok(/bcrypt\.hash/.test(src), 'kata sandi harus di-hash bcrypt');
  assert.ok(/logAdminAction/.test(src), 'aksi penting harus dicatat ke audit log');
  assert.ok(/generateTemporaryPassword/.test(src), 'harus mendukung kata sandi sementara acak');
});

test('GET/PATCH /api/admin/users/[id]: role ADMIN, tanpa password, ada audit', () => {
  const src = read('src/app/api/admin/users/[id]/route.ts');
  assert.ok(/session\.role !== 'ADMIN'/.test(src));
  assert.ok(/SAFE_USER_SELECT/.test(src), 'harus memakai daftar field aman');
  assert.equal(/password:\s*true/.test(src), false, 'detail tidak boleh menyertakan password/hash');
  assert.ok(/mustChangePassword/.test(src), 'detail boleh menunjukkan status wajib ganti sandi');
  assert.ok(/logAdminAction/.test(src), 'sunting/aktif-nonaktif harus dicatat');
  assert.equal(/data:\s*\{\s*role/.test(src), false, 'role tidak boleh diubah lewat PATCH');
});

test('POST /api/admin/users/[id]/reset-password: aman & sekali tampil', () => {
  const src = read('src/app/api/admin/users/[id]/reset-password/route.ts');
  assert.ok(/session\.role !== 'ADMIN'/.test(src));
  assert.ok(/generateTemporaryPassword/.test(src));
  assert.ok(/bcrypt\.hash/.test(src));
  assert.ok(/mustChangePassword:\s*true/.test(src), 'wajib ganti sandi harus diaktifkan');
  assert.ok(/logAdminAction/.test(src));
  assert.ok(/temporaryPassword/.test(src), 'kata sandi sementara dikembalikan sekali');
  // Tidak ada kata sandi (asli/hash) yang masuk ke log.
  for (const line of src.split(/\r?\n/).filter((l) => /console\./.test(l))) {
    assert.equal(/(plainPassword|hashedPassword|temporaryPassword|newPassword)/.test(line), false, `kata sandi tidak boleh di-log: ${line.trim()}`);
  }
});

test('POST /api/auth/change-password: hanya akun dari sesi, membersihkan mustChangePassword', () => {
  const src = read('src/app/api/auth/change-password/route.ts');
  assert.ok(/getSession\s*\(/.test(src));
  assert.ok(/session\.userId/.test(src), 'akun ditentukan dari sesi, bukan input');
  assert.ok(/validatePassword/.test(src));
  assert.ok(/mustChangePassword:\s*false/.test(src));
  for (const line of src.split(/\r?\n/).filter((l) => /console\./.test(l))) {
    assert.equal(/(newPassword|confirmPassword|plainPassword|hashedPassword)/.test(line), false, `kata sandi tidak boleh di-log: ${line.trim()}`);
  }
});

test('login mengarahkan akun wajib-ganti ke /ubah-password', () => {
  const src = read('src/app/api/auth/login/route.ts');
  assert.ok(/mustChangePassword/.test(src));
  assert.ok(/\/ubah-password/.test(src));
});

test('layout dashboard menahan akses selama wajib ganti sandi', () => {
  const src = read('src/app/(dashboard)/layout.tsx');
  assert.ok(/mustChangePassword/.test(src));
  assert.ok(/redirect\('\/ubah-password'\)/.test(src));
});

test('skema menyimpan mustChangePassword dengan default false (non-destruktif)', () => {
  const schema = read('prisma/schema.prisma');
  assert.ok(/mustChangePassword\s+Boolean\s+@default\(false\)/.test(schema));
});

test('endpoint admin akun hanya boleh menargetkan non-ADMIN (dicek dari kode)', () => {
  for (const f of [
    'src/app/api/admin/users/[id]/route.ts',
    'src/app/api/admin/users/[id]/reset-password/route.ts',
  ]) {
    const src = read(f);
    assert.ok(/target\.role === 'ADMIN'/.test(src), `${f} harus menolak target akun ADMIN`);
  }
});

// ---------------------------------------------------------------------------
// 3. Routing niat AI untuk pengelolaan akun (Admin)
// ---------------------------------------------------------------------------

function tools(role: 'ADMIN' | 'CITIZEN' | 'OFFICER', q: string) {
  return resolveIntent(role, q, []).tools;
}

test('admin: pertanyaan pengelolaan akun dijawab dari pengetahuan fitur adminAccounts', () => {
  const queries = [
    'Bagaimana cara menambah petugas baru?',
    'Cara mendaftarkan petugas?',
    'Bagaimana cara reset kata sandi warga?',
    'Di mana menu untuk menonaktifkan akun petugas?',
    'Bagaimana cara melihat detail akun warga?',
  ];
  for (const q of queries) {
    const t = tools('ADMIN', q);
    assert.equal(t[0]?.name, 'getWebsiteInfo', `gagal untuk: ${q}`);
    assert.equal(t[0]?.args?.topic, 'adminAccounts', `topik salah untuk: ${q}`);
  }
});

test('admin: hitungan akun terfilter memakai countAccounts; kombinasi role tetap getUserCounts', () => {
  // Pertanyaan dengan role tunggal/penanda "akun/terdaftar/pengguna" → hitungan terfilter.
  assert.equal(tools('ADMIN', 'Ada berapa petugas terdaftar?')[0]?.name, 'countAccounts');
  assert.equal(tools('ADMIN', 'Ada berapa petugas terdaftar?')[0]?.args?.role, 'OFFICER');
  assert.equal(tools('ADMIN', 'Berapa banyak akun pengguna?')[0]?.name, 'countAccounts');
  // Kombinasi beberapa role sekaligus tetap memakai ringkasan per-role.
  assert.equal(tools('ADMIN', 'Berapa jumlah petugas dan warga?')[0]?.name, 'getUserCounts');
});

test('admin: pertanyaan laporan/tugas tidak tertukar dengan hitungan akun', () => {
  assert.notEqual(tools('ADMIN', 'Berapa laporan dari petugas?')[0]?.name, 'getUserCounts');
  assert.notEqual(tools('ADMIN', 'Berapa tugas petugas?')[0]?.name, 'getUserCounts');
  // Registrasi harian memakai query pendaftaran (createdAt WIB) yang khusus.
  assert.equal(tools('ADMIN', 'Berapa warga yang mendaftar hari ini?')[0]?.name, 'getRecentRegistrations');
  // Fitur umum tetap 'features'.
  assert.equal(tools('ADMIN', 'Fitur apa saja yang tersedia untuk petugas?')[0]?.args?.topic, 'features');
});

test('warga/petugas: tool pengelolaan akun tetap terdaftar & tidak melewati otorisasi', () => {
  assert.ok(TOOL_REGISTRY['getWebsiteInfo']);
  assert.equal(isToolAllowed('CITIZEN', 'getWebsiteInfo'), true);
  assert.equal(isToolAllowed('ADMIN', 'getUserCounts'), true);
  assert.equal(isToolAllowed('CITIZEN', 'getUserCounts'), true);
});

// ---------------------------------------------------------------------------
// 4. Pengetahuan fitur adminAccounts (tanpa rahasia)
// ---------------------------------------------------------------------------

test('getWebsiteInfo(adminAccounts) untuk Admin memuat langkah-langkah & aman', async () => {
  const info = (await T.getWebsiteInfo('adminAccounts', 'ADMIN')) as any;
  assert.ok(Array.isArray(info.items) && info.items.length >= 4);
  const text = JSON.stringify(info);
  assert.ok(/Tambah Petugas/.test(text));
  assert.ok(/Reset Kata Sandi/.test(text));
  assert.ok(/detail akun/i.test(text));
  assert.equal(/password/i.test(text), false, 'penjelasan tidak boleh memakai istilah rahasia');
  assert.equal(/\$2[aby]\$/.test(text), false, 'tidak boleh ada hash bcrypt');
  assert.equal(/token/i.test(text), false, 'tidak boleh ada token');
});

test('getWebsiteInfo(adminAccounts) untuk non-Admin tidak membocorkan langkah admin', async () => {
  const info = (await T.getWebsiteInfo('adminAccounts', 'CITIZEN')) as any;
  const text = JSON.stringify(info);
  assert.ok(/hanya dapat dilakukan oleh Admin/i.test(text));
  assert.equal(/Tambah Petugas/.test(text), false, 'warga tidak boleh diberi langkah khusus admin');
  assert.equal(/Reset Kata Sandi/.test(text), false);
});

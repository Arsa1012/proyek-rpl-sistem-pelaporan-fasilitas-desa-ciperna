/**
 * Tes UI/UX & TEMA — penjaga regresi untuk audit mode terang/gelap dan
 * formulir wilayah.
 *
 * Fokus:
 *  - Tidak ada lagi warna teks gelap hardcoded (yang rusak di mode gelap)
 *    pada komponen status/peringatan; harus memakai token tema.
 *  - Tombol pengubah tema memakai label/aria yang jelas dan tersedia di sidebar.
 *  - Formulir registrasi & profil memakai master data wilayah (bukan angka bebas).
 *
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// Warna teks gelap hardcoded yang pernah dipakai pada komponen status.
// Semua harus diganti token tema (`--warning-text`, `--danger-text`, `--success-text`).
const LIGHT_ONLY_COLORS = ['#92400e', '#b45309', '#047857', '#b91c1c', '#065f46', '#991b1b'];

const AUDITED_FILES = [
  'src/components/ui/AssignOfficerPanel.tsx',
  'src/components/ui/ReviewButtons.tsx',
  'src/components/ui/AdminEvidenceVerification.tsx',
  'src/components/ui/ResendCompletionButton.tsx',
  'src/components/ui/DuplicateAssistant.tsx',
  'src/components/ui/ReportTimeline.tsx',
  'src/components/ui/AdminReportActions.tsx',
];

test('komponen status tidak memakai warna teks gelap hardcoded (audit tema)', () => {
  for (const file of AUDITED_FILES) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} harus ada`);
    const src = read(file).toLowerCase();
    for (const color of LIGHT_ONLY_COLORS) {
      assert.ok(
        !src.includes(color),
        `${file} masih memakai warna hardcoded ${color}; gunakan token tema (mis. var(--warning-text))`
      );
    }
  }
});

test('token status tersedia di kedua tema (terang & gelap)', () => {
  const css = read('src/app/globals.css');
  assert.ok(/--warning-text:/.test(css), 'token --warning-text harus didefinisikan');
  assert.ok(/--danger-text:/.test(css), 'token --danger-text harus didefinisikan');
  assert.ok(/--success-text:/.test(css), 'token --success-text harus didefinisikan');
  // Token didefinisikan ulang pada tema gelap.
  const darkBlock = css.slice(css.indexOf("[data-theme='dark']"));
  assert.ok(/--warning-text:/.test(darkBlock), '--warning-text harus punya nilai tema gelap');
  assert.ok(/--danger-text:/.test(darkBlock), '--danger-text harus punya nilai tema gelap');
});

test('mode gelap ditentukan sebelum render (mencegah flash tema salah)', () => {
  const layout = read('src/app/layout.tsx');
  assert.ok(/localStorage\.getItem\('ciperna-theme'\)/.test(layout), 'tema dibaca dari localStorage');
  assert.ok(/documentElement\.dataset\.theme/.test(layout), 'tema diterapkan ke <html> lebih awal');
});

test('tombol pengubah tema punya label jelas dan HANYA satu per layout (di topbar)', () => {
  const toggle = read('src/components/ui/ThemeToggle.tsx');
  assert.ok(/aria-label/.test(toggle), 'tombol tema harus punya aria-label');
  assert.ok(/withLabel/.test(toggle), 'tombol tema harus mendukung label teks');

  // Sejak perbaikan duplikasi: toggle tema ada di topbar (global), BUKAN lagi di
  // sidebar. Sidebar tidak boleh memuat toggle kedua.
  const navbar = read('src/components/layout/Navbar.tsx');
  assert.ok(/ThemeToggle\s+withLabel/.test(navbar), 'topbar harus menyediakan satu tombol tema berlabel');
  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.equal(
    /ThemeToggle/.test(sidebar),
    false,
    'sidebar tidak boleh lagi memuat tombol tema (duplikat dihapus)'
  );
});

test('animasi menghormati prefers-reduced-motion', () => {
  const css = read('src/app/globals.css');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'harus ada aturan reduced-motion');
  const reveal = read('src/components/landing/ScrollReveal.tsx');
  assert.ok(/prefers-reduced-motion/.test(reveal), 'efek gulir harus memeriksa reduced-motion');
  assert.ok(/requestAnimationFrame/.test(reveal), 'parallax harus hemat (rAF)');
});

test('formulir registrasi memakai master data wilayah, bukan angka bebas', () => {
  const register = read('src/app/register/page.tsx');
  assert.ok(/\/api\/regions/.test(register), 'registrasi harus membaca /api/regions');
  assert.ok(/<select/.test(register), 'RT/RW harus dipilih dari daftar, bukan diketik');
  assert.ok(/rtId/.test(register), 'registrasi harus mengirim rtId');
  assert.ok(/belum dikonfigurasi|belum tersedia/i.test(register), 'harus ada pesan bila data wilayah belum ada');
});

test('formulir profil dapat melengkapi wilayah setelah login', () => {
  const form = read('src/components/ui/ProfileForm.tsx');
  assert.ok(/region\?:/.test(form), 'ProfileForm harus menerima data wilayah opsional');
  assert.ok(/fd\.append\('rtId'/.test(form), 'profil harus mengirim rtId saat wilayah diubah');
  assert.ok(/\/api\/regions/.test(form), 'profil harus membaca daftar wilayah aktif');
});

test('halaman admin wilayah tersedia dan dilindungi role admin', () => {
  const page = read('src/app/(dashboard)/admin/wilayah/page.tsx');
  assert.ok(/session\.role !== 'ADMIN'/.test(page), 'halaman wilayah harus memeriksa role ADMIN');
  assert.ok(/RegionsManager/.test(page), 'halaman wilayah harus memakai pengelola wilayah');
});

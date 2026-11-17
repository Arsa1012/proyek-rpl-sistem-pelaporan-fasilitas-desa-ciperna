/**
 * Tes STRUKTUR UI & ALUR PERSETUJUAN (statis, tanpa database).
 *
 * Mengunci perbaikan yang diminta agar tidak kembali rusak:
 *  - SATU toggle tema saja per layout (tidak ada duplikat di sidebar);
 *  - kontak admin tidak diulang (hanya di section utama beranda, footer berupa tautan);
 *  - halaman profil memakai komponen ringkasan bersama (tanpa markup berbeda-beda);
 *  - alur persetujuan laporan punya pilihan "teks saja" / "teks + foto" dan
 *    pilihan itu eksplisit (radio) serta dijaga server;
 *  - pengiriman foto Fonnte memakai parameter `file` (multipart) dan token server.
 *
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const count = (src: string, re: RegExp) => (src.match(re) || []).length;

// ---------------------------------------------------------------------------
// 1. Toggle tema tidak boleh duplikat
// ---------------------------------------------------------------------------

test('sidebar tidak lagi memuat toggle tema (satu toggle per layout)', () => {
  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.equal(/ThemeToggle/.test(sidebar), false, 'Sidebar.tsx tidak boleh memuat ThemeToggle (duplikat)');
});

test('layout dashboard memakai tepat satu toggle tema (di topbar)', () => {
  const navbar = read('src/components/layout/Navbar.tsx');
  assert.equal(count(navbar, /<ThemeToggle/g), 1, 'topbar harus punya tepat satu toggle tema');
  assert.ok(/withLabel/.test(navbar), 'toggle tema dashboard harus berlabel jelas');
});

test('navigasi publik memakai satu toggle tema per halaman (tidak bersamaan)', () => {
  const nav = read('src/app/landing-nav.tsx');
  // Dua pemakaian: halaman auth dan halaman publik — dua cabang yang saling eksklusif.
  assert.ok(count(nav, /<ThemeToggle/g) <= 2);
  // Pastikan berada pada cabang return yang berbeda (authPage lebih dulu).
  const authIdx = nav.indexOf('isAuthPage');
  const first = nav.indexOf('<ThemeToggle');
  const second = nav.lastIndexOf('<ThemeToggle');
  assert.ok(authIdx > -1 && first > authIdx && second > first, 'toggle tema berada di cabang berbeda');
});

test('sistem tema tetap utuh (preferensi tersimpan & diterapkan sebelum render)', () => {
  const toggle = read('src/components/ui/ThemeToggle.tsx');
  assert.ok(/localStorage/.test(toggle), 'preferensi tema harus disimpan');
  assert.ok(/documentElement\.dataset\.theme/.test(toggle));
  const layout = read('src/app/layout.tsx');
  assert.ok(/ciperna-theme/.test(layout), 'tema harus diterapkan pra-render di layout untuk mencegah kedipan');
});

// ---------------------------------------------------------------------------
// 2. Kontak admin tidak diulang
// ---------------------------------------------------------------------------

test('section kontak admin hanya satu dan dapat ditautkan (#kontak)', () => {
  const sections = read('src/components/landing/Sections.tsx');
  assert.ok(/id="kontak"/.test(sections), 'section kontak harus punya anchor #kontak');
  assert.equal(count(sections, /wa\.me\/6282118727522/g), 1, 'tautan WhatsApp admin cukup satu');
  assert.equal(count(sections, /instagram\.com\/syajehh/g), 1, 'tautan Instagram admin cukup satu');
});

test('footer tidak mengulang blok kontak admin', () => {
  const footer = read('src/components/landing/Footer.tsx');
  assert.equal(/wa\.me/.test(footer), false, 'footer tidak boleh mengulang tautan WhatsApp admin');
  assert.equal(/instagram\.com/.test(footer), false, 'footer tidak boleh mengulang tautan Instagram');
  assert.ok(/#kontak/.test(footer), 'footer boleh menautkan ke bagian kontak utama');
});

// ---------------------------------------------------------------------------
// 3. Halaman profil konsisten
// ---------------------------------------------------------------------------

test('ketiga halaman profil memakai komponen ringkasan bersama', () => {
  const pages = [
    'src/app/(dashboard)/masyarakat/profile/page.tsx',
    'src/app/(dashboard)/petugas/profile/page.tsx',
    'src/app/(dashboard)/admin/profile/page.tsx',
  ];
  for (const p of pages) {
    assert.ok(existsSync(path.join(ROOT, p)), `${p} harus ada`);
    const src = read(p);
    assert.ok(/ProfileSummary/.test(src), `${p} harus memakai ProfileSummary (tata letak konsisten)`);
    assert.ok(/profile-grid/.test(src), `${p} harus memakai grid profil bersama`);
  }
  const summary = read('src/components/ui/ProfileSummary.tsx');
  for (const label of ['Email', 'Nomor WhatsApp', 'Wilayah (RT/RW)', 'Bergabung sejak']) {
    assert.ok(summary.includes(label), `ringkasan profil harus memuat label "${label}"`);
  }
});

// ---------------------------------------------------------------------------
// 4. Alur persetujuan: pilihan teks saja / teks + foto
// ---------------------------------------------------------------------------

test('ReviewButtons menyediakan pilihan format yang eksplisit (radio) + pratinjau foto', () => {
  const src = read('src/components/ui/ReviewButtons.tsx');
  assert.ok(/type="radio"/.test(src), 'pilihan format harus berupa radio group yang terlihat');
  assert.ok(/TEXT_PHOTO/.test(src), 'harus ada opsi teks + foto');
  assert.ok(/evidencePhoto/.test(src), 'harus menampilkan/menerima foto bukti');
  assert.ok(/photoAvailable/.test(src), 'opsi foto harus dinonaktifkan bila foto tidak ada');
});

test('server membatasi mode notifikasi & hanya mengirim foto yang benar-benar ada', () => {
  const src = read('src/app/api/assignments/[id]/review/route.ts');
  assert.ok(/notifyMode/.test(src), 'endpoint review harus menerima notifyMode');
  assert.ok(/TEXT_PHOTO/.test(src));
  assert.ok(/!evidence\?\.photo/.test(src), 'harus menolak mode foto bila foto bukti tidak ada');
  assert.ok(/sendEvidencePhoto/.test(src), 'harus meneruskan pilihan foto ke lapisan WhatsApp');
  // Status persetujuan terpisah dari status notifikasi.
  assert.ok(/notification:/.test(src), 'respons harus memuat status notifikasi terpisah');
});

test('retry notifikasi memakai format yang sama seperti saat persetujuan', () => {
  const src = read('src/app/api/admin/reports/[id]/notify-completion/route.ts');
  assert.ok(/notifyMode/.test(src), 'retry harus membaca notifyMode penugasan');
  assert.ok(/sendEvidencePhoto/.test(src), 'retry harus mengirim foto bila mode sebelumnya teks + foto');
});

test('WhatsApp media memakai parameter `file` (multipart) + token server', () => {
  const src = read('src/lib/whatsapp.ts');
  assert.ok(/FormData/.test(src), 'media harus dikirim sebagai multipart');
  assert.ok(/'file'/.test(src), 'parameter Fonnte untuk media adalah `file`');
  assert.ok(/Authorization: token/.test(src), 'token diambil dari konfigurasi server');
  assert.equal(/NEXT_PUBLIC_FONNTE/.test(src), false, 'token tidak boleh diekspos ke klien');
  assert.ok(/function loadEvidenceMedia/.test(src), 'ada fungsi pembaca foto bukti yang dibatasi');
  assert.ok(/unsupported_photo_path/.test(src), 'path foto di luar /uploads harus ditolak');
  assert.ok(/MEDIA_MAX_BYTES|photo_too_large/.test(src), 'ukuran media harus dibatasi');
});

test('notifikasi persetujuan punya kunci idempotency berbeda per mode', () => {
  const src = read('src/lib/whatsapp.ts');
  assert.ok(/'approved-photo:'|`approved-photo:/.test(src), 'mode foto butuh dedupeKey sendiri');
  assert.ok(/'approved:'|`approved:/.test(src), 'mode teks tetap memakai dedupeKey lama');
});

// ---------------------------------------------------------------------------
// 5. Pengumuman → notifikasi aplikasi (integrasi)
// ---------------------------------------------------------------------------

test('API pengumuman menyinkronkan notifikasi saat buat/ubah/terbit/tarik', () => {
  const post = read('src/app/api/admin/village/announcements/route.ts');
  const patch = read('src/app/api/admin/village/announcements/[id]/route.ts');
  assert.ok(/syncAnnouncementNotification/.test(post), 'POST harus menyinkronkan notifikasi');
  assert.ok(/syncAnnouncementNotification/.test(patch), 'PATCH harus menyinkronkan notifikasi');
  assert.ok(/broadcastAnnouncementWhatsApp/.test(post), 'POST mengirim WhatsApp bila diminta');
  assert.ok(/broadcastAnnouncementWhatsApp/.test(patch), 'PATCH mengirim WhatsApp bila diminta');
  assert.ok(/ANNOUNCEMENT_\$\{action\.toUpperCase\(\)\}/.test(patch), 'aksi terbit/tarik/arsip dicatat ke audit');
  assert.ok(/export async function DELETE/.test(patch), 'tersedia hapus lunak lewat DELETE');
  assert.ok(/deletedAt/.test(patch), 'hapus bersifat lunak (deletedAt), bukan hapus permanen');
});

test('GET notifikasi masyarakat menjadwalkan pengumuman yang baru jatuh tempo', () => {
  const src = read('src/app/api/notifications/route.ts');
  assert.ok(/ensureDueAnnouncementForUser/.test(src));
  assert.ok(/session\.role === 'CITIZEN'/.test(src), 'hanya warga yang menerima siaran pengumuman');
});

test('notifikasi pengumuman dapat diklik menuju detail (url) dengan emoji khusus', () => {
  const bell = read('src/components/ui/NotificationBell.tsx');
  assert.ok(/ANNOUNCEMENT/.test(bell));
  assert.ok(/n\.url/.test(bell), 'klik notifikasi pengumuman harus membuka tautannya');
});

test('skema menyimpan tautan pengumuman pada notifikasi + mode notifikasi penugasan', () => {
  const schema = read('prisma/schema.prisma');
  assert.ok(/announcementId\s+String\?/.test(schema));
  assert.ok(/@@unique\(\[userId, announcementId\]\)/.test(schema));
  assert.ok(/notifyMode\s+String\?/.test(schema));
  assert.ok(/url\s+String\?/.test(schema));
});

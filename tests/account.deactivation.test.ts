/**
 * Tes PENANGANAN AKUN NONAKTIF + NOTIFIKASI WHATSAPP + BROADCAST PENGUMUMAN.
 *
 * Fokus:
 * - Akun nonaktif TETAP bisa login (tidak ditolak 403), tetapi API fitur utama
 *   (buat laporan / mulai & selesaikan tugas) menolaknya.
 * - Alasan penonaktifan disimpan dan ditampilkan pada banner dashboard.
 * - Notifikasi WhatsApp penonaktifan memuat alasan + nomor Admin.
 * - Broadcast pengumuman berjalan di latar belakang dan memakai template resmi.
 * - Konteks AI memuat status akun + statistik pengumuman.
 *
 * Semua data uji dihapus kembali. Tidak ada pengiriman WhatsApp nyata (fetch di-mock).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import { notifyAccountDeactivated } from '../src/lib/whatsapp';
import { formatLiveChatContext, loadLiveChatContext, type LiveChatContext } from '../src/lib/aiContext';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

const TEST_EMAIL = 'zz-account-deactivated@example.com';
const TEST_PHONE = '081200000099';
const TEST_DEDUPE = 'zz-account-deactivated-test';

after(async () => {
  await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: TEST_DEDUPE } });
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. Statis: schema, sesi, login, dan guard API
// ---------------------------------------------------------------------------

test('skema menyimpan alasan penonaktifan akun', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /suspendReason\s+String\?/);
  assert.match(schema, /isActive\s+Boolean\s+@default\(true\)/);
});

test('sesi tidak membuang akun nonaktif (tetap boleh login & membaca)', () => {
  const auth = read('src/lib/auth.ts');
  assert.match(auth, /suspendReason/);
  assert.match(auth, /isActive:\s*user\.isActive/);
  assert.doesNotMatch(auth, /user\.isActive\s*===\s*false\)\s*return\s+null/);
});

test('login tidak lagi menolak akun nonaktif dengan 403', () => {
  const login = read('src/app/api/auth/login/route.ts');
  assert.doesNotMatch(login, /if\s*\(user\.isActive\s*===\s*false\)\s*\{[\s\S]{0,120}status:\s*403/);
  assert.match(login, /accountInactive/);
  assert.match(login, /suspendReason/);
});

test('API fitur utama menolak akun nonaktif dengan pesan yang jelas', () => {
  for (const file of [
    'src/app/api/reports/route.ts',
    'src/app/api/assignments/[id]/route.ts',
    'src/app/api/assignments/[id]/complete/route.ts',
  ]) {
    const src = read(file);
    assert.match(src, /session\.isActive\s*===\s*false/, `${file} harus memeriksa isActive`);
    assert.match(src, /ACCOUNT_INACTIVE/, `${file} harus menandai kode ACCOUNT_INACTIVE`);
    assert.match(src, /082118727522/, `${file} harus mengarahkan ke Admin`);
  }
});

test('dashboard warga menampilkan banner alasan nonaktif dan menyembunyikan tombol', () => {
  const page = read('src/app/(dashboard)/masyarakat/dashboard/page.tsx');
  assert.match(page, /accountInactive/);
  assert.match(page, /village-alert/);
  assert.match(page, /suspendReason/);
  assert.match(page, /Buat Laporan \(Nonaktif\)/);
  const sidebar = read('src/components/layout/Sidebar.tsx');
  assert.match(sidebar, /isActive/);
  assert.match(sidebar, /\/masyarakat\/laporan\/create/);
  assert.match(sidebar, /filter/);
});

test('form Admin menanyakan alasan saat menonaktifkan akun', () => {
  const button = read('src/components/ui/UserDisableButton.tsx');
  assert.match(button, /window\.prompt/);
  assert.match(button, /suspendReason/);
  assert.match(button, /Alasan penonaktifan wajib diisi/);
});

// ---------------------------------------------------------------------------
// 2. Notifikasi WhatsApp penonaktifan
// ---------------------------------------------------------------------------

test('template notifikasi penonaktifan memuat alasan + nomor Admin', () => {
  const wa = read('src/lib/whatsapp.ts');
  assert.match(wa, /export async function notifyAccountDeactivated/);
  assert.match(wa, /PEMBERITAHUAN PENONAKTIFAN AKUN/);
  assert.match(wa, /DINONAKTIFKAN oleh Administrator/);
  assert.match(wa, /082118727522/);
});

test('notifyAccountDeactivated mengirim alasan ke nomor pemilik akun (mock Fonnte)', async () => {
  const realFetch = globalThis.fetch;
  const savedToken = process.env.FONNTE_TOKEN;
  let captured = '';
  process.env.FONNTE_TOKEN = 'zz-test-token';
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    captured = String(init?.body || '');
    return new Response(JSON.stringify({ status: true, id: 'zz-mock-deactivated' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: TEST_DEDUPE } });
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    const user = await prisma.user.create({
      data: {
        name: 'Warga Nonaktif Uji',
        email: TEST_EMAIL,
        password: 'x',
        phone: TEST_PHONE,
        role: 'CITIZEN',
        isActive: false,
        suspendReason: 'Melanggar aturan pelaporan',
      },
    });

    const context = await loadLiveChatContext('CITIZEN', user.id);
    assert.equal(context.user.isActive, false);
    assert.equal(context.user.suspendReason, 'Melanggar aturan pelaporan');
    assert.ok(context.announcementStats, 'statistik pengumuman harus tersedia');

    const result = await notifyAccountDeactivated({
      userId: user.id,
      name: user.name,
      phone: user.phone,
      reason: user.suspendReason || '',
      dedupeKey: TEST_DEDUPE,
    });

    assert.equal(result.ok, true);
    const params = new URLSearchParams(captured);
    assert.equal(params.get('target'), '6281200000099');
    const message = params.get('message') || '';
    assert.match(message, /Warga Nonaktif Uji/);
    assert.match(message, /Melanggar aturan pelaporan/);
    assert.match(message, /082118727522/);

    const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: TEST_DEDUPE } });
    assert.equal(log?.status, 'SENT');
    assert.equal(log?.kind, 'ACCOUNT_DEACTIVATED');
  } finally {
    globalThis.fetch = realFetch;
    if (savedToken === undefined) delete process.env.FONNTE_TOKEN;
    else process.env.FONNTE_TOKEN = savedToken;
  }
});

// ---------------------------------------------------------------------------
// 3. Broadcast pengumuman di latar belakang
// ---------------------------------------------------------------------------

test('broadcast pengumuman memakai template resmi dan berjalan di latar belakang', () => {
  const lib = read('src/lib/announcementBroadcast.ts');
  assert.match(lib, /export async function broadcastAnnouncementWhatsAppAll/);
  assert.match(lib, /PENGUMUMAN \$\{VILLAGE_FALLBACK\.name\.toUpperCase\(\)\}/);
  assert.match(lib, /Silakan cek detail pengumuman/);

  const post = read('src/app/api/admin/village/announcements/route.ts');
  assert.match(post, /void broadcastAnnouncementWhatsAppAll/);
  const patch = read('src/app/api/admin/village/announcements/[id]/route.ts');
  assert.match(patch, /void broadcastAnnouncementWhatsAppAll/);
});

// ---------------------------------------------------------------------------
// 4. Konteks AI: status akun + statistik pengumuman
// ---------------------------------------------------------------------------

test('konteks live memuat status akun nonaktif dan statistik pengumuman', () => {
  const context: LiveChatContext = {
    generatedAtWib: '21 Oktober 2026, 17.00 WIB',
    village: {
      name: 'Desa Ciperna',
      district: 'Talun',
      regency: 'Cirebon',
      province: 'Jawa Barat',
      administrativeArea: 'Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon, Jawa Barat',
      address: null,
      phone: null,
      adminWhatsapp: '082118727522',
      instagramHandle: '@syajehh',
      instagramUrl: 'https://www.instagram.com/syajehh/',
      mapLink: null,
    },
    user: {
      name: 'Warga Nonaktif Uji',
      role: 'CITIZEN',
      roleLabel: 'Masyarakat',
      isActive: false,
      suspendReason: 'Melanggar aturan pelaporan',
    },
    reportStats: null,
    announcementStats: { total: 4, published: 2 },
    recentReports: [],
    recentReportsScope: 'laporan milik pengguna yang sedang login',
    errors: [],
  };

  const text = formatLiveChatContext(context);
  assert.match(text, /Status Akun: NONAKTIF/);
  assert.match(text, /Melanggar aturan pelaporan/);
  assert.match(text, /082118727522/);
  assert.match(text, /Statistik pengumuman desa: Total 4; terbit\/aktif 2/);
});

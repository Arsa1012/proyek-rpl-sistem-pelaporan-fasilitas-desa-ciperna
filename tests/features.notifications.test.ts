/**
 * TES FITUR BARU (brief terbaru):
 *  - Fitur 1: notifikasi simpan (toast) + pembedaan jenis kegagalan.
 *  - Fitur 2: notifikasi WhatsApp ke warga sendiri setelah registrasi.
 *  - Fitur 3: pembuatan akun petugas + tautan aktivasi + reset kata sandi.
 *  - Fitur 4: asisten AI berbasis data (tool baru + transparansi sumber).
 *  - Fitur 5: cakupan pengujian di atas.
 *
 * Sifat tes:
 *  - Tes DB bersifat READ-ONLY (hanya membaca/agregasi). Angka hasil tool
 *    dibandingkan dengan query Prisma INDEPENDEN agar terbukti berasal dari
 *    database, bukan tebakan model.
 *  - Pemeriksaan keamanan dilakukan dengan membaca sumber (statis), sehingga
 *    tidak pernah mengirim WhatsApp atau membuat akun nyata.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import * as T from '../src/lib/aiTools';
import { isToolAllowed, executeTools, TOOL_REGISTRY } from '../src/lib/aiToolRegistry';
import { resolveIntent, type ChatTurn } from '../src/lib/aiIntent';
import { describeFailure, describeError, safeJson, serverMessage } from '../src/lib/clientFeedback';
import { hashToken, resolveAccountToken, buildActivationUrl, buildResetUrl } from '../src/lib/accountTokens';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Ambil BODY sebuah fungsi (dalam tanda kurung kurawal) dari sumber TS/TSX,
 * tanpa menyertakan komentar JSDoc fungsi berikutnya. Dipakai untuk memastikan
 * pesan/implementasi tidak memuat kredensial — tanpa memalsukan keberadaan
 * kata pada komentar.
 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `${name} harus ada`);
  // Lewati daftar parameter (mencocokkan tanda kurung).
  let i = src.indexOf('(', start);
  let pd = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') pd++;
    else if (src[i] === ')') {
      pd--;
      if (pd === 0) {
        i++;
        break;
      }
    }
  }
  while (i < src.length && src[i] !== '{') i++;
  const bodyStart = i;
  let bd = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') bd++;
    else if (src[i] === '}') {
      bd--;
      if (bd === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(bodyStart, i);
}

/** True bila body meng-interpolasi nilai kata sandi ke dalam pesan. */
function interpolatesPassword(body: string): boolean {
  return /\$\{[^}]*\bpassword\b[^}]*\}/i.test(body) || /\b(plainPassword|hashedPassword|user\.password|\.password\b)/i.test(body);
}

// ===========================================================================
// FITUR 1 — Notifikasi simpan & pembedaan jenis kegagalan
// ===========================================================================

test('toast global disediakan & dipasang di layout (terang/gelap, aksesibel)', () => {
  assert.ok(existsSync(path.join(ROOT, 'src/components/ui/Toast.tsx')), 'Toast.tsx harus ada');
  const toast = read('src/components/ui/Toast.tsx');
  assert.ok(/export function useToast/.test(toast), 'harus mengekspor useToast');
  assert.ok(/export function ToastProvider/.test(toast), 'harus mengekspor ToastProvider');
  assert.ok(/aria-live/.test(toast), 'harus memakai aria-live agar aksesibel');
  assert.ok(/prefers-reduced-motion|toast-in/.test(read('src/app/globals.css')), 'gaya toast harus tersedia');

  const layout = read('src/app/layout.tsx');
  assert.ok(/ToastProvider/.test(layout), 'layout harus memasang ToastProvider');
  assert.ok(/<ToastProvider>/.test(layout), 'ToastProvider harus membungkus konten aplikasi');
});

test('klarifikasi kegagalan membedakan koneksi / validasi / izin / server', () => {
  const net = describeError(new TypeError('Failed to fetch'));
  assert.equal(net.kind, 'network');
  assert.equal(net.retryable, true, 'kegagalan koneksi harus dapat dicoba ulang');

  const timeout = describeError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(timeout.kind, 'timeout');
  assert.equal(timeout.retryable, true);

  const invalid = describeFailure(json(400), { error: 'Nama wajib diisi' });
  assert.equal(invalid.kind, 'validation');
  assert.equal(invalid.retryable, false, 'validasi tidak perlu diulang apa adanya');
  assert.equal(invalid.message, 'Nama wajib diisi', 'pesan validasi server dipakai');

  assert.equal(describeFailure(json(401)).kind, 'auth');
  assert.equal(describeFailure(json(403), { error: 'Akses ditolak. Hanya Admin.' }).kind, 'forbidden');
  assert.equal(describeFailure(json(404)).kind, 'notfound');
  assert.equal(describeFailure(json(409), { error: 'Email sudah terdaftar' }).kind, 'conflict');
  const server = describeFailure(json(500), { error: 'raw stack trace bocor' });
  assert.equal(server.kind, 'server');
  assert.equal(server.retryable, true, 'gangguan server boleh dicoba ulang');
  assert.ok(!/stack trace/i.test(server.message), 'detail teknis server tidak boleh ditampilkan');
});

test('safeJson & serverMessage aman terhadap body non-JSON', async () => {
  const parsed = await safeJson(new Response('bukan json', { status: 500 }));
  assert.deepEqual(parsed, {});
  assert.equal(serverMessage({ error: ' pesan ' }), 'pesan');
  assert.equal(serverMessage(null), '');
  assert.equal(serverMessage({ error: 123 }), '');
});

test('sukses hanya ditampilkan setelah server mengonfirmasi (res.ok) di alur simpan', () => {
  const flows = [
    'src/components/ui/village/VillageProfileForm.tsx',
    'src/components/ui/village/ServicesManager.tsx',
    'src/components/ui/village/OfficialsManager.tsx',
    'src/components/ui/village/RegionsManager.tsx',
    'src/components/ui/village/AnnouncementsManager.tsx',
    'src/components/ui/AddOfficerButton.tsx',
  ];
  for (const f of flows) {
    const src = read(f);
    assert.ok(/useToast/.test(src), `${f} harus memakai sistem toast bersama`);
    assert.ok(/if\s*\(\s*!res\.ok\s*\)/.test(src) || /!outcome\.ok/.test(src), `${f} harus memeriksa status HTTP/outcome`);
    assert.ok(/describeFailure|describeError|runRequest/.test(src), `${f} harus membedakan jenis kegagalan`);
    assert.ok(/disabled=\{[^}]*\bloading\b[^}]*\}/.test(src), `${f} harus mencegah kirim ganda saat memproses`);
  }
});

// ===========================================================================
// FITUR 2 — Notifikasi WhatsApp ke warga sendiri setelah registrasi
// ===========================================================================

test('registrasi mengirim notifikasi ke NOMOR WARGA SENDIRI setelah akun dibuat', () => {
  const src = read('src/app/api/auth/register/verify/route.ts');
  const createIdx = src.indexOf('.user.create');
  const welcomeIdx = src.indexOf('await notifyCitizenRegistrationWelcome(');
  assert.ok(createIdx > -1 && welcomeIdx > -1, 'harus memanggil notifikasi selamat datang');
  assert.ok(welcomeIdx > createIdx, 'notifikasi harus SETELAH akun tersimpan');
  assert.ok(/welcomeStatus/.test(src), 'status pengiriman WA dipisahkan dari sukses akun');
  assert.ok(/whatsapp:\s*welcomeStatus/.test(src), 'respons memuat status WhatsApp terpisah');
});

test('pesan selamat datang idempoten & tidak memuat kata sandi/token', () => {
  const src = read('src/lib/whatsapp.ts');
  const body = fnBody(src, 'notifyCitizenRegistrationWelcome');
  assert.ok(/dedupeKey/.test(body), 'harus idempoten (dedupeKey)');
  assert.equal(interpolatesPassword(body), false, 'tidak boleh mengirim kata sandi');
  assert.ok(!/\$\{[^}]*token[^}]*\}/i.test(body), 'tidak boleh memuat token');
  assert.ok(!/activationUrl|resetUrl/.test(body), 'bukan pesan tautan aktivasi/reset');
});

// ===========================================================================
// FITUR 3 — Akun petugas, aktivasi, dan reset kata sandi
// ===========================================================================

test('pembuatan petugas memaksa role OFFICER (tidak mempercayai role dari browser)', () => {
  const src = read('src/app/api/admin/officers/route.ts');
  assert.ok(/role:\s*'OFFICER'/.test(src), 'role harus dipaksa OFFICER di server');
  assert.equal(/body\.role/.test(src), false, 'role tidak boleh diambil dari body permintaan');
  assert.ok(/session\.role !== 'ADMIN'/.test(src), 'hanya Admin yang boleh membuat petugas');
});

test('kata sandi tidak pernah dikirim lewat WhatsApp; mode aktivasi memakai token', () => {
  const src = read('src/app/api/admin/officers/route.ts');
  const notifyIdx = src.indexOf('notifyOfficerAccountCreated');
  assert.ok(notifyIdx > -1, 'harus memberi tahu petugas setelah akun dibuat');
  const call = src.slice(notifyIdx, src.indexOf('});', notifyIdx));
  assert.equal(/plainPassword/.test(call), false, 'kata sandi tidak boleh diteruskan ke notifikasi WA');
  assert.ok(/createAccountToken/.test(src) && /purpose:\s*'ACTIVATION'/.test(src), 'mode aktivasi memakai token sekali pakai');
  assert.ok(/buildActivationUrl/.test(src), 'tautan aktivasi dibangun dari token mentah');
});

test('tautan aktivasi dikirim ulang tanpa membuat akun baru', () => {
  const f = 'src/app/api/admin/officers/[id]/activation-link/route.ts';
  assert.ok(existsSync(path.join(ROOT, f)), 'endpoint kirim ulang tautan harus ada');
  const src = read(f);
  assert.equal(/prisma\.user\.create/.test(src), false, 'kirim ulang tidak boleh membuat akun baru');
  assert.ok(/service: 'ACTIVATION'/.test(src) || /purpose:\s*'ACTIVATION'/.test(src), 'membuat token aktivasi baru');
  assert.ok(/logAdminAction/.test(src), 'aksi dicatat pada audit log');
});

test('token aktivasi/reset: hanya hash yang disimpan & sekali pakai', async () => {
  const src = read('src/lib/accountTokens.ts');
  assert.ok(/createHash\('sha256'\)/.test(src), 'token disimpan sebagai hash SHA-256');
  assert.ok(/tokenHash/.test(src), 'kolom tokenHash dipakai');
  assert.equal(/data:\s*\{[^}]*\braw\b/.test(src), false, 'token mentah tidak boleh disimpan ke database');
  assert.ok(/usedAt/.test(src) && /expiresAt/.test(src), 'harus sekali pakai & berbatas waktu');

  // Hash deterministik, berbeda dari token mentah.
  const raw = 'abc123'.repeat(6);
  assert.equal(hashToken(raw), hashToken(raw));
  assert.notEqual(hashToken(raw), raw);
  assert.equal(hashToken(raw).length, 64);

  // Token tak dikenal → tidak valid (tanpa menyentuh data sensitif).
  assert.equal(await resolveAccountToken('tidak-ada-token-seperti-ini-123456', 'RESET_PASSWORD'), null);
});

test('tautan aktivasi & reset menunjuk rute internal yang benar', () => {
  const act = buildActivationUrl('RAHASIA');
  const res = buildResetUrl('RAHASIA');
  assert.ok(act.includes('/aktivasi?token='), 'tautan aktivasi mengarah ke /aktivasi');
  assert.ok(res.includes('/reset-password?token='), 'tautan reset mengarah ke /reset-password');
  assert.ok(act.includes('RAHASIA') && res.includes('RAHASIA'), 'token mentah dititipkan pada tautan');
});

test('endpoint & halaman aktivasi/reset/lupa tersedia', () => {
  for (const f of [
    'src/app/api/auth/activate/route.ts',
    'src/app/api/auth/forgot-password/route.ts',
    'src/app/api/auth/reset-password/route.ts',
    'src/app/aktivasi/page.tsx',
    'src/app/lupa-password/page.tsx',
    'src/app/reset-password/page.tsx',
  ]) {
    assert.ok(existsSync(path.join(ROOT, f)), `${f} harus ada`);
  }
  const activate = read('src/app/api/auth/activate/route.ts');
  assert.ok(/consumeAccountToken/.test(activate), 'token dihanguskan setelah dipakai');
  const reset = read('src/app/api/auth/reset-password/route.ts');
  assert.ok(/resolveAccountToken\(token, 'RESET_PASSWORD'\)/.test(reset), 'reset memakai tujuan RESET_PASSWORD');
});

test('lupa kata sandi tidak membocorkan apakah akun terdaftar', () => {
  const src = read('src/app/api/auth/forgot-password/route.ts');
  assert.ok(/GENERIC/.test(src), 'respons selalu umum');
  assert.ok(!/NextResponse\.json\(\s*\{\s*resetUrl/.test(src), 'tautan reset tidak dikembalikan ke klien');
  assert.ok(!/\bresetUrl\b[^;]*NextResponse\.json/.test(src), 'tautan reset tidak boleh masuk respons');
  assert.ok(/rateLimit/.test(src), 'harus dibatasi laju untuk mencegah penyalahgunaan');
  assert.ok(/normalizeIndonesianPhone|user\.phone/.test(src), 'identitas diverifikasi lewat nomor terdaftar');
});

test('notifikasi tautan (aktivasi & reset) idempoten dan tanpa kata sandi', () => {
  const src = read('src/lib/whatsapp.ts');
  for (const fn of ['notifyOfficerAccountCreated', 'notifyPasswordReset']) {
    const body = fnBody(src, fn);
    assert.ok(/dedupeKey/.test(body), `${fn} harus idempoten`);
    assert.equal(interpolatesPassword(body), false, `${fn} tidak boleh mengirim kata sandi`);
    assert.ok(/activationUrl|resetUrl/.test(body), `${fn} memuat tautan aktivasi/reset`);
  }
});

test('UI pembuatan petugas mendukung mode aktivasi & menampilkan status WA', () => {
  const src = read('src/components/ui/AddOfficerButton.tsx');
  assert.ok(/credentialMode/.test(src), 'mengirim mode kredensial');
  assert.ok(/ACTIVATION/.test(src), 'menawarkan mode aktivasi');
  assert.ok(/waStatus|whatsapp/.test(src), 'menampilkan status pengiriman WhatsApp');
  assert.ok(/activationUrl/.test(src), 'menampilkan tautan bila WA gagal (agar diteruskan aman)');
});

// ===========================================================================
// FITUR 4 — Asisten AI berbasis data (tool + intent + transparansi)
// ===========================================================================

const NEW_ADMIN_TOOLS = [
  'getWhatsAppSummary',
  'getAnnouncementOverview',
  'compareReportPeriods',
  'getUnfinishedReports',
];

test('tool AI baru terdaftar & HANYA boleh dipakai Admin', () => {
  for (const name of NEW_ADMIN_TOOLS) {
    assert.ok(TOOL_REGISTRY[name], `tool ${name} harus terdaftar`);
    assert.equal(isToolAllowed('ADMIN', name), true, `${name} untuk Admin`);
    assert.equal(isToolAllowed('OFFICER', name), false, `${name} TIDAK untuk Petugas`);
    assert.equal(isToolAllowed('CITIZEN', name), false, `${name} TIDAK untuk Masyarakat`);
  }
});

test('AI menolak tool tak berwenang tanpa menyentuh database', async () => {
  const res = await executeTools('CITIZEN', 'user-tanpa-izin', [{ name: 'getWhatsAppSummary', args: {} }]);
  assert.equal((res[0].result as { error?: string }).error, 'forbidden');
});

test('intent memahami pertanyaan operasional sehari-hari (Admin)', () => {
  const names = (q: string, h: ChatTurn[] = []) =>
    resolveIntent('ADMIN', q, h).tools.map((t) => t.name);
  assert.equal(names('Ada berapa laporan yang belum selesai?')[0], 'countReports');
  assert.equal((resolveIntent('ADMIN', 'Ada berapa laporan yang belum selesai?').tools[0]?.args as any)?.statusNotFinal, true);
  assert.equal(names('Berapa notifikasi WA yang gagal?')[0], 'getWhatsAppSummary');
  assert.equal(names('Pengumuman apa yang masih aktif?')[0], 'getAnnouncementOverview');
  assert.equal(names('Laporan bulan ini lebih banyak dari bulan lalu?')[0], 'compareReportPeriods');
  assert.equal(names('Ringkas pekerjaan petugas minggu ini.')[0], 'getOfficerWorkload');
  assert.equal(names('Tampilkan laporan yang belum diverifikasi.')[0], 'getUnverifiedQueue');
  // "petugas minggu ini" TIDAK boleh dianggap nama petugas.
  assert.notEqual(names('petugas minggu ini siapa?')[0], 'getOfficerDetail');
});

test('AI memakai konteks untuk pertanyaan lanjutan tentang petugas penanggung jawab', () => {
  const hist: ChatTurn[] = [
    { role: 'user', content: 'tampilkan laporan id 1a2b3c4d' },
    { role: 'assistant', content: 'Laporan Jalan rusak (1a2b3c4d) sedang dikerjakan.' },
  ];
  const t = resolveIntent('ADMIN', 'Siapa petugas yang pegang laporan itu?', hist).tools;
  assert.equal(t[0].name, 'getReportFullDetail');
  assert.deepEqual(t[0].args, { idFragment: '1a2b3c4d' });
});

test('ringkasan WhatsApp cocok dengan database (READ-ONLY, agregasi)', async () => {
  const summary = await T.getWhatsAppSummary();
  assert.equal(summary.log.total, await prisma.whatsAppLog.count());
  assert.equal(summary.log.sent, await prisma.whatsAppLog.count({ where: { status: 'SENT' } }));
  assert.equal(summary.log.failed, await prisma.whatsAppLog.count({ where: { status: 'FAILED' } }));
  assert.equal(summary.announcements.sent, await prisma.announcementDelivery.count({ where: { status: 'SENT' } }));
  assert.equal(summary.log.sent + summary.log.failed <= summary.log.total, true);
});

test('ringkasan pengumuman konsisten dengan database', async () => {
  const ov = await T.getAnnouncementOverview();
  const total = await prisma.villageAnnouncement.count();
  assert.equal(ov.total, total);
  const sum = ov.countsLabeled.reduce((s, x) => s + x.count, 0);
  assert.equal(sum, total, 'jumlah semua status harus sama dengan total');
  assert.equal(ov.activeCount, ov.counts.PUBLISHED);
});

test('perbandingan periode dihitung dari kolom createdAt (WIB)', async () => {
  const cmp = await T.compareReportPeriods();
  assert.equal(cmp.delta, cmp.thisMonth.total - cmp.lastMonth.total);

  // Hitung ulang batas bulan WIB secara independen (bukan memakai implementasi).
  const off = 7 * 3600 * 1000;
  const wib = new Date(Date.now() + off);
  const startThis = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1) - off);
  const expected = await prisma.report.count({ where: { createdAt: { gte: startThis } } });
  assert.equal(cmp.thisMonth.total, expected);
});

test('laporan belum selesai cocok dengan database & tanpa PII', async () => {
  const uf = await T.getUnfinishedReports(5);
  const total = await prisma.report.count({ where: { status: { notIn: ['COMPLETED', 'REJECTED'] } } });
  assert.equal(uf.total, total);
  assert.ok(uf.items.length <= 5, 'harus dibatasi (LIMIT)');
  for (const item of uf.items) {
    assert.equal('email' in item, false, 'tidak boleh memuat email pelapor');
    assert.ok(String(item.status) !== 'COMPLETED');
  }
});

test('output tool tidak memuat nomor telepon, kata sandi, atau token', async () => {
  const summary = await T.getWhatsAppSummary();
  const ov = await T.getAnnouncementOverview();
  const blob = JSON.stringify({ summary, ov });
  assert.ok(!/\b0?8\d{7,}\b/.test(blob), 'tidak boleh ada nomor telepon utuh');
  assert.ok(!/password|kata sandi|token|hash/i.test(blob), 'tidak boleh ada kredensial');
});

test('tool AI tetap READ-ONLY (tanpa operasi tulis)', () => {
  const src = read('src/lib/aiTools.ts');
  for (const re of [/\.create\s*\(/, /\.update\s*\(/, /\.delete\s*\(/, /\.upsert\s*\(/, /\$transaction/, /\$executeRaw/]) {
    assert.equal(re.test(src), false, `aiTools.ts tidak boleh menulis: ${re}`);
  }
});

test('jawaban AI menyertakan transparansi (waktu, sumber, alih data sumber)', () => {
  const src = read('src/lib/aiChat.ts');
  for (const name of NEW_ADMIN_TOOLS) {
    assert.ok(src.includes(`${name}:`), `aiChat.ts harus punya label sumber untuk ${name}`);
  }
  assert.ok(/atWib/.test(src), 'meta memuat waktu pengambilan data');
  assert.ok(/sources:/.test(src), 'meta memuat sumber data');
  const ui = read('src/components/ui/AdminAiAssistant.tsx');
  assert.ok(/Data diperiksa|Data diambil/.test(ui), 'UI menampilkan waktu pemeriksaan data');
  assert.ok(/Sumber data:|Sumber:/.test(ui), 'UI menampilkan sumber data');
  assert.ok(/Lihat|Buka/.test(ui), 'UI menyediakan tautan ke halaman data sumber');
  assert.ok(/Notifikasi WA Gagal|Bulan Ini vs Bulan Lalu/.test(ui), 'UI menyediakan contoh pertanyaan baru');
});

// ===========================================================================
// Penutup: koneksi database pasti ditutup agar runner keluar bersih.
// ===========================================================================
after(async () => {
  await prisma.$disconnect();
});

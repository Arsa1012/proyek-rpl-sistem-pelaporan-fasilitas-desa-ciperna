/**
 * TAHAP 4.8 — UJI FUNGSIONAL WHATSAPP (mock, tanpa pesan sungguhan).
 *
 * Cakupan:
 *  - Aktivasi / penggantian / nonaktivasi penerima notifikasi Admin.
 *  - Tidak ada penerima aktif → notifikasi dihentikan, dicatat FAILED.
 *  - Tidak ada fallback diam-diam ke nomor perangkat pengirim.
 *  - Fonnte tidak tersedia (token kosong) → `skipped` + log FAILED.
 *  - Token/provider menolak → log FAILED dengan kode aman.
 *  - Deduplikasi WhatsAppLog (SENT hanya sekali).
 *  - Notifikasi Warga / Petugas / OTP mengikuti nomor masing-masing.
 *  - Fallback ringkasan ke Admin memakai PENERIMA AKTIF.
 *
 * Keamanan:
 *  - Database: SALINAN `prisma/dev.db` di folder TEMP (gate `PRAGMA database_list`).
 *  - `global.fetch` di-stub → TIDAK ada request ke Fonnte sungguhan.
 *  - Tidak ada kredensial produksi yang dicetak.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// 0. Salinan database (WAJIB sebelum impor modul Prisma).
// ---------------------------------------------------------------------------
const PROJECT_ROOT = process.cwd();
const SOURCE_DB = path.join(PROJECT_ROOT, 'prisma', 'dev.db');
const TEMP_DIR = mkdtempSync(path.join(tmpdir(), 'tahap4-wa-'));
const COPY_DB = path.join(TEMP_DIR, 'wa_flow_test.db');

if (!existsSync(SOURCE_DB)) {
  throw new Error(`Database sumber tidak ditemukan: ${SOURCE_DB}`);
}
copyFileSync(SOURCE_DB, COPY_DB);
process.env.DATABASE_URL = `file:${COPY_DB.replace(/\\/g, '/')}`;

// Nomor uji (11 digit → normalisasi ke 62 + 9 digit).
const ADMIN_PHONE = '08123450001'; // perangkat PENGIRIM
const ADMIN_RECIPIENT = '08123450002'; // PENERIMA notifikasi
const CITIZEN_PHONE = '08123450003';
const OFFICER_PHONE = '08123450004';
const ADMIN_RECIPIENT_2 = '08123450005';

const N_SENDER = '628123450001';
const N_RECIPIENT = '628123450002';
const N_CITIZEN = '628123450003';
const N_OFFICER = '628123450004';
const N_RECIPIENT_2 = '628123450005';

const MASK = (digits: string) => `${digits.slice(0, 4)}****`;

let prisma: any;
let whatsapp: any;
let recipients: any;
let fonnteConfig: any;

let realFetch: typeof globalThis.fetch;
let sentCalls: { url: string; target: string | null; auth: string | null }[] = [];
/** Target yang harus DITOLAK provider (simulasi penolakan). */
let rejectTargets = new Set<string>();
/** Status HTTP untuk semua target lain. */
let providerStatus = 200;

let deviceId = '';
let citizenId = '';
let officerId = '';
let reportId = '';

before(async () => {
  prisma = (await import('../src/lib/prisma')).prisma;
  whatsapp = await import('../src/lib/whatsapp');
  recipients = await import('../src/lib/notificationRecipients');
  fonnteConfig = await import('../src/lib/fonnteConfig');

  // GATE: pastikan yang terhubung adalah SALINAN.
  const rows: any[] = await prisma.$queryRawUnsafe('PRAGMA database_list');
  const fileRow = rows.find((r) => r.file);
  assert.ok(fileRow, 'PRAGMA database_list harus mengembalikan baris file');
  assert.equal(
    path.resolve(String(fileRow.file)).toLowerCase(),
    path.resolve(COPY_DB).toLowerCase(),
    'tes WAJIB berjalan pada salinan database di TEMP'
  );

  // Perangkat pengirim aktif (token uji).
  const device = await prisma.fonnteConfig.create({
    data: {
      deviceName: '__test_device_pengirim__',
      adminPhone: ADMIN_PHONE,
      token: 'TOKEN_UJI_FONNTE',
      isActive: false,
    },
  });
  deviceId = device.id;
  await fonnteConfig.setActiveFonnteConfig(deviceId);

  // Warga + laporan + petugas.
  const citizen = await prisma.user.create({
    data: {
      name: 'Warga Uji WhatsApp',
      email: 'zz-tahap4-warga@example.com',
      password: 'x',
      role: 'CITIZEN',
      phone: CITIZEN_PHONE,
    },
  });
  citizenId = citizen.id;

  const officer = await prisma.user.create({
    data: {
      name: 'Petugas Uji WhatsApp',
      email: 'zz-tahap4-petugas@example.com',
      password: 'x',
      role: 'OFFICER',
      phone: OFFICER_PHONE,
    },
  });
  officerId = officer.id;

  const report = await prisma.report.create({
    data: {
      userId: citizenId,
      title: 'Laporan Uji WhatsApp',
      description: 'Deskripsi laporan uji.',
      category: 'Jalan',
      location: 'Jl. Uji',
      status: 'SUBMITTED',
    },
  });
  reportId = report.id;

  // Stub fetch — tidak ada request sungguhan.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    if (!u.includes('fonnte.com')) {
      throw new Error(`Fetch tidak di-stub untuk URL: ${u}`);
    }
    const body = new URLSearchParams(String(init?.body ?? ''));
    const headers = (init?.headers || {}) as Record<string, string>;
    const target = body.get('target');
    sentCalls.push({ url: u, target, auth: headers.Authorization || null });

    const rejected = target !== null && rejectTargets.has(target);
    const status = rejected ? 400 : providerStatus;
    // Fonnte memakai badan JSON: `{status:true}` = sukses, `{status:false}` = gagal.
    const bodyOk = status >= 200 && status < 300;
    return {
      ok: bodyOk,
      status,
      json: async () => (bodyOk ? { status: true, id: 'msg-uji' } : { status: false, reason: 'ditolak' }),
      text: async () => JSON.stringify(bodyOk ? { status: true } : { status: false }),
    } as unknown as Response;
  }) as typeof globalThis.fetch;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (prisma) {
    try {
      await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: { startsWith: 'zz-tahap4' } } });
      await prisma.notificationRecipient.deleteMany({ where: { label: { startsWith: '__test' } } });
      await prisma.report.deleteMany({ where: { id: reportId } });
      await prisma.user.deleteMany({ where: { email: { startsWith: 'zz-tahap4' } } });
      await prisma.fonnteConfig.deleteMany({ where: { id: deviceId } });
    } catch {
      /* abaikan */
    }
    await prisma.$disconnect();
  }
  try {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Reset penerima notifikasi: nonaktifkan SEMUA dulu (partial UNIQUE INDEX
 * hanya mengizinkan satu aktif), lalu buat satu penerima aktif.
 */
async function resetRecipients(phone = ADMIN_RECIPIENT, label = '__test_penerima_utama__'): Promise<string> {
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });
  await prisma.notificationRecipient.deleteMany({ where: { label: { startsWith: '__test' } } });
  const row = await prisma.notificationRecipient.create({
    data: { label, phone, isActive: false },
  });
  await prisma.notificationRecipient.update({ where: { id: row.id }, data: { isActive: true } });
  return row.id;
}

async function resetLogs() {
  await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: { startsWith: 'zz-tahap4' } } });
  sentCalls = [];
  rejectTargets = new Set();
  providerStatus = 200;
}

// ===========================================================================
// W-01 : notifikasi Admin mengikuti PENERIMA AKTIF
// ===========================================================================
test('W-01 notifikasi Admin dikirim ke nomor PENERIMA AKTIF, bukan nomor perangkat', async () => {
  await resetRecipients();
  await resetLogs();

  const result = await whatsapp.notifyAdminNewUser({
    name: 'Warga Uji',
    email: 'warga.uji@example.com',
    phone: '628123450099',
    role: 'Warga',
    rt: '01',
    rw: '02',
    time: new Date(),
    dashboardUrl: 'http://localhost:3000/admin/masyarakat',
    dedupeKey: 'zz-tahap4:admin:1',
  });

  assert.equal(result.ok, true, 'pesan Admin harus terkirim');
  assert.equal(sentCalls.length, 1, 'Fonnte harus dipanggil tepat 1x');
  assert.equal(
    sentCalls[0].target,
    N_RECIPIENT,
    'tujuan harus nomor PENERIMA aktif, bukan nomor perangkat pengirim'
  );
  assert.notEqual(sentCalls[0].target, N_SENDER, 'nomor perangkat pengirim tidak boleh jadi tujuan');
  assert.equal(sentCalls[0].auth, 'TOKEN_UJI_FONNTE', 'token perangkat aktif yang dipakai');

  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:1' } });
  assert.ok(log, 'harus ada baris WhatsAppLog');
  assert.equal(log.status, 'SENT');
  assert.equal(log.toMasked, MASK(N_RECIPIENT), 'log hanya menyimpan nomor tersamar');
});

// ===========================================================================
// W-02 : ganti penerima aktif → pengiriman berikutnya ikut nomor baru
// ===========================================================================
test('W-02 ganti penerima aktif → notifikasi berikutnya ikut nomor baru', async () => {
  await resetRecipients();
  await resetLogs();

  const second = await recipients.addRecipient({
    label: '__test_penerima_kedua__',
    phone: ADMIN_RECIPIENT_2,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  await recipients.activateRecipient(second.recipient.id);

  await whatsapp.notifyAdminNewReport({
    reportId: 'uji-dummy',
    title: 'Laporan uji',
    reporter: 'Warga Uji',
    category: 'Jalan',
    location: 'Jl. Uji',
    description: 'Deskripsi',
    time: new Date(),
    status: 'SUBMITTED',
    detailUrl: 'http://localhost:3000/admin/laporan',
    dedupeKey: 'zz-tahap4:admin:2',
  });

  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].target, N_RECIPIENT_2, 'tujuan harus recipient yang baru diaktifkan');

  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:2' } });
  assert.equal(log?.toMasked, MASK(N_RECIPIENT_2), 'toMasked harus mencerminkan nomor baru');

  // Nomor lama tidak hilang dan dapat diaktifkan kembali.
  const old = await prisma.notificationRecipient.findFirst({ where: { phone: ADMIN_RECIPIENT } });
  assert.ok(old, 'nomor lama harus tetap tersimpan');
  await recipients.activateRecipient(old.id);
  const resolved = await recipients.resolveActiveRecipient();
  assert.equal(resolved.phone, N_RECIPIENT, 'nomor lama harus bisa diaktifkan kembali');
});

// ===========================================================================
// W-03 : tidak ada penerima aktif → dihentikan + log FAILED (TIDAK ada fallback)
// ===========================================================================
test('W-03 tanpa penerima aktif → tidak ada request Fonnte, log FAILED admin_recipient_unavailable', async () => {
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });
  await resetLogs();

  const result = await whatsapp.notifyAdminNewUser({
    name: 'Warga Uji',
    email: 'warga.uji@example.com',
    phone: '628123450099',
    role: 'Warga',
    time: new Date(),
    dashboardUrl: 'http://localhost:3000/admin/masyarakat',
    dedupeKey: 'zz-tahap4:admin:3',
  });

  assert.equal(result.ok, false, 'notifikasi harus gagal');
  assert.equal(sentCalls.length, 0, 'TIDAK boleh ada request ke Fonnte');

  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:3' } });
  assert.ok(log, 'kegagalan harus tercatat di WhatsAppLog');
  assert.equal(log.status, 'FAILED');
  assert.equal(log.error, 'admin_recipient_unavailable');
  assert.equal(log.toMasked, '-', 'tidak ada nomor tujuan yang dipakai');
});

// ===========================================================================
// W-04 : tidak ada fallback diam-diam ke nomor perangkat pengirim
// ===========================================================================
test('W-04 nomor perangkat pengirim TIDAK dipakai sebagai penerima notifikasi', async () => {
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });
  await resetLogs();

  await whatsapp.notifyAdminNewUser({
    name: 'Warga Uji',
    email: 'warga.uji@example.com',
    phone: '628123450099',
    role: 'Warga',
    time: new Date(),
    dashboardUrl: 'http://localhost:3000/admin/masyarakat',
    dedupeKey: 'zz-tahap4:admin:4',
  });

  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:4' } });
  assert.equal(log?.error, 'admin_recipient_unavailable');
  assert.equal(
    log?.toMasked,
    '-',
    'nomor perangkat pengirim tidak boleh muncul sebagai tujuan'
  );
  assert.equal(sentCalls.length, 0);
});

// ===========================================================================
// W-05 : hanya satu penerima aktif
// ===========================================================================
test('W-05 hanya satu penerima boleh berstatus aktif', async () => {
  const first = await resetRecipients();
  const second = await recipients.addRecipient({
    label: '__test_penerima_lain__',
    phone: ADMIN_RECIPIENT_2,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;

  await recipients.activateRecipient(second.recipient.id);
  const actives = await prisma.notificationRecipient.findMany({ where: { isActive: true } });
  assert.equal(actives.length, 1, 'harus tepat satu penerima aktif');
  assert.equal(actives[0].id, second.recipient.id);

  await recipients.activateRecipient(first);
  const actives2 = await prisma.notificationRecipient.findMany({ where: { isActive: true } });
  assert.equal(actives2.length, 1);
  assert.equal(actives2[0].id, first);
});

// ===========================================================================
// W-06 : Fonnte tidak tersedia (token kosong) → skipped + FAILED not_configured
// ===========================================================================
test('W-06 token Fonnte kosong → pengiriman dihentikan & dicatat not_configured', async () => {
  await resetRecipients();
  await resetLogs();

  const broken = await prisma.fonnteConfig.create({
    data: {
      deviceName: '__test_device_tanpa_token__',
      adminPhone: ADMIN_PHONE,
      token: '',
      isActive: false,
    },
  });
  await fonnteConfig.setActiveFonnteConfig(broken.id);

  try {
    const result = await whatsapp.notifyAdminNewUser({
      name: 'Warga Uji',
      email: 'warga.uji@example.com',
      phone: '628123450099',
      role: 'Warga',
      time: new Date(),
      dashboardUrl: 'http://localhost:3000/admin/masyarat',
      dedupeKey: 'zz-tahap4:admin:6',
    });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true, 'pengiriman harus ditandai skipped');
    assert.equal(result.error, 'not_configured');
    assert.equal(sentCalls.length, 0, 'tidak boleh memanggil Fonnte');

    const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:6' } });
    assert.equal(log?.status, 'FAILED');
    assert.equal(log?.error, 'not_configured');
  } finally {
    await prisma.fonnteConfig.deleteMany({ where: { id: broken.id } });
    await fonnteConfig.setActiveFonnteConfig(deviceId);
  }
});

// ===========================================================================
// W-07 : provider menolak (status 400) → log FAILED dengan kode aman
// ===========================================================================
test('W-07 provider menolak → FAILED provider_rejected, tanpa membocorkan isi', async () => {
  await resetRecipients();
  await resetLogs();
  providerStatus = 400;

  const result = await whatsapp.notifyAdminNewUser({
    name: 'Warga Uji',
    email: 'warga.uji@example.com',
    phone: '628123450099',
    role: 'Warga',
    time: new Date(),
    dashboardUrl: 'http://localhost:3000/admin/masyarakat',
    dedupeKey: 'zz-tahap4:admin:7',
  });

  assert.equal(result.ok, false);
  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:admin:7' } });
  assert.equal(log?.status, 'FAILED');
  assert.ok(String(log?.error).includes('provider_rejected'), 'kode error aman harus tercatat');
  assert.equal(String(log?.error).includes('TOKEN_UJI_FONNTE'), false, 'token tidak boleh bocor ke log');
});

// ===========================================================================
// W-08 : deduplikasi WhatsAppLog
// ===========================================================================
test('W-08 dedupeKey sama → Fonnte hanya dipanggil sekali, log SENT satu baris', async () => {
  await resetRecipients();
  await resetLogs();

  const payload = {
    name: 'Warga Uji',
    email: 'warga.uji@example.com',
    phone: '628123450099',
    role: 'Warga',
    time: new Date(),
    dashboardUrl: 'http://localhost:3000/admin/masyarakat',
    dedupeKey: 'zz-tahap4:admin:8',
  };
  const first = await whatsapp.notifyAdminNewUser(payload);
  const second = await whatsapp.notifyAdminNewUser(payload);

  assert.equal(first.ok, true);
  assert.equal(second.deduped, true, 'pengiriman kedua harus dilewati (dedupe)');
  assert.equal(sentCalls.length, 1, 'Fonnte hanya boleh dipanggil sekali');

  const logs = await prisma.whatsAppLog.findMany({ where: { dedupeKey: 'zz-tahap4:admin:8' } });
  assert.equal(logs.length, 1, 'hanya boleh ada 1 baris log untuk 1 dedupeKey');
  assert.equal(logs[0].status, 'SENT');
});

// ===========================================================================
// W-09 : notifikasi Warga mengikuti nomor Warga
// ===========================================================================
test('W-09 notifikasi warga dikirim ke nomor warga, bukan ke penerima Admin', async () => {
  await resetRecipients();
  await resetLogs();

  const result = await whatsapp.notifyCitizenStatusChange(reportId, 'VERIFIED');

  assert.equal(result.ok, true);
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].target, N_CITIZEN, 'tujuan harus nomor warga pelapor');
  assert.notEqual(sentCalls[0].target, N_RECIPIENT, 'bukan nomor penerima Admin');
});

// ===========================================================================
// W-10 : notifikasi Petugas mengikuti nomor Petugas
// ===========================================================================
test('W-10 notifikasi penugasan dikirim ke nomor petugas', async () => {
  await resetRecipients();
  await resetLogs();

  const result = await whatsapp.notifyOfficerAssignment(reportId, officerId);

  assert.equal(result.ok, true);
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].target, N_OFFICER, 'tujuan harus nomor petugas yang ditugaskan');
  assert.notEqual(sentCalls[0].target, N_RECIPIENT, 'bukan nomor penerima Admin');
});

// ===========================================================================
// W-11 : OTP mengikuti nomor pemilik akun
// ===========================================================================
test('W-11 OTP dikirim ke nomor pemilik akun', async () => {
  await resetRecipients();
  await resetLogs();

  const result = await whatsapp.sendOtpWhatsApp(
    CITIZEN_PHONE,
    'Kode OTP Anda: 123456',
    { dedupeKey: 'zz-tahap4:otp:1' }
  );

  assert.equal(result.ok, true);
  assert.equal(sentCalls.length, 1);
  assert.equal(sentCalls[0].target, N_CITIZEN, 'OTP harus ke nomor pemilik akun');

  const log = await prisma.whatsAppLog.findUnique({ where: { dedupeKey: 'zz-tahap4:otp:1' } });
  assert.equal(log?.status, 'SENT');
  assert.equal(log?.kind, 'OTP');
  // Isi OTP tidak boleh bocor ke log.
  assert.equal(JSON.stringify(log).includes('123456'), false, 'kode OTP tidak boleh masuk log');
});

// ===========================================================================
// W-12 : notifikasi warga gagal → ringkasan diteruskan ke PENERIMA AKTIF
// ===========================================================================
test('W-12 notifikasi warga ditolak provider → ringkasan diteruskan ke PENERIMA AKTIF', async () => {
  await resetRecipients();
  await resetLogs();
  // Provider menolak nomor warga, tetapi menerima nomor Admin.
  rejectTargets = new Set([N_CITIZEN]);

  const result = await whatsapp.notifyCitizenStatusChange(reportId, 'IN_PROGRESS');
  assert.equal(result.ok, false, 'notifikasi warga gagal');

  const fb = await prisma.whatsAppLog.findUnique({
    where: { dedupeKey: `status-fallback:${reportId}:IN_PROGRESS` },
  });
  assert.ok(fb, 'harus ada log fallback admin');
  assert.equal(fb.status, 'SENT');
  assert.equal(fb.toMasked, MASK(N_RECIPIENT), 'fallback harus ke nomor penerima Admin aktif');
  assert.equal(
    sentCalls.some((c) => c.target === N_RECIPIENT),
    true,
    'Fonnte harus dipanggil ke nomor penerima Admin'
  );
});

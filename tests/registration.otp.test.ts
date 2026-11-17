/**
 * Tes VERIFIKASI OTP WHATSAPP untuk registrasi warga.
 *
 * Sifat tes:
 *  - Fonnte di-MOCK (globalThis.fetch) — TIDAK ada pesan WhatsApp nyata.
 *  - Memakai route handler asli (`POST /api/auth/register`, `/verify`, `/resend`)
 *    sehingga validasi server, rate limit, dan transaksi ikut teruji.
 *  - Seluruh baris uji (user, pending OTP, notifikasi, log WA) dihapus kembali.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/prisma';
import { POST as registerPost } from '../src/app/api/auth/register/route';
import { POST as verifyPost } from '../src/app/api/auth/register/verify/route';
import { POST as resendPost } from '../src/app/api/auth/register/resend/route';
import {
  classifyOtpSendFailure,
  generateOtp,
  hashOtp,
  otpMatches,
  validateRegistrationPayload,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MS,
} from '../src/lib/registrationOtp';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const EMAIL_PREFIX = 'zz-otp-';
const NAME_PREFIX = 'ZZ OTP Uji';
const PASSWORD = 'Rahasia123';

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `0812345${String(6000 + phoneSeq).padStart(4, '0')}`;
}
let ipSeq = 0;
function nextIp(): string {
  ipSeq += 1;
  return `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
}

interface SentMessage {
  target: string;
  message: string;
}
let sent: SentMessage[] = [];
let mockFail = false;
let mockFailReason = 'invalid token';
const originalFetch = globalThis.fetch;

function installMockFonnte(): void {
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    const body = init?.body as URLSearchParams | undefined;
    const target = body && typeof body.get === 'function' ? String(body.get('target') || '') : '';
    const message = body && typeof body.get === 'function' ? String(body.get('message') || '') : '';
    sent.push({ target, message });
    if (mockFail) {
      return new Response(JSON.stringify({ status: false, reason: mockFailReason }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ status: true, requestid: `req-${sent.length}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const prevEnv = {
  FONNTE_TOKEN: process.env.FONNTE_TOKEN,
  WHATSAPP_ADMIN_NUMBER: process.env.WHATSAPP_ADMIN_NUMBER,
};
const startedAt = new Date();

function body(over: Record<string, unknown> = {}) {
  const phone = (over.phone as string) || nextPhone();
  return {
    name: `${NAME_PREFIX} Satu`,
    email: `${EMAIL_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    phone,
    role: 'CITIZEN',
    ...over,
  };
}

function post(pathname: string, payload: unknown, ip = nextIp()): Request {
  return new Request(`http://localhost${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload),
  });
}

function otpFromLastMessage(): string {
  const last = sent[sent.length - 1];
  const m = last?.message.match(/Kode OTP Anda: \*(\d{6})\*/);
  assert.ok(m, 'pesan OTP harus memuat kode 6 digit');
  return m![1];
}

after(async () => {
  globalThis.fetch = originalFetch;
  await prisma.whatsAppLog.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.notification.deleteMany({ where: { message: { contains: NAME_PREFIX } } });
  await prisma.registrationOtp.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  if (prevEnv.FONNTE_TOKEN === undefined) delete process.env.FONNTE_TOKEN;
  else process.env.FONNTE_TOKEN = prevEnv.FONNTE_TOKEN;
  if (prevEnv.WHATSAPP_ADMIN_NUMBER === undefined) delete process.env.WHATSAPP_ADMIN_NUMBER;
  else process.env.WHATSAPP_ADMIN_NUMBER = prevEnv.WHATSAPP_ADMIN_NUMBER;
  await prisma.$disconnect();
});

// Siapkan mock + konfigurasi provider sebelum tes berjalan.
installMockFonnte();
process.env.FONNTE_TOKEN = 'TEST_FONNTE_TOKEN_OTP';
process.env.WHATSAPP_ADMIN_NUMBER = '082118727522';

// ===========================================================================
// 1. Generator & hash OTP (murni)
// ===========================================================================
test('OTP: 6 digit acak, hash HMAC berbeda dari kode mentah, perbandingan constant-time', () => {
  const code = generateOtp();
  assert.match(code, /^\d{6}$/);
  const hash = hashOtp(code);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, code);
  assert.equal(otpMatches(code, hash), true);
  // Kode salah tidak cocok.
  const wrong = code === '123456' ? '654321' : '123456';
  assert.equal(otpMatches(wrong, hash), false);
  assert.equal(otpMatches('abc', hash), false);
  assert.equal(otpMatches('', hash), false);
});

test('validasi payload: password lemah, konfirmasi beda, nomor invalid ditolak', () => {
  assert.equal(validateRegistrationPayload(body({ password: 'lemah', confirmPassword: 'lemah' })).ok, false);
  assert.equal(validateRegistrationPayload(body({ confirmPassword: 'Beda12345' })).ok, false);
  assert.equal(validateRegistrationPayload(body({ phone: '12345' })).ok, false);
  const ok = validateRegistrationPayload(body({ phone: '081234567890' }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.phone, '6281234567890');
});

// ===========================================================================
// 2. Tahap 1 — kirim OTP
// ===========================================================================
test('OTP dikirim ke nomor warga (08xx → 628xx), akun BELUM dibuat, respons tanpa kode', async () => {
  sent = [];
  const phone = nextPhone();
  const p = body({ phone });
  const expected = `62${phone.slice(1)}`;
  const res = await registerPost(post('/api/auth/register', p));
  const data = await res.json();

  assert.equal(res.status, 200, data.error);
  assert.equal(data.step, 'verify');
  assert.equal(data.email, p.email);
  assert.match(data.phoneMasked, new RegExp(`^${expected.slice(0, 4)}\\*+$`));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].target, expected);
  assert.match(sent[0].message, /Kode OTP Anda: \*\d{6}\*/);
  assert.match(sent[0].message, /berlaku 5 menit/);
  // Kode OTP tidak boleh muncul di respons API.
  const code = otpFromLastMessage();
  assert.equal(JSON.stringify(data).includes(code), false, 'respons tidak boleh memuat kode OTP');

  // Akun belum dibuat sebelum verifikasi.
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);

  const pending = await prisma.registrationOtp.findUnique({ where: { email: p.email } });
  assert.ok(pending);
  assert.equal(pending!.phone, expected);
  const ttl = pending!.expiresAt.getTime() - Date.now();
  assert.ok(ttl > OTP_TTL_MS - 10_000 && ttl <= OTP_TTL_MS, `TTL tidak wajar: ${ttl}`);
  assert.equal(pending!.attempts, 0);
});

test('password sementara disimpan sebagai hash bcrypt, BUKAN teks biasa', async () => {
  sent = [];
  const p = body();
  const res = await registerPost(post('/api/auth/register', p));
  assert.equal(res.status, 200);
  const pending = await prisma.registrationOtp.findUnique({ where: { email: p.email } });
  assert.ok(pending);
  assert.notEqual(pending!.passwordHash, PASSWORD);
  assert.match(pending!.passwordHash, /^\$2[aby]\$/);
  assert.equal(await bcrypt.compare(PASSWORD, pending!.passwordHash), true);
});

test('email atau nomor yang sudah terdaftar tidak membuat pending/akun ganda', async () => {
  const p = body();
  const existing = await prisma.user.create({
    data: { name: `${NAME_PREFIX} Lama`, email: p.email, password: 'x', role: 'CITIZEN' },
  });
  try {
    sent = [];
    const res = await registerPost(
      post('/api/auth/register', body({ email: p.email }))
    );
    assert.equal(res.status, 409);
    assert.equal(sent.length, 0, 'tidak boleh mengirim OTP untuk email terdaftar');
    assert.equal(await prisma.registrationOtp.findUnique({ where: { email: p.email } }), null);
    assert.equal(await prisma.user.count({ where: { email: p.email } }), 1);
  } finally {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const phone = nextPhone();
  const phoneUser = await prisma.user.create({
    data: {
      name: `${NAME_PREFIX} Lama 2`,
      email: `${EMAIL_PREFIX}phone-${Date.now()}@example.test`,
      password: 'x',
      role: 'CITIZEN',
      phone: `62${phone.slice(1)}`,
    },
  });
  try {
    sent = [];
    const res = await registerPost(post('/api/auth/register', body({ phone })));
    assert.equal(res.status, 409);
    assert.equal(sent.length, 0);
    assert.equal(await prisma.registrationOtp.count({ where: { phone: `62${phone.slice(1)}` } }), 0);
  } finally {
    await prisma.user.delete({ where: { id: phoneUser.id } });
  }
});

// ===========================================================================
// 3. Tahap 2 — verifikasi
// ===========================================================================
test('OTP valid menyelesaikan registrasi; akun aktif dengan password hash bcrypt', async () => {
  sent = [];
  const p = body();
  const start = await registerPost(post('/api/auth/register', p));
  assert.equal(start.status, 200);
  const code = otpFromLastMessage();

  const res = await verifyPost(post('/api/auth/register/verify', { email: p.email, code, phone: p.phone }));
  const data = await res.json();
  assert.equal(res.status, 201, data.error);
  assert.equal(data.success, true);
  assert.ok(['sent', 'skipped', 'failed'].includes(data.whatsapp));

  const user = await prisma.user.findUnique({ where: { email: p.email } });
  assert.ok(user, 'akun harus dibuat setelah OTP valid');
  assert.equal(user!.role, 'CITIZEN');
  assert.equal(user!.phone, '62' + p.phone.slice(1));
  assert.ok(user!.phoneVerifiedAt instanceof Date, 'nomor harus ditandai terverifikasi');
  assert.equal(await bcrypt.compare(PASSWORD, user!.password), true);

  // Data sementara dibersihkan setelah sukses.
  assert.equal(await prisma.registrationOtp.findUnique({ where: { email: p.email } }), null);
});

test('OTP salah ditolak, percobaan bertambah, dan kode benar tetap tidak dipakai sebelum batas', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();
  const wrong = code === '000000' ? '111111' : '000000';

  const res = await verifyPost(post('/api/auth/register/verify', { email: p.email, code: wrong, phone: p.phone }));
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'Kode OTP salah. Silakan periksa kembali.');
  assert.equal(typeof data.remainingAttempts, 'number');

  const pending = await prisma.registrationOtp.findUnique({ where: { email: p.email } });
  assert.equal(pending!.attempts, 1);
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);
});

test('OTP kedaluwarsa ditolak dan tidak membuat akun', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();
  await prisma.registrationOtp.update({
    where: { email: p.email },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const res = await verifyPost(post('/api/auth/register/verify', { email: p.email, code, phone: p.phone }));
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'Kode OTP sudah kedaluwarsa. Silakan minta kode baru.');
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);
  assert.equal(await prisma.registrationOtp.findUnique({ where: { email: p.email } }), null);
});

test('OTP untuk nomor lain ditolak dan tidak menghanguskan kode', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();

  const res = await verifyPost(
    post('/api/auth/register/verify', { email: p.email, code, phone: nextPhone() })
  );
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.equal(data.error, 'Kode OTP salah. Silakan periksa kembali.');
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);

  // Kode TIDAK dihanguskan dan `attempts` tidak bertambah oleh nomor salah.
  const pending = await prisma.registrationOtp.findUnique({ where: { email: p.email } });
  assert.equal(pending!.attempts, 0);

  // Dengan nomor yang benar, kode yang sama tetap berhasil.
  const ok = await verifyPost(
    post('/api/auth/register/verify', { email: p.email, code, phone: p.phone })
  );
  assert.equal(ok.status, 201);
});

test('verifikasi tanpa nomor WhatsApp ditolak', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();

  const res = await verifyPost(post('/api/auth/register/verify', { email: p.email, code }));
  const data = await res.json();
  assert.equal(res.status, 400);
  assert.match(data.error, /nomor whatsapp/i);
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);
});

test('sesi kedaluwarsa tidak memblokir pendaftaran baru (email & nomor sama)', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  await prisma.registrationOtp.update({
    where: { email: p.email },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });

  const again = await registerPost(post('/api/auth/register', { ...p }));
  const data = await again.json();
  assert.equal(again.status, 200, data.error);
  assert.equal(sent.length, 2, 'pendaftaran baru harus mengirim OTP baru');

  const code = otpFromLastMessage();
  const ok = await verifyPost(
    post('/api/auth/register/verify', { email: p.email, code, phone: p.phone })
  );
  assert.equal(ok.status, 201);
});

test('OTP sekali pakai: verifikasi kedua dengan kode sama ditolak', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();

  const first = await verifyPost(post('/api/auth/register/verify', { email: p.email, code, phone: p.phone }));
  assert.equal(first.status, 201);
  const second = await verifyPost(post('/api/auth/register/verify', { email: p.email, code, phone: p.phone }));
  assert.equal(second.status, 400);
  assert.equal(await prisma.user.count({ where: { email: p.email } }), 1);
});

test('batas 5 percobaan: setelah 5 kode salah, kode benar pun ditolak', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code = otpFromLastMessage();
  const wrong = code === '000000' ? '111111' : '000000';

  let lastStatus = 0;
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    const res = await verifyPost(post('/api/auth/register/verify', { email: p.email, code: wrong, phone: p.phone }));
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429);

  const blocked = await verifyPost(post('/api/auth/register/verify', { email: p.email, code, phone: p.phone }));
  assert.equal(blocked.status, 429);
  assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);
});

// ===========================================================================
// 4. Kirim ulang & kegagalan provider
// ===========================================================================
test('kirim ulang dibatasi 60 detik (tanpa race condition)', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const before = sent.length;

  const res = await resendPost(post('/api/auth/register/resend', { email: p.email }));
  const data = await res.json();
  assert.equal(res.status, 429);
  assert.ok(typeof data.retryAfter === 'number' && data.retryAfter > 0);
  assert.ok(data.retryAfter <= OTP_RESEND_COOLDOWN_SECONDS);
  assert.equal(sent.length, before, 'tidak boleh mengirim OTP baru saat cooldown');
});

test('kirim ulang setelah cooldown mengirim kode baru dan mereset percobaan', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  const code1 = otpFromLastMessage();
  await prisma.registrationOtp.update({
    where: { email: p.email },
    data: { attempts: 3, lastSentAt: new Date(Date.now() - 61_000) },
  });

  const res = await resendPost(post('/api/auth/register/resend', { email: p.email }));
  const data = await res.json();
  assert.equal(res.status, 200, data.error);
  assert.equal(sent.length, 2);
  const code2 = otpFromLastMessage();
  assert.notEqual(code1, code2);

  const pending = await prisma.registrationOtp.findUnique({ where: { email: p.email } });
  assert.equal(pending!.attempts, 0);
  assert.equal(pending!.resendCount, 1);
  assert.equal(otpMatches(code2, pending!.otpHash), true);
});

test('dua permintaan kirim ulang paralel hanya mengirim SATU kode', async () => {
  sent = [];
  const p = body();
  await registerPost(post('/api/auth/register', p));
  await prisma.registrationOtp.update({
    where: { email: p.email },
    data: { lastSentAt: new Date(Date.now() - 61_000) },
  });
  const before = sent.length;

  const ipA = nextIp();
  const ipB = nextIp();
  const [a, b] = await Promise.all([
    resendPost(post('/api/auth/register/resend', { email: p.email }, ipA)),
    resendPost(post('/api/auth/register/resend', { email: p.email }, ipB)),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 429]);
  assert.equal(sent.length, before + 1, 'hanya satu OTP baru yang boleh terkirim');
});

test('token Fonnte salah: gagal aman, tanpa akun, tanpa OTP di respons/log', async () => {
  sent = [];
  mockFail = true;
  mockFailReason = 'invalid token';
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
  console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));

  try {
    const p = body();
    const res = await registerPost(post('/api/auth/register', p));
    const data = await res.json();
    assert.equal(res.status, 503, 'konfigurasi token salah = layanan belum siap, bukan error generik');
    assert.match(data.error, /Konfigurasi layanan WhatsApp/i);
    assert.doesNotMatch(data.error, /periksa koneksi/i);
    assert.ok(!JSON.stringify(data).match(/\d{6}/), 'respons gagal tidak boleh memuat OTP');
    assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);

    // Kode OTP tetap tidak boleh tercatat di log mana pun.
    const code = sent.length ? (sent[0].message.match(/\*(\d{6})\*/) || [])[1] : null;
    if (code) {
      assert.equal(
        logs.some((line) => line.includes(code)),
        false,
        'kode OTP tidak boleh muncul di log'
      );
    }
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
    mockFail = false;
  }
});

test('klasifikasi kegagalan Fonnte: perangkat terputus vs nomor vs paket vs konfigurasi', () => {
  const disconnected = classifyOtpSendFailure({
    configured: true,
    error: 'provider_rejected:request invalid on disconnected device',
  });
  assert.equal(disconnected.status, 503);
  assert.match(disconnected.error, /tidak tersambung/i);
  assert.match(disconnected.error, /bukan masalah pada nomor atau ponsel Anda/i);
  assert.doesNotMatch(disconnected.error, /periksa koneksi/i);

  const invalid = classifyOtpSendFailure({ configured: true, error: 'invalid_recipient' });
  assert.equal(invalid.status, 422);
  assert.match(invalid.error, /Nomor WhatsApp tidak valid/i);

  const free = classifyOtpSendFailure({
    configured: true,
    error: 'provider_rejected:invalid message request on free package',
  });
  assert.equal(free.status, 503);
  assert.match(free.error, /paket layanan/i);

  const notConfigured = classifyOtpSendFailure({ configured: false, error: 'not_configured' });
  assert.equal(notConfigured.status, 503);
  assert.match(notConfigured.error, /belum dikonfigurasi/i);

  const network = classifyOtpSendFailure({ configured: true, error: 'network_error' });
  assert.equal(network.status, 503);
  assert.match(network.error, /belum dapat menjangkau/i);

  const quota = classifyOtpSendFailure({ configured: true, error: 'provider_rejected:quota limit' });
  assert.equal(quota.status, 429);

  const provider = classifyOtpSendFailure({ configured: true, error: 'provider_rejected:unknown' });
  assert.equal(provider.status, 502);
  assert.match(provider.error, /Penyedia layanan WhatsApp menolak/i);
});

test('perangkat WhatsApp layanan terputus: 503 + pesan spesifik, bukan "periksa koneksi"', async () => {
  sent = [];
  mockFail = true;
  mockFailReason = 'request invalid on disconnected device';
  try {
    const p = body();
    const res = await registerPost(post('/api/auth/register', p));
    const data = await res.json();
    assert.equal(res.status, 503);
    assert.match(data.error, /tidak tersambung/i);
    assert.match(data.error, /bukan masalah pada nomor atau ponsel Anda/i);
    assert.doesNotMatch(data.error, /periksa koneksi/i);
    assert.equal(await prisma.user.findUnique({ where: { email: p.email } }), null);
  } finally {
    mockFail = false;
    mockFailReason = 'invalid token';
  }
});

// ===========================================================================
// 5. Kompatibilitas & keamanan statis
// ===========================================================================
test('skema: tabel sementara OTP dengan email & nomor unik, tanpa kolom OTP mentah', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /model RegistrationOtp\b/);
  assert.match(schema, /email\s+String\s+@unique/);
  assert.match(schema, /phone\s+String\s+@unique/);
  assert.match(schema, /otpHash\s+String/);
  assert.match(schema, /passwordHash\s+String/);
  assert.doesNotMatch(schema, /\botp\s+String/);
});

test('route registrasi tidak membuat akun sebelum OTP; verifikasi membuat akun', () => {
  const start = read('src/app/api/auth/register/route.ts');
  const verify = read('src/app/api/auth/register/verify/route.ts');
  assert.doesNotMatch(start, /\.user\.create/);
  assert.match(start, /startRegistration/);
  assert.match(verify, /\.user\.create/);
  assert.match(verify, /registrationOtp\.deleteMany/);
  assert.match(verify, /\$transaction/);
  assert.match(verify, /otpMatches/);
});

test('login pengguna lama tidak diubah/diwajibkan OTP ulang', () => {
  const login = read('src/app/api/auth/login/route.ts');
  assert.doesNotMatch(login, /registrationOtp|emailVerified|otpHash/);
  assert.match(login, /bcrypt\.compare/);
  // Akun nonaktif TETAP boleh login (hanya fitur utamanya dibatasi), jadi route
  // login tidak boleh menolak berdasarkan isActive.
  assert.doesNotMatch(login, /if\s*\(user\.isActive\s*===\s*false\)\s*\{[\s\S]*?status:\s*403/);
  assert.match(login, /suspendReason/);
});

test('notifikasi WhatsApp lama tetap tersedia dan dipanggil', () => {
  const wa = read('src/lib/whatsapp.ts');
  for (const fn of [
    'sendWhatsApp',
    'notifyCitizenReceived',
    'notifyCitizenApproved',
    'notifyAdminNewReport',
    'notifyOfficerAssignment',
    'notifyAdminNewUser',
  ]) {
    assert.ok(new RegExp(`export async function ${fn}\\(`).test(wa), `${fn} harus tetap ada`);
  }
  const verify = read('src/app/api/auth/register/verify/route.ts');
  assert.match(verify, /notifyAdminNewUser/);
  assert.match(verify, /notifyCitizenRegistrationWelcome/);
});

test('UI registrasi: dua tahap, countdown, anti klik ganda, dukungan tema', () => {
  const page = read('src/app/register/page.tsx');
  assert.match(page, /\/api\/auth\/register\/verify/);
  assert.match(page, /\/api\/auth\/register\/resend/);
  assert.match(page, /KIRIM ULANG/);
  assert.match(page, /one-time-code/);
  assert.match(page, /maxLength=\{6\}/);
  assert.match(page, /disabled=\{verifying \|\| done/);
  assert.match(page, /disabled=\{!canResend\}/);
  assert.match(page, /phone: phone\.trim\(\)/, 'verifikasi harus mengirim nomor untuk dicocokkan di server');
  assert.match(page, /var\(--/, 'harus memakai token warna agar terbaca di terang/gelap');
  // Field wilayah lama tetap ada.
  assert.match(page, /\/api\/regions/);
  assert.match(page, /<select/);
  assert.match(page, /rtId/);
});

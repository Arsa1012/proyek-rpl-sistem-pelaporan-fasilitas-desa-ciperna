/**
 * Tes MASTER DATA WILAYAH (RW/RT) + notifikasi registrasi Fonnte.
 *
 * Fokus:
 *  - normalisasi nomor wilayah & label;
 *  - validasi pilihan RT di server (menolak RT/RW tak ada atau nonaktif);
 *  - daftar publik hanya memuat wilayah AKTIF yang punya RT;
 *  - rekap jumlah warga per wilayah (untuk Admin);
 *  - template notifikasi pendaftaran memuat RT/RW + penutup otomatis yang wajib,
 *    dikirim lewat endpoint Fonnte resmi, dan tidak pernah memuat kata sandi;
 *  - idempotency: satu registrasi tidak mengirim pesan dua kali.
 *
 * Jalankan: npm test. Seluruh baris uji dihapus kembali di akhir (tanpa mengubah
 * data nyata).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import {
  getAllRegions,
  getActiveRegions,
  normalizeRegionNumber,
  regionLabel,
  validateRtSelection,
} from '../src/lib/region';
import { notifyAdminNewUser, normalizeIndonesianPhone } from '../src/lib/whatsapp';
import { setActiveFonnteConfig } from '../src/lib/fonnteConfig';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

// Nomor wilayah khusus uji yang tidak dipakai data nyata.
const RW_TEST = '97';
const RT_TEST = '13';
const RW_INACTIVE = '98';
const TEST_EMAIL = 'zz-region-test@example.com';

after(async () => {
  // Bersihkan hanya data uji milik file ini.
  await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
  for (const number of [RW_TEST, RW_INACTIVE]) {
    const rw = await prisma.villageRw.findUnique({ where: { number } });
    if (rw) {
      await prisma.villageRt.deleteMany({ where: { rwId: rw.id } });
      await prisma.villageRw.delete({ where: { id: rw.id } });
    }
  }
  await prisma.whatsAppLog.deleteMany({ where: { dedupeKey: { startsWith: 'zz-region-test:' } } });
});

// ---------------------------------------------------------------------------
// Normalisasi (murni)
// ---------------------------------------------------------------------------

test('normalisasi nomor wilayah: digit 1-3 angka, dipadkan dua digit', () => {
  assert.equal(normalizeRegionNumber('1'), '01');
  assert.equal(normalizeRegionNumber('01'), '01');
  assert.equal(normalizeRegionNumber('10'), '10');
  assert.equal(normalizeRegionNumber('123'), '123');
  assert.equal(normalizeRegionNumber(' 5 '), '05');
  assert.equal(normalizeRegionNumber('0'), null);
  assert.equal(normalizeRegionNumber('00'), null);
  assert.equal(normalizeRegionNumber('1234'), null);
  assert.equal(normalizeRegionNumber('01a'), null);
  assert.equal(normalizeRegionNumber(''), null);
  assert.equal(normalizeRegionNumber(null), null);
  assert.equal(normalizeRegionNumber(undefined), null);
});

test('label wilayah menampilkan RT/RW sekaligus', () => {
  assert.equal(regionLabel({ number: '03', rw: { number: '05' } }), 'RT 03 / RW 05');
  assert.equal(regionLabel(null), null);
  assert.equal(regionLabel(undefined), null);
});

// ---------------------------------------------------------------------------
// Validasi pilihan RT (dipakai registrasi & profil)
// ---------------------------------------------------------------------------

test('pilihan RT kosong sah (kompatibel akun lama tanpa wilayah)', async () => {
  const empty = await validateRtSelection('');
  assert.equal(empty.ok, true);
  const nul = await validateRtSelection(null);
  assert.equal(nul.ok, true);
  if (nul.ok) assert.equal(nul.rt, null);
});

test('RT yang tidak ada / ID tidak valid ditolak server', async () => {
  const missing = await validateRtSelection('rt-tidak-ada-xyz');
  assert.equal(missing.ok, false);

  const badType = await validateRtSelection(123);
  assert.equal(badType.ok, false);

  const tooLong = await validateRtSelection('x'.repeat(80));
  assert.equal(tooLong.ok, false);
});

test('validasi server: RT nonaktif dan RW nonaktif tidak boleh dipilih', async () => {
  const rw = await prisma.villageRw.upsert({
    where: { number: RW_TEST },
    create: { number: RW_TEST, name: 'RW Uji', isActive: true },
    update: { isActive: true },
  });
  const rt = await prisma.villageRt.upsert({
    where: { rwId_number: { rwId: rw.id, number: RT_TEST } },
    create: { rwId: rw.id, number: RT_TEST, name: 'RT Uji', isActive: true },
    update: { isActive: true },
  });

  const valid = await validateRtSelection(rt.id);
  assert.equal(valid.ok, true);
  if (valid.ok && valid.rt) {
    assert.equal(valid.rt.number, RT_TEST);
    assert.equal(valid.rt.rw.number, RW_TEST);
  }

  // RT dinonaktifkan → tidak boleh dipilih warga.
  await prisma.villageRt.update({ where: { id: rt.id }, data: { isActive: false } });
  const inactiveRt = await validateRtSelection(rt.id);
  assert.equal(inactiveRt.ok, false);
  await prisma.villageRt.update({ where: { id: rt.id }, data: { isActive: true } });

  // RW dinonaktifkan → seluruh RT di bawahnya tidak boleh dipilih.
  await prisma.villageRw.update({ where: { id: rw.id }, data: { isActive: false } });
  const inactiveRw = await validateRtSelection(rt.id);
  assert.equal(inactiveRw.ok, false);
  await prisma.villageRw.update({ where: { id: rw.id }, data: { isActive: true } });
});

// ---------------------------------------------------------------------------
// Daftar publik & rekap admin
// ---------------------------------------------------------------------------

test('daftar publik hanya memuat RW/RT aktif yang punya RT', async () => {
  // RW nonaktif dengan RT aktif tidak boleh muncul di registrasi.
  const rwOff = await prisma.villageRw.upsert({
    where: { number: RW_INACTIVE },
    create: { number: RW_INACTIVE, name: 'RW Uji Nonaktif', isActive: false },
    update: { isActive: false },
  });
  await prisma.villageRt.upsert({
    where: { rwId_number: { rwId: rwOff.id, number: RT_TEST } },
    create: { rwId: rwOff.id, number: RT_TEST, isActive: true },
    update: { isActive: true },
  });

  const active = await getActiveRegions();
  assert.ok(!active.some((rw) => rw.number === RW_INACTIVE), 'RW nonaktif harus tersembunyi');

  const mine = active.find((rw) => rw.number === RW_TEST);
  assert.ok(mine, 'RW aktif dengan RT harus muncul');
  assert.ok(mine!.rts.some((rt) => rt.number === RT_TEST));
  // Bentuk publik tidak memuat data pribadi.
  assert.deepEqual(Object.keys(mine!).sort(), ['id', 'name', 'number', 'rts'].sort());
});

test('rekap admin menghitung warga per RT dengan benar', async () => {
  const rw = await prisma.villageRw.findUnique({ where: { number: RW_TEST } });
  assert.ok(rw);
  const rt = await prisma.villageRt.findUnique({ where: { rwId_number: { rwId: rw!.id, number: RT_TEST } } });
  assert.ok(rt);

  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    create: { name: 'Warga Uji Wilayah', email: TEST_EMAIL, password: 'x', role: 'CITIZEN', rtId: rt!.id },
    update: { rtId: rt!.id },
  });

  const all = await getAllRegions();
  const mine = all.find((r) => r.id === rw!.id);
  assert.ok(mine);
  const rtRow = mine!.rts.find((r) => r.id === rt!.id);
  assert.ok(rtRow);
  assert.equal(rtRow!.userCount, 1);
  assert.equal(mine!.userCount, 1);

  await prisma.user.delete({ where: { id: user.id } });
});

// ---------------------------------------------------------------------------
// Skema & endpoint (non-destruktif, tervalidasi server)
// ---------------------------------------------------------------------------

test('skema menyimpan relasi wilayah secara opsional (kompatibel data lama)', () => {
  const schema = read('prisma/schema.prisma');
  assert.ok(/model VillageRw\b/.test(schema), 'model VillageRw harus ada');
  assert.ok(/model VillageRt\b/.test(schema), 'model VillageRt harus ada');
  assert.ok(/rtId\s+String\?/.test(schema), 'User.rtId harus opsional (nullable)');
  assert.ok(/@@unique\(\[rwId, number\]\)/.test(schema), 'nomor RT unik per RW');
});

test('registrasi & profil memvalidasi RT di server, bukan hanya frontend', () => {
  const register = read('src/app/api/auth/register/route.ts');
  assert.ok(/validateRtSelection/.test(register), 'registrasi harus memvalidasi RT di server');
  assert.ok(/rtId/.test(register), 'registrasi harus menyimpan rtId');

  const profile = read('src/app/api/profile/route.ts');
  assert.ok(/validateRtSelection/.test(profile), 'profil harus memvalidasi RT di server');

  const adminCreate = read('src/app/api/admin/regions/route.ts');
  const adminPatch = read('src/app/api/admin/regions/[id]/route.ts');
  assert.ok(/requireAdmin/.test(adminCreate) && /requireAdmin/.test(adminPatch), 'endpoint admin wajib requireAdmin');
  assert.ok(/isActive/.test(adminPatch), 'penonaktifan wilayah harus didukung');
});

test('tidak ada penghapusan permanen wilayah (hanya nonaktif)', () => {
  const create = read('src/app/api/admin/regions/route.ts');
  const patch = read('src/app/api/admin/regions/[id]/route.ts');
  assert.ok(!/\.delete\(/.test(create), 'endpoint create tidak boleh menghapus');
  assert.ok(!/\.delete\(/.test(patch), 'endpoint update tidak boleh menghapus wilayah');
});

// ---------------------------------------------------------------------------
// Notifikasi registrasi via Fonnte (mock fetch — tanpa jaringan nyata)
// ---------------------------------------------------------------------------

test('normalisasi nomor admin mengenali format 08xx', () => {
  assert.equal(normalizeIndonesianPhone('082118727522'), '6282118727522');
});

test('notifikasi registrasi: template wajib, RT/RW, penutup otomatis, tanpa kata sandi', async () => {
  // Perangkat uji DIBUAT & DIAKTIFKAN: pengirim notifikasi adalah perangkat
  // yang sedang dipilih Admin, bukan token `.env`.
  //
  // TAHAP 3: nomor PENERIMA notifikasi dipisahkan dari nomor perangkat
  // pengirim (tabel NotificationRecipient). Test ini membuat penerima aktif
  // sendiri agar target notifikasi terverifikasi eksplisit.
  const originalActive = await prisma.fonnteConfig.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const device = await prisma.fonnteConfig.create({
    data: {
      deviceName: '__test_region_device__',
      adminPhone: '082118727522',
      token: 'TEST_TOKEN_123',
      isActive: false,
    },
  });
  await setActiveFonnteConfig(device.id);

  // Penerima notifikasi AKTIF (TAHAP 3): nomor tujuan notifikasi Admin
  // diambil dari tabel NotificationRecipient, terpisah dari perangkat
  // pengirim. Disimpan agar bisa dibersihkan di blok finally.
  const previousActiveRecipient = await prisma.notificationRecipient.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const testRecipient = await prisma.notificationRecipient.create({
    data: { label: '__test_region_recipient__', phone: '6282118727522', isActive: false },
  });
  await prisma.notificationRecipient.updateMany({ data: { isActive: false } });
  await prisma.notificationRecipient.update({
    where: { id: testRecipient.id },
    data: { isActive: true },
  });

  const prev = {
    token: process.env.FONNTE_TOKEN,
    admin: process.env.WHATSAPP_ADMIN_NUMBER,
    phone: process.env.FONNTE_ADMIN_PHONE,
  };

  const originalFetch = globalThis.fetch;
  let calls = 0;
  const captured: { current: { url: string; auth?: string; body: URLSearchParams } | null } = { current: null };

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls += 1;
    const headers = (init?.headers || {}) as Record<string, string>;
    captured.current = {
      url: String(url),
      auth: headers.Authorization,
      body: new URLSearchParams(String(init?.body ?? '')),
    };
    return {
      status: 200,
      json: async () => ({ status: true, requestid: 'zz-test-1' }),
    } as unknown as Response;
  }) as typeof fetch;

  const dedupeKey = `zz-region-test:register:${Date.now()}`;
  try {
    const result = await notifyAdminNewUser({
      name: 'Warga Uji',
      email: 'warga.uji@example.com',
      phone: '628123456789',
      role: 'Warga',
      rt: '03',
      rw: '05',
      time: new Date('2026-01-02T03:04:00Z'),
      dashboardUrl: 'http://localhost:3000/admin/masyarakat',
      dedupeKey,
    });

    assert.equal(result.ok, true, 'pengiriman harus dianggap sukses setelah Fonnte mengonfirmasi');
    assert.equal(calls, 1);
    assert.ok(captured.current, 'request harus terkirim');
    const sent = captured.current!;
    assert.equal(sent.url, 'https://api.fonnte.com/send');
    assert.equal(sent.auth, 'TEST_TOKEN_123');
    assert.equal(sent.body.get('target'), '6282118727522');
    assert.equal(sent.body.get('countryCode'), '62');

    const message = sent.body.get('message') || '';
    assert.ok(message.includes('REGISTRASI WARGA BARU'), 'judul notifikasi harus jelas');
    assert.ok(message.includes('Nama: Warga Uji'));
    assert.ok(message.includes('Email: warga.uji@example.com'));
    assert.ok(/\bRT: 03\b/.test(message), 'RT harus ada di pesan');
    assert.ok(/\bRW: 05\b/.test(message), 'RW harus ada di pesan');
    assert.ok(
      message.includes('Pesan ini otomatis. Tidak perlu membalas jika tidak ada keperluan lain.'),
      'penutup otomatis wajib ada di pesan yang benar-benar dikirim'
    );
    assert.ok(!/password|kata sandi|hash/i.test(message), 'pesan tidak boleh memuat kredensial');

    // Idempotency: peristiwa yang sama tidak dikirim dua kali.
    const again = await notifyAdminNewUser({
      name: 'Warga Uji',
      email: 'warga.uji@example.com',
      phone: '628123456789',
      role: 'Warga',
      rt: '03',
      rw: '05',
      time: new Date('2026-01-02T03:04:00Z'),
      dashboardUrl: 'http://localhost:3000/admin/masyarakat',
      dedupeKey,
    });
    assert.equal(again.ok, true);
    assert.equal(again.deduped, true, 'pesan kedua harus dilewati (dedupe)');
    assert.equal(calls, 1, 'Fonnte hanya dipanggil sekali untuk satu registrasi');
  } finally {
    globalThis.fetch = originalFetch;
    if (prev.token === undefined) delete process.env.FONNTE_TOKEN;
    else process.env.FONNTE_TOKEN = prev.token;
    if (prev.admin === undefined) delete process.env.WHATSAPP_ADMIN_NUMBER;
    else process.env.WHATSAPP_ADMIN_NUMBER = prev.admin;
    if (prev.phone === undefined) delete process.env.FONNTE_ADMIN_PHONE;
    else process.env.FONNTE_ADMIN_PHONE = prev.phone;
    // Kembalikan perangkat aktif-asli & bersihkan fixture.
    await prisma.fonnteConfig.deleteMany({ where: { id: device.id } });
    if (originalActive) await setActiveFonnteConfig(originalActive.id);
    // Kembalikan penerima notifikasi aktif-asli & bersihkan fixture.
    await prisma.notificationRecipient.deleteMany({ where: { id: testRecipient.id } });
    if (previousActiveRecipient) {
      await prisma.notificationRecipient.update({
        where: { id: previousActiveRecipient.id },
        data: { isActive: true },
      });
    }
  }
});

test('registrasi tidak gagal bila perangkat WhatsApp aktif belum lengkap', async () => {
  // Perangkat aktif dengan token kosong → pengiriman dihentikan, DICATAT, dan
  // TIDAK dialihkan ke perangkat lain maupun ke token `.env`.
  const originalActive = await prisma.fonnteConfig.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const device = await prisma.fonnteConfig.create({
    data: {
      deviceName: '__test_region_device_kosong__',
      adminPhone: '082118727522',
      token: '',
      isActive: false,
    },
  });
  await setActiveFonnteConfig(device.id);

  const originalFetch = globalThis.fetch;
  let providerCalled = false;
  globalThis.fetch = (async () => {
    providerCalled = true;
    return { status: 200, json: async () => ({ status: true }) } as unknown as Response;
  }) as typeof fetch;

  const dedupeKey = `zz-region-test:unconfigured:${Date.now()}`;
  try {
    const result = await notifyAdminNewUser({
      name: 'Warga Uji',
      email: 'warga.uji@example.com',
      phone: '-',
      role: 'Warga',
      time: new Date(),
      dashboardUrl: 'http://localhost:3000/admin/masyarakat',
      dedupeKey,
    });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.error, 'not_configured');
    assert.equal(providerCalled, false, 'provider tidak boleh dipanggil saat konfigurasi tidak valid');

    // Kegagalan HARUS tercatat di log (tidak boleh hilang diam-diam).
    const log = await prisma.whatsAppLog.findFirst({ where: { dedupeKey } });
    assert.ok(log, 'kegagalan konfigurasi harus tercatat di WhatsAppLog');
    assert.equal(log?.status, 'FAILED');
    assert.equal(log?.error, 'not_configured');
    await prisma.whatsAppLog.deleteMany({ where: { dedupeKey } });
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.fonnteConfig.deleteMany({ where: { id: device.id } });
    if (originalActive) await setActiveFonnteConfig(originalActive.id);
  }
});

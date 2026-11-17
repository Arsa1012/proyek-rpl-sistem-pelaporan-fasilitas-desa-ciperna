/**
 * TES MULTI-DEVICE WHATSAPP ADMIN (single active sender).
 *
 * Semua test TIDAK mengirim pesan sungguhan: `globalThis.fetch` dipalsukan
 * sehingga tidak ada request ke Fonnte. Yang diperiksa adalah:
 *  - hanya ada SATU perangkat aktif,
 *  - mengaktifkan perangkat lain otomatis menonaktifkan yang lama,
 *  - pengiriman berikutnya memakai token perangkat yang BARU aktif,
 *  - nomor Admin (dashboard & AI Assistant) mengikuti perangkat aktif,
 *  - edit konfigurasi: nama/nomor bisa diubah, token opsional & lama bertahan,
 *  - token tidak pernah bocor ke klien,
 *  - hanya ADMIN yang boleh mengelola konfigurasi.
 *
 * Jalankan: npm test
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import {
  buildFonnteConfigPatch,
  resolveActiveFonnteConfig,
  sanitizePhoneInput,
  sanitizeTokenInput,
  setActiveFonnteConfig,
  updateFonnteConfig,
} from '../src/lib/fonnteConfig';
import { sendWhatsApp } from '../src/lib/whatsapp';
import { getWhatsAppSummary } from '../src/lib/aiTools';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

const DEVICE_A = '__test_wa_a__';
const DEVICE_B = '__test_wa_b__';
const TOKEN_A = 'token-perangkat-a';
const TOKEN_B = 'token-perangkat-b';
const PHONE_A = '081234567890';
const PHONE_B = '081298765432';

let originalActiveId: string | null = null;
let originalFetch: typeof globalThis.fetch;
let deviceAId = '';
let deviceBId = '';

/** Tangkap header Authorization yang dipakai untuk memanggil Fonnte. */
let lastAuthorization: string | null = null;
let lastTarget: string | null = null;

before(async () => {
  const active = await prisma.fonnteConfig.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  originalActiveId = active?.id ?? null;

  // Buang fixture lama bila pernah tertinggal (berdasarkan ID & nama).
  await prisma.fonnteConfig.deleteMany({ where: { deviceName: { in: [DEVICE_A, DEVICE_B] } } });
  await prisma.fonnteConfig.deleteMany({
    where: { OR: [{ deviceName: 'Nama Baru' }, { deviceName: 'Tanpa Ubah Token' }] },
  });

  await prisma.fonnteConfig.create({
    data: { deviceName: DEVICE_A, adminPhone: PHONE_A, token: TOKEN_A, isActive: false },
  });
  await prisma.fonnteConfig.create({
    data: { deviceName: DEVICE_B, adminPhone: PHONE_B, token: TOKEN_B, isActive: false },
  });
  deviceAId = (await prisma.fonnteConfig.findFirst({ where: { deviceName: DEVICE_A }, select: { id: true } }))!.id;
  deviceBId = (await prisma.fonnteConfig.findFirst({ where: { deviceName: DEVICE_B }, select: { id: true } }))!.id;

  // Palsukan fetch: TIDAK ada request sungguhan ke Fonnte.
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const headers = init?.headers || {};
    lastAuthorization = (headers as any).Authorization ?? (headers as any).authorization ?? null;
    const body = init?.body;
    if (typeof body === 'string') {
      lastTarget = body.includes('target=') ? new URLSearchParams(body).get('target') : null;
    } else if (body && typeof body.get === 'function') {
      lastTarget = body.get('target');
    } else {
      lastTarget = null;
    }
    return new Response(JSON.stringify({ status: true, requestid: 'test-request-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  // Pulihkan perangkat aktif-asli & bersihkan fixture (berdasarkan ID, karena
  // nama perangkat bisa berubah saat tes edit).
  if (deviceAId) {
    await prisma.fonnteConfig.deleteMany({ where: { id: deviceAId } });
  }
  if (deviceBId) {
    await prisma.fonnteConfig.deleteMany({ where: { id: deviceBId } });
  }
  await prisma.fonnteConfig.deleteMany({
    where: { OR: [{ deviceName: 'Nama Baru' }, { deviceName: 'Tanpa Ubah Token' }] },
  });
  if (originalActiveId) {
    await setActiveFonnteConfig(originalActiveId);
  }
  await prisma.$disconnect();
});

async function deviceByName(name: string) {
  const row = await prisma.fonnteConfig.findFirst({ where: { deviceName: name } });
  assert.ok(row, `fixture ${name} harus ada`);
  return row;
}

/** Ambil baris perangkat A berdasarkan ID (nama bisa berubah saat tes edit). */
async function deviceA() {
  const row = await prisma.fonnteConfig.findUnique({ where: { id: deviceAId } });
  assert.ok(row, 'fixture perangkat A harus ada');
  return row;
}

async function deviceB() {
  const row = await prisma.fonnteConfig.findUnique({ where: { id: deviceBId } });
  assert.ok(row, 'fixture perangkat B harus ada');
  return row;
}

// ---------------------------------------------------------------------------
// 1 & 2. Single active device
// ---------------------------------------------------------------------------

test('1. mengaktifkan perangkat A menonaktifkan perangkat B', async () => {
  const a = await deviceA();
  const b = await deviceB();

  await setActiveFonnteConfig(a.id);

  const after = await prisma.fonnteConfig.findMany({
    where: { id: { in: [a.id, b.id] } },
    select: { id: true, isActive: true },
  });
  const activeCount = await prisma.fonnteConfig.count({ where: { isActive: true } });
  assert.equal(activeCount, 1, 'harus tepat satu perangkat aktif');
  assert.equal(after.find((x) => x.id === a.id)?.isActive, true, 'A harus aktif');
  assert.equal(after.find((x) => x.id === b.id)?.isActive, false, 'B harus nonaktif');
});

test('2. mengaktifkan perangkat B menonaktifkan perangkat A', async () => {
  const a = await deviceA();
  const b = await deviceB();

  await setActiveFonnteConfig(b.id);

  const activeCount = await prisma.fonnteConfig.count({ where: { isActive: true } });
  assert.equal(activeCount, 1, 'harus tepat satu perangkat aktif');
  const rows = await prisma.fonnteConfig.findMany({
    where: { id: { in: [a.id, b.id] } },
    select: { id: true, isActive: true },
  });
  assert.equal(rows.find((x) => x.id === b.id)?.isActive, true, 'B harus aktif');
  assert.equal(rows.find((x) => x.id === a.id)?.isActive, false, 'A harus nonaktif');
});

test('perangkat aktif ganda dinormalkan otomatis (hanya satu yang bertahan)', async () => {
  const a = await deviceA();
  const b = await deviceB();
  // Simulasikan kondisi "ganda": dua perangkat aktif.
  await prisma.fonnteConfig.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { isActive: true } });

  const resolved = await resolveActiveFonnteConfig();
  const activeCount = await prisma.fonnteConfig.count({ where: { isActive: true } });
  assert.equal(activeCount, 1, 'setelah rekonsiliasi hanya satu perangkat aktif');
  assert.ok(resolved.deviceId, 'harus ada perangkat aktif yang terpilih');
});

// ---------------------------------------------------------------------------
// 3. Pengiriman berikutnya memakai perangkat yang baru aktif
// ---------------------------------------------------------------------------

test('3. pengiriman berikutnya membaca token perangkat yang baru aktif', async () => {
  const a = await deviceA();
  const b = await deviceB();

  await setActiveFonnteConfig(a.id);
  lastAuthorization = null;
  lastTarget = null;
  const resA = await sendWhatsApp('6281234567890', 'uji perangkat A', {
    dedupeKey: `test:device-switch:${Date.now()}:a`,
    kind: 'TEXT',
  });
  assert.equal(resA.ok, true, 'pengiriman (tersimulasi) harus sukses');
  assert.equal(lastAuthorization, TOKEN_A, 'harus memakai token perangkat A');
  assert.equal(lastTarget, '6281234567890', 'nomor TUJUAN tidak boleh berubah jadi nomor perangkat');

  await setActiveFonnteConfig(b.id);
  lastAuthorization = null;
  lastTarget = null;
  const resB = await sendWhatsApp('6281298765432', 'uji perangkat B', {
    dedupeKey: `test:device-switch:${Date.now()}:b`,
    kind: 'TEXT',
  });
  assert.equal(resB.ok, true);
  assert.equal(lastAuthorization, TOKEN_B, 'setelah ganti perangkat, token harus ikut berubah');
  assert.equal(lastTarget, '6281298765432', 'nomor tujuan tetap mengikuti penerima');
});

// ---------------------------------------------------------------------------
// 4. Nomor Admin pada AI mengikuti perangkat aktif
// ---------------------------------------------------------------------------

test('4. ringkasan AI Assistant memakai perangkat aktif & nomor adminnya', async () => {
  const b = await deviceB();
  await setActiveFonnteConfig(b.id);

  const summary: any = await getWhatsAppSummary();
  assert.equal(summary.device.activeDeviceName, DEVICE_B, 'nama perangkat harus mengikuti aktif');
  assert.equal(summary.device.adminPhone, '6281298765432', 'nomor admin harus mengikuti perangkat aktif');
  assert.equal(summary.device.isConfigured, true);
  assert.equal(summary.device.configSource.includes('database'), true);
});

// ---------------------------------------------------------------------------
// 5. Semua kategori notifikasi memakai service pengiriman yang sama
// ---------------------------------------------------------------------------

test('5. seluruh notifikasi melewati service pengiriman utama (tanpa bypass)', () => {
  const whatsapp = read('src/lib/whatsapp.ts');
  // Hanya satu titik kontak ke Fonnte.
  const fonnteCalls = read('src/lib/registrationOtp.ts') + read('src/lib/announcementBroadcast.ts');
  assert.equal(
    /api\.fonnte\.com/.test(fonnteCalls),
    false,
    'tidak boleh ada pemanggilan Fonnte di luar service utama'
  );
  assert.equal(/api\.fonnte\.com/.test(whatsapp), true, 'service utama yang memanggil Fonnte');
  assert.equal(
    (whatsapp.match(/api\.fonnte\.com/g) || []).length,
    1,
    'hanya satu titik pemanggilan Fonnte'
  );

  // Semua modul notifikasi mengimpor service utama.
  for (const file of [
    'src/lib/announcementBroadcast.ts',
    'src/lib/registrationOtp.ts',
    'src/lib/assignmentCancel.ts',
  ]) {
    assert.match(read(file), /from '@\/lib\/whatsapp'/, `${file} harus memakai service utama`);
  }

  // Tidak ada pembacaan token langsung di luar service konfigurasi.
  for (const file of [
    'src/lib/announcementBroadcast.ts',
    'src/lib/registrationOtp.ts',
    'src/app/api/reports/route.ts',
    'src/app/api/auth/login/route.ts',
  ]) {
    assert.equal(/process\.env\.FONNTE_TOKEN/.test(read(file)), false, `${file} tidak boleh membaca token langsung`);
  }
});

// ---------------------------------------------------------------------------
// 6, 7, 8. Edit konfigurasi
// ---------------------------------------------------------------------------

test('6. edit nama perangkat dan nomor berhasil', async () => {
  const a = await deviceA();
  const built = buildFonnteConfigPatch(
    { deviceName: '  Nama Baru  ', adminPhone: ' 081200000001 ' },
    { deviceName: a.deviceName, adminPhone: a.adminPhone }
  );
  assert.equal(built.ok, true);
  const updated = await updateFonnteConfig(a.id, (built as any).patch);
  assert.equal(updated?.deviceName, 'Nama Baru', 'nama perangkat tersimpan');
  assert.equal(updated?.adminPhone, '081200000001', 'nomor tersimpan (dinormalisasi)');
});

test('7. edit tanpa token mempertahankan token lama', async () => {
  const before = await deviceA();
  const built = buildFonnteConfigPatch(
    { deviceName: 'Tanpa Ubah Token' },
    { deviceName: before.deviceName, adminPhone: before.adminPhone }
  );
  assert.equal(built.ok, true);
  assert.equal('token' in (built as any).patch, false, 'token tidak boleh ada di patch');
  assert.equal((built as any).tokenUpdated, false);
  const updated = await updateFonnteConfig(before.id, (built as any).patch);
  assert.equal(updated?.token, before.token, 'token lama harus dipertahankan');
});

test('8. edit dengan token baru menyimpan token baru secara aman (dinormalisasi)', async () => {
  const a = await deviceA();
  const built = buildFonnteConfigPatch(
    { token: '  "token-baru-xyz"  ' },
    { deviceName: a.deviceName, adminPhone: a.adminPhone }
  );
  assert.equal(built.ok, true);
  assert.equal((built as any).patch.token, 'token-baru-xyz', 'tanda kutip & spasi dibuang');
  assert.equal((built as any).tokenUpdated, true);
  const updated = await updateFonnteConfig(a.id, (built as any).patch);
  assert.equal(updated?.token, 'token-baru-xyz');
});

test('token dan nomor dinormalisasi: data lama ber-kutip tidak lagi melumpuhkan sistem', () => {
  assert.equal(sanitizePhoneInput('"082118727522"'), '082118727522');
  assert.equal(sanitizeTokenInput('"abc123"'), 'abc123');
});

// ---------------------------------------------------------------------------
// 9. Token tidak bocor
// ---------------------------------------------------------------------------

test('9. API & UI tidak pernah membocorkan token', () => {
  /** Ambil blok payload NextResponse.json({ ... }) dari sebuah berkas. */
  const responseBlocks = (src: string): string[] => {
    const blocks: string[] = [];
    const multi = /NextResponse\.json\(\{\n([\s\S]*?)\n\s*\}\s*[,)]/g;
    let m: RegExpExecArray | null;
    while ((m = multi.exec(src)) !== null) blocks.push(m[1]);
    const single = /NextResponse\.json\(\{([^\n}]*)\}/g;
    while ((m = single.exec(src)) !== null) blocks.push(m[1]);
    return blocks;
  };

  for (const file of [
    'src/app/api/admin/whatsapp-config/route.ts',
    'src/app/api/admin/whatsapp-config/[id]/route.ts',
    'src/app/api/admin/whatsapp-logs/route.ts',
  ]) {
    const src = read(file);
    const blocks = responseBlocks(src);
    assert.ok(blocks.length > 0, `${file} harus punya respons JSON`);
    for (const block of blocks) {
      assert.equal(
        /\btoken\s*:/i.test(block),
        false,
        `${file} tidak boleh mengembalikan nilai token di respons`
      );
    }
  }

  // Route konfigurasi boleh menampilkan HANYA penanda boolean token.
  for (const file of [
    'src/app/api/admin/whatsapp-config/route.ts',
    'src/app/api/admin/whatsapp-config/[id]/route.ts',
  ]) {
    assert.equal(
      /hasToken|fonnteTokenSet|tokenUpdated/.test(read(file)),
      true,
      `${file} boleh menampilkan penanda token (boolean), bukan nilainya`
    );
  }

  const page = read('src/app/(dashboard)/admin/whatsapp-config/page.tsx');
  // UI tidak boleh MEMBACA nilai token dari data API/perangkat.
  assert.equal(
    /\b(d|device|devices|entry|item|row|data|res|response)\.token\b/.test(page),
    false,
    'UI tidak boleh membaca nilai token dari data perangkat'
  );
  // Yang boleh: nilai token yang DIKETIK Admin untuk mengganti token lama.
  assert.match(page, /body\.token\s*=/, 'UI hanya boleh mengirim token baru yang diketik Admin');
  assert.match(page, /hasToken/, 'UI hanya boleh menampilkan penanda "token tersimpan"');
});

test('monitoring & AI tidak mengembalikan token', () => {
  const monitoring = read('src/lib/whatsappMonitoring.ts');
  assert.equal(/\btoken\s*:/i.test(monitoring), false, 'monitoring tidak boleh mengembalikan nilai token');
  assert.match(monitoring, /tokenValid/, 'hanya penanda validitas yang boleh muncul');
});

// ---------------------------------------------------------------------------
// 10. Akses khusus ADMIN
// ---------------------------------------------------------------------------

test('10. CITIZEN & OFFICER tidak dapat mengelola konfigurasi', () => {
  for (const file of [
    'src/app/api/admin/whatsapp-config/route.ts',
    'src/app/api/admin/whatsapp-config/[id]/route.ts',
    'src/app/api/admin/whatsapp-logs/route.ts',
  ]) {
    const src = read(file);
    assert.match(src, /session\.role !== 'ADMIN'/, `${file} harus membatasi role ADMIN`);
    assert.match(src, /getSession\(\)/, `${file} harus memakai session server`);
  }

  // Tool AI untuk konfigurasi WhatsApp hanya untuk ADMIN.
  const registry = read('src/lib/aiToolRegistry.ts');
  for (const tool of ['getWhatsAppSummary', 'getWhatsAppMonitoringStatus', 'getWhatsAppDeliveryStatus']) {
    const block = registry.split(`${tool}: {`)[1]?.split('},')[0] || '';
    assert.match(block, /roles:\s*ADMIN/, `${tool} harus ADMIN-only`);
  }
});

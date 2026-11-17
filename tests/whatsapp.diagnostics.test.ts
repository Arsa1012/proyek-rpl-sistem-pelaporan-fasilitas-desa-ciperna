/**
 * TES MONITORING WHATSAPP: klasifikasi error, pemisahan mock-vs-nyata,
 * dan endpoint diagnostik (Admin only).
 *
 * TIDAK ada pesan WhatsApp yang dikirim pada test ini:
 * - fetch ke Fonnte tidak pernah dipanggil;
 * - diagnostik hanya DNS/TCP/TLS (tanpa HTTP);
 * - host yang diuji untuk kasus gagal adalah reserved/test range.
 *
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { prisma } from '../src/lib/prisma';
import { classifyTransportError } from '../src/lib/whatsapp';
import { isMockDelivery, isMockDedupeKey, isMockProviderId } from '../src/lib/whatsappDelivery';
import { getWhatsAppMonitoringStatus } from '../src/lib/whatsappMonitoring';
import { runConnectivityDiagnostics, FONNTE_HOST } from '../src/lib/whatsappDiagnostics';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
/** Buang komentar agar pemeriksaan hanya menyasar kode yang benar-benar dieksekusi. */
const readCode = (f: string): string =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

after(async () => {
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// P1 — klasifikasi error
// ---------------------------------------------------------------------------

test('P1: AbortError (timeout milik kita) -> timeout', () => {
  const info = classifyTransportError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(info.kind, 'timeout');
  assert.equal(info.safe, 'timeout', 'kompatibel dengan log lama');
});

test('P1: ENOTFOUND -> network_error:ENOTFOUND', () => {
  const err = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.fonnte.com'), { code: 'ENOTFOUND' }),
  });
  const info = classifyTransportError(err);
  assert.equal(info.kind, 'network_error');
  assert.equal(info.code, 'ENOTFOUND');
  assert.equal(info.safe, 'network_error:ENOTFOUND');
});

test('P1: ECONNREFUSED / ECONNRESET / ETIMEDOUT diklasifikasikan', () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']) {
    const err = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error(`boom ${code}`), { code }),
    });
    const info = classifyTransportError(err);
    assert.equal(info.code, code);
    assert.equal(info.safe, `network_error:${code}`);
  }
});

test('P1: error TLS diklasifikasikan sebagai kode aman', () => {
  const err = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }),
  });
  const info = classifyTransportError(err);
  assert.equal(info.code, 'CERT_HAS_EXPIRED');
  assert.equal(info.safe, 'network_error:CERT_HAS_EXPIRED');
});

test('P1: error tanpa kode dikenal -> network_error (kompatibel dengan log lama)', () => {
  const info = classifyTransportError(new Error('entah'));
  assert.equal(info.kind, 'network_error');
  assert.equal(info.code, null);
  assert.equal(info.safe, 'network_error');
});

test('P1: hasil klasifikasi tidak pernah memuat token/URL/pesan asli', () => {
  const secret = 'SECRET_TOKEN_ABC123';
  const err = Object.assign(new TypeError(`fetch failed https://api.fonnte.com/send?token=${secret}`), {
    cause: Object.assign(new Error(`getaddrinfo ENOTFOUND api.fonnte.com ${secret}`), { code: 'ENOTFOUND' }),
  });
  const info = classifyTransportError(err);
  assert.equal(info.safe.includes(secret), false, 'token tidak boleh ikut');
  assert.equal(info.safe.includes('http'), false, 'URL tidak boleh ikut');
  assert.equal(info.safe.includes('api.fonnte.com'), false, 'host tidak boleh ikut');
  assert.match(info.safe, /^network_error(:[A-Z0-9_]+)?$/, 'hanya kode aman');
});

test('P1: kode yang tidak dikenal TIDAK ikut tersimpan', () => {
  const err = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('rahasia internal'), { code: 'WEIRD_CODE_123' }),
  });
  const info = classifyTransportError(err);
  assert.equal(info.code, null, 'kode di luar daftar putih dibuang');
  assert.equal(info.safe, 'network_error');
});

// ---------------------------------------------------------------------------
// P2 — mock vs nyata
// ---------------------------------------------------------------------------

test('P2: id provider uji dan dedupeKey uji dikenali sebagai mock', () => {
  assert.equal(isMockProviderId('test-request-id'), true);
  assert.equal(isMockProviderId('mock-id'), true);
  assert.equal(isMockProviderId('1091275552'), false, 'id provider asli bukan mock');
  assert.equal(isMockProviderId(null), false);

  assert.equal(isMockDedupeKey('test:device-switch:123'), true);
  assert.equal(isMockDedupeKey('manual-test:123'), true);
  assert.equal(isMockDedupeKey('zz-region-test:1'), true);
  assert.equal(isMockDedupeKey('received:abc-123'), false, 'dedupeKey produksi bukan mock');
});

test('P2: isMockDelivery memprioritaskan id provider lalu dedupeKey', () => {
  assert.equal(isMockDelivery({ providerMessageId: 'test-request-id', dedupeKey: 'received:x' }), true);
  assert.equal(isMockDelivery({ providerMessageId: '1091275552', dedupeKey: 'test:x' }), true);
  assert.equal(isMockDelivery({ providerMessageId: '1091275552', dedupeKey: 'received:x' }), false);
});

test('P2: monitoring memisahkan bukti nyata dan mock', async () => {
  const status = await getWhatsAppMonitoringStatus();
  const s = status.deliverySummary;

  // Field baru harus ada.
  assert.ok('lastRealSuccessAt' in s, 'lastRealSuccessAt harus tersedia');
  assert.ok('lastTestSuccessAt' in s, 'lastTestSuccessAt harus tersedia');
  assert.equal(typeof s.hasRealSuccessfulDelivery, 'boolean');
  assert.equal(typeof s.hasMockDeliveryOnly, 'boolean');

  // Konsistensi dengan database.
  const allSent = await prisma.whatsAppLog.findMany({
    where: { status: 'SENT' },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { updatedAt: true, providerMessageId: true, dedupeKey: true },
  });
  const real = allSent.filter((r) => !isMockDelivery(r));
  const mock = allSent.filter((r) => isMockDelivery(r));
  assert.equal(s.hasRealSuccessfulDelivery, real.length > 0);
  assert.equal(
    s.lastRealSuccessAt?.getTime() ?? null,
    real[0]?.updatedAt.getTime() ?? null,
    'lastRealSuccessAt harus mencerminkan baris SENT non-mock terbaru'
  );
  assert.equal(
    s.lastTestSuccessAt?.getTime() ?? null,
    mock[0]?.updatedAt.getTime() ?? null,
    'lastTestSuccessAt harus mencerminkan baris SENT mock terbaru'
  );

  // Status 'connected' TIDAK boleh muncul bila tidak ada pengiriman nyata 24 jam.
  if (!real.some((r) => r.updatedAt.getTime() >= Date.now() - 24 * 60 * 60 * 1000)) {
    assert.notEqual(status.connectionStatus, 'connected', 'tidak boleh "Terhubung" tanpa bukti nyata');
  }
});

// ---------------------------------------------------------------------------
// P5 — endpoint diagnostik
// ---------------------------------------------------------------------------

test('P5: endpoint diagnostik hanya untuk ADMIN', async () => {
  const src = readCode('src/app/api/admin/whatsapp-diagnostics/route.ts');
  assert.match(src, /getSession\(\)/, 'harus memakai session server');
  assert.match(src, /session\.role !== 'ADMIN'/, 'harus membatasi role ADMIN');
  // Tidak boleh menerima hostname dari request.
  assert.equal(/request\.json|searchParams|get\('host'\)/.test(src), false, 'host tidak boleh dari request');
  // Tidak boleh menyentuh token maupun database.
  assert.equal(/prisma/.test(src), false, 'diagnostik tidak boleh menulis/membaca DB');
  assert.equal(/token/i.test(src), false, 'tidak boleh menyentuh token');
});

test('P5: modul diagnostik tidak melakukan HTTP POST dan tidak memakai kredensial', () => {
  const src = readCode('src/lib/whatsappDiagnostics.ts');
  assert.equal(/api\.fonnte\.com\/send/.test(src), false, 'tidak boleh memanggil endpoint kirim');
  assert.equal(/method:\s*['"]POST['"]/.test(src), false, 'tidak boleh HTTP POST');
  assert.equal(/fetch\s*\(/.test(src), false, 'tidak boleh melakukan request HTTP sama sekali');
  assert.equal(/process\.env/.test(src), false, 'tidak boleh membaca environment/kredensial');
  assert.equal(/Authorization/i.test(src), false, 'tidak boleh menyentuh header otorisasi');
  assert.equal(/Bearer/i.test(src), false);
  assert.equal(FONNTE_HOST, 'api.fonnte.com', 'host harus konstan');
});

test('P5: diagnostik menangani kegagalan DNS tanpa melempar', async () => {
  const result = await runConnectivityDiagnostics('host-yang-tidak-ada.invalid', 443);
  assert.equal(result.dns.ok, false, 'DNS harus gagal untuk host tak dikenal');
  assert.ok(result.dns.detail.length > 0);
  assert.equal(result.tcp.ok, false);
  assert.equal(result.tls.ok, false);
  assert.match(result.summary, /bermasalah|bermasalah/i);
});

test('P5: diagnostik punya timeout (host blackhole tidak menggantung)', async () => {
  const started = Date.now();
  // 203.0.113.0/24 = TEST-NET-3 (alamat dokumentasi, tidak dialokasikan).
  const result = await runConnectivityDiagnostics('203.0.113.1', 443);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 20000, `diagnostik harus selesai cepat (实际 ${elapsed} ms)`);
  assert.equal(result.tcp.ok, false, 'blackhole tidak boleh dianggap OK');
});

test('P5: keluaran diagnostik tidak memuat kredensial/rahasia', async () => {
  const result = await runConnectivityDiagnostics('host-yang-tidak-ada.invalid', 443);
  const blob = JSON.stringify(result);
  assert.equal(/Authorization/i.test(blob), false, 'tidak boleh ada header otorisasi');
  assert.equal(/Bearer\s/i.test(blob), false);
  assert.equal(/process\.env/.test(blob), false);
  assert.equal(/[A-Za-z0-9]{24,}/.test(blob), false, 'tidak boleh ada string panjang mirip kredensial');
  assert.equal(/api\.fonnte\.com\/send/.test(blob), false);
});

// ---------------------------------------------------------------------------
// P6 — tampilan monitoring
// ---------------------------------------------------------------------------

test('P6: UI menampilkan bukti nyata, mock, error terakhir, dan diagnostik', () => {
  const page = read('src/app/(dashboard)/admin/whatsapp-config/page.tsx');
  assert.match(page, /lastRealSuccessAt/, 'harus menampilkan bukti pengiriman nyata');
  assert.match(page, /lastTestSuccessAt/, 'harus menampilkan pengiriman uji/mock');
  assert.match(page, /Error Terakhir/, 'harus menampilkan error terakhir');
  assert.match(page, /Jalankan Diagnostik Koneksi/, 'harus ada tombol diagnostik');
  assert.match(page, /\/api\/admin\/whatsapp-diagnostics/, 'diagnostik diambil dari endpoint');
  assert.match(
    page, /bukan.*berarti pesan terkirim|belum.*berarti pesan terkirim/i,
    'harus menjelaskan koneksi ≠ pesan terkirim'
  );
});

test('P6: monitoring tidak menampilkan "Terhubung" hanya karena mock', () => {
  const src = read('src/lib/whatsappMonitoring.ts');
  // Kondisi 'connected' hanya boleh berdasarkan pengiriman NYATA.
  assert.match(src, /recentRealSent > 0/, 'connected harus bersandar pada pengiriman nyata');
  assert.equal(/recentSent > 0\) \{\s*connectionStatus = 'connected'/.test(src), false);
});

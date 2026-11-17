/**
 * Tes perbaikan laporan: deteksi duplikat berbasis bukti, validasi hasil
 * analisis AI, idempotensi kiriman, intent Asisten Admin, dan konsistensi data.
 *
 * Tidak menulis data ke database aktif (read-only), sesuai aturan proyek.
 * Jalankan: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  scoreSimilarity,
  classifyDuplicate,
  locationSimilarity,
  confidenceBand,
  AUTO_FLAG_THRESHOLD,
  STRONG_BAND_THRESHOLD,
  type LocationEvidence,
} from '../src/lib/duplicates';
import {
  validateAnalysis,
  mapAnalysisError,
  AnalysisError,
} from '../src/lib/aiService';
import { aiStatusLabel } from '../src/lib/reportAnalysis';
import { sanitizeClientKey, isSameSubmission } from '../src/lib/idempotency';
import { resolveIntent } from '../src/lib/aiIntent';
import { TOOL_REGISTRY } from '../src/lib/aiToolRegistry';
import { prisma } from '../src/lib/prisma';

const NOW = new Date('2026-10-20T08:00:00.000Z');

function input(over: Partial<Parameters<typeof scoreSimilarity>[0]> = {}) {
  return {
    category: 'Jalan',
    damageType: 'Lubang',
    location: 'Jl. Merdeka',
    latitude: null as number | null,
    longitude: null as number | null,
    title: 'Lubang besar di jalan',
    description: 'Ada lubang besar di tengah jalan yang membahayakan pengendara',
    createdAt: NOW,
    ...over,
  };
}

function evidence(strength: LocationEvidence['strength']): LocationEvidence {
  return { kind: strength === 'none' ? 'none' : 'coordinates', strength, points: 0, reasons: [] };
}

// ---------------------------------------------------------------------------
// 1. Kasus nyata: kategori + waktu sama, LOKASI BERBEDA → bukan duplikat.
// ---------------------------------------------------------------------------
test('duplikat: kategori sama + waktu berdekatan tetapi lokasi berbeda TIDAK ditandai', () => {
  const a = input({ location: 'Jl. Pilar', title: 'jalan rusak', description: 'jalan rusak parah' });
  const b = input({
    location: 'Taman Siswa',
    title: 'jalan',
    description: 'jalan',
    createdAt: new Date(NOW.getTime() - 3600_000),
  });
  const r = scoreSimilarity(a, b);
  assert.equal(r.flagged, false);
  assert.equal(r.band, 'Tidak cukup bukti');
  assert.ok(r.score < AUTO_FLAG_THRESHOLD, `skor harus di bawah ambang, dapat ${r.score}`);
  assert.equal(r.locationEvidence.strength, 'none');
});

test('duplikat: judul/deskripsi identik tetapi lokasi jelas berbeda → tidak cukup bukti', () => {
  const a = input({ location: 'Jl. Merdeka', title: 'Jalan berlubang', description: 'Jalan berlubang parah' });
  const b = input({ location: 'Jl. Sudirman', title: 'Jalan berlubang', description: 'Jalan berlubang parah' });
  const r = scoreSimilarity(a, b);
  assert.equal(r.flagged, false);
  assert.ok(r.score <= 25, `skor tanpa bukti lokasi harus <= 25, dapat ${r.score}`);
});

test('duplikat: nomor blok berbeda tidak dianggap lokasi sama', () => {
  const sim = locationSimilarity('Jalan Desa Ciperna Blok B', 'Jalan Desa Ciperna Blok D');
  assert.ok(sim < 0.45, `Blok B vs Blok D harus berbeda, similarity=${sim}`);
});

// ---------------------------------------------------------------------------
// 2. Bukti kuat → ditandai, dengan band transparan.
// ---------------------------------------------------------------------------
test('duplikat: koordinat sangat dekat + kategori/jenis sama → Kemungkinan duplikat', () => {
  const a = input({ latitude: -6.95104, longitude: 107.61104 });
  const b = input({ latitude: -6.95104, longitude: 107.61104 });
  const r = scoreSimilarity(a, b);
  assert.equal(r.flagged, true);
  assert.equal(r.band, 'Kemungkinan duplikat');
  assert.ok(r.score >= STRONG_BAND_THRESHOLD);
  assert.ok(r.reasons.some((x) => /Koordinat sangat berdekatan/i.test(x)));
});

test('duplikat: lokasi tekstual sama + judul generik → Perlu pemeriksaan admin (bukan kepastian)', () => {
  const a = input({ location: 'Jl. Merdeka', title: 'jalan', description: '' });
  const b = input({ location: 'Jl. Merdeka', title: 'jalan jelek', description: '' });
  const r = scoreSimilarity(a, b);
  assert.equal(r.flagged, true);
  assert.equal(r.band, 'Perlu pemeriksaan admin');
  assert.ok(r.score >= AUTO_FLAG_THRESHOLD && r.score < STRONG_BAND_THRESHOLD);
});

test('klasifikasi band: bukti lemah/tiada tidak pernah menjadi "Kemungkinan duplikat"', () => {
  assert.equal(classifyDuplicate(99, evidence('none')), 'Tidak cukup bukti');
  assert.equal(classifyDuplicate(99, evidence('weak')), 'Perlu pemeriksaan admin');
  assert.equal(classifyDuplicate(70, evidence('moderate')), 'Perlu pemeriksaan admin');
  assert.equal(classifyDuplicate(STRONG_BAND_THRESHOLD, evidence('strong')), 'Kemungkinan duplikat');
  assert.equal(confidenceBand(90), 'Kemungkinan duplikat');
  assert.equal(confidenceBand(65), 'Perlu pemeriksaan admin');
  assert.equal(confidenceBand(10), 'Tidak cukup bukti');
});

// ---------------------------------------------------------------------------
// 3. Validasi hasil analisis AI (tidak menyimpan hasil palsu/rusak).
// ---------------------------------------------------------------------------
const validRaw = {
  category: 'Jalan',
  damageType: 'Lubang',
  severity: 'SEDANG',
  confidence: 78,
  summary: 'Ada lubang di jalan berdasarkan deskripsi pelapor.',
  recommendation: 'Lakukan pengecekan lokasi oleh petugas.',
  aiResult: 'Jalan - Lubang',
  urgencyReason: 'Lubang berada di jalan yang dilalui warga.',
  reasons: ['Deskripsi menyebut lubang'],
  facts: ['Judul menyebut lubang'],
  missing: ['Foto tidak tersedia'],
  suggestedAction: 'Jadwalkan pengecekan',
};

test('analisis: keluaran valid dinormalisasi (confidence dibatasi 0-99)', () => {
  const ok = validateAnalysis({ ...validRaw, confidence: 150 }, { model: 'm', provider: 'gemini' });
  assert.equal(ok.confidence, 99);
  assert.equal(ok.severity, 'SEDANG');
  assert.deepEqual(ok.reasons, ['Deskripsi menyebut lubang']);
  assert.equal(ok.model, 'm');
});

test('analisis: struktur tidak lengkap ditolak (bukan disimpan sebagai hasil)', () => {
  assert.throws(
    () => validateAnalysis({ ...validRaw, summary: '' }, { model: 'm', provider: 'gemini' }),
    (e: unknown) => e instanceof AnalysisError && e.code === 'invalid_output'
  );
  assert.throws(
    () => validateAnalysis({ ...validRaw, severity: 'PARAH' }, { model: 'm', provider: 'gemini' }),
    (e: unknown) => e instanceof AnalysisError && e.code === 'invalid_output'
  );
  assert.throws(
    () => validateAnalysis(null, { model: 'm', provider: 'gemini' }),
    (e: unknown) => e instanceof AnalysisError && e.code === 'invalid_output'
  );
});

test('analisis: pesan error aman (tanpa detail internal) dan jelas bagi pengguna', () => {
  const notConfigured = mapAnalysisError(new AnalysisError('not_configured'));
  assert.match(notConfigured.message, /belum dikonfigurasi/i);
  assert.doesNotMatch(notConfigured.message, /api[_-]?key|token|stack/i);

  const timeout = mapAnalysisError(new Error('request aborted by timeout'));
  assert.equal(timeout.code, 'timeout');
  assert.match(timeout.message, /terlalu lama/i);

  assert.equal(aiStatusLabel('PENDING'), 'Menunggu analisis');
  assert.equal(aiStatusLabel('SUCCESS'), 'Berhasil dianalisis');
  assert.equal(aiStatusLabel('FAILED'), 'Gagal dianalisis');
  assert.equal(aiStatusLabel('ANALYZING'), 'Sedang dianalisis');
  assert.equal(aiStatusLabel('NEEDS_REVIEW'), 'Perlu ditinjau admin');
});

// ---------------------------------------------------------------------------
// 4. Idempotensi kiriman (anti dobel).
// ---------------------------------------------------------------------------
test('idempotensi: kunci klien valid diterima, kunci berbahaya ditolak', () => {
  assert.equal(sanitizeClientKey('5f0c6a3e-1b2c-4d5e-8f90-123456789abc'), '5f0c6a3e-1b2c-4d5e-8f90-123456789abc');
  assert.equal(sanitizeClientKey('  key_123-abc  '), 'key_123-abc');
  assert.equal(sanitizeClientKey(''), null);
  assert.equal(sanitizeClientKey('has space'), null);
  assert.equal(sanitizeClientKey('a; drop table'), null);
  assert.equal(sanitizeClientKey('x'.repeat(101)), null);
  assert.equal(sanitizeClientKey(123), null);
});

test('idempotensi: hanya kunci + pengguna yang sama dianggap kiriman sama', () => {
  assert.equal(
    isSameSubmission({ userId: 'u1', clientKey: 'k1' }, { userId: 'u1', clientKey: 'k1' }),
    true
  );
  assert.equal(
    isSameSubmission({ userId: 'u1', clientKey: 'k1' }, { userId: 'u2', clientKey: 'k1' }),
    false
  );
  assert.equal(
    isSameSubmission(null, { userId: 'u1', clientKey: 'k1' }),
    false
  );
  assert.equal(
    isSameSubmission({ userId: 'u1', clientKey: null }, { userId: 'u1', clientKey: null }),
    false
  );
});

// ---------------------------------------------------------------------------
// 5. Intent Asisten AI Admin baru.
// ---------------------------------------------------------------------------
test('intent: "kenapa laporan X masuk kategori sedang" → penjelasan analisis tersimpan', () => {
  const res = resolveIntent('ADMIN', 'kenapa laporan pompa rusak masuk kategori sedang?');
  assert.equal(res.tools[0].name, 'explainReportAnalysis');
  assert.equal(res.tools[0].args.idFragment, 'pompa rusak');
});

test('intent: "apakah laporan #ID duplikat" → penilaian kandidat untuk laporan itu', () => {
  const res = resolveIntent('ADMIN', 'apakah laporan #45ed6e03 duplikat?');
  assert.equal(res.tools[0].name, 'findReportDuplicateCandidates');
  assert.equal(res.tools[0].args.idFragment, '45ed6e03');
});

test('intent: "cek laporan duplikat hari ini" tetap ke ringkasan duplikat (regresi)', () => {
  const res = resolveIntent('ADMIN', 'cek laporan duplikat hari ini');
  assert.equal(res.tools[0].name, 'getDuplicateOverview');
});

test('intent: "berapa laporan yang belum dianalisis" → rekap status analisis', () => {
  const res = resolveIntent('ADMIN', 'berapa laporan yang belum dianalisis?');
  assert.equal(res.tools[0].name, 'getAnalysisStatusRecap');
});

test('registry: tool baru hanya untuk ADMIN dan benar-benar terdaftar', () => {
  for (const name of ['explainReportAnalysis', 'findReportDuplicateCandidates', 'getAnalysisStatusRecap']) {
    const def = (TOOL_REGISTRY as any)[name];
    assert.ok(def, `${name} harus terdaftar`);
    assert.deepEqual(def.roles, ['ADMIN']);
  }
});

// ---------------------------------------------------------------------------
// 6. Bukti statis: analisis ulang tidak membuat laporan baru.
// ---------------------------------------------------------------------------
const root = process.cwd();
const analyzeRoute = readFileSync(path.join(root, 'src/app/api/reports/[id]/analyze/route.ts'), 'utf8');
const createRoute = readFileSync(path.join(root, 'src/app/api/reports/route.ts'), 'utf8');
const schema = readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');

test('analisis ulang: memakai runReportAnalysis, TIDAK memanggil prisma.report.create', () => {
  assert.match(analyzeRoute, /runReportAnalysis/);
  assert.doesNotMatch(analyzeRoute, /prisma\.report\.create/);
  assert.match(analyzeRoute, /reportAnalysis|aiStatus/);
});

test('pembuatan laporan: memakai idempotency key dan analisis terpusat', () => {
  assert.match(createRoute, /clientKey/);
  assert.match(createRoute, /runReportAnalysis/);
  assert.match(createRoute, /userId_clientKey/);
  assert.match(schema, /@@unique\(\[userId, clientKey\]\)/);
  assert.match(schema, /model ReportAnalysis/);
  assert.match(schema, /aiStatus\s+String\s+@default\("PENDING"\)/);
});

// ---------------------------------------------------------------------------
// 7. Konsistensi data aktual (READ-ONLY).
// ---------------------------------------------------------------------------
test('data: laporan dengan aiResult selalu berstatus SUCCESS/NEEDS_REVIEW (tidak menampilkan hasil lama sebagai baru)', async () => {
  const inconsistent = await prisma.report.count({
    where: { aiResult: { not: null }, aiStatus: { notIn: ['SUCCESS', 'NEEDS_REVIEW'] } },
  });
  assert.equal(inconsistent, 0);
});

test('data: status analisis hanya memakai nilai yang dikenal', async () => {
  const rows = await prisma.report.findMany({ select: { aiStatus: true } });
  const allowed = new Set(['PENDING', 'ANALYZING', 'SUCCESS', 'FAILED', 'NEEDS_REVIEW']);
  for (const r of rows) assert.ok(allowed.has(r.aiStatus), `status tak dikenal: ${r.aiStatus}`);
});

test('data: band duplikat (bila ada) hanya memakai tiga kategori resmi', async () => {
  const rows = await prisma.report.findMany({
    where: { duplicateBand: { not: null } },
    select: { duplicateBand: true },
  });
  const allowed = new Set(['Kemungkinan duplikat', 'Perlu pemeriksaan admin', 'Tidak cukup bukti']);
  for (const r of rows) assert.ok(allowed.has(r.duplicateBand as string), `band tak dikenal: ${r.duplicateBand}`);
});

test.after(async () => {
  await prisma.$disconnect();
});

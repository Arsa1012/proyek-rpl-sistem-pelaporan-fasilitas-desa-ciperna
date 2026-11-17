/**
 * Tes alur ANALISIS AI LAPORAN (status proses, kegagalan, rekonsiliasi).
 *
 * Fokus:
 * 1. Analisis GAGAL tidak boleh meninggalkan laporan pada status ANALYZING.
 * 2. Status OPERASIONAL laporan warga tidak boleh berubah karena analisis AI.
 * 3. Rekonsiliasi membersihkan laporan ANALYZING yang basi (crash/restart).
 * 4. Pesan error yang sampai ke admin informatif tapi TANPA rahasia teknis.
 *
 * Tidak memanggil layanan AI eksternal (analyzer dimock).
 * Jalankan: npm test
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/lib/prisma';
import { runReportAnalysis, reconcileStaleAnalyses } from '../src/lib/reportAnalysis';
import { AnalysisError, mapAnalysisError } from '../src/lib/aiService';

after(async () => {
  await prisma.$disconnect();
});

/** Buat laporan uji lalu hapus kembali (tidak menyentuh data pengguna nyata). */
async function makeTestReport(overrides: Record<string, unknown> = {}) {
  const user = await prisma.user.findFirst({ where: { role: 'CITIZEN' }, select: { id: true } });
  assert.ok(user, 'fixture: butuh warga');
  const report = await prisma.report.create({
    data: {
      userId: user.id,
      title: 'Laporan uji analisis AI',
      description: 'Lampu jalan mati di jalan utama.',
      location: 'Jl. Uji',
      category: 'Lampu Jalan',
      status: 'SUBMITTED',
      ...overrides,
    },
    select: { id: true, status: true, aiStatus: true, aiError: true },
  });
  return report;
}

const mockSuccess = async () => ({
  category: 'Lampu Jalan',
  damageType: 'Mati',
  severity: 'SEDANG' as const,
  confidence: 80,
  summary: 'Ringkasan uji',
  recommendation: 'Rekomendasi uji',
  aiResult: 'Hasil uji',
  urgencyReason: 'Alasan uji',
  reasons: ['alasan'],
  facts: ['fakta'],
  missing: [],
  suggestedAction: 'Tindakan uji',
  model: 'mock-model',
  provider: 'mock',
});

test('analisis yang melempar -> status FAILED, bukan terjebak ANALYZING', async () => {
  const report = await makeTestReport();
  try {
    const outcome = await runReportAnalysis(report.id, {
      analyzer: async () => {
        throw new AnalysisError('upstream');
      },
    });
    assert.equal(outcome.ok, false);

    const after = await prisma.report.findUnique({
      where: { id: report.id },
      select: { aiStatus: true, aiError: true, status: true },
    });
    assert.equal(after?.aiStatus, 'FAILED', 'harus FAILED, bukan ANALYZING');
    assert.ok(after?.aiError && after.aiError.length > 0, 'pesan error harus tersimpan');

    // Status operasional laporan warga TIDAK boleh berubah karena analisis gagal.
    assert.equal(after?.status, 'SUBMITTED', 'status operasional tidak boleh disentuh analisis AI');

    // Riwayat percobaan tersimpan agar admin bisa melihatnya.
    const attempts = await prisma.reportAnalysis.count({ where: { reportId: report.id } });
    assert.equal(attempts, 1, 'percobaan gagal harus tercatat di ReportAnalysis');
  } finally {
    await prisma.report.delete({ where: { id: report.id } });
  }
});

test('kuota provider (rate limit) -> pesan error informatif tanpa secrets', async () => {
  const report = await makeTestReport();
  try {
    await runReportAnalysis(report.id, {
      analyzer: async () => {
        throw new AnalysisError('rate_limit');
      },
    });
    const after = await prisma.report.findUnique({
      where: { id: report.id },
      select: { aiStatus: true, aiError: true },
    });
    assert.equal(after?.aiStatus, 'FAILED');
    const message = String(after?.aiError || '');
    assert.match(message, /kuota/i, 'pesan harus menyebut kuota');
    assert.doesNotMatch(message, /api[_ -]?key|bearer|https?:\/\/|sk-|AIza/i, 'tidak boleh ada rahasia teknis');
  } finally {
    await prisma.report.delete({ where: { id: report.id } });
  }
});

test('analisis berhasil -> SUCCESS/NEEDS_REVIEW dan kolom ringkas terisi', async () => {
  const report = await makeTestReport();
  try {
    const outcome = await runReportAnalysis(report.id, { analyzer: mockSuccess });
    assert.equal(outcome.ok, true);

    const after = await prisma.report.findUnique({
      where: { id: report.id },
      select: { aiStatus: true, aiConfidence: true, aiResult: true, aiError: true, status: true },
    });
    assert.equal(after?.aiStatus, 'SUCCESS');
    assert.equal(after?.aiConfidence, 80);
    assert.ok(after?.aiResult);
    assert.equal(after?.aiError, null);
    assert.equal(after?.status, 'SUBMITTED', 'status operasional tetap sama');
  } finally {
    await prisma.report.delete({ where: { id: report.id } });
  }
});

test('keyakinan rendah -> NEEDS_REVIEW (bukan SUCCESS penuh)', async () => {
  const report = await makeTestReport();
  try {
    await runReportAnalysis(report.id, {
      analyzer: async () => ({ ...(await mockSuccess()), confidence: 20 }),
    });
    const after = await prisma.report.findUnique({
      where: { id: report.id },
      select: { aiStatus: true },
    });
    assert.equal(after?.aiStatus, 'NEEDS_REVIEW');
  } finally {
    await prisma.report.delete({ where: { id: report.id } });
  }
});

test('rekonsiliasi membersihkan ANALYZING basi: tanpa hasil -> FAILED, ada hasil -> NEEDS_REVIEW', async () => {
  const stuckNoResult = await makeTestReport({ aiStatus: 'ANALYZING' });
  const stuckWithResult = await makeTestReport({ aiStatus: 'ANALYZING', aiResult: 'hasil lama' });
  try {
    // Tandai lama (>10 menit) supaya dianggap basi.
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.report.updateMany({
      where: { id: { in: [stuckNoResult.id, stuckWithResult.id] } },
      data: { updatedAt: old },
    });

    const fixed = await reconcileStaleAnalyses();
    assert.ok(fixed >= 2, 'rekonsiliasi harus menemukan laporan basi');

    const a = await prisma.report.findUnique({ where: { id: stuckNoResult.id }, select: { aiStatus: true } });
    const b = await prisma.report.findUnique({ where: { id: stuckWithResult.id }, select: { aiStatus: true } });
    assert.equal(a?.aiStatus, 'FAILED', 'tanpa hasil analisis -> FAILED');
    assert.equal(b?.aiStatus, 'NEEDS_REVIEW', 'dengan hasil analisis -> NEEDS_REVIEW (invarian aiResult)');
  } finally {
    await prisma.report.delete({ where: { id: stuckNoResult.id } });
    await prisma.report.delete({ where: { id: stuckWithResult.id } });
  }
});

test('rekonsiliasi tidak menyentuh laporan yang statusnya sudah final', async () => {
  const done = await makeTestReport({ aiStatus: 'SUCCESS', aiResult: 'hasil' });
  try {
    await prisma.report.update({ where: { id: done.id }, data: { updatedAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await reconcileStaleAnalyses();
    const after = await prisma.report.findUnique({ where: { id: done.id }, select: { aiStatus: true } });
    assert.equal(after?.aiStatus, 'SUCCESS', 'laporan sukses tidak boleh diubah rekonsiliasi');
  } finally {
    await prisma.report.delete({ where: { id: done.id } });
  }
});

test('pesan error analisis tidak membocorkan rahasia teknis', () => {
  const cases = ['not_configured', 'invalid_output', 'upstream', 'rate_limit', 'timeout', 'unknown'] as const;
  for (const code of cases) {
    const { message } = mapAnalysisError(new AnalysisError(code));
    assert.ok(message.length > 10, `${code} harus punya pesan`);
    assert.doesNotMatch(message, /api[_ -]?key|bearer|sk-[a-z0-9]|AIza|https?:\/\//i, `${code} tidak boleh bocor rahasia`);
  }
});

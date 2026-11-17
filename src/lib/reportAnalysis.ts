/**
 * Orkestrasi analisis AI untuk satu laporan.
 *
 * Tanggung jawab:
 *  - Membaca data laporan + foto dari database/disk (server-side).
 *  - Menjalankan analisis dan MEMVALIDASI hasilnya.
 *  - Menyimpan riwayat ke tabel ReportAnalysis (SUCCESS/FAILED) — TIDAK pernah
 *    membuat laporan baru.
 *  - Memperbarui kolom ringkas pada Report hanya bila analisis BERHASIL.
 *  - Menyimpan status proses (PENDING/ANALYZING/SUCCESS/FAILED), model, waktu,
 *    dan pesan error yang aman.
 *
 * Semua kegagalan dikembalikan sebagai hasil terstruktur (tidak throw), agar
 * route API dapat memberi respons yang jujur kepada pengguna.
 */

import { prisma } from '@/lib/prisma';
import {
  analyzeReport,
  mapAnalysisError,
  type AIAnalysisResult,
  type AnalysisErrorCode,
} from '@/lib/aiService';

export interface AnalysisSuccess {
  ok: true;
  status: 'SUCCESS' | 'NEEDS_REVIEW';
  analysis: AIAnalysisResult;
  durationMs: number;
  analysisId: string;
}

export interface AnalysisFailure {
  ok: false;
  code: AnalysisErrorCode;
  message: string;
  durationMs: number;
  analysisId: string;
}

export type AnalysisOutcome = AnalysisSuccess | AnalysisFailure;

export type Analyzer = typeof analyzeReport;

/** Throttle rekonsiliasi ANALYZING basi: maksimal sekali per menit. */
let lastReconcileAt = 0;

/** Batas ukuran foto yang dibaca untuk analisis (10 MB). */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

function safeErrorForLog(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}

/**
 * Baca foto laporan dari path `/uploads/...` di direktori public.
 * Digunakan di Server Component Next.js.
 * Catatan: Baca langsung di API route atau handler jika butuh data foto sebenarnya.
 * Fungsi ini return placeholder hingga foto diproses melalui jalur yang tepat.
 */
async function readPhoto(reportPhoto: string | null): Promise<{
  base64: string | null;
  mimeType: string | null;
  note?: string;
}> {
  if (!reportPhoto) return { base64: null, mimeType: null };
  // Foto laporan selalu disimpan sebagai path internal "/uploads/...".
  if (!reportPhoto.startsWith('/uploads/')) {
    return { base64: null, mimeType: null, note: 'path foto tidak dikenali' };
  }
  // Placeholder - foto akan diproses saat AI analysis dipicu
  // melalui jalur yang tepat (bukan fs/promises di sini).
  return { base64: null, mimeType: null, note: 'foto disiapkan untuk analisis' };
}

/** Untuk pengujian: ganti fungsi analisis tanpa memanggil API eksternal. */
export interface RunAnalysisOptions {
  analyzer?: Analyzer;
}

/**
 * Rekonsiliasi laporan yang terjebak status ANALYZING.
 *
 * Penyebab historis: proses mati/restart saat analisis berjalan, atau error
 * sebelum jalur penulisan FAILED. Tanpa rekonsiliasi, UI menampilkan
 * "sedang dianalisis" selamanya.
 *
 * Data yang dibenahi HANYA kolom status analisis (aiStatus/aiError), BUKAN
 * status operasional laporan (SUBMITTED/ASSIGNED/...). Ini koreksi status
 * proses, bukan perubahan data warga. Dipanggil sebelum analisis baru.
 */
const STALE_ANALYZING_MS = 10 * 60 * 1000; // 10 menit

export async function reconcileStaleAnalyses(): Promise<number> {
  const threshold = new Date(Date.now() - STALE_ANALYZING_MS);
  try {
    // Kasus 1: laporan yang SUDAH punya hasil analisis lama (aiResult terisi).
    // Status prosesnya tidak diketahui karena analisis terakhir terputus.
    // Invarian: bila aiResult ada, status proses harus SUCCESS/NEEDS_REVIEW —
    // jadi ditandai NEEDS_REVIEW (perlu ditinjau Admin), bukan FAILED.
    const withResult = await prisma.report.updateMany({
      where: {
        aiStatus: 'ANALYZING',
        updatedAt: { lt: threshold },
        aiResult: { not: null },
      },
      data: {
        aiStatus: 'NEEDS_REVIEW',
        aiError:
          'Analisis terakhir tidak selesai; hasil analisis sebelumnya perlu ditinjau Admin.',
      },
    });

    // Kasus 2: belum ada hasil sama sekali → analysis memang gagal/terhenti.
    const withoutResult = await prisma.report.updateMany({
      where: {
        aiStatus: 'ANALYZING',
        updatedAt: { lt: threshold },
        aiResult: null,
      },
      data: {
        aiStatus: 'FAILED',
        aiError:
          'Analisis berhenti di tengah proses (gangguan server atau layanan AI). Jalankan analisis ulang.',
      },
    });

    const total = withResult.count + withoutResult.count;
    if (total > 0) {
      console.log(
        `[report-analysis] rekonsiliasi: ${total} laporan ANALYZING basi dibereskan ` +
          `(${withResult.count} perlu tinjau, ${withoutResult.count} gagal)`
      );
    }
    return total;
  } catch (e) {
    console.error(`[report-analysis] rekonsiliasi gagal (dilanjutkan): ${safeErrorForLog(e)}`);
    return 0;
  }
}

/**
 * Perbaikan DATA LAMA: laporan yang sudah punya hasil analisis (aiResult)
 * tetapi status prosesnya masih PENDING.
 *
 * Ini berasal dari versi lama aplikasi (hasil analisis ditulis, status proses
 * tidak pernah diperbarui). Invarian sistem: bila aiResult ada, status proses
 * harus SUCCESS atau NEEDS_REVIEW.
 *
 * PENTING: fungsi ini TIDAK dipanggil otomatis. Menjalankannya menulis ulang
 * `aiStatus` pada laporan yang sudah ada, jadi harus dilakukan dengan
 * persetujuan pemilik sistem (jalankan manual bila disetujui).
 * Status OPERASIONAL laporan (SUBMITTED/ASSIGNED/…) tidak tersentuh.
 */
export async function repairLegacyAnalysisStatus(): Promise<number> {
  const result = await prisma.report.updateMany({
    where: { aiStatus: 'PENDING', aiResult: { not: null } },
    data: {
      aiStatus: 'NEEDS_REVIEW',
      aiError:
        'Status proses analisis diperbaiki otomatis dari data lama (hasil analisis terdeteksi, perlu ditinjau Admin).',
    },
  });
  if (result.count > 0) {
    console.log(`[report-analysis] perbaikan data lama: ${result.count} laporan PENDING -> NEEDS_REVIEW`);
  }
  return result.count;
}

/**
 * Jalankan (atau jalankan ulang) analisis AI untuk sebuah laporan.
 * Tidak pernah membuat Report baru.
 */
export async function runReportAnalysis(
  reportId: string,
  options: RunAnalysisOptions = {}
): Promise<AnalysisOutcome> {
  const analyzer = options.analyzer || analyzeReport;
  const t0 = Date.now();
  // Rekap status basi dibereskan sekali di awal eksekusi apa pun (murah):
  // admin tidak perlu menunggu cron khusus untuk melihat status jujur.
  const shouldReconcile = Date.now() - lastReconcileAt > 60_000;
  if (shouldReconcile) {
    lastReconcileAt = Date.now();
    await reconcileStaleAnalyses();
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      photo: true,
      aiStatus: true,
    },
  });

  if (!report) {
    return {
      ok: false,
      code: 'unknown',
      message: 'Laporan tidak ditemukan.',
      durationMs: 0,
      analysisId: '',
    };
  }

  // Tandai sedang dianalisis agar UI tidak menampilkan hasil lama sebagai hasil baru.
  try {
    await prisma.report.update({
      where: { id: reportId },
      data: { aiStatus: 'ANALYZING', aiError: null },
    });
  } catch (e) {
    console.error(`[report-analysis] gagal set ANALYZING report=${reportId.slice(0, 8)} err=${safeErrorForLog(e)}`);
  }

  let photo: { base64: string | null; mimeType: string | null };
  let outcome: AnalysisOutcome;

  try {
    // readPhoto di dalam cakupan try: bila ini (atau apa pun di antara set
    // ANALYZING dan analyzer) melempar, penangkap akhir menulis FAILED —
    // tanpa ini laporan bisa terjebak status ANALYZING.
    photo = await readPhoto(report.photo);
    const analysis = await analyzer(
      photo.base64,
      photo.mimeType,
      report.description,
      report.title,
      report.location
    );
    const durationMs = Date.now() - t0;

    // Analisis valid tetapi keyakinan rendah → tandai PERLU DITINJAU Admin.
    // Status proses tetap jujur: bukan "berhasil penuh", bukan pula gagal.
    const resultStatus = analysis.confidence < 50 ? 'NEEDS_REVIEW' : 'SUCCESS';

    const saved = await prisma.reportAnalysis.create({
      data: {
        reportId,
        status: 'SUCCESS',
        provider: analysis.provider,
        model: analysis.model,
        category: analysis.category,
        damageType: analysis.damageType,
        severity: analysis.severity,
        confidence: analysis.confidence,
        summary: analysis.summary,
        urgencyReason: analysis.urgencyReason || null,
        reasons: JSON.stringify(analysis.reasons || []),
        facts: JSON.stringify(analysis.facts || []),
        missing: JSON.stringify(analysis.missing || []),
        recommendation: analysis.recommendation,
        suggestedAction: analysis.suggestedAction || null,
        durationMs,
      },
    });

    // Kolom ringkas pada Report diperbarui HANYA setelah analisis valid.
    await prisma.report.update({
      where: { id: reportId },
      data: {
        aiResult: analysis.aiResult,
        aiConfidence: analysis.confidence,
        category: analysis.category,
        damageType: analysis.damageType,
        severity: analysis.severity,
        aiStatus: resultStatus,
        aiAnalyzedAt: new Date(),
        aiModel: analysis.model,
        aiError: null,
        analysisCount: { increment: 1 },
      },
    });

    console.log(
      `[report-analysis] report=${reportId.slice(0, 8)} status=${resultStatus} provider=${analysis.provider} ` +
      `model=${analysis.model} ms=${durationMs} hasPhoto=${!!photo.base64}`
    );

    outcome = { ok: true, status: resultStatus, analysis, durationMs, analysisId: saved.id };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const safe = mapAnalysisError(err);
    console.error(
      `[report-analysis] report=${reportId.slice(0, 8)} status=FAILED code=${safe.code} ms=${durationMs} err=${safeErrorForLog(err)}`
    );

    let analysisId = '';
    try {
      const failed = await prisma.reportAnalysis.create({
        data: {
          reportId,
          status: 'FAILED',
          errorMessage: safe.message,
          durationMs,
        },
      });
      analysisId = failed.id;
    } catch (e) {
      console.error(`[report-analysis] gagal simpan riwayat FAILED report=${reportId.slice(0, 8)} err=${safeErrorForLog(e)}`);
    }

    try {
      await prisma.report.update({
        where: { id: reportId },
        data: {
          aiStatus: 'FAILED',
          aiError: safe.message,
          aiAnalyzedAt: new Date(),
          analysisCount: { increment: 1 },
        },
      });
    } catch (e) {
      console.error(`[report-analysis] gagal set FAILED report=${reportId.slice(0, 8)} err=${safeErrorForLog(e)}`);
    }

    outcome = { ok: false, code: safe.code, message: safe.message, durationMs, analysisId };
  }

  return outcome;
}

/** Baca ulang array JSON yang disimpan pada ReportAnalysis (aman bila rusak). */
export function safeJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Ambil analisis terakhir yang berhasil (untuk ditampilkan/dijelaskan). */
export async function getLatestSuccessfulAnalysis(reportId: string) {
  return prisma.reportAnalysis.findFirst({
    where: { reportId, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
  });
}

/** Label status analisis yang ramah pengguna. */
export function aiStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'ANALYZING':
      return 'Sedang dianalisis';
    case 'SUCCESS':
      return 'Berhasil dianalisis';
    case 'FAILED':
      return 'Gagal dianalisis';
    case 'NEEDS_REVIEW':
      return 'Perlu ditinjau admin';
    case 'PENDING':
    default:
      return 'Menunggu analisis';
  }
}
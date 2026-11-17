/**
 * Deteksi laporan duplikat — versi 2 (berbasis bukti).
 *
 * Prinsip:
 *  1. LOKASI adalah bukti utama. Tanpa bukti lokasi yang cukup, dua laporan
 *     TIDAK PERNAH ditandai duplikat, sekalipun kategori/judulnya sama.
 *  2. Judul yang sama saja tidak cukup. Judul generik pendek ("jalan", "rusak")
 *     tidak boleh menghasilkan skor kemiripan teks tinggi.
 *  3. Hasil selalu salah satu dari tiga kategori transparan:
 *       - "Kemungkinan duplikat"
 *       - "Perlu pemeriksaan admin"
 *       - "Tidak cukup bukti"
 *  4. Tidak pernah menghapus/menggabungkan laporan. Penandaan hanya untuk
 *     ditinjau Admin; keputusan akhir tetap di tangan Admin.
 *  5. Lapisan AI (on-demand) hanya MEMBANTU menilai pasangan kandidat dan tidak
 *     pernah menjadi satu-satunya dasar penandaan otomatis.
 */

export type DuplicateStatus = 'ORIGINAL' | 'POSSIBLE_DUPLICATE' | 'DUPLICATE' | 'NOT_DUPLICATE';

export type DuplicateBand =
  | 'Kemungkinan duplikat'
  | 'Perlu pemeriksaan admin'
  | 'Tidak cukup bukti';

/** Ambang minimal agar laporan otomatis ditandai untuk ditinjau Admin. */
export const AUTO_FLAG_THRESHOLD = 60;
/** Ambang agar disebut "Kemungkinan duplikat" (bukan sekadar perlu diperiksa). */
export const STRONG_BAND_THRESHOLD = 75;

export interface DuplicateCandidate {
  id: string;
  title: string;
  description: string;
  category: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  createdAt: Date;
  userId: string;
}

export interface ScoredCandidate extends DuplicateCandidate {
  score: number; // 0-100
  reasons: string[];
  band: DuplicateBand;
}

export interface AIJudgeResult {
  confidence: number; // 0-100
  reasons: string[];
  aiFailed: boolean;
}

// ---------------------------------------------------------------------------
// Util teks
// ---------------------------------------------------------------------------

const TEXT_STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'adalah',
  'ini', 'itu', 'sudah', 'telah', 'ada', 'sangat', 'tidak', 'kurang',
  'the', 'and', 'atau', 'serta', 'oleh', 'sebagai', 'dalam', 'akan',
  'juga', 'masih', 'banyak', 'sedikit', 'sekali', 'saja', 'saya', 'kami',
  'warga', 'lapor', 'laporan', 'tolong', 'mohon', 'banget', 'bgt',
]);

const LOCATION_STOPWORDS = new Set([
  'jalan', 'jl', 'jln', 'gang', 'gg', 'desa', 'kel', 'kelurahan', 'kec',
  'kecamatan', 'kab', 'kabupaten', 'kota', 'ciperna', 'rt', 'rw', 'no',
  'nomor', 'depan', 'dekat', 'samping', 'seberang', 'ujung', 'dusun',
]);

function textTokens(text: string): Set<string> {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TEXT_STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Token lokasi mempertahankan huruf tunggal (mis. "Blok B" vs "Blok D") dan
 * membuang kata umum yang membuat lokasi berbeda terlihat sama.
 * Token angka murni dibuang agar "Jl. Merdeka 2" tidak dianggap beda dari
 * "Jl. Merdeka".
 */
function locationTokens(text: string): Set<string> {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !LOCATION_STOPWORDS.has(w))
    .filter((w) => !/^\d+$/.test(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((w) => {
    if (b.has(w)) inter++;
  });
  return inter / (a.size + b.size - inter);
}

// Jaccard similarity 0-1 untuk teks judul/deskripsi.
export function textSimilarity(a: string, b: string): number {
  return jaccard(textTokens(a), textTokens(b));
}

// Similarity lokasi (mempertimbangkan nomor blok/RT).
export function locationSimilarity(a: string, b: string): number {
  return jaccard(locationTokens(a), locationTokens(b));
}

/** Jarak haversine dalam meter. */
export function haversineMeters(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Skoring
// ---------------------------------------------------------------------------

export interface ScoreInput {
  category: string | null;
  /** Opsional: dipakai untuk mencocokkan jenis kerusakan. */
  damageType?: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  title: string;
  description: string;
  createdAt: Date | string;
}

export interface LocationEvidence {
  kind: 'coordinates' | 'text' | 'none';
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  points: number;
  distanceM?: number;
  similarity?: number;
  reasons: string[];
}

export interface ScoreOutput {
  /** Skor kemiripan 0-100 (sudah memperhitungkan gate bukti). */
  score: number;
  reasons: string[];
  /** Kategori transparan hasil klasifikasi. */
  band: DuplicateBand;
  /** Ringkasan bukti lokasi (dipakai UI/AI untuk menjelaskan). */
  locationEvidence: LocationEvidence;
  /** True bila laporan layak ditandai untuk ditinjau Admin. */
  flagged: boolean;
}

const CATEGORY_FAMILIES: Record<string, string[]> = {
  jalan: ['jalan', 'infrastruktur jalan', 'jalan raya', 'perkerasan jalan'],
  lampu: ['lampu jalan', 'penerangan jalan', 'lampu penerangan'],
  drainase: ['drainase', 'sistem drainase', 'saluran air'],
  trotoar: ['trotoar', 'jalur pejalan kaki'],
  jembatan: ['jembatan', 'infrastruktur jembatan'],
};

function categoryKey(category: string | null | undefined): string | null {
  if (!category) return null;
  const c = category.trim().toLowerCase();
  if (!c) return null;
  return c;
}

function sameCategory(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = categoryKey(a);
  const cb = categoryKey(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  // Kelompokkan variasi penulisan kategori yang jelas sama. "Fasilitas Umum
  // Lainnya" sengaja TIDAK dianggap sama dengan apa pun karena bersifat
  // catch-all — jika tidak, semua laporan tak terkategori akan bertabrakan.
  for (const variants of Object.values(CATEGORY_FAMILIES)) {
    if (variants.includes(ca) && variants.includes(cb)) return true;
  }
  return false;
}

function locationEvidenceOf(target: ScoreInput, cand: ScoreInput): LocationEvidence {
  const reasons: string[] = [];
  const hasCoords =
    target.latitude != null && target.longitude != null &&
    cand.latitude != null && cand.longitude != null;

  if (hasCoords) {
    const dist = haversineMeters(
      target.latitude!, target.longitude!, cand.latitude!, cand.longitude!
    );
    if (dist < 100) {
      reasons.push(`Koordinat sangat berdekatan (±${Math.round(dist)} m)`);
      return { kind: 'coordinates', strength: 'strong', points: 40, distanceM: dist, reasons };
    }
    if (dist < 300) {
      reasons.push(`Koordinat berdekatan (±${Math.round(dist)} m)`);
      return { kind: 'coordinates', strength: 'strong', points: 34, distanceM: dist, reasons };
    }
    if (dist < 800) {
      reasons.push(`Koordinat dalam radius ±${Math.round(dist)} m`);
      return { kind: 'coordinates', strength: 'moderate', points: 20, distanceM: dist, reasons };
    }
    if (dist < 2000) {
      reasons.push(`Koordinat berjauhan (±${(dist / 1000).toFixed(1)} km)`);
      return { kind: 'coordinates', strength: 'weak', points: 6, distanceM: dist, reasons };
    }
    reasons.push(`Koordinat berjauhan (±${(dist / 1000).toFixed(1)} km)`);
    return { kind: 'coordinates', strength: 'none', points: 0, distanceM: dist, reasons };
  }

  // Tanpa koordinat: bandingkan token lokasi (mempertahankan nomor blok/RT).
  const sim = locationSimilarity(target.location, cand.location);
  if (sim >= 0.75) {
    reasons.push('Alamat/lokasi yang ditulis hampir sama');
    return { kind: 'text', strength: 'strong', points: 32, similarity: sim, reasons };
  }
  if (sim >= 0.6) {
    reasons.push('Alamat/lokasi yang ditulis sangat mirip');
    return { kind: 'text', strength: 'strong', points: 26, similarity: sim, reasons };
  }
  if (sim >= 0.45) {
    reasons.push('Alamat/lokasi yang ditulis mirip');
    return { kind: 'text', strength: 'moderate', points: 14, similarity: sim, reasons };
  }
  reasons.push('Lokasi berbeda atau tidak cukup detail untuk dibandingkan');
  return { kind: 'text', strength: 'none', points: 0, similarity: sim, reasons };
}

/** Tentukan band transparan dari skor + kekuatan bukti. */
export function classifyDuplicate(score: number, evidence: LocationEvidence): DuplicateBand {
  if (evidence.strength === 'none') return 'Tidak cukup bukti';
  if (score >= STRONG_BAND_THRESHOLD && evidence.strength === 'strong') {
    return 'Kemungkinan duplikat';
  }
  if (score >= AUTO_FLAG_THRESHOLD) return 'Perlu pemeriksaan admin';
  return 'Tidak cukup bukti';
}

/**
 * Skor kemiripan deterministik 0-100 antara laporan target dan satu kandidat.
 * Skor selalu "digate" oleh bukti lokasi sehingga kategori/judul saja tidak
 * pernah cukup untuk menandai duplikat.
 */
export function scoreSimilarity(target: ScoreInput, cand: ScoreInput): ScoreOutput {
  const reasons: string[] = [];
  const evidence = locationEvidenceOf(target, cand);
  reasons.push(...evidence.reasons);

  let score = evidence.points;

  // 1. Kategori (18 poin) — bukan bukti utama.
  const catMatch = sameCategory(target.category, cand.category);
  if (catMatch) {
    score += 18;
    reasons.push(`Kategori sama: ${target.category}`);
  } else if (target.category && cand.category) {
    reasons.push(`Kategori berbeda (${target.category} vs ${cand.category})`);
  }

  // 2. Jenis kerusakan (8 poin)
  const dtA = (target.damageType || '').trim().toLowerCase();
  const dtB = (cand.damageType || '').trim().toLowerCase();
  if (dtA && dtB && dtA === dtB) {
    score += 8;
    reasons.push(`Jenis kerusakan sama: ${target.damageType}`);
  }

  // 3. Waktu pelaporan (maks 10 poin)
  const tDiff = Math.abs(
    new Date(target.createdAt).getTime() - new Date(cand.createdAt).getTime()
  );
  const hours = tDiff / 3600000;
  if (hours < 24) {
    score += 10;
    reasons.push('Waktu pelaporan berdekatan (< 24 jam)');
  } else if (hours < 24 * 7) {
    score += 5;
    reasons.push('Waktu pelaporan dalam 7 hari terakhir');
  } else if (hours < 24 * 30) {
    score += 2;
  }

  // 4. Kemiripan JUDUL (maks 10) — hanya bila token cukup banyak.
  const titleA = textTokens(target.title);
  const titleB = textTokens(cand.title);
  const titleUnion = new Set(Array.from(titleA).concat(Array.from(titleB))).size;
  const titleSim = jaccard(titleA, titleB);
  if (titleUnion >= 3 && titleSim >= 0.6) {
    score += 10;
    reasons.push('Judul laporan sangat mirip');
  } else if (titleUnion >= 3 && titleSim >= 0.4) {
    score += 5;
    reasons.push('Judul laporan mirip');
  }

  // 5. Kemiripan DESKRIPSI (maks 12) — hanya bila token cukup banyak.
  const descA = textTokens(target.description);
  const descB = textTokens(cand.description);
  const descUnion = new Set(Array.from(descA).concat(Array.from(descB))).size;
  const descSim = jaccard(descA, descB);
  if (descUnion >= 5 && descSim >= 0.6) {
    score += 12;
    reasons.push('Deskripsi kerusakan sangat mirip');
  } else if (descUnion >= 5 && descSim >= 0.4) {
    score += 6;
    reasons.push('Deskripsi kerusakan mirip');
  }

  // --- GATE BUKTI (inti perbaikan) ---
  // Tanpa bukti lokasi, skor tidak boleh melewati ambang penandaan.
  if (evidence.strength === 'none') {
    score = Math.min(score, 25);
    reasons.push('Tidak ditandai: bukti lokasi tidak cukup');
  } else if (evidence.strength === 'weak') {
    score = Math.min(score, 45);
    reasons.push('Tidak ditandai otomatis: lokasi hanya berjauhan/lemah');
  }

  // Kategori berbeda + lokasi tidak kuat → bukan kejadian yang sama.
  if (!catMatch && evidence.strength !== 'strong') {
    score = Math.min(score, 45);
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const band = classifyDuplicate(finalScore, evidence);

  return {
    score: finalScore,
    reasons,
    band,
    locationEvidence: evidence,
    flagged: band !== 'Tidak cukup bukti',
  };
}

/** Label band resmi (dipakai UI/AI) — tiga kategori transparan. */
export function confidenceBand(confidence: number): DuplicateBand {
  if (confidence >= STRONG_BAND_THRESHOLD) return 'Kemungkinan duplikat';
  if (confidence >= AUTO_FLAG_THRESHOLD) return 'Perlu pemeriksaan admin';
  return 'Tidak cukup bukti';
}

// ---------------------------------------------------------------------------
// Pencarian kandidat & penandaan
// ---------------------------------------------------------------------------

import { prisma } from '@/lib/prisma';
import { recordReportStatusHistory } from '@/lib/history';
import { createNotification, createNotifications } from '@/lib/notification';
// KONFIGURASI PROVIDER AI terpusat (tabel AiProvider, dikelola Admin).
import { resolveAiProviderChain } from './aiProviderConfig';
import { callProvider, getProviderSpec } from './aiProviders';

function toScoreInput(r: {
  category: string | null;
  damageType?: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  title: string;
  description: string;
  createdAt: Date | string;
}): ScoreInput {
  return {
    category: r.category,
    damageType: r.damageType ?? null,
    location: r.location,
    latitude: r.latitude,
    longitude: r.longitude,
    title: r.title,
    description: r.description,
    createdAt: r.createdAt,
  };
}

/**
 * Cari kandidat duplikat untuk sebuah laporan.
 * Hanya laporan ORIGINAL (bukan yang sudah terkonfirmasi duplikat) yang boleh
 * menjadi laporan utama, sehingga tidak terbentuk rantai duplikat.
 */
export async function findDuplicateCandidates(
  reportId: string,
  minScore = AUTO_FLAG_THRESHOLD,
  limit = 5
): Promise<{ main: DuplicateCandidate; matches: ScoredCandidate[] } | null> {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) return null;

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const others = await prisma.report.findMany({
    where: {
      id: { not: reportId },
      status: { not: 'REJECTED' },
      // Hanya laporan ORIGINAL (atau yang sudah dinyatakan BUKAN duplikat) yang
      // boleh menjadi laporan utama. Ini mencegah rantai/siklus duplikat
      // (A→B, B→A) yang membingungkan Admin.
      duplicateStatus: { in: ['ORIGINAL', 'NOT_DUPLICATE'] },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
    take: 60,
  });

  const target = toScoreInput(report);

  const scored: ScoredCandidate[] = others
    .map((o) => {
      const result = scoreSimilarity(target, toScoreInput(o));
      return { ...o, score: result.score, reasons: result.reasons, band: result.band };
    })
    .filter((s) => s.score >= minScore && s.band !== 'Tidak cukup bukti')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return null;
  return { main: report, matches: scored };
}

/**
 * Deteksi otomatis saat laporan dibuat. Hanya menandai bila bukti kuat
 * (lihat `classifyDuplicate`). Tidak pernah throw agar pembuatan laporan aman.
 */
export async function detectAndFlagDuplicates(reportId: string): Promise<{
  mainReportId: string;
  confidence: number;
  band: DuplicateBand;
  reasons: string[];
} | null> {
  try {
    const found = await findDuplicateCandidates(reportId, AUTO_FLAG_THRESHOLD, 3);
    if (!found) return null;

    // Laporan utama = kandidat yang PALING DAHULU dibuat (bukan skor tertinggi),
    // agar kejadian pertama tetap menjadi acuan. Kandidat berstatus DUPLICATE
    // sudah dikecualikan sehingga tidak terbentuk rantai duplikat.
    const mainCandidate = [...found.matches].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )[0];
    if (!mainCandidate) return null;

    const updated = await prisma.report.update({
      where: { id: reportId },
      data: {
        duplicateStatus: 'POSSIBLE_DUPLICATE',
        duplicateOfReportId: mainCandidate.id,
        duplicateConfidence: mainCandidate.score,
        duplicateReason: mainCandidate.reasons.join('; '),
        duplicateBand: mainCandidate.band,
      },
    });

    await recordReportStatusHistory({
      reportId,
      status: updated.status,
      notes: `Sistem mendeteksi kemungkinan duplikat dari laporan #${mainCandidate.id.slice(0, 8)} (${mainCandidate.score}% — ${mainCandidate.band}). Menunggu review Admin; tidak ada data yang dihapus.`,
      actorName: 'Sistem Deteksi Duplikat',
      actorRole: 'SYSTEM',
    });

    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true },
    });
    await createNotifications(
      admins.map((a) => ({
        userId: a.id,
        type: 'POSSIBLE_DUPLICATE' as const,
        title: 'Kemungkinan Laporan Duplikat',
        message: `Laporan "${updated.title}" perlu ditinjau: ${mainCandidate.band.toLowerCase()} dari laporan #${mainCandidate.id.slice(0, 8)} (${mainCandidate.score}%).`,
      }))
    );

    return {
      mainReportId: mainCandidate.id,
      confidence: mainCandidate.score,
      band: mainCandidate.band,
      reasons: mainCandidate.reasons,
    };
  } catch (e) {
    console.error('[detectAndFlagDuplicates]', e);
    return null;
  }
}

/**
 * Hitung ulang SEMUA kandidat yang masih menunggu review memakai algoritma
 * terbaru. Dipakai Admin lewat endpoint khusus (bukan otomatis) agar tidak ada
 * perubahan status tanpa jejak audit.
 *
 * - Kandidat yang kini "Tidak cukup bukti" → kembali ORIGINAL.
 * - Kandidat yang masih memenuhi ambang → confidence/reason/band diperbarui.
 * - Tidak pernah menghapus laporan.
 */
export async function reevaluateDuplicateFlags(): Promise<{
  checked: number;
  kept: number;
  cleared: number;
  changed: { id: string; title: string; from: number | null; to: number; band: DuplicateBand; action: 'KEPT' | 'CLEARED' }[];
}> {
  const pending = await prisma.report.findMany({
    where: { duplicateStatus: 'POSSIBLE_DUPLICATE' },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const changed: { id: string; title: string; from: number | null; to: number; band: DuplicateBand; action: 'KEPT' | 'CLEARED' }[] = [];
  let kept = 0;
  let cleared = 0;

  for (const r of pending) {
    const found = await findDuplicateCandidates(r.id, AUTO_FLAG_THRESHOLD, 1);
    const best = found?.matches[0];
    if (!best || best.band === 'Tidak cukup bukti') {
      await prisma.report.update({
        where: { id: r.id },
        data: {
          duplicateStatus: 'ORIGINAL',
          duplicateOfReportId: null,
          duplicateConfidence: null,
          duplicateReason: null,
          duplicateBand: null,
          duplicateReviewedBy: 'Sistem (validasi ulang)',
          duplicateReviewedAt: new Date(),
        },
      });
      await recordReportStatusHistory({
        reportId: r.id,
        status: r.status,
        notes: 'Validasi ulang algoritma duplikat: bukti tidak cukup, penandaan dilepas. Laporan diproses normal.',
        actorName: 'Sistem Deteksi Duplikat',
        actorRole: 'SYSTEM',
      });
      cleared++;
      changed.push({ id: r.id, title: r.title, from: r.duplicateConfidence, to: best?.score ?? 0, band: 'Tidak cukup bukti', action: 'CLEARED' });
      continue;
    }

    if (
      best.id !== r.duplicateOfReportId ||
      best.score !== r.duplicateConfidence ||
      best.band !== r.duplicateBand
    ) {
      await prisma.report.update({
        where: { id: r.id },
        data: {
          duplicateOfReportId: best.id,
          duplicateConfidence: best.score,
          duplicateReason: best.reasons.join('; '),
          duplicateBand: best.band,
        },
      });
      await recordReportStatusHistory({
        reportId: r.id,
        status: r.status,
        notes: `Validasi ulang algoritma duplikat: kandidat #${best.id.slice(0, 8)} (${best.score}% — ${best.band}).`,
        actorName: 'Sistem Deteksi Duplikat',
        actorRole: 'SYSTEM',
      });
    }
    kept++;
    changed.push({ id: r.id, title: r.title, from: r.duplicateConfidence, to: best.score, band: best.band, action: 'KEPT' });
  }

  return { checked: pending.length, kept, cleared, changed };
}

// ---------------------------------------------------------------------------
// Lapisan AI (on-demand) — tetap ada, tetapi bukan dasar penandaan otomatis.
// ---------------------------------------------------------------------------

export async function judgePairWithAI(
  target: ScoreInput & { id: string },
  cand: ScoreInput & { id: string },
  fallback: ScoreOutput
): Promise<AIJudgeResult> {
  // Kunci + model diambil dari KONFIGURASI AI terpusat (dikelola Admin),
  // bukan dari `.env` dan bukan dari model hardcode.
  const chain = await resolveAiProviderChain();
  const attempt = chain.attempts[0];
  if (!attempt || !attempt.apiKey || !attempt.primaryModel) {
    return { confidence: fallback.score, reasons: [...fallback.reasons, 'AI tidak dikonfigurasi, memakai skor sistem'], aiFailed: true };
  }
  const spec = getProviderSpec(attempt.provider);
  if (!spec) {
    return { confidence: fallback.score, reasons: [...fallback.reasons, 'AI tidak dikonfigurasi, memakai skor sistem'], aiFailed: true };
  }
  const apiKey = attempt.apiKey;
  const model = attempt.primaryModel;
  const prompt = `Kamu membantu admin sistem pelaporan fasilitas umum menentukan apakah dua laporan kemungkinan merupakan SATU kejadian yang sama. Jawab HANYA dengan JSON valid tanpa teks lain, format:
{"confidence": angka 0-100, "reasons": ["alasan singkat bahasa Indonesia", ...]}

Aturan:
- Jangan pernah memberi skor tinggi bila lokasi/koordinat jelas berbeda.
- Judul atau kategori yang sama SAJA tidak cukup.
- Jangan mengarang fakta yang tidak ada pada data.
- Sebutkan bila bukti tidak cukup.

Laporan A:
- Kategori: ${target.category || '-'} / ${target.damageType || '-'}
- Lokasi: ${target.location}${target.latitude != null ? ` (${target.latitude}, ${target.longitude})` : ''}
- Waktu: ${new Date(target.createdAt).toISOString()}
- Judul: ${target.title}
- Deskripsi: ${target.description.slice(0, 500)}

Laporan B:
- Kategori: ${cand.category || '-'} / ${cand.damageType || '-'}
- Lokasi: ${cand.location}${cand.latitude != null ? ` (${cand.latitude}, ${cand.longitude})` : ''}
- Waktu: ${new Date(cand.createdAt).toISOString()}
- Judul: ${cand.title}
- Deskripsi: ${cand.description.slice(0, 500)}`;

  try {
    // Adapter terpusat: OpenRouter/Groq (OpenAI-compatible) & Gemini (SDK)
    // memakai satu jalur yang benar.
    const result = await callProvider(spec, {
      apiKey,
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      temperature: 0.1,
      timeoutMs: 25000,
    });
    if (!result.ok || !result.content) {
      throw new Error(`AI gagal (${result.status ?? '-'}/${result.errorKind})`);
    }
    const text: string = result.content;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Format AI tidak valid');
    const parsed = JSON.parse(jsonMatch[0]);
    const aiConfidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence))));
    if (Number.isNaN(aiConfidence)) throw new Error('Confidence AI tidak valid');

    // AI hanya penasihat. Skor akhir TIDAK boleh melampaui batas bukti
    // deterministik, agar AI tidak mengembalikan false positive.
    let confidence = aiConfidence;
    const strength = fallback.locationEvidence.strength;
    if (strength === 'none') confidence = Math.min(confidence, 30);
    else if (strength === 'weak') confidence = Math.min(confidence, 45);
    else if (strength === 'moderate') confidence = Math.min(confidence, 74);
    confidence = Math.min(confidence, fallback.score + 20);

    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons.map((r: unknown) => String(r)).slice(0, 6)
      : fallback.reasons;
    if (confidence < aiConfidence) {
      reasons.push('Skor AI dibatasi oleh bukti lokasi/waktu yang tersedia');
    }
    return { confidence, reasons, aiFailed: false };
  } catch (e) {
    console.error('[judgePairWithAI] AI gagal, fallback deterministik:', e);
    return { confidence: fallback.score, reasons: [...fallback.reasons, 'Analisis AI gagal, memakai skor sistem'], aiFailed: true };
  }
}

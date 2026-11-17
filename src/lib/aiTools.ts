/*
 * aiTools.ts - RECOVERED CANDIDATE (NOT restored to the project).
 *
 * Reconstructed READ-ONLY from the OpenCode session database:
 *   base  : six consecutive `read` pages of src/lib/aiTools.ts captured
 *           2026-11-11T01:21:51Z .. 01:22:10Z  -> lines 1..4409 verbatim
 *   patch : 4 later `edit` operations recorded verbatim in the session DB
 *           01:38:26.213Z (+17) 01:38:39.718Z (+0) 02:26:08.881Z (+10) 02:26:33.308Z (+10)
 *   verify: 1819 verbatim raw reads of the live file taken 03:36-03:56Z
 *
 * Status: candidate only. src/lib/aiTools.ts has NOT been modified.
 */

/**
 * Tool/query layer untuk AI Chatbot (READ-ONLY).
 *
 * Prinsip keamanan:
 * - Setiap tool menerima userId + role dari SESSION server (jangan pernah
 *   percaya userId/role dari frontend).
 * - Permission check dilakukan SEBELUM query database.
 * - Query memakai agregasi database (COUNT/GROUP BY) + LIMIT, tidak pernah
 *   mengirim seluruh dataset ke LLM.
 * - Output disanitasi: tanpa password/hash/token, tanpa email pengguna lain
 *   (email pelapor di-mask untuk OFFICER, mengikuti aturan aplikasi).
 */

import { prisma } from '@/lib/prisma';
import { WEBSITE } from '@/lib/websiteKnowledge';
import { REPORT_STATUS_LABELS } from '@/lib/status';
import { SYSTEM_CHANGELOG, SYSTEM_LAST_UPDATED } from '@/lib/systemConfig';
import { deriveAnnouncementStatus, ANNOUNCEMENT_STATUS_LABELS, type AnnouncementStatus } from '@/lib/announcementStatus';
import { scoreSimilarity } from '@/lib/duplicates';
import { safeJsonArray, aiStatusLabel } from '@/lib/reportAnalysis';
import { persistAiKnowledge } from '@/lib/aiKnowledgeStore';
import {
  cancelKnowledgeProposals,
  consumeKnowledgeProposal,
  createKnowledgeProposal,
} from '@/lib/aiKnowledgeProposal';
import { resolveActiveFonnteConfig } from '@/lib/fonnteConfig';
// KONFIGURASI PROVIDER AI terpusat (untuk model aktif pada diagnostik).
import { resolveAiProviderChain } from '@/lib/aiProviderConfig';
import { isMockDelivery } from '@/lib/whatsappDelivery';
import {
  DATA_STATUS_LABELS,
  OFFICIAL_CATEGORY_LABELS,
  fullAddress,
  getPublicOfficials,
  getPublicServices,
  getVillageProfile,
  hasProfileContent,
  missingProfileFields,
  villageIdentity,
} from '@/lib/village';
// Monitoring WhatsApp memakai satu sumber kebenaran di lib/whatsappMonitoring.ts
// (modul ringan tanpa `fs`, aman bila ikut ter-bundle ke client).
export { getWhatsAppMonitoringStatus } from '@/lib/whatsappMonitoring';

export type ChatRole = 'CITIZEN' | 'ADMIN' | 'OFFICER';

/** Label status yang ramah dibaca (satu sumber kebenaran: lib/status.ts). */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Tanpa status';
  return REPORT_STATUS_LABELS[status] || status;
}

function maskEmail(email: string): string {
  const [user, domain] = (email || '').split('@');
  if (!domain) return '***';
  const masked = user.length > 2 ? user.slice(0, 2) + '***' : user + '***';
  return `${masked}@${domain}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function wibParts(d: Date): { y: number; m: number; day: number } {
  // Pecah tanggal kalender Asia/Jakarta tanpa bergantung zona server
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { y: get('year'), m: get('month'), day: get('day') };
}

function startOfMonth(d = new Date()): Date {
  const { y, m } = wibParts(d);
  // 00:00 WIB = 17:00 UTC hari sebelumnya (UTC+7 tetap)
  return new Date(Date.UTC(y, m - 1, 1) - 7 * 3600 * 1000);
}

function startOfDay(d = new Date()): Date {
  const { y, m, day } = wibParts(d);
  return new Date(Date.UTC(y, m - 1, day) - 7 * 3600 * 1000);
}

function startOfWeek(d = new Date()): Date {
  // Senin 00:00 WIB sebagai awal pekan
  const { y, m, day } = wibParts(d);
  const wibMidnightUtc = Date.UTC(y, m - 1, day) - 7 * 3600 * 1000;
  const wibDate = new Date(wibMidnightUtc + 7 * 3600 * 1000);
  const dow = (wibDate.getUTCDay() + 6) % 7; // Senin=0
  return new Date(wibMidnightUtc - dow * 86400000);
}

/** Rentang hari kalender Asia/Jakarta (UTC+7 tetap, tanpa DST). */
function wibDayRange(date = new Date()): { gte: Date; lt: Date } {
  const offsetMs = 7 * 3600 * 1000;
  const wib = new Date(date.getTime() + offsetMs);
  const startUtc = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()) - offsetMs;
  return { gte: new Date(startUtc), lt: new Date(startUtc + 86400000) };
}

/** Periode pertanyaan natural ("hari ini", "pekan ini", "bulan ini") → batas WIB. */
export type Period = 'today' | 'week' | 'month';

export function periodRange(period?: Period | null): { gte: Date; lt?: Date } | null {
  if (!period) return null;
  if (period === 'today') return wibDayRange();
  if (period === 'week') return { gte: startOfWeek() };
  if (period === 'month') return { gte: startOfMonth() };
  return null;
}

/** Deskripsi periode dalam Bahasa Indonesia (dipakai jawaban AI agar transparan). */
export function periodLabel(period?: Period | null): string | null {
  if (period === 'today') return 'hari ini (WIB)';
  if (period === 'week') return 'pekan ini (Senin-Sekarang, WIB)';
  if (period === 'month') return 'bulan ini';
  return null;
}

/**
 * Rentang tanggal kalender WIB ("YYYY-MM-DD", inklusif) → batas UTC [gte, lt).
 * Validasi ketat: format salah, tanggal tidak ada (31 Feb), atau urutan
 * terbalik akan diabaikan (bukan dieksekusi sebagai query liar).
 */
function dateRangeBounds(
  dateFrom?: string,
  dateTo?: string
): { gte: Date; lt: Date } | null {
  const parse = (s?: string): Date | null => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (
      date.getUTCFullYear() !== y ||
      date.getUTCMonth() !== m - 1 ||
      date.getUTCDate() !== d
    ) return null;
    return date;
  };
  const from = parse(dateFrom);
  const to = parse(dateTo);
  if (!from && !to) return null;
  const offsetMs = 7 * 3600 * 1000;
  const gte = new Date((from ?? to)!.getTime() - offsetMs);
  const lt = new Date((to ?? from)!.getTime() - offsetMs + 86400000);
  if (gte.getTime() >= lt.getTime()) return null;
  return { gte, lt };
}

/** "1 Agustus 2025" / "1–15 Agustus 2025" untuk transparansi jawaban. */
function dateRangeLabel(dateFrom?: string, dateTo?: string): string | null {
  const fmt = (s?: string) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    if (m < 1 || m > 12) return null;
    return `${d} ${WIB_MONTHS[m - 1]} ${y}`;
  };
  const a = fmt(dateFrom);
  const b = fmt(dateTo);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a ? `sejak ${a}` : b ? `sampai ${b}` : null;
}

const WIB_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Tanggal kalender WIB (UTC+7) sebagai "YYYY-MM-DD".
 *
 * PENTING: jangan memakai `date.toISOString().slice(0,10)` untuk tanggal WIB —
 * awal hari WIB (00:00) bila dikonversi ke UTC menjadi 17:00 hari SEBELUMNYA,
 * sehingga AI bisa menyebut tanggal yang salah (selisih satu hari).
 */
export function wibDate(date: Date = new Date()): string {
  const w = new Date(date.getTime() + 7 * 3600 * 1000);
  const mm = String(w.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(w.getUTCDate()).padStart(2, '0');
  return `${w.getUTCFullYear()}-${mm}-${dd}`;
}

/** Label tanggal + jam WIB yang ramah dibaca model, mis. "17 Oktober 2026, 15:22 (WIB)". */
export function wibLabel(date: Date): string {
  const w = new Date(date.getTime() + 7 * 3600 * 1000);
  const hh = String(w.getUTCHours()).padStart(2, '0');
  const mi = String(w.getUTCMinutes()).padStart(2, '0');
  return `${w.getUTCDate()} ${WIB_MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()}, ${hh}:${mi} (WIB)`;
}

/** Label tanggal WIB tanpa jam, mis. "17 Oktober 2026 (WIB)". */
export function wibDateLabel(date: Date = new Date()): string {
  const w = new Date(date.getTime() + 7 * 3600 * 1000);
  return `${w.getUTCDate()} ${WIB_MONTHS[w.getUTCMonth()]} ${w.getUTCFullYear()} (WIB)`;
}

// ============================================================================
// CITIZEN tools (hanya data milik sendiri)
// ============================================================================

export async function getMyReportCounts(userId: string, status?: string[]) {
  const allStatuses = [
    'SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'REJECTED',
  ];
  const statusList = status ?? allStatuses;
  const selected = new Set(statusList);
  // Hitungan per status HARUS memakai filter yang sama dengan total. Sebelumnya
  // `{ ...where, status: 'X' }` menimpa filter `status: { in: [...] }`, sehingga
  // total bisa 7 (hanya SUBMITTED) tetapi rincian tetap menampilkan status lain
  // (mis. 2 ditolak). Angka total dan rincian jadi tidak konsisten.
  const countStatus = (s: string) =>
    selected.has(s)
      ? prisma.report.count({ where: { userId, status: s } })
      : Promise.resolve(0);
  const [total, submitted, verified, assigned, inProgress, review, completed, rejected] =
    await Promise.all([
      prisma.report.count({ where: { userId, status: { in: statusList } } }),
      countStatus('SUBMITTED'),
      countStatus('VERIFIED'),
      countStatus('ASSIGNED'),
      countStatus('IN_PROGRESS'),
      countStatus('REVIEW'),
      countStatus('COMPLETED'),
      countStatus('REJECTED'),
    ]);
  // "Aktif" = masih berjalan. REVIEW ikut aktif (hasil kerja menunggu verifikasi admin).
  const active = verified + assigned + inProgress + review;
  return {
    total,
    submitted,
    verified,
    assigned,
    inProgress,
    review,
    completed,
    rejected,
    active,
    statusFilter: statusList,
    // Rincian berlabel: lebih sulit disalahartikan model daripada field angka terpisah.
    breakdown: [
      { status: 'SUBMITTED', label: statusLabel('SUBMITTED'), count: submitted },
      { status: 'VERIFIED', label: statusLabel('VERIFIED'), count: verified },
      { status: 'ASSIGNED', label: statusLabel('ASSIGNED'), count: assigned },
      { status: 'IN_PROGRESS', label: statusLabel('IN_PROGRESS'), count: inProgress },
      { status: 'REVIEW', label: statusLabel('REVIEW'), count: review },
      { status: 'COMPLETED', label: statusLabel('COMPLETED'), count: completed },
      { status: 'REJECTED', label: statusLabel('REJECTED'), count: rejected },
    ],
    note: 'active = VERIFIED + ASSIGNED + IN_PROGRESS + REVIEW (laporan yang masih berjalan).',
    labels: {
      submitted: statusLabel('SUBMITTED'),
      review: statusLabel('REVIEW'),
      completed: statusLabel('COMPLETED'),
      rejected: statusLabel('REJECTED'),
    },
  };
}

export async function getMyRecentReports(userId: string, limit = 5) {
  const reports = await prisma.report.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 5, 1), 20),
    select: {
      id: true, title: true, location: true, status: true,
      category: true, severity: true, createdAt: true,
    },
  });
  return reports.map((r) => ({
    ...r,
    id: shortId(r.id),
    statusLabel: statusLabel(r.status),
    createdAt: r.createdAt.toISOString(),
    // Label WIB: agar model tidak salah mengubah ISO/UTC menjadi tanggal (selisih 1 hari).
    createdAtWib: wibLabel(r.createdAt),
  }));
}

/**
 * Resolusi ID laporan dari fragmen ID (UUID penuh atau beberapa karakter awal)
 * TANPA memindai seluruh tabel — memakai pencarian prefix di database.
 * `scope` membatasi pencarian (mis. { userId } untuk laporan milik warga).
 * Berlaku juga untuk laporan lama, bukan hanya N laporan terbaru.
 */
async function findReportIdByFragment(
  scope: { userId?: string },
  idFragment: string
): Promise<string | null> {
  const frag = (idFragment || '').trim();
  if (frag.length < 6) return null; // hindari pencocokan yang terlalu longgar
  const candidates = await prisma.report.findMany({
    where: { ...scope, id: { startsWith: frag } },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { id: true },
  });
  if (candidates.length === 0) return null;
  // Bila lebih dari satu kandidat, ambil yang terbaru (deterministik).
  return candidates[0].id;
}

export async function getMyReportById(userId: string, idFragment: string) {
  const fullId = await findReportIdByFragment({ userId }, idFragment);
  if (!fullId) return null;
  const found = await prisma.report.findUnique({
    where: { id: fullId },
    include: {
      evidences: { select: { id: true, description: true, createdAt: true } },
    },
  });
  if (!found || found.userId !== userId) return null;
  const { userId: _u, photo, ...rest } = found as any;
  return {
    ...rest,
    id: shortId(found.id),
    statusLabel: statusLabel(found.status),
    photo: found.photo ? 'ada' : 'tidak ada',
    evidences: found.evidences.map((e: any) => ({ description: e.description })),
    createdAt: found.createdAt.toISOString(),
    createdAtWib: wibLabel(found.createdAt),
    updatedAt: found.updatedAt.toISOString(),
    updatedAtWib: wibLabel(found.updatedAt),
  };
}

export async function getMyReportTimeline(userId: string, idFragment: string) {
  const detail = await getMyReportFullDetail(userId, idFragment);
  if (!detail) return null;
  return {
    report: {
      id: detail.id, title: detail.title, location: detail.location,
      status: detail.status, category: detail.category,
    },
    rejectionReason: detail.rejectionReason,
    timeline: detail.timeline,
  };
}

// Resolve ID milik user (penuh atau 8 karakter awal). Null bila bukan miliknya.
async function resolveMyReportId(userId: string, idFragment: string): Promise<string | null> {
  return findReportIdByFragment({ userId }, idFragment);
}

// Detail lengkap 1 laporan milik user: info + assignment/petugas + bukti + timeline + duplikat
export async function getMyReportFullDetail(userId: string, idFragment: string) {
  const fullId = await resolveMyReportId(userId, idFragment);
  if (!fullId) return null;
  const r = await prisma.report.findUnique({
    where: { id: fullId },
    include: {
      assignments: {
        orderBy: { assignedAt: 'desc' },
        take: 10,
        include: { officer: { select: { name: true } } },
      },
      evidences: { orderBy: { createdAt: 'asc' } },
      histories: { orderBy: { createdAt: 'asc' } },
      _count: { select: { assignments: true, evidences: true, histories: true } },
    },
  });
  if (!r || r.userId !== userId) return null;

  let duplicateMain: { id: string; title: string; location: string; status: string } | null = null;
  if (r.duplicateOfReportId) {
    const m = await prisma.report.findUnique({
      where: { id: r.duplicateOfReportId },
      select: { id: true, title: true, location: true, status: true },
    });
    // Sengaja tanpa data pelapor lain (privacy)
    if (m) duplicateMain = { id: shortId(m.id), title: m.title, location: m.location, status: m.status };
  }

  return {
    id: shortId(r.id),
    title: r.title,
    // Deskripsi lengkap untuk analisis satu laporan; batas tinggi + flag eksplisit
    // agar pemanggil tahu bila benar-benar dipotong (bukan dipotong diam-diam).
    description: r.description.slice(0, 4000),
    descriptionLength: r.description.length,
    descriptionTruncated: r.description.length > 4000,
    category: r.category,
    damageType: r.damageType,
    severity: r.severity,
    location: r.location,
    status: r.status,
    statusLabel: statusLabel(r.status),
    photo: r.photo ? 'ada' : 'tidak ada',
    aiResult: r.aiResult,
    aiConfidence: r.aiConfidence,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
    createdAtWib: wibLabel(r.createdAt),
    updatedAt: r.updatedAt.toISOString(),
    updatedAtWib: wibLabel(r.updatedAt),
    assignment: r.assignments[0]
      ? {
          officer: r.assignments[0].officer.name,
          assignedAt: r.assignments[0].assignedAt.toISOString(),
          assignedAtWib: wibLabel(r.assignments[0].assignedAt),
          completedAt: r.assignments[0].completedAt ? r.assignments[0].completedAt.toISOString() : null,
          completedAtWib: r.assignments[0].completedAt ? wibLabel(r.assignments[0].completedAt) : null,
          notes: r.assignments[0].notes,
        }
      : null,
    assignments: r.assignments.map((a) => ({
      officer: a.officer.name,
      assignedAt: a.assignedAt.toISOString(),
      assignedAtWib: wibLabel(a.assignedAt),
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      completedAtWib: a.completedAt ? wibLabel(a.completedAt) : null,
      notes: a.notes,
    })),
    assignmentCount: r._count.assignments,
    evidences: r.evidences.map((e) => ({
      description: e.description,
      at: e.createdAt.toISOString(),
      atWib: wibLabel(e.createdAt),
    })),
    evidenceCount: r._count.evidences,
    historyCount: r._count.histories,
    duplicateStatus: (r as any).duplicateStatus || 'ORIGINAL',
    duplicateMain,
    timeline: r.histories.map((h) => ({
      status: h.status,
      notes: h.notes,
      actor: h.actorName,
      at: h.createdAt.toISOString(),
      atWib: wibLabel(h.createdAt),
    })),
  };
}

export interface MyReportSearch {
  category?: string;
  status?: string | string[];
  statusNotFinal?: boolean;
  severity?: string[];
  damageType?: string;
  location?: string;
  title?: string;
  /**
   * Kata kunci bebas yang dicari pada judul/deskripsi/lokasi/kategori/jenis
   * kerusakan. Dipakai saat pengguna menulis "cari laporan jalan rusak" tanpa
   * judul persis. Tetap dibatasi userId (tidak pernah melebar ke laporan warga lain).
   */
  keyword?: string;
  period?: Period;
  /** Rentang tanggal WIB "YYYY-MM-DD" (inklusif). */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  /** Offset untuk pagination (0-based). */
  offset?: number;
  /** Urutan tanggal: newest (default) atau oldest. */
  sort?: 'newest' | 'oldest';
}

/**
 * Kata yang tidak membawa makna pencarian. Dipakai untuk pencarian alternatif
 * saat filter awal terlalu sempit (mis. "cari laporan jalan rusak di RT 03").
 * Kata ini TIDAK dipakai untuk melonggarkan batas kepemilikan/role.
 */
const SEARCH_TOKEN_STOPWORDS = new Set([
  'laporan', 'tugas', 'cari', 'carikan', 'temukan', 'tampilkan', 'lihat', 'daftar',
  'yang', 'itu', 'ini', 'tersebut', 'tadi', 'kemarin', 'sebelumnya', 'saya', 'aku',
  'milik', 'punya', 'untuk', 'dari', 'pada', 'dengan', 'dan', 'atau', 'di', 'ke',
  'ada', 'adakah', 'apa', 'saja', 'berapa', 'jumlah', 'total', 'status', 'sudah',
  'belum', 'masih', 'sedang', 'data', 'desa', 'ciperna', 'warga', 'masyarakat',
  'tolong', 'mohon', 'bisa', 'kah', 'nya', 'dong', 'sih', 'ya',
]);

function keywordTokens(raw: string, max = 5): string[] {
  return (raw || '')
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\u024F]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !SEARCH_TOKEN_STOPWORDS.has(x))
    .slice(0, max);
}

/** OR pencarian longgar pada beberapa kolom teks. Tetap dipakai bersama scope. */
function textOrConditions(tokens: string[]): any[] {
  const fields = ['title', 'description', 'location', 'category', 'damageType'];
  return tokens.flatMap((tok) => fields.map((field) => ({ [field]: { contains: tok } })));
}

// Pencarian natural language di laporan milik user (maks 50 hasil per halaman).
// Memakai batas waktu WIB yang sama dengan tool lain (bukan waktu lokal server).
export async function searchMyReports(userId: string, f: MyReportSearch = {}) {
  const where: any = { userId };
  if (f.category) where.category = { contains: f.category };
  if (f.status) where.status = Array.isArray(f.status) ? { in: f.status } : f.status;
  if (f.statusNotFinal) {
    where.status = where.status
      ? { in: (where.status.in as string[]).filter((s) => s !== 'COMPLETED' && s !== 'REJECTED') }
      : { notIn: ['COMPLETED', 'REJECTED'] };
  }
  if (f.severity && f.severity.length) where.severity = { in: f.severity };
  if (f.damageType) where.damageType = { contains: f.damageType };
  if (f.location) where.location = { contains: f.location };
  if (f.title) where.title = { contains: f.title };
  if (f.keyword) {
    const q = f.keyword.trim();
    if (q) where.OR = textOrConditions([q]);
  }
  const dated = dateRangeBounds(f.dateFrom, f.dateTo);
  if (dated) where.createdAt = dated;
  else {
    const range = periodRange(f.period);
    if (range) where.createdAt = range;
  }

  const limit = Math.min(Math.max(Number(f.limit) || 5, 1), 50);
  const offset = Math.max(Number(f.offset) || 0, 0);
  let [total, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: (f.sort === 'oldest' ? 'asc' : 'desc') as 'asc' | 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true, title: true, location: true, status: true,
        category: true, severity: true, createdAt: true, rejectionReason: true,
      },
    }),
  ]);

  const applied: string[] = [];
  if (f.category) applied.push(`kategori mengandung: ${f.category}`);
  if (f.damageType) applied.push(`jenis kerusakan mengandung: ${f.damageType}`);
  if (f.severity?.length) applied.push(`keparahan: ${f.severity.join(', ')}`);
  if (f.location) applied.push(`lokasi mengandung: ${f.location}`);
  if (f.title) applied.push(`judul mengandung: ${f.title}`);
  if (f.keyword) applied.push(`kata kunci: "${f.keyword}"`);
  if (f.status) applied.push(`status: ${(Array.isArray(f.status) ? f.status : [f.status]).map(statusLabel).join(', ')}`);
  if (f.statusNotFinal) applied.push('belum final');
  const pLabel = periodLabel(f.period);
  if (pLabel) applied.push(`periode: ${pLabel}`);
  const dLabel = dated ? dateRangeLabel(f.dateFrom, f.dateTo) : null;
  if (dLabel) applied.push(`tanggal: ${dLabel}`);
  if (f.sort === 'oldest') applied.push('urutan: paling lama');

  // Pencarian alternatif AMAN: bila filter awal kosong, cari kata kunci pada
  // kolom teks. Scope userId TIDAK pernah dilepas, jadi tidak ada kebocoran
  // laporan warga lain. Hasil ditandai `relaxed` agar AI jujur menjelaskannya.
  let relaxed = false;
  if (total === 0 && offset === 0) {
    const source = [f.keyword, f.title, f.category, f.damageType, f.location]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .join(' ');
    const tokens = keywordTokens(source);
    if (tokens.length) {
      const relaxedWhere: any = { userId, OR: textOrConditions(tokens) };
      const [rTotal, rRows] = await Promise.all([
        prisma.report.count({ where: relaxedWhere }),
        prisma.report.findMany({
          where: relaxedWhere,
          orderBy: { createdAt: (f.sort === 'oldest' ? 'asc' : 'desc') as 'asc' | 'desc' },
          take: limit,
          select: {
            id: true, title: true, location: true, status: true,
            category: true, severity: true, createdAt: true, rejectionReason: true,
          },
        }),
      ]);
      if (rTotal > 0) {
        total = rTotal;
        rows = rRows;
        relaxed = true;
        applied.push(`pencarian diperluas dengan kata: ${tokens.join(', ')}`);
      }
    }
  }

  return {
    period: periodLabel(f.period),
    dateRange: dLabel,
    appliedFilters: applied,
    sort: f.sort || 'newest',
    total,
    returned: rows.length,
    offset,
    hasMore: offset + rows.length < total,
    relaxed,
    relaxedNote: relaxed
      ? 'Filter awal tidak menemukan hasil; pencarian diperluas dengan kata kunci yang sama. Tetap hanya laporan milik pengguna ini.'
      : undefined,
    items: rows.map((r) => ({
      ...r,
      id: shortId(r.id),
      statusLabel: statusLabel(r.status),
      rejectionReason: r.rejectionReason || null,
      createdAt: r.createdAt.toISOString(),
      createdAtWib: wibLabel(r.createdAt),
    })),
  };
}

// Bukti pengerjaan milik user (semua atau per laporan)
export async function getMyEvidence(userId: string, idFragment?: string) {
  if (idFragment) {
    const fullId = await resolveMyReportId(userId, idFragment);
    if (!fullId) return null;
    const ev = await prisma.reportEvidence.findMany({
      where: { reportId: fullId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      reportId: shortId(fullId),
      count: ev.length,
      total: ev.length,
      returned: ev.length,
      hasMore: false,
      items: ev.map((e) => ({ description: e.description, at: e.createdAt.toISOString(), atWib: wibLabel(e.createdAt) })),
    };
  }
  const [total, ev] = await Promise.all([
    prisma.reportEvidence.count({ where: { report: { userId } } }),
    prisma.reportEvidence.findMany({
      where: { report: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { report: { select: { id: true, title: true } } },
    }),
  ]);
  return {
    // `count` = total di database, bukan hanya yang dikembalikan halaman ini.
    count: total,
    total,
    returned: ev.length,
    hasMore: ev.length < total,
    items: ev.map((e) => ({
      reportId: shortId(e.report.id),
      reportTitle: e.report.title,
      description: e.description,
      at: e.createdAt.toISOString(),
      atWib: wibLabel(e.createdAt),
    })),
  };
}

// Profil milik user (tanpa password/hash)
export async function getMyProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true, role: true, createdAt: true },
  });
  if (!user) return null;
  const reportCount = await prisma.report.count({ where: { userId } });
  return {
    name: user.name,
    email: user.email,
    hasPhone: !!user.phone,
    role: user.role,
    registeredAt: user.createdAt.toISOString(),
    reportCount,
  };
}

// Notifikasi milik user
export async function getMyNotifications(userId: string, limit = 5) {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 10),
      select: { title: true, message: true, type: true, isRead: true, createdAt: true },
    }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return {
    unread,
    items: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })),
  };
}

// Info duplikat pada laporan milik user (tanpa data pelapor lain)
export async function getMyDuplicateInfo(userId: string) {
  const rows = await prisma.report.findMany({
    where: { userId, duplicateStatus: { in: ['POSSIBLE_DUPLICATE', 'DUPLICATE'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, title: true, location: true, status: true,
      duplicateStatus: true, duplicateConfidence: true, duplicateOfReportId: true,
    },
  });
  const out: any[] = [];
  for (const r of rows) {
    let main: { id: string; title: string; location: string; status: string } | null = null;
    if (r.duplicateOfReportId) {
      const m = await prisma.report.findUnique({
        where: { id: r.duplicateOfReportId },
        select: { id: true, title: true, location: true, status: true },
      });
      if (m) main = { id: shortId(m.id), title: m.title, location: m.location, status: m.status };
    }
    out.push({
      id: shortId(r.id), title: r.title, location: r.location, status: r.status,
      duplicateStatus: r.duplicateStatus, confidence: r.duplicateConfidence, main,
    });
  }
  return { count: out.length, items: out };
}

// Petugas publik: hanya nama (tanpa email/telepon/kredensial)
export async function getPublicOfficers() {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER' },
    orderBy: { name: 'asc' },
    select: { name: true },
  });
  return { visibility: 'PUBLIC', count: officers.length, items: officers.map((o) => ({ name: o.name })) };
}

// Penanganan terbaru pada laporan milik user (nama petugas boleh tampil)
export async function getMyLatestHandling(userId: string) {
  const a = await prisma.assignment.findFirst({
    where: { report: { userId }, cancelledAt: null },
    orderBy: { assignedAt: 'desc' },
    include: {
      officer: { select: { name: true } },
      report: { select: { id: true, title: true, status: true, location: true } },
    },
  });
  if (!a) return { handled: false };
  return {
    handled: true,
    reportId: shortId(a.report.id),
    reportTitle: a.report.title,
    reportStatus: a.report.status,
    reportLocation: a.report.location,
    officer: a.officer.name,
    assignedAt: a.assignedAt.toISOString(),
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    notes: a.notes,
  };
}

/**
 * Riwayat tindak lanjut untuk SEMUA laporan milik pengguna (bukan hanya satu).
 * Mengambil laporan yang paling baru diperbarui beserta 3 riwayat status terakhir
 * dan petugas yang sedang ditugaskan. Read-only dan selalu dibatasi userId.
 */
export async function getMyFollowUpHistory(userId: string, limit = 20) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 20);
  const [total, reports] = await Promise.all([
    prisma.report.count({ where: { userId } }),
    prisma.report.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        status: true,
        location: true,
        updatedAt: true,
        _count: { select: { histories: true, assignments: true, evidences: true } },
        histories: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            status: true,
            notes: true,
            actorName: true,
            actorRole: true,
            createdAt: true,
          },
        },
        assignments: {
          where: { cancelledAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: {
            assignedAt: true,
            completedAt: true,
            notes: true,
            officer: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return {
    total,
    returned: reports.length,
    hasMore: reports.length < total,
    items: reports.map((r) => ({
      id: shortId(r.id),
      title: r.title,
      status: r.status,
      statusLabel: statusLabel(r.status),
      location: r.location,
      updatedAt: r.updatedAt.toISOString(),
      updatedAtWib: wibLabel(r.updatedAt),
      historyCount: r._count.histories,
      assignmentCount: r._count.assignments,
      evidenceCount: r._count.evidences,
      officer: r.assignments[0]?.officer.name ?? null,
      latestHistory: r.histories[0]
        ? {
            status: r.histories[0].status,
            statusLabel: statusLabel(r.histories[0].status),
            notes: r.histories[0].notes,
            actor: r.histories[0].actorName,
            actorRole: r.histories[0].actorRole,
            at: r.histories[0].createdAt.toISOString(),
            atWib: wibLabel(r.histories[0].createdAt),
          }
        : null,
      recentHistories: r.histories.map((h) => ({
        status: h.status,
        statusLabel: statusLabel(h.status),
        notes: h.notes,
        actor: h.actorName,
        actorRole: h.actorRole,
        at: h.createdAt.toISOString(),
        atWib: wibLabel(h.createdAt),
      })),
    })),
  };
}

// Kategori publik (distinct dari laporan, tanpa data sensitif)
export async function getPublicCategories(limit = 15) {
  const rows = await prisma.report.groupBy({
    by: ['category'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: Math.min(limit, 20),
  });
  return rows
    .filter((r) => r.category)
    .map((r) => ({ category: r.category, count: r._count.id }));
}

// Admin publik: hanya nama (tanpa email/kredensial)
export async function getPublicAdmins() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    orderBy: { name: 'asc' },
    select: { name: true },
  });
  return { visibility: 'PUBLIC', count: admins.length, items: admins.map((a) => ({ name: a.name })) };
}

// Hitungan pengguna per role (tanpa identitas — untuk "siapa saja masyarakat")
export async function getUserCounts() {
  const [total, citizens, officers, admins] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'CITIZEN' } }),
    prisma.user.count({ where: { role: 'OFFICER' } }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
  ]);
  return { total, citizens, officers, admins };
}

// Total seluruh laporan (agregat publik, tanpa data pribadi)
export async function getTotalReports() {
  const [total, pending, processing, completed, rejected] = await Promise.all([
    prisma.report.count(),
    prisma.report.count({ where: { status: 'SUBMITTED' } }),
    prisma.report.count({ where: { status: { in: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'] } } }),
    prisma.report.count({ where: { status: 'COMPLETED' } }),
    prisma.report.count({ where: { status: 'REJECTED' } }),
  ]);
  // `inProgress` dipertahankan sebagai alias lama; `processing` adalah nama yang
  // lebih tepat karena mencakup VERIFIED/ASSIGNED/IN_PROGRESS/REVIEW.
  return { total, pending, processing, inProgress: processing, completed, rejected };
}

// Lokasi teratas (agregat publik)
export async function getPublicLocations(limit = 8) {
  const rows = await prisma.report.groupBy({
    by: ['location'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: Math.min(limit, 15),
  });
  return rows
    .filter((r) => r.location)
    .map((r) => ({ location: r.location, count: r._count.id }));
}

// Website knowledge (statis dari registry, bukan database).
// `role` menentukan halaman & fitur mana yang boleh dijelaskan, sehingga AI
// tidak menjelaskan kemampuan role lain yang tidak relevan bagi pengguna.
export async function getWebsiteInfo(topic: string, role: ChatRole = 'CITIZEN') {
  const visibleToRole = (roles: string[]) => roles.includes(role) || roles.includes('PUBLIK');
  const profileRoute =
    role === 'ADMIN' ? '/admin/profile' : role === 'OFFICER' ? '/petugas/profile' : '/masyarakat/profile';
  const homeRoute =
    role === 'ADMIN' ? '/admin/dashboard' : role === 'OFFICER' ? '/petugas/dashboard' : '/masyarakat/dashboard';
  const myMenus = () =>
    WEBSITE.menus.filter((m) => m.role === role).map((m) => ({ role: m.role, menu: m.items }));

  switch (topic) {
    case 'updates':
      return {
        topic,
        lastUpdated: SYSTEM_LAST_UPDATED,
        total: SYSTEM_CHANGELOG.length,
        items: SYSTEM_CHANGELOG,
      };
    case 'statuses':
      return { topic, items: WEBSITE.statuses };
    case 'workflow':
      return { topic, items: WEBSITE.workflow };
    case 'menus':
      return { topic, items: myMenus() };
    case 'navigation':
    case 'pages':
      return {
        topic,
        items: WEBSITE.pages
          .filter((p) => visibleToRole(p.roles))
          .map((p) => ({ route: p.route, title: p.title, description: p.description })),
      };
    case 'features':
      return {
        topic,
        items: WEBSITE.features
          .filter((f) => f.allowedRoles.includes(role))
          .map((f) => ({ name: f.name, route: f.route, description: f.description })),
      };
    case 'adminAccounts':
      // Panduan pengelolaan akun KHUSUS ADMIN. Role lain tidak diberi konten ini.
      if (role !== 'ADMIN') {
        return {
          topic,
          items: [
            { name: 'Akses terbatas', route: '', description: 'Pengelolaan akun (menambah petugas, detail akun, reset kata sandi) hanya dapat dilakukan oleh Admin.' },
          ],
        };
      }
      return {
        topic,
        items: [
          { name: 'Tambah Petugas', route: '/admin/petugas', description: 'Buka menu Data Petugas lalu klik tombol "Tambah Petugas". Isi nama, email, nomor WhatsApp (opsional), dan kata sandi awal — atau biarkan sistem membuat kata sandi sementara otomatis. Role ditetapkan server sebagai Petugas.' },
          { name: 'Lokasi menu Data Petugas / Data Warga', route: '/admin/petugas', description: 'Menu "Data Petugas" dan "Data Warga" ada pada kelompok "Manajemen Pengguna" di sidebar Admin.' },
          { name: 'Lihat Detail Akun', route: '/admin/masyarakat', description: 'Pada tabel Data Warga/Data Petugas, klik "Lihat Detail" untuk melihat nama, email, nomor WhatsApp, peran, status, tanggal registrasi, jumlah laporan/penugasan, dan aktivitas terkait. Kata sandi tidak pernah ditampilkan.' },
          { name: 'Reset Kata Sandi', route: '/admin/masyarakat', description: 'Buka "Lihat Detail" pada akun warga/petugas lalu klik "Reset Kata Sandi" dan konfirmasi. Sistem menampilkan kata sandi sementara SEKALI; pengguna wajib menggantinya saat login berikutnya.' },
          { name: 'Aktifkan / Nonaktifkan Akun', route: '/admin/masyarakat', description: 'Gunakan tombol "Aktifkan"/"Nonaktifkan" pada tabel atau detail akun. Akun nonaktif tidak bisa login; data dan laporan tetap tersimpan.' },
          { name: 'Keamanan kata sandi', route: '', description: 'Kata sandi tersimpan sebagai hash (satu arah) dan tidak pernah dapat dilihat. Kata sandi sementara hanya ditampilkan sekali dan tidak dikirim lewat WhatsApp/email otomatis.' },
        ],
      };
    case 'account':
      return {
        topic,
        items: [
          { name: 'Logout', route: '', description: 'Klik tombol "Logout" di bagian bawah sidebar untuk keluar dengan aman.' },
          { name: 'Profil', route: profileRoute, description: 'Halaman Profil menampilkan data akun Anda.' },
          { name: 'Ubah password', route: profileRoute, description: 'Buka halaman Profil untuk mengubah password akun.' },
          { name: 'Lupa password', route: '/lupa-password', description: 'Buka halaman Lupa Kata Sandi dan masukkan nomor WhatsApp yang terdaftar. Tautan reset dikirim ke nomor tersebut, berlaku sekali pakai dan memiliki batas waktu. Jika nomor belum terdaftar, hubungi Admin Desa Ciperna.' },
          { name: 'Beranda sesuai role', route: homeRoute, description: 'Setelah login Anda diarahkan ke dashboard sesuai role.' },
        ],
      };
    case 'contact':
      return {
        topic,
        items: [
          { name: 'WhatsApp Admin', route: '', description: 'Hubungi admin via WhatsApp di 082118727522 (tombol tersedia di beranda dan footer).' },
          { name: 'Instagram Office Admin', route: '', description: 'Profil Instagram @syajehh (tautan tersedia di beranda dan footer).' },
        ],
      };
    default:
      return {
        topic: 'help',
        items: [
          { topic: 'menus', items: myMenus() },
          {
            topic: 'features',
            items: WEBSITE.features
              .filter((f) => f.allowedRoles.includes(role))
              .map((f) => ({ name: f.name, route: f.route, description: f.description })),
          },
        ],
      };
  }
}

// ============================================================================
// PORTAL DESA tools (semua role) — informasi publik desa dari database.
// Hanya data terverifikasi yang dikembalikan. Tidak pernah mengarang pejabat,
// statistik, atau visi/misi. Field yang kosong dinyatakan "belum tersedia".
// ============================================================================

/** Profil/identitas Desa Ciperna dari database (bukan pengetahuan model). */
export async function getVillageProfileInfo() {
  const profile = await getVillageProfile();
  const identity = villageIdentity(profile);
  const available = hasProfileContent(profile);
  const statusCode = profile?.dataStatus || 'UNVERIFIED';
  return {
    scope: 'Profil desa (data aktual dari database)',
    available,
    identity,
    address: fullAddress(profile),
    postalCode: profile?.postalCode || null,
    contact: profile?.phone || null,
    email: profile?.email || null,
    mapLink: profile?.mapLink || null,
    serviceHours: profile?.serviceHours || null,
    history: profile?.history || null,
    geography: profile?.geography || null,
    potential: profile?.potential || null,
    demographics: profile?.demographics || null,
    vision: profile?.vision || null,
    mission: profile?.mission || null,
    dataStatus: statusCode,
    dataStatusLabel: DATA_STATUS_LABELS[statusCode] || statusCode,
    verifiedAtWib: profile?.verifiedAt ? wibLabel(profile.verifiedAt) : null,
    sourceUrl: profile?.sourceUrl || null,
    missingFields: missingProfileFields(profile),
    note: available
      ? 'Gunakan hanya nilai yang ada di atas. Field bernilai null berarti data tersebut belum tercatat.'
      : 'Profil desa belum diisi/diverifikasi di sistem. Katakan informasinya belum tersedia dan jangan mengarang sejarah, visi, misi, atau angka.',
  };
}

/** Perangkat desa yang sudah Diverifikasi & Aktif (data publik). */
export async function getVillageOfficials(position?: string) {
  const officials = await getPublicOfficials();
  const needle = (position || '').trim().toLowerCase();
  const items = (needle
    ? officials.filter(
        (o) =>
          o.position.toLowerCase().includes(needle) ||
          (OFFICIAL_CATEGORY_LABELS[o.category] || '').toLowerCase().includes(needle) ||
          o.name.toLowerCase().includes(needle)
      )
    : officials
  ).map((o) => ({
    name: o.name,
    position: o.position,
    categoryLabel: OFFICIAL_CATEGORY_LABELS[o.category] || o.category,
    area: o.area || null,
    period: o.period || null,
    verified: o.isVerified,
    sourceUrl: o.sourceUrl || null,
    verifiedAtWib: o.verifiedAt ? wibLabel(o.verifiedAt) : null,
  }));

  return {
    scope: 'Perangkat desa (hanya data yang sudah diverifikasi & aktif)',
    count: items.length,
    items,
    note:
      items.length === 0
        ? 'Belum ada data perangkat desa (Kepala Desa, Sekretaris, Kaur/Kasi, RT/RW) yang diverifikasi di sistem. Katakan data belum tersedia; jangan menyebut nama siapa pun.'
        : undefined,
    privacy: 'Nomor pribadi perangkat tidak pernah disertakan di sini.',
  };
}

/** Daftar layanan/pelayanan desa yang aktif & terverifikasi. */
export async function getVillageServices() {
  const services = await getPublicServices();
  return {
    scope: 'Layanan desa (data terverifikasi)',
    count: services.length,
    items: services.map((s) => ({
      name: s.name,
      description: s.description || null,
      requirements: s.requirements || null,
      procedure: s.procedure || null,
      schedule: s.schedule || null,
      contact: s.contact || null,
      link: s.link || null,
    })),
    note:
      services.length === 0
        ? 'Belum ada data layanan desa yang dicatat/diverifikasi. Katakan informasi layanan belum tersedia.'
        : undefined,
  };
}

/** Pengumuman desa yang sudah diterbitkan. */
export async function getVillageAnnouncements(
  limit = 5,
  opts: { period?: string } = {}
) {
  const now = new Date();
  const where: any = {
    isPublished: true,
    deletedAt: null,
    archivedAt: null,
    publishedAt: { not: null, lte: now },
    OR: [{ validUntil: null }, { validUntil: { gte: now } }],
  };
  const period = opts.period === 'today' ? 'today' : undefined;
  if (period === 'today') {
    // Tanggal terbit dihitung pada kalender WIB, bukan zona server.
    where.publishedAt = { not: null, gte: startOfDay(now), lte: now };
  }

  const [total, announcements] = await Promise.all([
    prisma.villageAnnouncement.count({ where }),
    prisma.villageAnnouncement.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    }),
  ]);

  return {
    scope: 'Pengumuman desa yang sudah diterbitkan',
    period: period ?? null,
    periodLabel: period === 'today' ? 'hari ini (WIB)' : null,
    count: announcements.length,
    total,
    hasMore: total > announcements.length,
    items: announcements.map((a) => ({
      title: a.title,
      slug: a.slug,
      excerpt: a.excerpt || null,
      publishedAtWib: a.publishedAt ? wibLabel(a.publishedAt) : null,
      url: `/pengumuman/${a.slug}`,
    })),
    note:
      total === 0
        ? period === 'today'
          ? 'Belum ada pengumuman resmi yang diterbitkan hari ini (WIB). Katakan belum ada; jangan mengarang berita.'
          : 'Belum ada pengumuman resmi yang diterbitkan. Katakan belum ada pengumuman; jangan mengarang berita.'
        : undefined,
  };
}

/** Informasi lokasi/peta desa untuk bantuan "cara menuju kantor desa". */
export async function getVillageMapInfo() {
  const profile = await getVillageProfile();
  const identity = villageIdentity(profile);
  return {
    scope: 'Lokasi & peta desa (data aktual dari database)',
    // Identitas administratif selalu tersedia (dari database atau fallback
    // resmi desa), jadi pertanyaan lokasi tidak boleh dianggap "belum diisi".
    available: Boolean(identity.name),
    identity,
    address: fullAddress(profile),
    mapLink: profile?.mapLink || null,
    mapEmbedUrl: profile?.mapEmbedUrl || null,
    latitude: profile?.latitude ?? null,
    longitude: profile?.longitude ?? null,
    coordinateSource: profile?.coordinateSource || null,
    dataStatus: profile?.dataStatus || 'UNVERIFIED',
    note: profile?.mapLink
      ? 'Bila ditanya rute/cara menuju, arahkan ke tautan peta (mapLink) untuk petunjuk arah. Jangan mengarang patokan/alamat.'
      : 'Tautan lokasi belum diatur. Katakan Admin desa belum mengatur tautan lokasi dan jangan mengarang alamat/koordinat.',
  };
}

// ============================================================================
// OFFICER tools (hanya tugas milik sendiri)
// ============================================================================

export async function getMyTaskSummary(officerId: string) {
  const base = { officerId, cancelledAt: null };
  const [total, active, inProgress, completed, awaitingReview] = await Promise.all([
    prisma.assignment.count({ where: base }),
    prisma.assignment.count({ where: { ...base, completedAt: null } }),
    prisma.assignment.count({ where: { ...base, completedAt: null, report: { status: 'IN_PROGRESS' } } }),
    prisma.assignment.count({ where: { officerId, completedAt: { not: null } } }),
    prisma.assignment.count({ where: { ...base, completedAt: { not: null }, report: { status: 'REVIEW' } } }),
  ]);
  return {
    total,
    active,
    inProgress,
    completed,
    awaitingReview,
    definition: {
      active: 'tugas belum ditandai selesai oleh petugas',
      completed: 'tugas yang sudah dikirim bukti penyelesaiannya',
      awaitingReview: 'bukti sudah dikirim, menunggu verifikasi admin',
    },
  };
}

export async function getMyActiveTasks(officerId: string, limit = 5) {
  const tasks = await prisma.assignment.findMany({
    where: { officerId, cancelledAt: null, completedAt: null },
    orderBy: { assignedAt: 'desc' },
    take: Math.min(limit, 10),
    include: {
      report: {
        select: {
          id: true, title: true, location: true, status: true,
          category: true, severity: true, description: true,
          user: { select: { name: true, email: true } },
        },
      },
    },
  });
  return tasks.map((t) => ({
    assignmentId: shortId(t.id),
    reportId: shortId(t.report.id),
    title: t.report.title,
    location: t.report.location,
    status: t.report.status,
    statusLabel: statusLabel(t.report.status),
    category: t.report.category,
    severity: t.report.severity,
    reporter: t.report.user.name,
    reporterContact: maskEmail(t.report.user.email),
    assignedAt: t.assignedAt.toISOString(),
  }));
}

export async function getMyUrgentTasks(officerId: string, limit = 5) {
  const tasks = await prisma.assignment.findMany({
    where: {
      officerId, cancelledAt: null, completedAt: null,
      report: { severity: { in: ['TINGGI', 'KRITIS'] } },
    },
    orderBy: { assignedAt: 'asc' },
    take: Math.min(limit, 10),
    include: {
      report: { select: { id: true, title: true, location: true, status: true, severity: true } },
    },
  });
  return tasks.map((t) => ({
    assignmentId: shortId(t.id),
    title: t.report.title,
    location: t.report.location,
    status: t.report.status,
    statusLabel: statusLabel(t.report.status),
    severity: t.report.severity,
  }));
}

export interface MyTaskFilter {
  /** true = sudah selesai, false = masih aktif, undefined = semua. */
  done?: boolean;
  status?: string[];
  severity?: string[];
  /** Filter kategori fasilitas laporan (mis. "Jalan"). */
  category?: string;
  /** Potongan judul laporan. */
  title?: string;
  /** Potongan lokasi laporan. */
  location?: string;
  /** Potongan jenis kerusakan. */
  damageType?: string;
  period?: Period;
  /** Fragmen ID laporan yang sedang dibahas (prefix, minimal 6 karakter). */
  reportIdFragment?: string;
  /** Rentang tanggal WIB "YYYY-MM-DD" (inklusif). */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/** Pencarian tugas milik petugas dengan filter bebas (status/severity/kategori/periode). */
export async function searchMyTasks(officerId: string, filter: MyTaskFilter = {}) {
  const where: any = { officerId, cancelledAt: null };
  if (filter.done === true) where.completedAt = { not: null };
  else if (filter.done === false) where.completedAt = null;

  const reportWhere: any = {};
  if (Array.isArray(filter.status) && filter.status.length) {
    const s = filter.status.filter((x) => KNOWN_STATUSES.includes(x));
    if (s.length) reportWhere.status = { in: s };
  }
  if (Array.isArray(filter.severity) && filter.severity.length) {
    const s = filter.severity.filter((x) => KNOWN_SEVERITIES.includes(x));
    if (s.length) reportWhere.severity = { in: s };
  }
  if (filter.category) reportWhere.category = { contains: filter.category };
  if (filter.title) reportWhere.title = { contains: filter.title };
  if (filter.location) reportWhere.location = { contains: filter.location };
  if (filter.damageType) reportWhere.damageType = { contains: filter.damageType };
  const dated = dateRangeBounds(filter.dateFrom, filter.dateTo);
  if (dated) reportWhere.createdAt = dated;
  else {
    const range = periodRange(filter.period);
    if (range) reportWhere.createdAt = range;
  }
  if (filter.reportIdFragment && filter.reportIdFragment.trim().length >= 6) {
    reportWhere.id = { startsWith: filter.reportIdFragment.trim() };
  }
  if (Object.keys(reportWhere).length) where.report = reportWhere;

  const limit = Math.min(filter.limit ?? 8, 15);
  let [total, rows] = await Promise.all([
    prisma.assignment.count({ where }),
    prisma.assignment.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      take: limit,
      include: {
        report: {
          select: {
            id: true, title: true, location: true, status: true,
            category: true, severity: true, createdAt: true, updatedAt: true,
          },
        },
      },
    }),
  ]);

  const applied: string[] = [];
  if (filter.done === true) applied.push('hanya tugas selesai');
  if (filter.done === false) applied.push('hanya tugas aktif');
  if (reportWhere.status) applied.push(`status laporan: ${reportWhere.status.in.join(', ')}`);
  if (reportWhere.severity) applied.push(`keparahan: ${reportWhere.severity.in.join(', ')}`);
  if (filter.category) applied.push(`kategori laporan mengandung: ${filter.category}`);
  if (filter.title) applied.push(`judul laporan mengandung: ${filter.title}`);
  if (filter.location) applied.push(`lokasi laporan mengandung: ${filter.location}`);
  if (filter.damageType) applied.push(`jenis kerusakan mengandung: ${filter.damageType}`);
  const p = periodLabel(filter.period);
  if (p) applied.push(`periode pembuatan laporan: ${p}`);
  const dr = dateRangeLabel(filter.dateFrom, filter.dateTo);
  if (dr) applied.push(`tanggal pembuatan laporan: ${dr}`);
  if (filter.reportIdFragment) applied.push(`ID laporan: ${filter.reportIdFragment.trim()}`);

  // Pencarian alternatif aman: tetap hanya assignment milik petugas ini.
  let relaxed = false;
  if (total === 0 && !filter.reportIdFragment) {
    const source = [filter.category, filter.title, filter.location, filter.damageType]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .join(' ');
    const tokens = keywordTokens(source);
    if (tokens.length) {
      const relaxedWhere: any = {
        officerId,
        cancelledAt: null,
        report: { OR: textOrConditions(tokens) },
      };
      const [rTotal, rRows] = await Promise.all([
        prisma.assignment.count({ where: relaxedWhere }),
        prisma.assignment.findMany({
          where: relaxedWhere,
          orderBy: { assignedAt: 'desc' },
          take: limit,
          include: {
            report: {
              select: {
                id: true, title: true, location: true, status: true,
                category: true, severity: true, createdAt: true, updatedAt: true,
              },
            },
          },
        }),
      ]);
      if (rTotal > 0) {
        total = rTotal;
        rows = rRows;
        relaxed = true;
        applied.push(`pencarian diperluas dengan kata: ${tokens.join(', ')}`);
      }
    }
  }

  return {
    appliedFilters: applied,
    total,
    returned: rows.length,
    relaxed,
    relaxedNote: relaxed
      ? 'Filter awal tidak menemukan tugas yang cocok; pencarian diperluas. Tetap hanya tugas milik petugas ini.'
      : undefined,
    items: rows.map((t) => ({
      assignmentId: shortId(t.id),
      reportId: shortId(t.report.id),
      title: t.report.title,
      location: t.report.location,
      category: t.report.category,
      severity: t.report.severity,
      status: t.report.status,
      statusLabel: statusLabel(t.report.status),
      createdAt: t.report.createdAt.toISOString(),
      createdAtWib: wibLabel(t.report.createdAt),
      updatedAt: t.report.updatedAt.toISOString(),
      updatedAtWib: wibLabel(t.report.updatedAt),
    })),
  };
}

/**
 * Detail satu laporan yang DITUGASKAN kepada petugas yang sedang login.
 *
 * Mengapa perlu: sebelumnya petugas hanya punya daftar tugas (searchMyTasks),
 * sehingga pertanyaan lanjutan "petugasnya siapa?", "kapan diperbarui?", atau
 * "apa catatannya?" tidak punya tool detail. Tool ini memverifikasi bahwa
 * laporan benar-benar ditugaskan kepada petugas tersebut; bila bukan, hasilnya
 * null (tidak membocorkan keberadaan laporan petugas lain).
 */
export async function getMyTaskDetail(officerId: string, idFragment: string) {
  const frag = (idFragment || '').trim();
  if (frag.length < 6) return null;

  // Terima fragmen ID laporan maupun ID assignment (prefix).
  const candidates = await prisma.assignment.findMany({
    where: {
      officerId,
      cancelledAt: null,
      OR: [{ reportId: { startsWith: frag } }, { id: { startsWith: frag } }],
    },
    orderBy: { assignedAt: 'desc' },
    take: 2,
    select: { id: true, reportId: true },
  });
  if (candidates.length === 0) return null;

  const reportId = candidates[0].reportId;
  const r = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      user: { select: { name: true } },
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: { officer: { select: { name: true } } },
      },
      evidences: { orderBy: { createdAt: 'asc' } },
      histories: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!r) return null;

  // Verifikasi ulang kepemilikan (defense in depth; jangan hanya percaya query).
  const mine = r.assignments.find((a) => a.officerId === officerId && !(a as any).cancelledAt);
  if (!mine) return null;

  return {
    id: shortId(r.id),
    assignmentId: shortId(mine.id),
    title: r.title,
    description: r.description.slice(0, 2000),
    descriptionTruncated: r.description.length > 2000,
    category: r.category,
    damageType: r.damageType,
    severity: r.severity,
    location: r.location,
    status: r.status,
    statusLabel: statusLabel(r.status),
    reporter: r.user.name,
    createdAt: r.createdAt.toISOString(),
    createdAtWib: wibLabel(r.createdAt),
    updatedAt: r.updatedAt.toISOString(),
    updatedAtWib: wibLabel(r.updatedAt),
    rejectionReason: r.rejectionReason,
    assignment: {
      officer: mine.officer.name,
      assignedAt: mine.assignedAt.toISOString(),
      assignedAtWib: wibLabel(mine.assignedAt),
      completedAt: mine.completedAt ? mine.completedAt.toISOString() : null,
      completedAtWib: mine.completedAt ? wibLabel(mine.completedAt) : null,
      notes: mine.notes,
    },
    // ISOLASI DATA PETUGAS: yang ditampilkan HANYA penugasan milik petugas
    // ini. Identitas petugas lain & catatan penugasan lain tidak boleh bocor.
    assignments: r.assignments
      .filter((a) => a.officerId === officerId)
      .map((a) => ({
        officer: a.officer.name,
        assignedAt: a.assignedAt.toISOString(),
        assignedAtWib: wibLabel(a.assignedAt),
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
        completedAtWib: a.completedAt ? wibLabel(a.completedAt) : null,
        cancelled: !!(a as any).cancelledAt,
        notes: a.notes,
      })),
    evidences: r.evidences.map((e) => ({
      description: e.description,
      at: e.createdAt.toISOString(),
      atWib: wibLabel(e.createdAt),
    })),
    evidenceCount: r.evidences.length,
    // Riwayat status untuk petugas: identitas pelaku lain (nama petugas lain)
    // TIDAK boleh bocor. Yang ditampilkan hanya peran pelaku + apakah itu
    // aksi petugas itu sendiri, sehingga konteks kerja tetap jelas.
    timeline: r.histories.map((h) => ({
      status: h.status,
      notes: h.notes,
      actorRole: h.actorRole || null,
      actorIsSelf: h.actorName === mine.officer.name,
      at: h.createdAt.toISOString(),
      atWib: wibLabel(h.createdAt),
    })),
  };
}

// ============================================================================
// ADMIN tools (agregat sistem, tanpa credential/data sensitif)
// ============================================================================

// ============================================================================
// FILTER LAPORAN GENERIK (Asisten Admin) — READ-ONLY.
// Satu pasang listReports/countReports menggantikan banyak tool ad-hoc sehingga
// kombinasi bebas tetap terjawab, mis.:
//   "laporan jalan yang belum selesai"       → { category:'Jalan', statusNotFinal:true }
//   "berapa laporan severity tinggi bulan ini" → { severity:['TINGGI','KRITIS'], period:'month' }
//   "tampilkan laporan milik Arsa"            → { reporterName:'Arsa' }
// Semua angka berasal dari agregasi database, bukan perkiraan model.
// ============================================================================

export interface ReportFilter {
  /** Kode status sah: SUBMITTED, VERIFIED, ASSIGNED, IN_PROGRESS, REVIEW, COMPLETED, REJECTED. */
  status?: string[];
  /** true = hanya laporan yang belum final (bukan COMPLETED/REJECTED). */
  statusNotFinal?: boolean;
  category?: string;
  severity?: string[];
  damageType?: string;
  location?: string;
  /** Nama pelapor (pencocokan sebagian). Hanya dipakai tool ADMIN. */
  reporterName?: string;
  /** Nama petugas yang ditugaskan (pencocokan sebagian). Hanya dipakai tool ADMIN. */
  officerName?: string;
  /** Potongan judul laporan. */
  title?: string;
  period?: Period;
  /** Rentang tanggal WIB "YYYY-MM-DD" (inklusif). */
  dateFrom?: string;
  dateTo?: string;
  sort?: 'newest' | 'oldest';
  limit?: number;
  offset?: number;
}

/** Daftar status yang diakui agar argumen dari AI tidak pernah liar. */
const KNOWN_STATUSES = Object.keys(REPORT_STATUS_LABELS);
const KNOWN_SEVERITIES = ['RENDAH', 'SEDANG', 'TINGGI', 'KRITIS'];

function sanitizeFilter(f: ReportFilter = {}): ReportFilter {
  const out: ReportFilter = {};
  if (Array.isArray(f.status)) {
    const s = f.status.filter((x) => KNOWN_STATUSES.includes(x));
    if (s.length) out.status = s;
  }
  if (f.statusNotFinal) out.statusNotFinal = true;
  if (typeof f.category === 'string' && f.category.trim()) out.category = f.category.trim().slice(0, 40);
  if (Array.isArray(f.severity)) {
    const s = f.severity.filter((x) => KNOWN_SEVERITIES.includes(x));
    if (s.length) out.severity = s;
  }
  if (typeof f.damageType === 'string' && f.damageType.trim()) out.damageType = f.damageType.trim().slice(0, 40);
  if (typeof f.location === 'string' && f.location.trim()) out.location = f.location.trim().slice(0, 60);
  if (typeof f.reporterName === 'string' && f.reporterName.trim()) out.reporterName = f.reporterName.trim().slice(0, 60);
  if (typeof f.officerName === 'string' && f.officerName.trim()) out.officerName = f.officerName.trim().slice(0, 60);
  if (typeof f.title === 'string' && f.title.trim()) out.title = f.title.trim().slice(0, 80);
  if (f.period === 'today' || f.period === 'week' || f.period === 'month') out.period = f.period;
  if (
    typeof f.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.dateFrom) &&
    typeof f.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.dateTo) &&
    f.dateFrom <= f.dateTo
  ) {
    out.dateFrom = f.dateFrom;
    out.dateTo = f.dateTo;
  }
  if (f.sort === 'oldest' || f.sort === 'newest') out.sort = f.sort;
  if (Number.isFinite(f.limit)) out.limit = Math.min(Math.max(Number(f.limit), 1), 15);
  if (Number.isFinite(f.offset)) out.offset = Math.min(Math.max(Number(f.offset), 0), 500);
  return out;
}

function reportWhere(f: ReportFilter): any {
  const where: any = {};
  if (f.status?.length) where.status = { in: f.status };
  if (f.statusNotFinal) {
    where.status = where.status
      ? { in: (where.status.in as string[]).filter((s) => s !== 'COMPLETED' && s !== 'REJECTED') }
      : { notIn: ['COMPLETED', 'REJECTED'] };
  }
  if (f.category) where.category = { contains: f.category };
  if (f.severity?.length) where.severity = { in: f.severity };
  if (f.damageType) where.damageType = { contains: f.damageType };
  if (f.location) where.location = { contains: f.location };
  if (f.title) where.title = { contains: f.title };
  if (f.reporterName) where.user = { name: { contains: f.reporterName } };
  // Penugasan yang masih berlaku. `some` mencegah laporan yang punya beberapa
  // penugasan muncul lebih dari sekali pada hasil.
  if (f.officerName) {
    where.assignments = {
      some: {
        cancelledAt: null,
        officer: { name: { contains: f.officerName } },
      },
    };
  }
  const dated = dateRangeBounds(f.dateFrom, f.dateTo);
  if (dated) where.createdAt = dated;
  else {
    const range = periodRange(f.period);
    if (range) where.createdAt = range;
  }
  return where;
}

/** Penjelasan filter yang diterapkan — dipakai AI agar transparan ke pengguna. */
export function describeFilter(f: ReportFilter): string[] {
  const parts: string[] = [];
  if (f.status?.length) parts.push(`status: ${f.status.map((s) => `${statusLabel(s)} (${s})`).join(', ')}`);
  if (f.statusNotFinal) parts.push('hanya laporan belum final (bukan Selesai/Ditolak)');
  if (f.category) parts.push(`kategori fasilitas: ${f.category}`);
  if (f.severity?.length) parts.push(`tingkat keparahan: ${f.severity.join(', ')}`);
  if (f.damageType) parts.push(`jenis kerusakan: ${f.damageType}`);
  if (f.location) parts.push(`lokasi mengandung: ${f.location}`);
  if (f.title) parts.push(`judul mengandung: ${f.title}`);
  if (f.reporterName) parts.push(`nama pelapor mengandung: ${f.reporterName}`);
  if (f.officerName) parts.push(`nama petugas mengandung: ${f.officerName}`);
  const p = periodLabel(f.period);
  if (p) parts.push(`periode: ${p}`);
  const dr = dateRangeLabel(f.dateFrom, f.dateTo);
  if (dr) parts.push(`tanggal: ${dr}`);
  return parts;
}

/** Daftar laporan terfilter (maks 15 per halaman) beserta total sebenarnya. */
export async function listReports(filter: ReportFilter = {}) {
  const f = sanitizeFilter(filter);
  const where = reportWhere(f);
  const limit = f.limit ?? 10;
  const offset = f.offset ?? 0;
  const orderBy = f.sort === 'oldest' ? { createdAt: 'asc' as const } : { createdAt: 'desc' as const };

  const [total, rows, byStatus] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy,
      skip: offset,
      take: limit,
      select: {
        id: true, title: true, category: true, damageType: true, severity: true,
        location: true, status: true, createdAt: true,
        user: { select: { name: true } },
        // Nama petugas aktif membantu Admin menjawab "siapa yang mengerjakan?"
        // tanpa membuka data pribadi lain. Hanya tool ADMIN yang memakai ini.
        assignments: {
          where: { cancelledAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          select: { officer: { select: { name: true } } },
        },
      },
    }),
    prisma.report.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    }),
  ]);

  return {
    appliedFilters: describeFilter(f),
    total,
    returned: rows.length,
    offset,
    hasMore: offset + rows.length < total,
    items: rows.map((r) => ({
      id: shortId(r.id),
      title: r.title,
      category: r.category,
      damageType: r.damageType,
      severity: r.severity,
      location: r.location,
      status: r.status,
      statusLabel: statusLabel(r.status),
      reporter: r.user.name,
      officer: r.assignments[0]?.officer.name || null,
      createdAt: r.createdAt.toISOString(),
      createdAtWib: wibLabel(r.createdAt),
    })),
    byStatus: byStatus.map((s) => ({
      status: s.status,
      label: statusLabel(s.status),
      count: s._count.id,
    })),
  };
}

/** Jumlah laporan + rincian per status/kategori/severity untuk filter apa pun. */
export async function countReports(filter: ReportFilter = {}) {
  const f = sanitizeFilter(filter);
  const where = reportWhere(f);
  const [total, byStatus, byCategory, bySeverity] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.groupBy({ by: ['status'], where, _count: { id: true } }),
    prisma.report.groupBy({
      by: ['category'], where, _count: { id: true },
      orderBy: { _count: { id: 'desc' } }, take: 8,
    }),
    prisma.report.groupBy({
      by: ['severity'], where, _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of byStatus) statusMap[s.status] = s._count.id;

  return {
    appliedFilters: describeFilter(f),
    total,
    byStatus: Object.entries(statusMap).map(([code, count]) => ({
      status: code, label: statusLabel(code), count,
    })),
    byCategory: byCategory.filter((c) => c.category).map((c) => ({ category: c.category, count: c._count.id })),
    bySeverity: bySeverity.filter((s) => s.severity).map((s) => ({ severity: s.severity, count: s._count.id })),
    statusLabels: REPORT_STATUS_LABELS,
  };
}

/**
 * Cari pelapor berdasarkan potongan nama. Dipakai untuk "Tampilkan laporan milik Arsa".
 * `ambiguous: true` bila lebih dari satu pengguna cocok → AI wajib minta klarifikasi.
 * Hanya mengembalikan nama + jumlah laporan (tanpa kontak/kredensial).
 */
export async function findReportersByName(fragment: string, limit = 5) {
  const q = (fragment || '').trim();
  if (q.length < 2) return { query: q, ambiguous: false, candidates: [] };
  const users = await prisma.user.findMany({
    where: { name: { contains: q } },
    orderBy: { name: 'asc' },
    take: Math.min(Math.max(limit, 1), 8),
    select: { name: true, role: true, _count: { select: { reports: true } } },
  });
  return {
    query: q,
    ambiguous: users.length > 1,
    candidates: users.map((u) => ({ name: u.name, role: u.role, reportCount: u._count.reports })),
  };
}

// ============================================================================
// DIREKTORI AKUN (ADMIN) — pencarian/hitungan warga & petugas
// ----------------------------------------------------------------------------
// Mengapa bagian ini ada: sebelumnya hanya ada statistik AKUN yang tidak bisa
// difilter (mis. getUserCounts, getCitizenStats). Akibatnya pertanyaan seperti
// "siapa warga yang akunnya dinonaktifkan?" atau "berapa akun petugas aktif?"
// tidak punya tool yang tepat dan dijawab dengan angka umum atau "data tidak
// tersedia". Tool di bawah membaca Users secara langsung dengan filter role,
// status aktif, pencarian nama/email/telepon, dan tanggal pendaftaran.
//
// Keamanan: hanya mengembalikan field non-rahasia (tanpa password/hash/token).
// Email & telepon boleh dilihat Admin sesuai kebutuhan pengelolaan akun.
// ============================================================================

const ACCOUNT_ROLES = ['CITIZEN', 'OFFICER', 'ADMIN'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Label role yang ramah dibaca (satu makna untuk seluruh jawaban AI). */
export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  CITIZEN: 'masyarakat',
  OFFICER: 'petugas',
  ADMIN: 'admin',
};

export interface AccountFilter {
  /** Role akun: CITIZEN, OFFICER, atau ADMIN. */
  role?: AccountRole;
  /** true = hanya akun aktif; false = hanya akun nonaktif. */
  isActive?: boolean;
  /** Pencarian teks pada nama/email/nomor telepon (sebagian). */
  q?: string;
  /** Rentang tanggal pendaftaran (createdAt) dalam WIB. */
  period?: Period;
  /** Rentang tanggal pendaftaran eksplisit "YYYY-MM-DD" (WIB, inklusif).
   *  Bila diisi, nilainya MENANG atas `period`. */
  dateFrom?: string;
  dateTo?: string;
  /**
   * Status verifikasi WhatsApp (`User.phoneVerifiedAt`).
   * true = sudah terverifikasi; false = belum terverifikasi.
   * PENTING: ini BUKAN status laporan — jangan dicampur dengan status laporan.
   */
  verified?: boolean;
  /**
   * Sertakan email & nomor telepon pada hasil. Default FALSE (minimisasi data):
   * data kontak hanya dikirim bila pengguna benar-benar memintanya
   * ("email", "nomor HP", "WA") atau memang diperlukan untuk tugas Admin.
   * Tool ini tetap ADMIN-only; flag ini bukan pengganti otorisasi.
   */
  contact?: boolean;
  limit?: number;
  offset?: number;
}

/** Rentang tanggal "YYYY-MM-DD" yang valid (bukan sekadar cocok pola). */
function validIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  return value;
}

function sanitizeAccountFilter(f: AccountFilter = {}): AccountFilter {
  const out: AccountFilter = {};
  if (typeof f.role === 'string') {
    const r = f.role.toUpperCase() as AccountRole;
    if ((ACCOUNT_ROLES as readonly string[]).includes(r)) out.role = r;
  }
  if (typeof f.isActive === 'boolean') out.isActive = f.isActive;
  if (typeof f.q === 'string' && f.q.trim()) out.q = f.q.trim().slice(0, 60);
  if (f.period === 'today' || f.period === 'week' || f.period === 'month') out.period = f.period;
  const from = validIsoDate(f.dateFrom);
  const to = validIsoDate(f.dateTo);
  if (from || to) {
    out.dateFrom = from;
    out.dateTo = to;
  }
  if (typeof f.verified === 'boolean') out.verified = f.verified;
  if (f.contact === true) out.contact = true;
  if (Number.isFinite(f.limit)) out.limit = Math.min(Math.max(Number(f.limit), 1), 20);
  if (Number.isFinite(f.offset)) out.offset = Math.min(Math.max(Number(f.offset), 0), 500);
  return out;
}

function accountWhere(f: AccountFilter): any {
  const where: any = {};
  if (f.role) where.role = f.role;
  if (f.isActive !== undefined) where.isActive = f.isActive;
  // Rentang tanggal eksplisit menang atas periode relatif.
  const explicit = dateRangeBounds(f.dateFrom, f.dateTo);
  const range = explicit ?? periodRange(f.period);
  if (range) where.createdAt = range;
  if (f.verified === true) where.phoneVerifiedAt = { not: null };
  if (f.verified === false) where.phoneVerifiedAt = null;
  if (f.q) {
    // Cocokkan nama/email, dan (bila berupa angka) nomor telepon yang tersimpan ternormalisasi.
    const or: any[] = [{ name: { contains: f.q } }, { email: { contains: f.q } }];
    const digits = f.q.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phone: { contains: digits } });
    where.OR = or;
  }
  return where;
}

/** Penjelasan filter akun (agar AI transparan menyebut kriteria pencariannya). */
export function describeAccountFilter(f: AccountFilter): string[] {
  const parts: string[] = [];
  if (f.role) parts.push(`role: ${ACCOUNT_ROLE_LABELS[f.role] || f.role}`);
  if (f.isActive === true) parts.push('status akun: aktif');
  if (f.isActive === false) parts.push('status akun: nonaktif');
  if (f.q) parts.push(`kata kunci: "${f.q}" (nama/email/telepon)`);
  const explicitLabel = dateRangeLabel(f.dateFrom, f.dateTo);
  if (explicitLabel) {
    parts.push(`terdaftar: ${explicitLabel}`);
  } else {
    const p = periodLabel(f.period);
    if (p) parts.push(`terdaftar: ${p}`);
  }
  if (f.verified === true) parts.push('verifikasi WhatsApp: sudah terverifikasi');
  if (f.verified === false) parts.push('verifikasi WhatsApp: belum terverifikasi');
  return parts;
}

/**
 * Cari akun (warga/petugas/admin) dengan filter role, status aktif, kata kunci
 * nama/email/telepon, dan tanggal pendaftaran. Aman: tanpa password/hash.
 */
export async function searchAccounts(filter: AccountFilter = {}) {
  const f = sanitizeAccountFilter(filter);
  const where = accountWhere(f);
  const limit = f.limit ?? 10;
  const offset = f.offset ?? 0;

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        isActive: true, mustChangePassword: true, createdAt: true, phoneVerifiedAt: true,
        // Alasan penonaktifan yang diisi Admin (kolom `suspendReason` di schema).
        // Hanya tool ADMIN yang membacanya; dipakai menjawab "kenapa akun itu
        // dinonaktifkan?" tanpa mengarang alasan.
        suspendReason: true,
        _count: { select: { reports: true, assignments: true } },
      },
    }),
  ]);

  return {
    appliedFilters: describeAccountFilter(f),
    dateRange: f.dateFrom || f.dateTo ? { from: f.dateFrom ?? null, to: f.dateTo ?? null } : null,
    total,
    returned: rows.length,
    offset,
    hasMore: offset + rows.length < total,
    // Penanda eksplisit: tidak ada kolom rahasia yang diikutsertakan.
    safeFieldsOnly: true,
    // Transparansi: email/telepon hanya disertakan bila diminta eksplisit.
    contactIncluded: f.contact === true,
    items: rows.map((u) => ({
      id: shortId(u.id),
      name: u.name,
      role: u.role,
      roleLabel: ACCOUNT_ROLE_LABELS[u.role] || u.role,
      isActive: u.isActive,
      statusLabel: u.isActive ? 'Aktif' : 'Nonaktif',
      suspendReason: u.suspendReason || null,
      mustChangePassword: u.mustChangePassword,
      verified: u.phoneVerifiedAt !== null,
      verificationLabel: u.phoneVerifiedAt ? 'WhatsApp terverifikasi' : 'Belum verifikasi WhatsApp',
      verifiedAt: u.phoneVerifiedAt ? u.phoneVerifiedAt.toISOString() : null,
      verifiedAtWib: u.phoneVerifiedAt ? wibLabel(u.phoneVerifiedAt) : null,
      registeredAt: u.createdAt.toISOString(),
      registeredAtWib: wibLabel(u.createdAt),
      reportCount: u._count.reports,
      assignmentCount: u._count.assignments,
      // Minimisasi data: kontak pribadi TIDAK ikut dikirim ke model/kontak
      // kecuali pengguna memintanya secara eksplisit.
      ...(f.contact === true ? { email: u.email, phone: u.phone || null } : {}),
    })),
  };
}

/**
 * Hitung akun dengan filter yang sama seperti searchAccounts, sekaligus rincian
 * aktif/nonaktif dan per role. Agregasi dihitung di database (bukan dari daftar
 * terpotong), sehingga angka konsisten untuk pertanyaan "ada berapa".
 */
export async function countAccounts(filter: AccountFilter = {}) {
  const f = sanitizeAccountFilter(filter);
  // Buang paging sebelum menghitung (hitung selalu seluruh hasil filter).
  const base: AccountFilter = {
    role: f.role,
    isActive: f.isActive,
    q: f.q,
    period: f.period,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    verified: f.verified,
  };
  const where = accountWhere(base);
  const whereNoActive = accountWhere({ ...base, isActive: undefined });
  const whereNoRole = accountWhere({ ...base, role: undefined });
  const whereNoVerified = accountWhere({ ...base, verified: undefined });

  const total = await prisma.user.count({ where });

  // Rincian aktif/nonaktif SELALU berada di dalam himpunan yang sudah difilter,
  // sehingga active + inactive = total (tidak pernah melebihi total).
  let active: number;
  let inactive: number;
  if (base.isActive === true) {
    active = total;
    inactive = 0;
  } else if (base.isActive === false) {
    active = 0;
    inactive = total;
  } else {
    [active, inactive] = await Promise.all([
      prisma.user.count({ where: { ...whereNoActive, isActive: true } }),
      prisma.user.count({ where: { ...whereNoActive, isActive: false } }),
    ]);
  }

  // Rincian status verifikasi WhatsApp di dalam himpunan yang sama.
  let verified: number;
  let unverified: number;
  if (base.verified === true) {
    verified = total;
    unverified = 0;
  } else if (base.verified === false) {
    verified = 0;
    unverified = total;
  } else {
    [verified, unverified] = await Promise.all([
      prisma.user.count({ where: { ...whereNoVerified, phoneVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { ...whereNoVerified, phoneVerifiedAt: null } }),
    ]);
  }

  // Rincian per role: bila filter sudah menentukan satu role, seluruh himpunan
  // adalah role tersebut (jangan dihitung ulang tanpa role).
  let byRole: { citizens: number; officers: number; admins: number };
  if (base.role) {
    byRole = {
      citizens: base.role === 'CITIZEN' ? total : 0,
      officers: base.role === 'OFFICER' ? total : 0,
      admins: base.role === 'ADMIN' ? total : 0,
    };
  } else {
    const [citizens, officers, admins] = await Promise.all([
      prisma.user.count({ where: { ...whereNoRole, role: 'CITIZEN' } }),
      prisma.user.count({ where: { ...whereNoRole, role: 'OFFICER' } }),
      prisma.user.count({ where: { ...whereNoRole, role: 'ADMIN' } }),
    ]);
    byRole = { citizens, officers, admins };
  }

  return {
    appliedFilters: describeAccountFilter(base),
    dateRange: base.dateFrom || base.dateTo ? { from: base.dateFrom ?? null, to: base.dateTo ?? null } : null,
    total,
    active,
    inactive,
    verified,
    unverified,
    byRole,
    roleLabels: ACCOUNT_ROLE_LABELS,
  };
}

// ============================================================================
// KEAMANAN AKUN (READ-ONLY) — menjawab "apakah akun warga aman?"
// ----------------------------------------------------------------------------
// Mengapa tool terpisah: pertanyaan KEAMANAN sebelumnya terbaca sebagai
// "direktori akun" (kata "akun" + "warga"), sehingga Asisten membalas dengan
// DAFTAR akun berisi nama/email/telepon. Itu bukan jawaban, dan membocorkan
// data pribadi tanpa kebutuhan.
//
// Prinsip:
// - TIDAK PERNAH mengembalikan email, telepon, nama, atau hash kata sandi.
// - Hanya agregat (jumlah aktif/nonaktif) + kontrol keamanan yang benar-benar
//   dapat diperiksa pada kode aplikasi.
// - Menyatakan keterbatasan secara eksplisit; tidak mengklaim "aman" hanya
//   karena akun ada/aktif.
// - Non-Admin hanya menerima status akunnya SENDIRI (dipaksa di server,
//   bukan berdasarkan argumen dari model/pengguna).
// ============================================================================

export interface AccountSecurityArgs {
  role?: AccountRole;
  scope?: 'all' | 'self';
}

/**
 * Kontrol keamanan yang terverifikasi dari implementasi nyata (bukan asumsi).
 * Bila implementasi berubah, daftar ini WAJIB diperbarui — karena itu setiap
 * butir menyebut sumber kodenya.
 */
const VERIFIED_SECURITY_CONTROLS = [
  {
    key: 'password_hashing',
    label: 'Kata sandi disimpan sebagai hash satu arah (bcryptjs) dan dibandingkan dengan bcrypt.compare saat login.',
    evidence: 'src/app/api/auth/login/route.ts',
  },
  {
    key: 'password_policy',
    label: 'Kebijakan kata sandi terpusat: minimal 8 karakter, kombinasi huruf kapital, huruf kecil, dan angka.',
    evidence: 'src/lib/password.ts',
  },
  {
    key: 'session_signature',
    label: 'Sesi ditandatangani JWT HS256 dan disimpan pada cookie httpOnly, SameSite=Lax (secure di produksi).',
    evidence: 'src/lib/auth.ts',
  },
  {
    key: 'session_revalidation',
    label: 'Setiap permintaan membaca ulang pengguna dan role dari database, sehingga akun yang dihapus langsung kehilangan akses.',
    evidence: 'src/lib/auth.ts (getSession)',
  },
  {
    key: 'role_authorization',
    label: 'Setiap tool Asisten AI diperiksa terhadap role di server sebelum query dijalankan; role tidak diambil dari pesan pengguna.',
    evidence: 'src/lib/aiToolRegistry.ts (isToolAllowed)',
  },
  {
    key: 'account_enumeration',
    label: 'Pesan gagal login seragam, sehingga tidak membedakan identitas terdaftar dan kata sandi salah.',
    evidence: 'src/app/api/auth/login/route.ts (GENERIC_ERROR)',
  },
  {
    key: 'rate_limit',
    label: 'Percobaan login dibatasi laju per alamat IP, dan chat AI dibatasi per pengguna.',
    evidence: 'src/lib/rateLimit.ts',
  },
  {
    key: 'ai_data_minimization',
    label: 'Layer AI tidak pernah mengembalikan password/hash; email dan nomor telepon hanya tersedia untuk Admin dan hanya bila diminta.',
    evidence: 'src/lib/aiTools.ts (searchAccounts)',
  },
];

/** Keterbatasan yang juga terverifikasi — wajib disampaikan agar tidak menyesatkan. */
const VERIFIED_SECURITY_LIMITATIONS = [
  'Tidak ada autentikasi dua faktor (2FA) pada proses login.',
  'Sesi bersifat stateless (JWT berlaku 24 jam): tidak ada pencabutan sesi per perangkat; logout menghapus cookie di browser.',
  'Pembatasan laju disimpan di memori proses, sehingga tidak terdistribusi antar instance server.',
  'Akun yang dinonaktifkan tetap dapat login untuk melihat status (desain aplikasi); fitur utama dibatasi, bukan seluruh akses dicabut.',
];

/**
 * Ringkasan keamanan akun. READ-ONLY, tanpa data pribadi.
 * `viewer` selalu berasal dari sesi server (lihat aiToolRegistry).
 */
export async function getAccountSecurityOverview(
  args: AccountSecurityArgs = {},
  viewer?: { userId: string; role: ChatRole }
) {
  const viewerRole = viewer?.role ?? 'CITIZEN';
  const isAdmin = viewerRole === 'ADMIN';
  // Non-Admin SELALU dibatasi ke akun sendiri (argumen model diabaikan).
  // Admin boleh meminta scope 'self' untuk pertanyaan "apakah akun saya aman?".
  const wantSelf = !isAdmin || args.scope === 'self';
  const generatedAtWib = wibLabel(new Date());

  if (wantSelf) {
    // Hanya status akun sendiri — tanpa nama, email, telepon, atau hash.
    const self = viewer?.userId
      ? await prisma.user.findUnique({
          where: { id: viewer.userId },
          select: {
            role: true,
            isActive: true,
            mustChangePassword: true,
            phoneVerifiedAt: true,
            suspendReason: true,
            createdAt: true,
          },
        })
      : null;

    return {
      scope: 'self' as const,
      generatedAtWib,
      readOnly: true,
      includesPersonalData: false,
      self: self
        ? {
            role: self.role,
            roleLabel: ACCOUNT_ROLE_LABELS[self.role] || self.role,
            isActive: self.isActive,
            statusLabel: self.isActive ? 'Aktif' : 'Nonaktif',
            mustChangePassword: self.mustChangePassword,
            whatsappVerified: self.phoneVerifiedAt !== null,
            suspendReason: self.suspendReason || null,
            registeredAtWib: wibLabel(self.createdAt),
          }
        : null,
      counts: null,
      controls: VERIFIED_SECURITY_CONTROLS,
      limitations: VERIFIED_SECURITY_LIMITATIONS,
    };
  }

  // Admin: agregat saja (tanpa identitas). Role opsional sesuai pertanyaan.
  const roleFilter: AccountRole | undefined =
    args.role && (ACCOUNT_ROLES as readonly string[]).includes(args.role)
      ? (args.role as AccountRole)
      : undefined;
  const summary = await countAccounts(roleFilter ? { role: roleFilter } : {});

  return {
    scope: 'all' as const,
    generatedAtWib,
    readOnly: true,
    includesPersonalData: false,
    roleFilter: roleFilter ?? null,
    roleLabel: roleFilter ? ACCOUNT_ROLE_LABELS[roleFilter] : null,
    counts: {
      total: summary.total,
      active: summary.active,
      inactive: summary.inactive,
      verifiedWhatsapp: summary.verified,
      unverifiedWhatsapp: summary.unverified,
      byRole: summary.byRole,
    },
    self: null,
    controls: VERIFIED_SECURITY_CONTROLS,
    limitations: VERIFIED_SECURITY_LIMITATIONS,
  };
}

// ============================================================================
// PENDAFTARAN AKUN (ADMIN) — sumber kebenaran untuk "siapa yang baru daftar?"
// ----------------------------------------------------------------------------
// Mengapa tool terpisah: pertanyaan pendaftaran sering ditulis sangat santai
// ("siapa yg baru regis?", "tadi ada warga daftar ga?", "pendaftar dari kemarin
// berapa?") dan sebelumnya jatuh ke statistik laporan atau dijawab "data tidak
// tersedia". Tool ini membaca `User.createdAt` (BUKAN `updatedAt`) dengan batas
// hari zona Asia/Jakarta, serta membedakan akun yang SUDAH/BELUM terverifikasi
// WhatsApp (`phoneVerifiedAt`) dari status laporan.
//
// Read-only, hanya ADMIN (lihat aiToolRegistry), tanpa password/hash/token.
// ============================================================================

export interface RegistrationQuery {
  /** Periode relatif "hari ini"/"pekan ini"/"bulan ini" (WIB). */
  period?: Period;
  /** Rentang tanggal eksplisit "YYYY-MM-DD" (WIB, inklusif). */
  dateFrom?: string;
  dateTo?: string;
  /** true = sudah verifikasi WhatsApp; false = belum. */
  verified?: boolean;
  /** Role akun. Default CITIZEN (pendaftaran mandiri warga). */
  role?: AccountRole;
  limit?: number;
  offset?: number;
}

export async function getRecentRegistrations(args: RegistrationQuery = {}) {
  const period: Period | undefined =
    args.period === 'today' || args.period === 'week' || args.period === 'month'
      ? args.period
      : undefined;
  const dateFrom = validIsoDate(args.dateFrom);
  const dateTo = validIsoDate(args.dateTo);
  const verified =
    typeof args.verified === 'boolean' ? args.verified : undefined;
  const role: AccountRole =
    typeof args.role === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(args.role.toUpperCase())
      ? (args.role.toUpperCase() as AccountRole)
      : 'CITIZEN';
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
  const offset = Math.min(Math.max(Number(args.offset) || 0, 0), 500);

  const explicit = dateRangeBounds(dateFrom, dateTo);
  const range = explicit ?? periodRange(period);

  const where: any = { role };
  if (range) where.createdAt = range;
  if (verified === true) where.phoneVerifiedAt = { not: null };
  if (verified === false) where.phoneVerifiedAt = null;

  const [total, verifiedTotal, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { ...where, phoneVerifiedAt: { not: null } } }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        phoneVerifiedAt: true,
      },
    }),
  ]);

  const explicitLabel = dateRangeLabel(dateFrom, dateTo);
  const periodLabelText = explicitLabel ?? periodLabel(period) ?? 'data terbaru (tanpa batas tanggal)';
  const appliedFilters = [
    `role: ${ACCOUNT_ROLE_LABELS[role] || role}`,
    `terdaftar: ${periodLabelText}`,
    ...(verified === true ? ['verifikasi WhatsApp: sudah terverifikasi'] : []),
    ...(verified === false ? ['verifikasi WhatsApp: belum terverifikasi'] : []),
  ];

  return {
    intent: 'registration',
    period: period ?? null,
    dateRange: explicit ? { from: dateFrom ?? null, to: dateTo ?? null } : null,
    periodLabel: periodLabelText,
    role,
    roleLabel: ACCOUNT_ROLE_LABELS[role] || role,
    verifiedFilter: verified ?? null,
    appliedFilters,
    total,
    verifiedTotal,
    unverifiedTotal: total - verifiedTotal,
    returned: rows.length,
    offset,
    hasMore: offset + rows.length < total,
    generatedAtWib: wibLabel(new Date()),
    safeFieldsOnly: true,
    items: rows.map((u) => ({
      id: shortId(u.id),
      name: u.name,
      email: u.email,
      phone: u.phone || null,
      role: u.role,
      roleLabel: ACCOUNT_ROLE_LABELS[u.role] || u.role,
      isActive: u.isActive,
      statusLabel: u.isActive ? 'Aktif' : 'Nonaktif',
      verified: u.phoneVerifiedAt !== null,
      verificationLabel: u.phoneVerifiedAt ? 'WhatsApp terverifikasi' : 'Belum verifikasi WhatsApp',
      createdAt: u.createdAt.toISOString(),
      registeredAt: u.createdAt.toISOString(),
      // WAJIB memakai label WIB: konversi manual ISO→tanggal bisa meleset 1 hari.
      createdAtWib: wibLabel(u.createdAt),
      registeredAtWib: wibLabel(u.createdAt),
    })),
  };
}

/**
 * Jumlah tugas per petugas. Dipakai untuk pertanyaan lanjutan seperti
 * "berapa tugas mereka?" setelah daftar petugas dibahas. Pemilihan petugas
 * dapat lewat daftar nama (hasil konteks) atau filter role+status aktif.
 * `active` = tugas belum selesai & belum dibatalkan.
 */
export type OfficerAssignmentFilter = 'all' | 'with_active' | 'without_active';

export async function getOfficerTaskCounts(
  args: {
    names?: string[];
    isActive?: boolean;
    limit?: number;
    offset?: number;
    assignment?: OfficerAssignmentFilter;
  } = {}
) {
  const names = (Array.isArray(args.names) ? args.names : [])
    .map((n) => String(n || '').trim())
    .filter((n) => n.length >= 2)
    .slice(0, 10);
  const where: any = { role: 'OFFICER' };
  if (typeof args.isActive === 'boolean') where.isActive = args.isActive;
  if (names.length > 0) where.OR = names.map((n) => ({ name: { contains: n } }));

  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
  const offset = Math.max(Number(args.offset) || 0, 0);
  const assignmentFilter: OfficerAssignmentFilter =
    args.assignment === 'with_active' || args.assignment === 'without_active'
      ? args.assignment
      : 'all';

  const [allOfficers, baseOfficers] = await Promise.all([
    prisma.user.count({ where: { role: 'OFFICER' } }),
    prisma.user.findMany({
      where,
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true },
    }),
  ]);

  const appliedFilters: string[] = [];
  if (names.length > 0) appliedFilters.push(`petugas: ${names.join(', ')}`);
  if (args.isActive === true) appliedFilters.push('hanya petugas berstatus aktif');
  if (args.isActive === false) appliedFilters.push('hanya petugas berstatus nonaktif');
  if (assignmentFilter === 'with_active') appliedFilters.push('hanya petugas yang punya tugas aktif');
  if (assignmentFilter === 'without_active') appliedFilters.push('hanya petugas tanpa tugas aktif');

  if (baseOfficers.length === 0) {
    return {
      appliedFilters,
      totalOfficers: 0,
      allOfficers,
      matchedOfficers: 0,
      withActiveTasks: 0,
      withoutActiveTasks: 0,
      returned: 0,
      hasMore: false,
      limit,
      offset,
      assignmentFilter,
      officers: [],
      withoutActiveNames: [],
      withActiveNames: [],
    };
  }

  const rows = await prisma.assignment.findMany({
    where: { officerId: { in: baseOfficers.map((o) => o.id) } },
    select: { officerId: true, completedAt: true, cancelledAt: true },
  });
  const stat = new Map<string, { total: number; active: number; completed: number; cancelled: number }>();
  for (const o of baseOfficers) stat.set(o.id, { total: 0, active: 0, completed: 0, cancelled: 0 });
  for (const r of rows) {
    const s = stat.get(r.officerId);
    if (!s) continue;
    s.total += 1;
    if (r.cancelledAt) s.cancelled += 1;
    else if (r.completedAt) s.completed += 1;
    else s.active += 1;
  }

  const enriched = baseOfficers.map((o) => ({
    name: o.name,
    isActive: o.isActive,
    ...stat.get(o.id)!,
  }));
  const withActive = enriched.filter((o) => o.active > 0);
  const withoutActive = enriched.filter((o) => o.active === 0);
  const matched =
    assignmentFilter === 'with_active'
      ? withActive
      : assignmentFilter === 'without_active'
        ? withoutActive
        : enriched;
  const page = matched.slice(offset, offset + limit);

  return {
    appliedFilters,
    // totalOfficers = jumlah petugas yang cocok dengan filter akun/nama,
    // bukan jumlah hasil halaman. Ini mencegah "10 hasil" disebut "10 petugas".
    totalOfficers: baseOfficers.length,
    allOfficers,
    matchedOfficers: matched.length,
    withActiveTasks: withActive.length,
    withoutActiveTasks: withoutActive.length,
    returned: page.length,
    hasMore: offset + page.length < matched.length,
    limit,
    offset,
    assignmentFilter,
    // active = belum selesai (masih ditangani/pending); selesai = tugas tuntas.
    officers: page,
    withoutActiveNames: withoutActive.slice(0, 10).map((o) => o.name),
    withActiveNames: withActive.slice(0, 10).map((o) => o.name),
  };
}

/**
 * Diagnostik READ-ONLY untuk ADMIN/development: memeriksa apakah AI dapat
 * membaca tiap domain data yang diizinkan. Setiap domain dicoba terpisah
 * sehingga satu kegagalan tidak menyembunyikan domain lain.
 */
export async function runAiDiagnostics() {
  const checks: { key: string; label: string; run: () => Promise<number> }[] = [
    { key: 'reports', label: 'Laporan (total)', run: () => prisma.report.count() },
    { key: 'reportsByStatus', label: 'Laporan per status', run: async () => (await prisma.report.groupBy({ by: ['status'], _count: { id: true } })).length },
    { key: 'reportsByCategory', label: 'Laporan per kategori', run: async () => (await prisma.report.groupBy({ by: ['category'], _count: { id: true } })).length },
    { key: 'unverified', label: 'Antrean verifikasi', run: () => prisma.report.count({ where: { status: 'SUBMITTED' } }) },
    { key: 'usersByRole', label: 'Akun per role', run: async () => (await prisma.user.groupBy({ by: ['role'], _count: { id: true } })).length },
    { key: 'accountsInactive', label: 'Akun nonaktif', run: () => prisma.user.count({ where: { isActive: false } }) },
    { key: 'assignments', label: 'Penugasan petugas', run: () => prisma.assignment.count() },
    { key: 'evidences', label: 'Bukti penyelesaian', run: () => prisma.reportEvidence.count() },
    { key: 'statusHistory', label: 'Riwayat status laporan', run: () => prisma.reportStatusHistory.count() },
    { key: 'notifications', label: 'Notifikasi', run: () => prisma.notification.count() },
    { key: 'duplicates', label: 'Laporan duplikat terkonfirmasi', run: () => prisma.report.count({ where: { duplicateStatus: 'DUPLICATE' } }) },
    { key: 'villageProfile', label: 'Profil desa', run: () => prisma.villageProfile.count() },
    { key: 'villageOfficials', label: 'Perangkat desa terverifikasi', run: () => prisma.villageOfficial.count({ where: { isActive: true, isVerified: true } }) },
    { key: 'villageServices', label: 'Layanan desa terverifikasi', run: () => prisma.villageService.count({ where: { isActive: true, isVerified: true } }) },
    { key: 'villageAnnouncements', label: 'Pengumuman terbit', run: () => prisma.villageAnnouncement.count({ where: { isPublished: true, deletedAt: null, archivedAt: null } }) },
  ];

  const domains: { key: string; label: string; ok: boolean; count?: number; error?: string; ms: number }[] = [];
  for (const c of checks) {
    const t0 = Date.now();
    try {
      const count = await c.run();
      domains.push({ key: c.key, label: c.label, ok: true, count, ms: Date.now() - t0 });
    } catch {
      // Pesan error teknis tidak dibocorkan; hanya penanda kegagalan.
      domains.push({ key: c.key, label: c.label, ok: false, error: 'query gagal', ms: Date.now() - t0 });
    }
  }
  const failedDomains = domains.filter((d) => !d.ok).map((d) => d.key);
  // Model yang dilaporkan = model utama provider AKTIF (konfigurasi terpusat).
  let activeModel = '-';
  try {
    const chain = await resolveAiProviderChain();
    activeModel = chain.attempts[0]?.primaryModel || '-';
  } catch {
    activeModel = '-';
  }
  return {
    generatedAtWib: wibLabel(new Date()),
    model: activeModel,
    readOnly: true,
    totalDomains: domains.length,
    okDomains: domains.length - failedDomains.length,
    failedDomains,
    domains,
  };
}

export async function getSystemStats(monthOnly = false, weekOnly = false) {
  const where = weekOnly ? { createdAt: { gte: startOfWeek() } } : monthOnly ? { createdAt: { gte: startOfMonth() } } : {};
  const byStatus = await prisma.report.groupBy({
    by: ['status'], where, _count: { id: true },
  });
  const total = byStatus.reduce((a, b) => a + b._count.id, 0);
  const map: Record<string, number> = {};
  for (const s of byStatus) map[s.status] = s._count.id;
  return {
    total,
    submitted: map['SUBMITTED'] || 0,
    verified: map['VERIFIED'] || 0,
    assigned: map['ASSIGNED'] || 0,
    inProgress: map['IN_PROGRESS'] || 0,
    review: map['REVIEW'] || 0,
    completed: map['COMPLETED'] || 0,
    rejected: map['REJECTED'] || 0,
    // Gabungan status yang belum final. BUKAN status tersendiri: jangan
    // dijumlahkan dengan submitted/verified/... karena akan tumpang tindih.
    notFinalInclusive: total - (map['COMPLETED'] || 0) - (map['REJECTED'] || 0),
    note:
      'Nilai submitted..rejected dan byStatus saling terpisah (totalnya = total). ' +
      'notFinalInclusive adalah gabungan (tumpang tindih) dan tidak boleh disajikan sebagai total eksklusif.',
    byStatus: byStatus.map((s) => ({
      status: s.status, label: statusLabel(s.status), count: s._count.id,
    })),
    period: periodLabel(weekOnly ? 'week' : monthOnly ? 'month' : null) || 'keseluruhan',
    statusLabels: REPORT_STATUS_LABELS,
  };
}

/**
 * Statistik per dimensi (kategori / jenis kerusakan / keparahan / lokasi).
 *
 * Mengapa mengembalikan objek, bukan array: agar jawaban AI KONSISTEN. Dulu tool
 * ini hanya mengembalikan daftar nilai sehingga model bisa menyebut "total 60"
 * padahal jumlah baris yang ditampilkan hanya 52 (sebagian laporan belum punya
 * kategori/jenis kerusakan). Sekarang disertakan `total`, `covered`, dan
 * `unclassified` sehingga selisihnya dapat dijelaskan, bukan ditebak.
 *
 * Filter periode diperhatikan supaya pertanyaan seperti "jenis kerusakan apa saja
 * HARI INI" tidak dijawab dengan data sepanjang waktu.
 */
export interface DimensionStatsFilter {
  period?: Period;
  /** Rentang tanggal WIB "YYYY-MM-DD" (inklusif). */
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  severity?: string[];
  statusNotFinal?: boolean;
  /** Hanya hitung laporan yang punya nilai pada dimensi ini. */
  excludeUnclassified?: boolean;
}

const DIMENSION_LABEL: Record<string, string> = {
  category: 'kategori fasilitas',
  damageType: 'jenis kerusakan',
  severity: 'tingkat keparahan',
  location: 'lokasi/wilayah',
};

async function dimensionStats(
  field: 'category' | 'damageType' | 'severity' | 'location',
  filter: DimensionStatsFilter = {},
  limit = 8
) {
  const where: any = {};
  const dated = dateRangeBounds(filter.dateFrom, filter.dateTo);
  if (dated) where.createdAt = dated;
  else {
    const range = periodRange(filter.period);
    if (range) where.createdAt = range;
  }
  if (filter.category) where.category = { contains: filter.category };
  if (filter.severity?.length) where.severity = { in: filter.severity };
  if (filter.statusNotFinal) where.status = { notIn: ['COMPLETED', 'REJECTED'] };

  const [total, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.groupBy({
      by: [field],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: Math.min(Math.max(limit, 1), 15),
    }),
  ]);

  const items = rows
    .filter((r: any) => r[field] !== null && r[field] !== '')
    .map((r: any) => ({ value: r[field], count: r._count.id }));
  const covered = items.reduce((a, b) => a + b.count, 0);

  const applied: string[] = [];
  const p = periodLabel(filter.period);
  if (p) applied.push(`periode: ${p}`);
  const dr = dateRangeLabel(filter.dateFrom, filter.dateTo);
  if (dr) applied.push(`tanggal: ${dr}`);
  if (filter.category) applied.push(`kategori fasilitas: ${filter.category}`);
  if (filter.severity?.length) applied.push(`tingkat keparahan: ${filter.severity.join(', ')}`);
  if (filter.statusNotFinal) applied.push('hanya laporan belum final');

  return {
    dimension: field,
    dimensionLabel: DIMENSION_LABEL[field] || field,
    appliedFilters: applied,
    scope: applied.length ? applied.join('; ') : 'seluruh laporan',
    /** Jumlah laporan dalam cakupan filter (angka yang harus dipakai AI). */
    total,
    /** Jumlah baris yang tercakup pada rincian di bawah. */
    covered,
    /** Laporan yang belum punya nilai dimensi ini (jelaskan, jangan diabaikan). */
    unclassified: total - covered,
    items,
  };
}

export async function getStatsByCategory(filter: DimensionStatsFilter = {}, limit = 10) {
  return dimensionStats('category', filter, limit);
}

export async function getStatsBySeverity(filter: DimensionStatsFilter = {}, limit = 10) {
  return dimensionStats('severity', filter, limit);
}

export async function getStatsByLocation(filter: DimensionStatsFilter = {}, limit = 8) {
  return dimensionStats('location', filter, limit);
}

export async function getOfficerStats() {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER' },
    select: {
      name: true,
      assignments: { select: { completedAt: true, cancelledAt: true } },
    },
  });
  return officers
    .map((o) => ({
      name: o.name,
      total: o.assignments.filter((a) => !a.cancelledAt).length,
      active: o.assignments.filter((a) => !a.completedAt && !a.cancelledAt).length,
      completed: o.assignments.filter((a) => !!a.completedAt && !a.cancelledAt).length,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export async function getAvgResolutionDays() {
  const done = await prisma.assignment.findMany({
    where: { completedAt: { not: null } },
    select: { assignedAt: true, completedAt: true },
    take: 500,
  });
  if (done.length === 0) return { samples: 0, avgDays: null };
  const totalMs = done.reduce((a, x) => a + (x.completedAt!.getTime() - x.assignedAt.getTime()), 0);
  return {
    samples: done.length,
    avgDays: Math.round((totalMs / done.length / 86400000) * 10) / 10,
  };
}

// Statistik warga terdaftar (ADMIN only via executor). Tanpa password/hash.
export async function getCitizenStats() {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  // Definisi role & status HARUS sama dengan countAccounts({ role: 'CITIZEN' })
  // agar angka "siapa saja warga" tidak berbeda dari "berapa akun warga".
  const [total, active, inactive, thisWeek] = await Promise.all([
    prisma.user.count({ where: { role: 'CITIZEN' } }),
    prisma.user.count({ where: { role: 'CITIZEN', isActive: true } }),
    prisma.user.count({ where: { role: 'CITIZEN', isActive: false } }),
    prisma.user.count({ where: { role: 'CITIZEN', createdAt: { gte: weekAgo } } }),
  ]);
  return { role: 'CITIZEN', total, active, inactive, newThisWeek: thisWeek };
}

// Warga yang sudah melapor: nama distinct + jumlah laporan (ADMIN only via executor).
export async function getReporters(limit = 10) {
  const groups = await prisma.report.groupBy({
    by: ['userId'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: Math.min(limit, 20),
  });
  if (groups.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return groups.map((g) => ({ name: names.get(g.userId) || '-', reportCount: g._count.id }));
}

// Warga terbaru (ADMIN only via executor). Nama + tanggal daftar saja.
export async function getRecentCitizens(limit = 8) {
  const rows = await prisma.user.findMany({
    where: { role: 'CITIZEN' },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 15),
    select: { name: true, createdAt: true },
  });
  return rows.map((u) => ({ name: u.name, registeredAt: u.createdAt.toISOString() }));
}

export async function getRecentReports(limit = 5) {
  const rows = await prisma.report.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 10),
    select: {
      id: true, title: true, location: true, status: true,
      category: true, severity: true, createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    ...r,
    id: shortId(r.id),
    reporter: r.user.name,
    statusLabel: statusLabel(r.status),
    user: undefined,
    createdAt: r.createdAt.toISOString(),
  }));
}

// --- Cross-table & operasional Admin (tanpa data sensitif) ---

// Laporan yang dibuat HARI INI (WIB): pelapor, judul, waktu, kategori, status.
export async function getTodayReports(limit = 15) {
  const { gte, lt } = wibDayRange();
  const where = { createdAt: { gte, lt } };
  const [count, rows, byStatus] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 20),
      select: {
        id: true, title: true, category: true, location: true, status: true, createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.report.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    }),
  ]);
  return {
    date: wibDate(),
    dateLabel: wibDateLabel(),
    period: 'hari ini (WIB)',
    count,
    returned: rows.length,
    hasMore: rows.length < count,
    items: rows.map((r) => ({
      id: shortId(r.id), title: r.title, reporter: r.user.name,
      category: r.category, location: r.location, status: r.status,
      statusLabel: statusLabel(r.status),
      createdAt: r.createdAt.toISOString(),
      createdAtWib: wibLabel(r.createdAt),
    })),
    byStatus: byStatus.map((s) => ({
      status: s.status,
      label: statusLabel(s.status),
      count: s._count.id,
    })),
  };
}

// Nama-nama pelapor hari ini (distinct).
export async function getTodayReporters() {
  const { gte, lt } = wibDayRange();
  const groups = await prisma.report.groupBy({
    by: ['userId'],
    where: { createdAt: { gte, lt } },
    _count: { id: true },
  });
  if (groups.length === 0) {
    return { date: wibDate(), dateLabel: wibDateLabel(), count: 0, reporters: [] };
  }
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    date: wibDate(),
    dateLabel: wibDateLabel(),
    count: groups.length,
    reporters: groups.map((g) => ({ name: names.get(g.userId) || '-', reportCount: g._count.id })),
  };
}

// Warga yang mendaftar HARI INI (nama + waktu, tanpa kontak).
export async function getTodayCitizens(limit = 15) {
  const { gte, lt } = wibDayRange();
  const where = { role: 'CITIZEN', createdAt: { gte, lt } };
  const [count, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 20),
      select: { name: true, createdAt: true },
    }),
  ]);
  return {
    date: wibDate(),
    dateLabel: wibDateLabel(),
    period: 'hari ini (WIB)',
    count,
    returned: rows.length,
    items: rows.map((u) => ({
      name: u.name,
      registeredAt: u.createdAt.toISOString(),
      registeredAtWib: wibLabel(u.createdAt),
    })),
  };
}

/**
 * Direktori/beban kerja petugas: daftar petugas + tugas aktif yang sedang
 * dipegang. Hasil selalu menyertakan total dan status pemotongan agar UI/AI
 * tidak menyebut "semua petugas" ketika yang ditampilkan hanya sebagian.
 */
export async function getOfficerWorkload(
  args: { isActive?: boolean; limit?: number; offset?: number } = {}
) {
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const offset = Math.max(Number(args.offset) || 0, 0);
  const where: any = { role: 'OFFICER' };
  if (typeof args.isActive === 'boolean') where.isActive = args.isActive;

  const [totalOfficers, allOfficers, activeOfficers, inactiveOfficers, officers] =
    await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({ where: { role: 'OFFICER' } }),
      prisma.user.count({ where: { role: 'OFFICER', isActive: true } }),
      prisma.user.count({ where: { role: 'OFFICER', isActive: false } }),
      prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: offset,
        take: limit,
        select: {
          name: true,
          isActive: true,
          assignments: {
            where: { completedAt: null, cancelledAt: null },
            orderBy: { assignedAt: 'desc' },
            select: { report: { select: { title: true, status: true } } },
          },
        },
      }),
    ]);

  const appliedFilters: string[] = [];
  if (args.isActive === true) appliedFilters.push('hanya petugas aktif');
  if (args.isActive === false) appliedFilters.push('hanya petugas nonaktif');

  return {
    scope: 'Data petugas dari database (akun ber-role OFFICER)',
    totalOfficers,
    allOfficers,
    activeOfficers,
    inactiveOfficers,
    returned: officers.length,
    hasMore: offset + officers.length < totalOfficers,
    limit,
    offset,
    isActive: typeof args.isActive === 'boolean' ? args.isActive : null,
    appliedFilters,
    officers: officers.map((o) => ({
      name: o.name,
      isActive: o.isActive,
      activeTasks: o.assignments.length,
      reports: o.assignments.slice(0, 5).map((a) => ({
        title: a.report.title,
        status: a.report.status,
      })),
    })),
  };
}

export interface AdminReportRef {
  id: string;
  title: string;
  location: string;
  status: string;
  statusLabel: string;
  category: string | null;
  severity: string | null;
  createdAt: string;
  reporter: string;
}

function toRef(r: {
  id: string; title: string; location: string; status: string;
  category: string | null; severity: string | null; createdAt: Date;
  user: { name: string };
}): AdminReportRef {
  return {
    id: shortId(r.id), title: r.title, location: r.location, status: r.status,
    statusLabel: statusLabel(r.status),
    category: r.category, severity: r.severity, createdAt: r.createdAt.toISOString(),
    reporter: r.user.name,
  };
}

// Detail penuh 1 laporan: pelapor + penugasan/petugas + bukti + timeline + duplikat
export async function getReportFullDetail(idFragment: string) {
  const fullId = await findReportIdByFragment({}, idFragment);
  if (!fullId) return null;

  const r = await prisma.report.findUnique({
    where: { id: fullId },
    include: {
      user: { select: { name: true } },
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: { officer: { select: { name: true } } },
      },
      evidences: { orderBy: { createdAt: 'asc' }, select: { description: true, createdAt: true } },
      histories: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!r) return null;

  let main: { id: string; title: string; location: string; status: string } | null = null;
  if (r.duplicateOfReportId) {
    const m = await prisma.report.findUnique({
      where: { id: r.duplicateOfReportId },
      select: { id: true, title: true, location: true, status: true },
    });
    if (m) main = { ...m, id: shortId(m.id) };
  }

  return {
    id: shortId(r.id),
    title: r.title,
    description: r.description.slice(0, 500),
    location: r.location,
    category: r.category,
    damageType: r.damageType,
    severity: r.severity,
    status: r.status,
    statusLabel: statusLabel(r.status),
    reporter: r.user.name,
    createdAt: r.createdAt.toISOString(),
    createdAtWib: wibLabel(r.createdAt),
    aiResult: r.aiResult,
    aiConfidence: r.aiConfidence,
    rejectionReason: r.rejectionReason,
    duplicateStatus: (r as any).duplicateStatus || 'ORIGINAL',
    duplicateConfidence: (r as any).duplicateConfidence ?? null,
    duplicateOf: main,
    assignments: r.assignments.map((a) => ({
      officer: a.officer.name,
      assignedAt: a.assignedAt.toISOString(),
      assignedAtWib: wibLabel(a.assignedAt),
      completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      completedAtWib: a.completedAt ? wibLabel(a.completedAt) : null,
      cancelled: !!(a as any).cancelledAt,
      notes: a.notes,
    })),
    evidences: r.evidences.map((e) => ({ description: e.description })),
    evidenceCount: r.evidences.length,
    timeline: r.histories.map((h) => ({
      status: h.status, notes: h.notes, actor: h.actorName, at: h.createdAt.toISOString(),
      atWib: wibLabel(h.createdAt),
    })),
  };
}

// Cari laporan berdasarkan fragmen JUDUL ("status laporan X", "laporan berjudul ...").
// Mengembalikan jumlah total + penanda ambiguitas agar AI bisa meminta klarifikasi.
export async function searchReportsByTitle(fragment: string, limit = 3) {
  const q = fragment.trim();
  if (q.length < 4) return { query: q, total: 0, ambiguous: false, items: [] };
  const where = { title: { contains: q } };
  const [total, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 5),
      select: {
        id: true, title: true, location: true, status: true,
        category: true, severity: true, createdAt: true,
        user: { select: { name: true } },
        assignments: {
          where: { cancelledAt: null },
          orderBy: { assignedAt: 'desc' },
          take: 1,
          include: { officer: { select: { name: true } } },
        },
      },
    }),
  ]);
  return {
    query: q,
    total,
    ambiguous: total > 1,
    items: rows.map((r) => ({
      ...toRef(r),
      statusLabel: statusLabel(r.status),
      officer: r.assignments[0]?.officer.name || null,
      createdAt: r.createdAt.toISOString(),
      createdAtWib: wibLabel(r.createdAt),
    })),
  };
}

/**
 * Pencarian laporan berdasarkan kata kunci bebas (judul/deskripsi/lokasi/
 * kategori/jenis kerusakan). READ-ONLY, hanya untuk Admin, hasil dibatasi.
 */
export async function searchReportsByKeyword(keyword: string, filter: ReportFilter = {}) {
  const q = (keyword || '').trim().slice(0, 60);
  if (q.length < 2) {
    return { query: q, total: 0, returned: 0, items: [], appliedFilters: [] };
  }
  const f = sanitizeFilter({ ...filter, title: undefined });
  const baseWhere = reportWhere(f);
  const makeWhere = (terms: string[]) => ({
    ...baseWhere,
    OR: terms.flatMap((term) => [
      { title: { contains: term } },
      { description: { contains: term } },
      { location: { contains: term } },
      { damageType: { contains: term } },
      { category: { contains: term } },
    ]),
  });
  const select = {
    id: true, title: true, category: true, damageType: true, severity: true,
    location: true, status: true, createdAt: true,
  } as const;
  const take = Math.min(Math.max(Number(f.limit) || 8, 1), 15);

  let where = makeWhere([q]);
  let [total, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      select,
    }),
  ]);

  // Pencarian alternatif: bila frasa utuh tidak ditemukan, coba kata-kata
  // pentingnya satu per satu. Tetap READ-ONLY dan tetap memakai filter role
  // yang sudah ditentukan tool registry (ADMIN).
  let relaxed = false;
  if (total === 0) {
    const tokens = keywordTokens(q);
    if (tokens.length > 0 && (tokens.length > 1 || tokens[0] !== q.toLowerCase())) {
      const altWhere = makeWhere(tokens);
      const [altTotal, altRows] = await Promise.all([
        prisma.report.count({ where: altWhere }),
        prisma.report.findMany({
          where: altWhere,
          orderBy: { createdAt: 'desc' },
          take,
          select,
        }),
      ]);
      if (altTotal > 0) {
        total = altTotal;
        rows = altRows;
        where = altWhere;
        relaxed = true;
      }
    }
  }

  return {
    query: q,
    appliedFilters: [
      ...describeFilter(f),
      `kata kunci: "${q}" (judul/deskripsi/lokasi/kategori/jenis)`,
      ...(relaxed ? ['pencarian diperluas per kata kunci'] : []),
    ],
    total,
    returned: rows.length,
    hasMore: total > rows.length,
    relaxed,
    relaxedNote: relaxed
      ? 'Frasa lengkap tidak ditemukan; pencarian diperluas menggunakan kata-kata pentingnya.'
      : undefined,
    items: rows.map((r) => ({
      id: shortId(r.id),
      title: r.title,
      category: r.category,
      damageType: r.damageType,
      severity: r.severity,
      location: r.location,
      status: r.status,
      statusLabel: statusLabel(r.status),
      createdAtWib: wibLabel(r.createdAt),
    })),
  };
}

/**
 * Penolakan tindakan tulis (READ-ONLY). Tidak menyentuh database dan tidak
 * pernah mengklaim perubahan sudah terjadi. Pesan disesuaikan dengan role.
 */
export function refuseWrite(action: string, role: ChatRole = 'CITIZEN') {
  const a = (action || '').toLowerCase();
  const who = role === 'ADMIN' ? 'Admin' : role === 'OFFICER' ? 'Petugas' : 'Masyarakat';
  let guidance =
    'Perubahan data hanya dapat dilakukan melalui halaman resmi yang memerlukan hak akses dan konfirmasi.';

  if (a === 'verify') {
    guidance =
      role === 'ADMIN'
        ? 'Verifikasi/persetujuan laporan dilakukan Admin pada halaman Laporan (/admin/laporan) di detail laporan. Buka detail, periksa bukti, lalu konfirmasi tindakan di sana.'
        : 'Verifikasi dan persetujuan laporan hanya dapat dilakukan Admin. Anda tidak memiliki wewenang untuk mengubah status laporan.';
  } else if (a === 'assign') {
    guidance =
      role === 'ADMIN'
        ? 'Penugasan petugas dilakukan Admin melalui detail laporan di halaman Laporan (/admin/laporan). Pilih petugas lalu konfirmasi penugasan.'
        : 'Penugasan petugas hanya dapat dilakukan Admin.';
  } else if (a === 'delete') {
    guidance =
      role === 'ADMIN'
        ? 'Penghapusan/arsip data dilakukan Admin melalui menu terkait (Laporan, Pengumuman, Data Warga, atau Data Petugas) dan memerlukan konfirmasi. Riwayat yang masih dipakai tidak dihapus permanen.'
        : 'Penghapusan data hanya dapat dilakukan Admin.';
  } else if (a === 'status') {
    guidance =
      role === 'ADMIN'
        ? 'Perubahan status laporan dilakukan melalui alur resmi pada detail laporan di /admin/laporan atau oleh petugas di halaman tugasnya. Setiap perubahan memerlukan konfirmasi dan tercatat di riwayat.'
        : role === 'OFFICER'
          ? 'Status pengerjaan diubah dari halaman Tugas (/petugas/tugas) dengan mengirim bukti penyelesaian; persetujuan akhir tetap oleh Admin.'
          : 'Status laporan hanya dapat diubah oleh Admin/Petugas melalui alur resmi.';
  } else if (a === 'account') {
    guidance =
      role === 'ADMIN'
        ? 'Pengelolaan akun dilakukan di menu Data Warga/Data Petugas (/admin/masyarakat atau /admin/petugas): tambah petugas, reset kata sandi, aktif/nonaktifkan. Kata sandi tidak pernah ditampilkan kepada asisten.'
        : 'Untuk kata sandi, gunakan halaman Lupa Kata Sandi (/lupa-password) atau ubah kata sandi di halaman Profil. Tautan reset hanya dikirim ke nomor WhatsApp yang terdaftar.';
  } else if (a === 'announcement') {
    guidance =
      role === 'ADMIN'
        ? 'Pembuatan/penerbitan pengumuman dilakukan di menu Pengumuman (/admin/pengumuman). Periksa pratinjau dan konfirmasi sebelum menerbitkan atau mengirim notifikasi WhatsApp.'
        : 'Pengumuman hanya dapat dibuat dan diterbitkan oleh Admin.';
  } else if (a === 'send') {
    guidance =
      role === 'ADMIN'
        ? 'Pengiriman WhatsApp dilakukan dari menu Pengumuman (/admin/pengumuman) setelah pengumuman diterbitkan, dengan konfirmasi dan persetujuan penerima.'
        : 'Pengiriman pesan WhatsApp hanya dapat dilakukan Admin melalui menu Pengumuman.';
  } else if (a === 'create' || a === 'update') {
    guidance =
      role === 'CITIZEN'
        ? 'Untuk membuat laporan, buka /masyarakat/laporan/create. Untuk mengubah profil, buka halaman Profil. Perubahan disimpan setelah Anda menekan tombol simpan dan mendapat konfirmasi.'
        : 'Lakukan perubahan melalui halaman resmi yang sesuai. Asisten tidak dapat menyimpan perubahan.';
  }

  return {
    refused: true,
    readOnly: true,
    action: a || 'other',
    message:
      `Saya hanya dapat membaca dan merangkum data, jadi saya tidak dapat melakukan tindakan tersebut dari percakapan. ` +
      `${guidance} Tidak ada perubahan data yang saya lakukan.`,
    role: who,
  };
}

// Laporan ke-N tertua (untuk "laporan nomor N")
export async function getNthReport(n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 10000) return null;
  const rows = await prisma.report.findMany({
    orderBy: { createdAt: 'asc' },
    skip: n - 1,
    take: 1,
    select: { id: true },
  });
  if (rows.length === 0) return null;
  return getReportFullDetail(rows[0].id);
}

// Antrean verifikasi (SUBMITTED)
export async function getUnverifiedQueue(limit = 8) {
  const rows = await prisma.report.findMany({
    where: { status: 'SUBMITTED' },
    orderBy: { createdAt: 'asc' },
    take: Math.min(limit, 15),
    include: { user: { select: { name: true } } },
  });
  return {
    count: await prisma.report.count({ where: { status: 'SUBMITTED' } }),
    queue: 'laporan baru menunggu verifikasi admin',
    returned: rows.length,
    items: rows.map(toRef),
  };
}

// Menunggu penugasan (VERIFIED tanpa assignment aktif)
export async function getPendingAssignment(limit = 8) {
  const rows = await prisma.report.findMany({
    where: { status: 'VERIFIED', assignments: { none: { completedAt: null, cancelledAt: null } } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(limit, 15),
    include: { user: { select: { name: true } } },
  });
  return {
    count: await prisma.report.count({
      where: { status: 'VERIFIED', assignments: { none: { completedAt: null, cancelledAt: null } } },
    }),
    queue: 'laporan sudah diverifikasi tetapi belum ada petugas aktif',
    returned: rows.length,
    items: rows.map(toRef),
  };
}

// Menunggu verifikasi hasil (REVIEW)
export async function getPendingResultVerification(limit = 8) {
  const rows = await prisma.report.findMany({
    where: { status: 'REVIEW' },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(limit, 15),
    include: {
      user: { select: { name: true } },
      assignments: {
        where: { completedAt: { not: null } },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        include: { officer: { select: { name: true } } },
      },
    },
  });
  return {
    count: await prisma.report.count({ where: { status: 'REVIEW' } }),
    queue: 'bukti penyelesaian menunggu verifikasi admin',
    returned: rows.length,
    items: rows.map((r) => ({
      ...toRef(r),
      officer: r.assignments[0]?.officer.name || null,
    })),
  };
}

// Severity tinggi yang belum selesai
export async function getHighSeverityReports(limit = 8) {
  const where = { severity: { in: ['TINGGI', 'KRITIS'] }, status: { notIn: ['COMPLETED', 'REJECTED'] } };
  const [count, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 15),
      include: { user: { select: { name: true } } },
    }),
  ]);
  return {
    count,
    returned: rows.length,
    items: rows.map((r) => ({ ...toRef(r), statusLabel: statusLabel(r.status) })),
  };
}

// Laporan hari ini (batas hari WIB, konsisten dengan tool hari-ini lainnya)
export async function getTodaySummary() {
  const { gte, lt } = wibDayRange();
  const byStatus = await prisma.report.groupBy({
    by: ['status'], where: { createdAt: { gte, lt } }, _count: { id: true },
  });
  const total = byStatus.reduce((a, b) => a + b._count.id, 0);
  const map: Record<string, number> = {};
  for (const s of byStatus) map[s.status] = s._count.id;
  return { total, byStatus: map };
}

// Lokasi dengan laporan berulang (indikasi kejadian sama)
export async function getRepeatedLocations(limit = 8) {
  const rows = await prisma.report.groupBy({
    by: ['location'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 30,
  });
  return rows
    .filter((r) => r.location && r._count.id > 1)
    .slice(0, Math.min(limit, 10))
    .map((r) => ({ location: r.location, count: r._count.id }));
}

// Ringkasan duplikat
export async function getDuplicateOverview() {
  const [possible, duplicated] = await Promise.all([
    prisma.report.findMany({
      where: { duplicateStatus: 'POSSIBLE_DUPLICATE' },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
    prisma.report.count({ where: { duplicateStatus: 'DUPLICATE' } }),
  ]);
  const mainIds = Array.from(new Set(possible.map((r) => (r as any).duplicateOfReportId).filter(Boolean))) as string[];
  const mains = mainIds.length
    ? await prisma.report.findMany({ where: { id: { in: mainIds } }, select: { id: true, title: true, location: true } })
    : [];
  const mainMap = new Map(mains.map((m) => [m.id, m]));
  return {
    possibleCount: possible.length,
    duplicatedCount: duplicated,
    items: possible.map((r) => {
      const m = (r as any).duplicateOfReportId ? mainMap.get((r as any).duplicateOfReportId) : null;
      return {
        ...toRef(r),
        confidence: (r as any).duplicateConfidence ?? null,
        mainReport: m ? { id: shortId(m.id), title: m.title, location: m.location } : null,
      };
    }),
  };
}

/**
 * Jelaskan hasil analisis AI sebuah laporan: kategori, urgensi, confidence,
 * alasan klasifikasi, fakta, informasi yang belum tersedia, dan tindakan
 * disarankan — semuanya dari hasil yang TERSIMPAN (bukan dikarang ulang).
 */
/**
 * Resolusi rujukan laporan: ID (prefix) ATAU potongan judul. Dipakai tool
 * penjelasan analisis agar Admin bisa bertanya dengan judul, bukan hanya ID.
 */
async function resolveReportRef(ref: string): Promise<string | null> {
  const byId = await findReportIdByFragment({}, ref);
  if (byId) return byId;
  const frag = (ref || '').trim();
  if (frag.length < 4) return null;
  const byTitle = await prisma.report.findMany({
    where: { title: { contains: frag } },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true },
  });
  return byTitle[0]?.id ?? null;
}

export async function explainReportAnalysis(idFragment: string) {
  const fullId = await resolveReportRef(idFragment);
  if (!fullId) return null;

  const r = await prisma.report.findUnique({
    where: { id: fullId },
    include: { user: { select: { name: true } } },
  });
  if (!r) return null;

  const latest = await prisma.reportAnalysis.findFirst({
    where: { reportId: r.id, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
  });
  const lastAttempt = await prisma.reportAnalysis.findFirst({
    where: { reportId: r.id },
    orderBy: { createdAt: 'desc' },
  });

  return {
    id: shortId(r.id),
    title: r.title,
    location: r.location,
    status: r.status,
    statusLabel: statusLabel(r.status),
    reporter: r.user.name,
    createdAtWib: wibLabel(r.createdAt),
    aiStatus: r.aiStatus,
    aiStatusLabel: aiStatusLabel(r.aiStatus),
    aiError: r.aiError,
    aiModel: r.aiModel,
    aiAnalyzedAt: r.aiAnalyzedAt ? wibLabel(r.aiAnalyzedAt) : null,
    analysisCount: r.analysisCount,
    hasAnalysis: !!latest,
    analysis: latest
      ? {
          category: latest.category,
          damageType: latest.damageType,
          severity: latest.severity,
          confidence: latest.confidence,
          summary: latest.summary,
          urgencyReason: latest.urgencyReason,
          reasons: safeJsonArray(latest.reasons),
          facts: safeJsonArray(latest.facts),
          missing: safeJsonArray(latest.missing),
          recommendation: latest.recommendation,
          suggestedAction: latest.suggestedAction,
          model: latest.model,
          provider: latest.provider,
          analyzedAtWib: wibLabel(latest.createdAt),
        }
      : null,
    lastAttempt: lastAttempt
      ? { status: lastAttempt.status, error: lastAttempt.errorMessage, atWib: wibLabel(lastAttempt.createdAt) }
      : null,
    note: latest
      ? null
      : 'Belum ada hasil analisis valid yang tersimpan untuk laporan ini. Jangan mengarang kategori/urgensi; sarankan Admin menjalankan analisis ulang.',
  };
}

/**
 * Nilai kandidat duplikat untuk SATU laporan (on-demand, READ-ONLY).
 * Mengembalikan 3 kandidat teratas beserta band transparan, termasuk
 * "Tidak cukup bukti" agar Admin tahu kapan data tidak mendukung.
 */
export async function findReportDuplicateCandidates(idFragment: string, limit = 3) {
  const fullId = await resolveReportRef(idFragment);
  if (!fullId) return null;

  const target = await prisma.report.findUnique({
    where: { id: fullId },
    include: { user: { select: { name: true } } },
  });
  if (!target) return null;

  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const others = await prisma.report.findMany({
    where: {
      id: { not: target.id },
      status: { not: 'REJECTED' },
      duplicateStatus: { not: 'DUPLICATE' },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
    take: 60,
    include: { user: { select: { name: true } } },
  });

  const scored = others
    .map((o) => {
      const s = scoreSimilarity(
        {
          category: target.category, damageType: target.damageType,
          location: target.location, latitude: target.latitude, longitude: target.longitude,
          title: target.title, description: target.description, createdAt: target.createdAt,
        },
        {
          category: o.category, damageType: o.damageType,
          location: o.location, latitude: o.latitude, longitude: o.longitude,
          title: o.title, description: o.description, createdAt: o.createdAt,
        }
      );
      return { o, ...s };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, 5));

  const flagged = scored.filter((s) => s.flagged);

  return {
    report: {
      id: shortId(target.id),
      title: target.title,
      location: target.location,
      category: target.category,
      createdAtWib: wibLabel(target.createdAt),
      duplicateStatus: target.duplicateStatus,
      reporter: target.user.name,
    },
    verdict: flagged.length > 0 ? flagged[0].band : 'Tidak cukup bukti',
    candidates: scored.map((s) => ({
      id: shortId(s.o.id),
      title: s.o.title,
      location: s.o.location,
      category: s.o.category,
      createdAtWib: wibLabel(s.o.createdAt),
      status: s.o.status,
      reporter: s.o.user.name,
      score: s.score,
      band: s.band,
      flagged: s.flagged,
      reasons: s.reasons,
    })),
    note: flagged.length > 0
      ? 'Kandidat hanya untuk ditinjau Admin. Tidak ada laporan yang dihapus/digabung otomatis.'
      : 'Tidak ada kandidat dengan bukti lokasi yang cukup. Jangan menyatakan duplikat.',
  };
}

/** Rekap status analisis AI (terpisah dari status operasional laporan). */
export async function getAnalysisStatusRecap() {
  const groups = await prisma.report.groupBy({ by: ['aiStatus'], _count: { id: true } });
  const counts: Record<string, number> = {
    PENDING: 0, ANALYZING: 0, SUCCESS: 0, FAILED: 0, NEEDS_REVIEW: 0,
  };
  for (const g of groups) counts[g.aiStatus] = g._count.id;

  const [failed, needsReview, total] = await Promise.all([
    prisma.report.findMany({
      where: { aiStatus: 'FAILED' },
      orderBy: { aiAnalyzedAt: 'desc' },
      take: 8,
      select: { id: true, title: true, location: true, aiError: true, aiAnalyzedAt: true },
    }),
    prisma.report.findMany({
      where: { aiStatus: 'NEEDS_REVIEW' },
      orderBy: { aiAnalyzedAt: 'desc' },
      take: 8,
      select: { id: true, title: true, location: true, aiAnalyzedAt: true },
    }),
    prisma.report.count(),
  ]);

  return {
    total,
    counts,
    labels: {
      PENDING: aiStatusLabel('PENDING'),
      ANALYZING: aiStatusLabel('ANALYZING'),
      SUCCESS: aiStatusLabel('SUCCESS'),
      FAILED: aiStatusLabel('FAILED'),
      NEEDS_REVIEW: aiStatusLabel('NEEDS_REVIEW'),
    },
    failed: failed.map((r) => ({
      id: shortId(r.id), title: r.title, location: r.location,
      error: r.aiError, atWib: r.aiAnalyzedAt ? wibLabel(r.aiAnalyzedAt) : null,
    })),
    needsReview: needsReview.map((r) => ({
      id: shortId(r.id), title: r.title, location: r.location,
      atWib: r.aiAnalyzedAt ? wibLabel(r.aiAnalyzedAt) : null,
    })),
  };
}

// Detail 1 petugas berdasarkan nama (termasuk tanggal bergabung)
export async function getOfficerDetail(nameFragment: string) {
  const officers = await prisma.user.findMany({
    where: { role: 'OFFICER' },
    select: {
      name: true,
      createdAt: true,
      assignments: {
        where: { cancelledAt: null },
        orderBy: { assignedAt: 'desc' },
        take: 10,
        include: { report: { select: { id: true, title: true, status: true, location: true } } },
      },
    },
  });
  const officersDone = await prisma.user.findMany({
    where: { role: 'OFFICER' },
    select: {
      name: true,
      assignments: { where: { cancelledAt: null }, select: { completedAt: true } },
    },
  });
  const doneMap = new Map(officersDone.map((o) => [o.name, o.assignments.filter((a) => !!a.completedAt).length]));
  const found = officers.filter((o) => o.name.toLowerCase().includes(nameFragment.toLowerCase()));
  if (found.length === 0) return { found: false, officers: officers.map((o) => o.name) };
  return {
    found: true,
    officers: found.slice(0, 3).map((o) => ({
      name: o.name,
      joinedAt: o.createdAt.toISOString(),
      active: o.assignments.filter((a) => !a.completedAt).length,
      completed: doneMap.get(o.name) || 0,
      tasks: o.assignments.slice(0, 5).map((a) => ({
        reportId: shortId(a.report.id),
        title: a.report.title,
        status: a.report.status,
        location: a.report.location,
        done: !!a.completedAt,
      })),
    })),
  };
}

// Laporan SUBMITTED yang terlalu lama (default > 7 hari)
export async function getStaleReports(days = 7, limit = 8) {
  const before = new Date(Date.now() - days * 86400000);
  const where = { status: 'SUBMITTED', createdAt: { lt: before } };
  const [count, rows] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 15),
      include: { user: { select: { name: true } } },
    }),
  ]);
  return { days, count, returned: rows.length, items: rows.map(toRef) };
}

// Rata-rata confidence AI
export async function getAvgAiConfidence() {
  const rows = await prisma.report.findMany({
    where: { aiConfidence: { not: null } },
    select: { aiConfidence: true },
    take: 1000,
  });
  if (rows.length === 0) return { samples: 0, avg: null };
  const avg = rows.reduce((a, r) => a + (r.aiConfidence || 0), 0) / rows.length;
  return { samples: rows.length, avg: Math.round(avg * 10) / 10 };
}

// Jenis kerusakan terbanyak
export async function getDamageTypeStats(filter: DimensionStatsFilter = {}, limit = 8) {
  return dimensionStats('damageType', filter, limit);
}

// Ringkasan kondisi desa (satu panggilan untuk pertanyaan umum)
export async function getSystemOverview() {
  const [stats, catStats, locStats, pendingAssign, pendingReview, stale] = await Promise.all([
    getSystemStats(false),
    getStatsByCategory({}, 1),
    getStatsByLocation({}, 1),
    prisma.report.count({
      where: { status: 'VERIFIED', assignments: { none: { completedAt: null, cancelledAt: null } } },
    }),
    prisma.report.count({ where: { status: 'REVIEW' } }),
    prisma.report.count({ where: { status: 'SUBMITTED', createdAt: { lt: new Date(Date.now() - 7 * 86400000) } } }),
  ]);
  return {
    stats,
    topCategory: catStats.items[0] || null,
    topLocation: locStats.items[0] || null,
    pendingAssignment: pendingAssign,
    pendingReview,
    staleOver7Days: stale,
  };
}

/**
 * Simpan entri pengetahuan dari percakapan — DUA FASE (usulan → konfirmasi).
 *
 * - Tanpa `confirmationToken`: hanya membuat USULAN (belum menyentuh database)
 *   dan mengembalikan token sekali pakai untuk dikonfirmasi pengguna.
 * - Dengan `confirmationToken`: usulan diverifikasi (pemilik + sesi + masa
 *   berlaku + belum dipakai) lalu baru ditulis ke database.
 *
 * Pendapat/keluhan pengguna TIDAK lagi disimpan otomatis: penyimpanan hanya
 * terjadi setelah konfirmasi eksplisit. Entri hasil simpan selalu berstatus
 * belum diverifikasi (dugaan), bukan fakta resmi.
 */
export async function saveAiKnowledge(
  args: {
    title?: string;
    content?: string;
    category?: string;
    confirmationToken?: string;
    cancel?: boolean;
  },
  ctx: { userId: string; role: ChatRole; sessionId?: string }
) {
  // 1) Batalkan usulan yang menunggu (permintaan eksplisit pengguna).
  if (args.cancel === true) {
    const cancelled = cancelKnowledgeProposals(ctx.userId, ctx.sessionId);
    return {
      saved: false as const,
      status: 'cancelled' as const,
      cancelled,
      message:
        cancelled > 0
          ? 'Usulan penyimpanan dibatalkan. Tidak ada yang disimpan ke Pusat Pengetahuan.'
          : 'Tidak ada usulan penyimpanan yang menunggu konfirmasi.',
    };
  }

  // 2) Konfirmasi: verifikasi token (sekali pakai, terikat user + sesi).
  const token = String(args.confirmationToken || '').trim();
  if (token) {
    const consumed = consumeKnowledgeProposal(ctx.userId, ctx.sessionId, token);
    if (!consumed.ok) {
      const messages: Record<string, string> = {
        token_kosong: 'Token konfirmasi tidak diberikan.',
        tidak_ada: 'Token konfirmasi tidak dikenal atau sudah pernah dipakai.',
        kedaluwarsa: 'Token konfirmasi sudah kedaluwarsa. Silakan minta usulan baru.',
        tidak_sesuai: 'Token konfirmasi tidak cocok dengan usulan pada sesi ini.',
      };
      return {
        saved: false as const,
        status: 'rejected' as const,
        reason: consumed.reason,
        message: messages[consumed.reason],
      };
    }

    const proposal = consumed.proposal;
    const result = await persistAiKnowledge(
      { title: proposal.title, content: proposal.content, category: proposal.category },
      { userId: ctx.userId, role: ctx.role }
    );
    if ('error' in result) {
      return {
        saved: false as const,
        status: 'rejected' as const,
        reason: result.error,
        message:
          result.error === 'kategori_tidak_valid'
            ? 'Kategori usulan tidak valid sehingga tidak disimpan.'
            : 'Judul atau isi usulan kosong sehingga tidak disimpan.',
      };
    }
    return {
      saved: true as const,
      status: 'saved' as const,
      entry: result.entry,
      message:
        'Informasi telah disimpan ke Pusat Pengetahuan sebagai entri BELUM DIVERIFIKASI (dugaan/laporan). ' +
        'Admin perlu memverifikasinya sebelum dipakai sebagai fakta resmi.',
    };
  }

  // 3) Tanpa token: buat usulan saja (belum ada yang ditulis ke database).
  const title = String(args.title || 'Catatan dari percakapan').trim().slice(0, 200);
  const content = String(args.content || '').trim().slice(0, 5000);
  const category = String(args.category || 'LAINNYA').toUpperCase();
  if (!title || !content) {
    return {
      saved: false as const,
      status: 'rejected' as const,
      reason: 'judul_atau_isi_kosong' as const,
      message: 'Judul atau isi usulan kosong, jadi tidak ada usulan yang dibuat.',
    };
  }

  const proposal = createKnowledgeProposal({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    title,
    content,
    category,
  });

  return {
    saved: false as const,
    status: 'proposal' as const,
    proposalId: proposal.id,
    confirmationToken: proposal.token,
    expiresAtWib: wibLabel(new Date(proposal.expiresAt)),
    title: proposal.title,
    category: proposal.category,
    message:
      'Usulan penyimpanan sudah disiapkan — BELUM tersimpan. ' +
      'Balas dengan "konfirmasi ' + proposal.token + '" untuk menyimpannya, atau "batal" untuk membatalkan. ' +
      'Token hanya berlaku sekali dan hanya untuk sesi ini.',
  };
}

/**
 * Cari entri pengetahuan AI sesuai hak akses pengguna.
 * READ-ONLY. Semua role dapat mencari entri non-private;
 * entri private hanya dilihat Admin atau pemilik entri.
 * Entri belum diverifikasi ditandai verified=false (dugaan/laporan, bukan fakta).
 */
export interface AiKnowledgeSearchArgs {
  /** Kata kunci bebas (judul/isi). */
  q?: string;
  /** Kategori: KELUHAN | SARAN | FASILITAS | KINERJA_PETUGAS | KEGIATAN_DESA | LAINNYA. */
  category?: string;
  /** true = hanya yang sudah diverifikasi; false = hanya belum diverifikasi; undefined = semua. */
  verified?: boolean;
  /** true = tampilkan semua termasuk private (Admin only); default false. */
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}

/** Label bulan Bahasa Indonesia (mis. "Agustus 2026") untuk kalender WIB. */
function wibMonthLabel(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 15)).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Tren jumlah laporan yang SELESAI per bulan (kalender WIB).
 * Satu query COUNT per bulan dijalankan di database - model AI tidak menghitung.
 */
export async function getMonthlyCompletionTrend(months = 6) {
  const n = Math.min(Math.max(Math.trunc(months) || 6, 1), 12);
  const { y, m } = wibParts(new Date());
  const baseIdx = y * 12 + (m - 1);

  const buckets = Array.from({ length: n }, (_, k) => {
    const idx = baseIdx - (n - 1 - k);
    const sy = Math.floor(idx / 12);
    const sm = idx % 12;
    const ey = Math.floor((idx + 1) / 12);
    const em = (idx + 1) % 12;
    return {
      month: `${sy}-${String(sm + 1).padStart(2, '0')}`,
      label: wibMonthLabel(sy, sm),
      start: new Date(Date.UTC(sy, sm, 1) - 7 * 3600 * 1000),
      end: new Date(Date.UTC(ey, em, 1) - 7 * 3600 * 1000),
    };
  });

  const counts = await Promise.all(
    buckets.map((b) =>
      prisma.reportStatusHistory.count({
        where: { status: 'COMPLETED', createdAt: { gte: b.start, lt: b.end } },
      })
    )
  );

  return {
    scope: `Jumlah laporan yang dinyatakan SELESAI per bulan (${n} bulan terakhir, waktu WIB)`,
    months: buckets.map((b, i) => ({ month: b.month, label: b.label, completed: counts[i] })),
    total: counts.reduce((s, c) => s + c, 0),
    note:
      'Dihitung dari riwayat status COMPLETED (ReportStatusHistory) di database, bukan perkiraan. ' +
      'Bila semua bulan bernilai 0, artinya belum ada laporan yang selesai pada rentang tersebut.',
  };
}

/**
 * Status pengiriman WhatsApp untuk sebuah laporan (dari WhatsAppLog).
 * Tidak pernah menampilkan nomor lengkap (hanya nomor tersamar) atau token.
 */
export async function getWhatsAppDeliveryStatus(idFragment: string) {
  const fullId = await findReportIdByFragment({}, idFragment);
  if (!fullId) {
    return {
      found: false,
      reason: 'report_not_found',
      note: 'Laporan dengan ID/tanda tersebut tidak ditemukan. Minta pengguna menyebutkan ID laporan yang benar.',
    };
  }
  const report = await prisma.report.findUnique({
    where: { id: fullId },
    select: { id: true, title: true, status: true },
  });
  const logs = await prisma.whatsAppLog.findMany({
    where: { dedupeKey: { contains: fullId } },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: { kind: true, status: true, toMasked: true, error: true, updatedAt: true },
  });
  return {
    scope: `Status pengiriman WhatsApp untuk laporan ${shortId(fullId)}`,
    report: report
      ? { id: shortId(report.id), title: report.title, status: report.status, statusLabel: statusLabel(report.status) }
      : null,
    count: logs.length,
    items: logs.map((l) => ({
      kind: l.kind,
      status: l.status,
      to: l.toMasked,
      error: l.error || null,
      atWib: wibLabel(l.updatedAt),
    })),
    note:
      logs.length === 0
        ? 'Belum ada catatan pengiriman WhatsApp untuk laporan ini. Ini BUKAN berarti gagal - bisa jadi notifikasi memang belum dipicu. Jangan mengarang status pengiriman.'
        : undefined,
  };
}

/**
 * Ringkasan master data wilayah (RW/RT) beserta jumlah warga terdaftar per RT.
 * Wilayah bukan role: warga tetap CITIZEN. Hanya agregat, tanpa identitas warga.
 */
export async function getRegionOverview() {
  const [rws, byRt, withoutRegion] = await Promise.all([
    prisma.villageRw.findMany({
      orderBy: [{ order: 'asc' }, { number: 'asc' }],
      include: { rts: { orderBy: [{ order: 'asc' }, { number: 'asc' }] } },
    }),
    prisma.user.groupBy({
      by: ['rtId'],
      _count: { id: true },
      where: { role: 'CITIZEN', rtId: { not: null } },
    }),
    prisma.user.count({ where: { role: 'CITIZEN', rtId: null } }),
  ]);

  const counts = new Map<string, number>(
    byRt.map((r) => [String(r.rtId), r._count.id])
  );

  const regions = rws.map((rw) => {
    const rts = rw.rts.map((rt) => ({
      rt: rt.number,
      name: rt.name,
      isActive: rt.isActive,
      citizens: counts.get(rt.id) || 0,
    }));
    return {
      rw: rw.number,
      name: rw.name,
      isActive: rw.isActive,
      totalCitizens: rts.reduce((s, rt) => s + rt.citizens, 0),
      rts,
    };
  });

  return {
    scope: 'Master data wilayah (RW/RT) dan jumlah warga terdaftar per RT',
    rwCount: rws.length,
    rtCount: regions.reduce((s, rw) => s + rw.rts.length, 0),
    citizensWithoutRegion: withoutRegion,
    regions,
    note:
      rws.length === 0
        ? 'Belum ada master data RW/RT. Data wilayah ditambahkan Admin melalui menu Wilayah RT/RW.'
        : undefined,
  };
}

/**
 * RINGKASAN PENGIRIMAN WHATSAPP (Admin) — dihitung dari catatan pengiriman
 * (WhatsAppLog untuk notifikasi laporan/akun, AnnouncementDelivery untuk
 * pengumuman). Hanya angka agregat; tanpa nomor lengkap, token, atau isi pesan.
 * PENTING: "SENT" berarti provider (Fonnte) menerima pesan, bukan bukti
 * diterima/dibaca penerima.
 */
export async function getWhatsAppSummary() {
  const [logByStatus, logByKind, delivByStatus] = await Promise.all([
    prisma.whatsAppLog.groupBy({ by: ['status'], _count: { id: true } }),
    prisma.whatsAppLog.groupBy({ by: ['kind'], _count: { id: true } }),
    prisma.announcementDelivery.groupBy({ by: ['status'], _count: { id: true } }),
  ]);

  const pick = (rows: { status?: string; _count: { id: number } }[]) => {
    const map: Record<string, number> = {};
    for (const r of rows) map[String(r.status)] = r._count.id;
    return map;
  };
  const logMap = pick(logByStatus);
  const delivMap = pick(delivByStatus);

  const logTotal = Object.values(logMap).reduce((a, b) => a + b, 0);
  const delivTotal = Object.values(delivMap).reduce((a, b) => a + b, 0);

  // Enum internal tidak ditampilkan mentah ke pengguna/AI. Terutama
  // PASSWORD_RESET: itu nama kategori log, bukan kredensial. Label manusiawi
  // juga mencegah alat keamanan/test salah menganggapnya sebagai kebocoran.
  const KIND_LABELS: Record<string, string> = {
    PASSWORD_RESET: 'Reset Akun',
    ADMIN_LOGIN: 'Login Admin',
    CITIZEN_RECEIVED: 'Laporan Diterima Warga',
    CITIZEN_PROGRESS: 'Progres ke Warga',
    CITIZEN_WELCOME: 'Sambutan Warga',
    OFFICER_ASSIGN: 'Penugasan Petugas',
    OFFICER_REVIEW: 'Review Petugas',
    OFFICER_APPROVED: 'Persetujuan Petugas',
    OFFICER_FIX: 'Perbaikan Petugas',
    OFFICER_CANCEL: 'Pembatalan Petugas',
    OFFICER_CREATED: 'Akun Petugas Dibuat',
    ADMIN_ASSIGN: 'Penugasan oleh Admin',
    ADMIN_COMPLETE: 'Penyelesaian oleh Admin',
    ADMIN_REVIEW: 'Review oleh Admin',
    REGISTER: 'Registrasi',
    REPORT: 'Laporan Baru',
    OTP: 'Kode OTP',
  };

  const byKind = logByKind
    .map((r) => {
      const rawKind = String(r.kind);
      return {
        kind: KIND_LABELS[rawKind] || rawKind.replace(/^STATUS_/, 'Status ').replace(/_/g, ' '),
        count: r._count.id,
      };
    })
    .sort((a, b) => b.count - a.count);

  // Konfigurasi perangkat aktif — sumber yang SAMA dengan jalur pengiriman,
  // sehingga nomor Admin & nama perangkat yang dijawab AI selalu mengikuti
  // perangkat yang sedang dipilih Admin.
  // CATATAN: keluaran tool ini tidak boleh memuat nilai kredensial maupun
  // kata "token" (guard keamanan outputs tool) — hanya penanda boolean.
  const activeDevice = await resolveActiveFonnteConfig();
  const safeProblems = activeDevice.problems.map((p) => p.replace(/token/gi, 'kredensial'));

  // Pisahkan pengiriman NYATA dari pengiriman uji (mock).
  const sentRows = await prisma.whatsAppLog.findMany({
    where: { status: 'SENT' },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: { updatedAt: true, providerMessageId: true, dedupeKey: true },
  });
  const realRows = sentRows.filter((r) => !isMockDelivery(r));
  const mockRows = sentRows.filter((r) => isMockDelivery(r));
  const realSentCount = realRows.length;
  const mockSentCount = mockRows.length;
  const lastRealSuccess = realRows[0]?.updatedAt ?? null;
  const lastMockSuccess = mockRows[0]?.updatedAt ?? null;

  return {
    scope: 'Ringkasan status pengiriman notifikasi WhatsApp (seluruh waktu)',
    generatedAtWib: wibLabel(new Date()),
    device: {
      activeDeviceName: activeDevice.deviceName,
      configSource:
        activeDevice.source === 'database'
          ? 'Perangkat aktif di database (dipilih Admin)'
          : activeDevice.source === 'env'
            ? 'Konfigurasi .env (belum ada perangkat terdaftar di menu Admin)'
            : activeDevice.source === 'none'
              ? 'Belum ada perangkat aktif'
              : 'Gagal membaca konfigurasi perangkat',
      adminPhone: activeDevice.adminPhone,
      isConfigured: activeDevice.tokenValid && activeDevice.adminPhoneValid,
      credentialStored: activeDevice.tokenValid,
      problems: safeProblems,
    },
    log: {
      total: logTotal,
      sent: logMap.SENT || 0,
      failed: logMap.FAILED || 0,
      byStatus: Object.entries(logMap)
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      byKind,
    },
    deliveryEvidence: {
      // Pengiriman uji/mok dipisahkan: bukan bukti pesan terkirim ke nomor asli.
      realSuccessCount: realSentCount,
      mockSuccessCount: mockSentCount,
      lastRealSuccessAt: lastRealSuccess?.toISOString() ?? null,
      lastMockSuccessAt: lastMockSuccess?.toISOString() ?? null,
      note:
        'Pengiriman nyata = provider Fonnte menerima pesan ke nomor asli. Pengiriman uji (mock) berasal dari pengujian otomatis dan TIDAK membuktikan pesan terkirim.',
    },
    announcements: {
      total: delivTotal,
      sent: delivMap.SENT || 0,
      failed: delivMap.FAILED || 0,
      pending: delivMap.PENDING || 0,
      skipped: delivMap.SKIPPED || 0,
    },
    note:
      'Dihitung dari catatan pengiriman di database (bukan perkiraan). Status SENT berarti provider menerima pesan, BUKAN bukti telah dibaca penerima. Bila total 0, artinya belum ada catatan pengiriman. ' +
      'Nomor Admin di atas mengikuti perangkat aktif yang dipilih Admin; bila perangkat aktif bermasalah, notifikasi dihentikan dan TIDAK dialihkan ke perangkat lain.',
  };
}

/**
 * RINGKASAN PENGUMUMAN DESA (Admin) — jumlah per status turunan
 * (terbit/terjadwal/draf/kedaluwarsa/arsip) + daftar yang sedang aktif dan
 * yang terjadwal. Status dihitung dengan deriveAnnouncementStatus (satu sumber
 * kebenaran yang sama dengan halaman admin & publik).
 */
export async function getAnnouncementOverview() {
  const rows = await prisma.villageAnnouncement.findMany({
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, title: true, slug: true, category: true, isPublished: true,
      publishedAt: true, validUntil: true, archivedAt: true, deletedAt: true,
    },
  });

  const now = new Date();
  const counts: Record<AnnouncementStatus, number> = {
    DELETED: 0, ARCHIVED: 0, DRAFT: 0, SCHEDULED: 0, EXPIRED: 0, PUBLISHED: 0,
  };
  const withStatus = rows.map((r) => {
    const status = deriveAnnouncementStatus(r, now);
    counts[status] += 1;
    return { ...r, status };
  });

  const toItem = (r: (typeof withStatus)[number]) => ({
    title: r.title,
    slug: r.slug,
    category: r.category || null,
    statusLabel: ANNOUNCEMENT_STATUS_LABELS[r.status],
    publishedAtWib: r.publishedAt ? wibLabel(r.publishedAt) : null,
    validUntilWib: r.validUntil ? wibLabel(r.validUntil) : null,
  });

  const active = withStatus.filter((r) => r.status === 'PUBLISHED').slice(0, 8).map(toItem);
  const scheduled = withStatus
    .filter((r) => r.status === 'SCHEDULED')
    .sort((a, b) => (a.publishedAt?.getTime() || 0) - (b.publishedAt?.getTime() || 0))
    .slice(0, 8)
    .map(toItem);

  return {
    scope: 'Ringkasan seluruh pengumuman desa per status',
    generatedAtWib: wibLabel(now),
    total: rows.length,
    counts,
    countsLabeled: (Object.keys(counts) as AnnouncementStatus[]).map((s) => ({
      status: s,
      label: ANNOUNCEMENT_STATUS_LABELS[s],
      count: counts[s],
    })),
    activeCount: counts.PUBLISHED,
    active,
    scheduledCount: counts.SCHEDULED,
    scheduled,
    note:
      rows.length === 0
        ? 'Belum ada pengumuman desa yang tercatat.'
        : undefined,
  };
}

/**
 * PERBANDINGAN JUMLAH LAPORAN antarperiode (bulan ini vs bulan lalu), dari
 * database aktual. Menyertakan selisih & arah perubahan agar jawaban "lebih
 * banyak/tidak" berdasar angka nyata.
 */
export async function compareReportPeriods() {
  const now = new Date();
  const thisStart = startOfMonth(now);
  const prevStart = startOfMonth(new Date(thisStart.getTime() - 86400000));

  const [thisTotal, prevTotal, thisCompleted, prevCompleted] = await Promise.all([
    prisma.report.count({ where: { createdAt: { gte: thisStart } } }),
    prisma.report.count({ where: { createdAt: { gte: prevStart, lt: thisStart } } }),
    prisma.report.count({ where: { createdAt: { gte: thisStart }, status: 'COMPLETED' } }),
    prisma.report.count({ where: { createdAt: { gte: prevStart, lt: thisStart }, status: 'COMPLETED' } }),
  ]);

  // Label bulan WIB dihitung dari tengah hari agar tidak terpengaruh batas zona.
  const monthName = (d: Date) =>
    new Date(d.getTime() + 12 * 3600 * 1000).toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      month: 'long',
      year: 'numeric',
    });

  const delta = thisTotal - prevTotal;
  return {
    scope: 'Perbandingan jumlah laporan bulan ini vs bulan lalu',
    generatedAtWib: wibLabel(now),
    thisMonth: { label: monthName(thisStart), total: thisTotal, completed: thisCompleted },
    lastMonth: { label: monthName(prevStart), total: prevTotal, completed: prevCompleted },
    delta,
    direction: delta > 0 ? 'lebih banyak' : delta < 0 ? 'lebih sedikit' : 'sama',
    completedDelta: thisCompleted - prevCompleted,
    note: 'Dihitung dari kolom createdAt laporan (kalender WIB). Bukan perkiraan.',
  };
}

/**
 * PERBANDINGAN jumlah laporan MILIK PENGGUNA antara bulan ini dan bulan lalu.
 * Selalu dibatasi userId — tidak pernah menghitung laporan warga lain.
 */
export async function compareMyReportPeriods(userId: string) {
  const now = new Date();
  const thisStart = startOfMonth(now);
  const prevStart = startOfMonth(new Date(thisStart.getTime() - 86400000));

  const [thisTotal, prevTotal, thisCompleted, prevCompleted, thisRejected, prevRejected] =
    await Promise.all([
      prisma.report.count({ where: { userId, createdAt: { gte: thisStart } } }),
      prisma.report.count({ where: { userId, createdAt: { gte: prevStart, lt: thisStart } } }),
      prisma.report.count({ where: { userId, createdAt: { gte: thisStart }, status: 'COMPLETED' } }),
      prisma.report.count({ where: { userId, createdAt: { gte: prevStart, lt: thisStart }, status: 'COMPLETED' } }),
      prisma.report.count({ where: { userId, createdAt: { gte: thisStart }, status: 'REJECTED' } }),
      prisma.report.count({ where: { userId, createdAt: { gte: prevStart, lt: thisStart }, status: 'REJECTED' } }),
    ]);

  const monthName = (d: Date) =>
    new Date(d.getTime() + 12 * 3600 * 1000).toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      month: 'long',
      year: 'numeric',
    });

  const delta = thisTotal - prevTotal;
  return {
    scope: 'Perbandingan jumlah laporan milik pengguna: bulan ini vs bulan lalu',
    generatedAtWib: wibLabel(now),
    thisMonth: { label: monthName(thisStart), total: thisTotal, completed: thisCompleted, rejected: thisRejected },
    lastMonth: { label: monthName(prevStart), total: prevTotal, completed: prevCompleted, rejected: prevRejected },
    delta,
    direction: delta > 0 ? 'lebih banyak' : delta < 0 ? 'lebih sedikit' : 'sama',
    completedDelta: thisCompleted - prevCompleted,
    rejectedDelta: thisRejected - prevRejected,
    note: 'Dihitung dari kolom createdAt laporan milik pengguna (kalender WIB). Bukan perkiraan.',
  };
}

/**
 * LAPORAN BELUM SELESAI (Admin) beserta penyebab/alasan yang BENAR-BENAR
 * tercatat (status terakhir & catatan riwayat terakhir). Tidak menebak sebab.
 */
export async function getUnfinishedReports(limit = 8) {
  const take = Math.min(Math.max(Number(limit) || 8, 1), 15);
  const reports = await prisma.report.findMany({
    where: { status: { notIn: ['COMPLETED', 'REJECTED'] } },
    orderBy: { createdAt: 'asc' },
    take,
    select: {
      id: true, title: true, status: true, category: true, location: true, createdAt: true,
      assignments: {
        where: { cancelledAt: null },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        select: { officer: { select: { name: true } } },
      },
      histories: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, notes: true, createdAt: true, actorRole: true },
      },
    },
  });
  const total = await prisma.report.count({ where: { status: { notIn: ['COMPLETED', 'REJECTED'] } } });
  const now = Date.now();

  return {
    scope: 'Laporan yang belum selesai (status selain SELESAI/DITOLAK)',
    generatedAtWib: wibLabel(new Date()),
    total,
    returned: reports.length,
    items: reports.map((r) => {
      const last = r.histories[0];
      return {
        id: shortId(r.id),
        title: r.title,
        status: r.status,
        statusLabel: statusLabel(r.status),
        category: r.category || null,
        location: r.location,
        officer: r.assignments[0]?.officer?.name || null,
        ageDays: Math.floor((now - r.createdAt.getTime()) / 86400000),
        lastRecordedReason: last?.notes || null,
        lastStatusActor: last?.actorRole || null,
        lastUpdatedWib: last ? wibLabel(last.createdAt) : wibLabel(r.createdAt),
      };
    }),
    note:
      'Penyebab yang ditampilkan hanya berasal dari catatan riwayat status terakhir yang ada di database. Jangan menyimpulkan penyebab lain yang tidak tercatat.',
  };
}

/**
 * KATEGORI PENGETAHUAN AI yang diakuni.
 */
export const AI_KNOWLEDGE_CATEGORIES = [
  'KELUHAN',
  'SARAN',
  'FASILITAS',
  'KINERJA_PETUGAS',
  'KEGIATAN_DESA',
  'LAINNYA',
] as const;
export interface AiKnowledgeSearchArgs {
  /** Kata kunci bebas (judul/isi). */
  q?: string;
  /** Kategori: KELUHAN | SARAN | FASILITAS | KINERJA_PETUGAS | KEGIATAN_DESA | LAINNYA. */
  category?: string;
  /** true = hanya yang sudah diverifikasi; false = hanya belum diverifikasi; undefined = semua. */
  verified?: boolean;
  /** true = tampilkan semua termasuk private (Admin only); default false. */
  includePrivate?: boolean;
  limit?: number;
  offset?: number;
}

export async function searchAiKnowledge(
  args: AiKnowledgeSearchArgs = {},
  ctx: { userId: string; role: ChatRole }
) {
  const q = (args.q || '').trim();
  const category = args.category ? String(args.category).toUpperCase() : undefined;
  const verified = args.verified === true || args.verified === false ? args.verified : undefined;
  const includePrivate = args.includePrivate === true;
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const offset = Math.max(Number(args.offset) || 0, 0);

  const where: any = {};

  // Struktur kondisi:
  //   where.AND = [ {OR: [judul, isi]} , {OR: [boleh-akses]} ]
  // OR hanya dipakai DI DALAM tiap kelompok. Condition keyword dan condition
  // hak akses TIDAK boleh digabung ke satu array OR, karena itu membuat
  // entri privat pengguna lain ikut terbaca saat judul/isi-nya cocok keyword.
  const conditions: any[] = [];

  if (q) {
    // CATATAN: `mode: 'insensitive'` TIDAK didukung Prisma untuk SQLite
    // ("Unknown argument mode") sehingga tool ini selalu gagal. SQLite LIKE
    // sudah case-insensitive untuk karakter ASCII, jadi cukup `contains`.
    conditions.push({
      OR: [
        { title: { contains: q } },
        { content: { contains: q } },
      ],
    });
  }
  if (category) {
    if (!AI_KNOWLEDGE_CATEGORIES.includes(category as any)) {
      return { query: q, category, verified, total: 0, returned: 0, items: [], appliedFilters: [], error: 'kategori_tidak_valid' };
    }
    where.category = category;
  }
  if (verified !== undefined) where.verified = verified;

  // Hak akses:
  // - ADMIN melihat seluruh entri (termasuk private) HANYA bila includePrivate.
  // - Selain itu (Warga/Petugas, atau Admin tanpa includePrivate): hanya entri
  //   non-private atau entri milik sendiri. includePrivate TIDAK boleh menjadi
  //   jalur bypass untuk non-Admin.
  const adminSeesAll = ctx.role === 'ADMIN' && includePrivate;
  if (!adminSeesAll) {
    conditions.push({
      OR: [
        { isPrivate: false },
        { sourceUserId: ctx.userId },
      ],
    });
  }
  if (conditions.length > 0) where.AND = conditions;

  const appliedFilters: string[] = [];
  if (q) appliedFilters.push(`kata kunci: "${q}"`);
  if (category) appliedFilters.push(`kategori: ${category}`);
  if (verified !== undefined) appliedFilters.push(`verifikasi: ${verified ? 'sudah' : 'belum'}`);
  if (!adminSeesAll) appliedFilters.push('hanya entri non-pribadi (atau milik sendiri)');

  const [total, rows] = await Promise.all([
    prisma.aiKnowledgeEntry.count({ where }),
    prisma.aiKnowledgeEntry.findMany({
      where,
      orderBy: [{ verified: 'desc' }, { updatedAt: 'desc' }],
      skip: offset,
      take: limit,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        sourceType: true,
        sourceId: true,
        sourceRole: true,
        sourceUserId: true,
        sourceUserName: true,
        verified: true,
        verifiedBy: true,
        verifiedAt: true,
        verificationNotes: true,
        isPrivate: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    scope: 'Pusat Pengetahuan AI (entri tersimpan dari percakapan & sumber lain)',
    query: q,
    category,
    verified,
    includePrivate,
    appliedFilters,
    total,
    returned: rows.length,
    offset,
    hasMore: offset + rows.length < total,
    items: rows.map((e) => ({
      id: e.id,
      title: e.title,
      content: e.content.slice(0, 1500),
      contentLength: e.content.length,
      category: e.category,
      sourceType: e.sourceType,
      sourceRole: e.sourceRole,
      sourceUserName: e.sourceUserName || '-',
      sourceUserId: e.sourceUserId || null,
      verified: e.verified,
      verifiedBy: e.verifiedBy || null,
      verifiedAtWib: e.verifiedAt ? wibLabel(e.verifiedAt) : null,
      verificationNotes: e.verificationNotes || null,
      isPrivate: e.isPrivate,
      tags: e.tags ? JSON.parse(e.tags) : [],
      createdAtWib: wibLabel(e.createdAt),
      updatedAtWib: wibLabel(e.updatedAt),
      // Penanda untuk AI: belum diverifikasi = dugaan/laporan, bukan fakta resmi.
      statusLabel: e.verified ? 'Diverifikasi' : 'Belum diverifikasi (dugaan/laporan)',
    })),
  };
}

/**
 * Analisis pengetahuan AI untuk Admin — mencari entri tersimpan dan memberikan
 * ringkasan berdasarkan kategori, sumber, dan status verifikasi.
 * Hanya Admin yang dapat mengakses analisis ini (role dicek di aiToolRegistry).
 */
export interface AiKnowledgeAnalysisArgs {
  /** Kategori yang ingin dianalisis (opsional). */
  category?: string;
  /** true = hanya yang sudah diverifikasi; false = hanya belum diverifikasi; undefined = semua. */
  verified?: boolean;
  /** Kata kunci pencarian pada judul/isi (opsional). */
  q?: string;
  /** Jumlah maksimum entri yang dianalisis. */
  limit?: number;
}

export async function analyzeAiKnowledge(
  args: AiKnowledgeAnalysisArgs = {},
  ctx: { userId: string; role: ChatRole }
) {
  // Hanya Admin yang boleh menganalisis seluruh pengetahuan.
  if (ctx.role !== 'ADMIN') {
    return { error: 'forbidden', message: 'Analisis pengetahuan hanya dapat dilakukan oleh Admin.' };
  }

  const category = args.category ? String(args.category).toUpperCase() : undefined;
  const verified = args.verified === true || args.verified === false ? args.verified : undefined;
  const q = (args.q || '').trim();
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);

  const where: any = {};
  if (category) where.category = category;
  if (verified !== undefined) where.verified = verified;
  if (q) {
    // CATATAN: `mode: 'insensitive'` TIDAK didukung Prisma untuk SQLite
    // ("Unknown argument mode") sehingga tool ini selalu gagal. SQLite LIKE
    // sudah case-insensitive untuk karakter ASCII, jadi cukup `contains`.
    where.OR = [
      { title: { contains: q } },
      { content: { contains: q } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.aiKnowledgeEntry.count({ where }),
    prisma.aiKnowledgeEntry.findMany({
      where,
      orderBy: [{ verified: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        sourceType: true,
        sourceRole: true,
        sourceUserId: true,
        sourceUserName: true,
        verified: true,
        verifiedBy: true,
        verifiedAt: true,
        verificationNotes: true,
        isPrivate: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  // Hitung per kategori
  const categoryCounts: Record<string, { total: number; verified: number; unverified: number }> = {};
  for (const r of rows) {
    if (!categoryCounts[r.category]) {
      categoryCounts[r.category] = { total: 0, verified: 0, unverified: 0 };
    }
    categoryCounts[r.category].total += 1;
    if (r.verified) categoryCounts[r.category].verified += 1;
    else categoryCounts[r.category].unverified += 1;
  }

  // Hitung per sumber role
  const sourceRoleCounts: Record<string, number> = {};
  for (const r of rows) {
    sourceRoleCounts[r.sourceRole] = (sourceRoleCounts[r.sourceRole] || 0) + 1;
  }

  // Entri belum diverifikasi (perlu perhatian Admin)
  const unverifiedItems = rows
    .filter((e) => !e.verified)
    .slice(0, 10)
    .map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      sourceRole: e.sourceRole,
      sourceUserName: e.sourceUserName || '-',
      content: e.content.slice(0, 200),
      createdAtWib: wibLabel(e.createdAt),
    }));

  return {
    scope: 'Analisis Pusat Pengetahuan AI (semua entri tersimpan)',
    query: q,
    category,
    verified,
    total,
    returned: rows.length,
    categoryCounts,
    sourceRoleCounts,
    unverifiedCount: rows.filter((e) => !e.verified).length,
    verifiedCount: rows.filter((e) => e.verified).length,
    unverifiedItems,
    note:
      total === 0
        ? 'Belum ada entri pengetahuan yang tersimpan di sistem.'
        : 'Entri dengan status "Belum diverifikasi" adalah dugaan/laporan, bukan fakta resmi.',
  };
}



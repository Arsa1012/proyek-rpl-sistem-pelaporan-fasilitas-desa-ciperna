/**
 * AI INTENT LAYER — menerjemahkan pertanyaan Bahasa Indonesia sehari-hari
 * menjadi panggilan tool database yang terarah (READ-ONLY).
 *
 * Mengapa lapisan ini ada:
 * - Router lama adalah rantai `if` "yang pertama cocok menang". Salah satu
 *   kondisinya memuat kata tunggal "laporan" sehingga HAMPIR SEMUA pertanyaan
 *   yang mengandung kata "laporan" berakhir di tool statistik (hanya jumlah).
 *   Itulah sebabnya AI bisa menyebut jumlah tetapi gagal menjelaskan jenis,
 *   kategori, lokasi, dan detail laporan.
 * - Router lama tidak menerima riwayat percakapan, sehingga pertanyaan lanjutan
 *   ("siapa saja yang membuatnya?") tidak memicu tool apa pun.
 *
 * Cara kerja sekarang (deterministik, mudah diuji):
 * 1. Ekstrak SLOT dari kalimat: periode, status, kategori, keparahan, jenis
 *    kerusakan, lokasi, nama pelapor, judul, ID laporan.
 * 2. Tentukan NIAT: hitung / daftar / detail / rincian-per-dimensi / antrean /
 *    pelapor / petugas / penjelasan fitur.
 * 3. Susun SATU tool (maksimal beberapa untuk kasus ambigu nama) dari
 *    kombinasi slot + niat. Filter bebas tetap terjawab karena listReports /
 *    countReports menerima slot apa pun.
 * 4. Bila kalimat memakai kata ganti ("itu", "tadi", "nya"), pakai slot dari
 *    konteks percakapan sebelumnya, bukan mengarang.
 *
 * Lapisan ini TIDAK memeriksa izin. Pemeriksaan role dilakukan di
 * aiToolRegistry.ts (server-side), sehingga manipulasi prompt tidak bisa
 * melewati otorisasi.
 */

import type { ChatRole, Period, ReportFilter, MyReportSearch, DimensionStatsFilter, AccountFilter, AccountRole } from './aiTools';
import { CITIZEN_PUBLIC_INTENTS } from './websiteKnowledge';
import type { ChatTurn, ToolCall, PendingReply, ReplyTone, AssistantQuestionKind } from './aiTypes';
import { formatCandidateClarification, pickReportCandidate } from './aiCandidates';

// Tipe & helper kandidat dipindah ke modul netral agar lapisan pendukung
// (aiRetrieval/aiSessionStore) tidak perlu mengimpor modul layanan AI.
export type { ChatTurn, ToolCall } from './aiTypes';
export type { PendingReply, ReplyTone, AssistantQuestionKind } from './aiTypes';
export {
  formatCandidateClarification,
  pickReportCandidate,
  type ReportCandidate,
} from './aiCandidates';

export type Dimension = 'category' | 'damageType' | 'severity' | 'location' | 'status' | 'officer';

export type Kind =
  | 'count' | 'list' | 'detail' | 'breakdown' | 'reporters' | 'queue'
  | 'explain' | 'officers' | 'officerDetail' | 'stats' | 'profile' | 'registration' | 'none';

/** Konteks percakapan yang dipakai untuk memahami pertanyaan lanjutan. */
export interface AiContext {
  lastReportRef?: string;
  lastReportTitle?: string;
  /**
   * Kandidat laporan dari jawaban asisten sebelumnya. Bila jawaban memuat
   * beberapa ID, pertanyaan lanjutan yang menyebut "itu/laporan tersebut"
   * TIDAK boleh menebak satu laporan; router meminta klarifikasi.
   */
  lastReportCandidates?: { id: string; title?: string }[];
  lastCategory?: string;
  lastSeverity?: string[];
  lastStatus?: string[];
  lastPeriod?: Period;
  lastReporterName?: string;
  lastLocation?: string;
  lastKind?: Kind;
  lastDimension?: Dimension;
  /** Konteks direktori akun (dipakai untuk pertanyaan lanjutan "mereka/tadi"). */
  lastAccountRole?: 'CITIZEN' | 'OFFICER' | 'ADMIN';
  lastAccountActive?: boolean;
  lastAccountQuery?: string;
  /** Percakapan terakhir membahas KEAMANAN akun (bukan daftar akun). */
  lastAccountSecurity?: boolean;
  /** Nama petugas yang baru saja dibahas (untuk "berapa tugas mereka?"). */
  lastOfficerNames?: string[];
  /** Nama petugas spesifik yang baru saja dibahas (untuk filter laporan). */
  lastOfficerName?: string;
  /** Percakapan sedang membahas direktori/penugasan petugas (bukan laporan). */
  lastOfficerFocus?: boolean;
  /** Pertanyaan terakhir membahas tugas/penugasan petugas. */
  lastOfficerAssignment?: boolean;
  /**
   * Percakapan terakhir membahas PENDAFTARAN akun. Dipakai agar pertanyaan
   * lanjutan ("kalau kemarin?") tetap diarahkan ke data pendaftaran.
   */
  lastRegistration?: boolean;
  /**
   * Pertanyaan (atau tawaran) terakhir dari assistant yang masih menunggu
   * jawaban pengguna. Dipakai untuk memahami balasan singkat.
   */
  lastAssistantQuestion?: string;
  /** Bentuk pertanyaan assistant terakhir (lihat AssistantQuestionKind). */
  lastAssistantQuestionKind?: AssistantQuestionKind;
  /**
   * Balasan singkat pengguna yang WAITU diinterpretasi berdasarkan pertanyaan
   * assistant terakhir. Diisi oleh resolveIntent, bukan oleh extractContext,
   * karena dibutuhkan pesan terbaru (yang belum ada di riwayat).
   */
  pendingReply?: PendingReply;
}

export interface IntentResult {
  tools: ToolCall[];
  /** Konteks gabungan (hasil ekstraksi riwayat + slot pada pesan ini). */
  context: AiContext;
}

// ============================================================================
// KAMUS SINONIM
// ============================================================================

/** Kategori fasilitas. Dicocokkan sebagai frasa utuh agar tidak salah tangkap. */
const CATEGORY_SYNONYMS: [string, string[]][] = [
  ['Lampu Jalan', ['lampu jalan', 'lampu', 'penerangan', 'pju']],
  ['Trotoar', ['trotoar', 'trotar', 'pedestrian']],
  ['Drainase', ['drainase', 'selokan', 'got', 'saluran air', 'saluran', 'parit', 'tersumbat', 'banjir']],
  ['Jembatan', ['jembatan']],
  ['Taman', ['taman', 'ruang terbuka hijau', 'rth']],
  ['Jalan', ['jalan', 'aspal', 'berlubang', 'pengaspalan']],
  ['Fasilitas Umum Lainnya', ['fasilitas umum', 'fasilitas lainnya', 'sarana umum']],
];

/** Jenis kerusakan (disimpan di kolom damageType). Hanya frasa SPESIFIK yang
 *  dianggap filter — kata umum "rusak/kerusakan" tidak, agar "jalan rusak"
 *  tidak menyempitkan pencarian ke satu jenis kerusakan saja. */
const DAMAGE_SYNONYMS: [string, string[]][] = [
  ['Lubang', ['lubang', 'bolong']],
  ['Retak', ['retak', 'rekahan']],
  ['Tergenang', ['tergenang', 'genangan', 'terendam']],
  ['Mati', ['lampu mati', 'padam', 'tidak menyala', 'tidak nyala']],
  ['Patah', ['patah', 'roboh', 'runtuh', 'ambruk']],
  ['Rusak', ['kerusakan umum', 'rusak berat', 'rusak parah']],
];

/** Status laporan. Dua frasa "menunggu verifikasi" dipisah oleh kata hasil/bukti. */
const STATUS_SYNONYMS: [string, string[]][] = [
  ['REVIEW', ['menunggu verifikasi bukti', 'menunggu verifikasi hasil', 'menunggu hasil', 'menunggu review', 'verifikasi hasil', 'review']],
  ['SUBMITTED', ['belum diverifikasi', 'belum di verifikasi', 'menunggu verifikasi', 'baru diajukan', 'baru masuk', 'menunggu di verifikasi', 'belum diperiksa']],
  ['VERIFIED', ['sudah diverifikasi', 'terverifikasi', 'sudah di verifikasi', 'menunggu penugasan', 'belum ditugaskan', 'belum ada petugas']],
  ['ASSIGNED', ['ditugaskan', 'sudah ditugaskan', 'sudah di tugaskan', 'ditugaskan ke']],
  ['IN_PROGRESS', ['sedang dikerjakan', 'sedang ditangani', 'sedang di kerjakan', 'diproses', 'dalam proses', 'sedang proses', 'in progress']],
  ['COMPLETED', ['selesai', 'beres', 'tuntas', 'sudah selesai', 'sudah beres', 'diselesaikan', 'menyelesaikan', 'clear']],
  ['REJECTED', ['ditolak', 'di tolak', 'ditolak admin']],
];

const SEVERITY_SYNONYMS: [string, string[]][] = [
  ['KRITIS', ['kritis', 'sangat parah', 'darurat', 'sangat berat']],
  ['TINGGI', ['tinggi', 'parah', 'berat', 'prioritas', 'mendesak', 'urgent']],
  // \"Sedang\" saja hampir selalu penanda waktu (\"sedang diproses\"), bukan
  // keparahan. Wajib ada konteks tingkat/kerusakan agar tidak salah filter.
  ['SEDANG', [
    'tingkat sedang', 'severity sedang', 'keparahan sedang', 'kerusakan sedang',
    'prioritas sedang', 'level sedang', 'kategori sedang', 'menengah',
  ]],
  ['RENDAH', ['rendah', 'ringan', 'kecil']],
];

const STATUS_NOT_FINAL_HINTS = [
  'belum selesai', 'belum beres', 'belum tuntas', 'belum final',
  'masih berjalan', 'masih diproses', 'masih proses', 'belum kelar', 'aktif',
  'belum ditangani', 'belum diproses', 'belum dikerjakan', 'belum diperbaiki',
  'masih ditangani', 'masih dikerjakan', 'masih menunggu',
];

const TODAY_HINTS = ['hari ini', 'today', 'tanggal ini'];
const WEEK_HINTS = ['minggu ini', 'pekan ini', 'minggu berjalan', 'pekan berjalan', '7 hari terakhir', 'seminggu'];
const MONTH_HINTS = ['bulan ini', 'bulan berjalan', 'bulan sekarang'];

/** Kata ganti / rujukan ke percakapan sebelumnya. */
const REFERENCE_PATTERN = /(?:^|\s)(itu|tadi|tersebut|dia|orangnya|yang sama|barusan|td|mereka|sebelumnya|yang kemarin|yang tadi|laporan itu|laporan tersebut)(?:\s|[,.?!]|$)|\w+nya\b/i;

/**
 * Kata yang menandakan pengguna meminta PENJELASAN LANJUTAN, bukan pertanyaan
 * baru. Tanpa ini, "kenapa?" setelah AI menjelaskan sebuah laporan tidak
 * memicu query apa pun sehingga AI mengulang jawaban sebelumnya.
 */
const FOLLOWUP_HINTS = [
  'kenapa', 'mengapa', 'kok bisa', 'kok', 'terus', 'trus', 'lalu',
  'maksudnya', 'maksud kamu', 'jelaskan', 'lanjut', 'terus gimana', 'apa lagi',
  // "Bulannya?" / "minggunya?" adalah lanjutan periode, bukan pertanyaan baru.
  'bulannya', 'bulan nya', 'minggunya', 'minggu nya', 'tahunnya', 'tahun nya',
  // Lanjutan status/penanganan yang umum di percakapan warga.
  'sudah ditangani', 'sudah diproses', 'sudah dikerjakan', 'sudah diperbaiki',
  'belum ditangani', 'belum diproses', 'belum dikerjakan', 'belum diperbaiki',
  'kok belum', 'kenapa belum', 'mengapa belum', 'masih belum',
  'kapan diperbaiki', 'kapan diperbarui', 'kapan diupdate', 'kapan update',
  'update terakhir', 'terakhir diperbarui', 'terakhir diupdate', 'terakhir update',
  'petugasnya', 'siapa petugasnya', 'siapa yang mengerjakan', 'siapa yang menangani',
  'ditangani siapa', 'dikerjakan siapa', 'siapa yang ditugaskan',
  'statusnya', 'gimana statusnya', 'bagaimana statusnya', 'progresnya', 'progressnya',
  'perkembangannya', 'sudah sampai mana', 'sudah selesai belum', 'sudah beres belum',
  'yang kemarin', 'yang tadi', 'laporan tersebut', 'laporan itu', 'itu gimana',
  'itu bagaimana', 'terus gimana', 'lalu gimana', 'sebelumnya bagaimana',
];

export function detectFollowUp(t: string): boolean {
  // "bulan lalu"/"minggu lalu"/"tahun lalu" adalah periode, bukan lanjutan.
  const cleaned = t.replace(/\b(bulan|minggu|pekan|tahun|hari)\s+lalu\b/g, ' ');
  return hasAny(cleaned, FOLLOWUP_HINTS);
}

/**
 * Koreksi atas jawaban sebelumnya ("bukan itu", "kalau itu kan semua laporan",
 * "maksud saya ..."). Dipakai agar router MENGGANTI query, bukan mengulang
 * jawaban lama atau diam-diam menyempit ke periode "hari ini".
 */
export function detectCorrection(t: string): boolean {
  return hasAny(t, [
    'bukan itu', 'bukan yang itu', 'bukan begitu', 'bukan ini',
    'kalau itu', 'itu kan', 'itu tadi', 'yang tadi',
    'maksud saya', 'maksudku', 'maksud kamu', 'yang saya maksud', 'yang aku maksud',
    'salah paham', 'salah tangkap', 'kok itu', 'kok jadi',
  ]);
}

// ============================================================================
// NORMALISASI BAHASA SEHARI-HARI (typo ringan, singkatan, kata tidak baku)
// ============================================================================
/**
 * Mengapa: pertanyaan nyata sering ditulis "laporan sya gmna?", "knp ditolak?",
 * "udah selesai blm?", "brp laporan bln ini". Router lama hanya melakukan
 * lowercase sehingga variasi ini tidak dikenali dan AI menjawab "tidak ada".
 *
 * Normalisasi HANYA pada kata utuh (bukan potongan di tengah kata) agar nama,
 * ID, nomor telepon, dan alamat tidak berubah. Teks asli tetap dipakai untuk
 * mengekstrak nama pelapor, judul, dan fragmen ID.
 */
const SLANG_WORDS: Record<string, string> = {
  sy: 'saya', sya: 'saya', aq: 'saya', gw: 'saya', gue: 'saya', gua: 'saya',
  knp: 'kenapa', knapa: 'kenapa', kenap: 'kenapa',
  gmn: 'gimana', gmna: 'gimana', gmana: 'gimana', bgmn: 'gimana', bagaimna: 'gimana',
  brp: 'berapa', brapa: 'berapa', berpa: 'berapa',
  blm: 'belum', blom: 'belum', belom: 'belum', belm: 'belum',
  udh: 'sudah', udah: 'sudah', sdh: 'sudah', uda: 'sudah',
  tdk: 'tidak', gk: 'tidak', ga: 'tidak', gak: 'tidak', ngga: 'tidak', nggak: 'tidak',
  engga: 'tidak', enggak: 'tidak', kagak: 'tidak',
  yg: 'yang', dgn: 'dengan', utk: 'untuk', tp: 'tapi', tpi: 'tapi',
  krn: 'karena', karna: 'karena', klo: 'kalau', kalo: 'kalau',
  skrg: 'sekarang', skrng: 'sekarang', tgl: 'tanggal', bln: 'bulan',
  thn: 'tahun', mgu: 'minggu', hr: 'hari', dpt: 'dapat', bikin: 'buat',
  sdg: 'sedang', sdng: 'sedang',
  // "regis"/"regist"/"register" â†’ registrasi (pertanyaan pendaftaran akun).
  regis: 'registrasi', regist: 'registrasi', register: 'registrasi',
  regristasi: 'registrasi', regristrasi: 'registrasi',
};

export function normalizeIndonesian(text: string): string {
  return (text || '')
    .toLowerCase()
    // "selesaaaai" â†’ "selesai" (hanya 3 huruf kembar atau lebih; "menunggu" aman).
    .replace(/([a-z\u00C0-\u024F])\1{2,}/g, '$1')
    // Bentuk percakapan yang memisahkan awalan "di": "sedang di tangani",
    // "laporan di tolak". Disatukan secara konservatif agar status tetap
    // dikenali tanpa fuzzy matching yang agresif.
    .replace(/\bdi\s+(tangani|kerjakan|tolak|proses|tugaskan|verifikasi|selesaikan|periksa)\b/g, 'di$1')
    .replace(/\b([a-z\u00C0-\u024F]+)\b/g, (w) => SLANG_WORDS[w] || w);
}

// ============================================================================
// RENTANG TANGGAL EKSPLISIT ("bulan Agustus", "1-15 Agustus 2025", "kemarin")
// ============================================================================
export interface DateRange {
  /** Tanggal WIB "YYYY-MM-DD" (inklusif). */
  from: string;
  /** Tanggal WIB "YYYY-MM-DD" (inklusif). */
  to: string;
  label: string;
}

const MONTH_INDEX: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, ags: 8,
  september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12,
};
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const MONTH_PATTERN = Object.keys(MONTH_INDEX).join('|');

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** Tanggal kalender WIB saat ini (tanpa bergantung zona waktu server). */
function wibToday(now = new Date()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return { y: get('year'), m: get('month'), d: get('day') };
}
function monthRange(y: number, m: number): DateRange {
  return {
    from: isoDate(y, m, 1),
    to: isoDate(y, m, daysInMonth(y, m)),
    label: `${MONTH_NAMES[m - 1]} ${y}`,
  };
}
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Kenali periode tanggal yang disebut eksplisit. Mengembalikan tanggal WIB
 * (bukan Date) agar konversi ke batas UTC dilakukan terpusat di aiTools.
 */
export function detectDateRange(t: string, now = new Date()): DateRange | null {
  const today = wibToday(now);

  // 1) Rentang hari. WAJIB ada penanda "tanggal" ATAU nama bulan agar angka
  //    seperti "tampilkan 5-10 laporan" tidak salah dibaca sebagai tanggal.
  const explicitDayRange = t.match(
    new RegExp(`\\b(?:tanggal|tgl)\\s*(\\d{1,2})\\s*(?:-|–|s\\/d|sampai|hingga|sd)\\s*(\\d{1,2})(?:\\s+(${MONTH_PATTERN})\\b)?(?:\\s+(\\d{4})\\b)?`, 'i')
  );
  const namedDayRange = t.match(
    new RegExp(`\\b(\\d{1,2})\\s*(?:-|–|s\\/d|sampai|hingga|sd)\\s*(\\d{1,2})\\s+(${MONTH_PATTERN})\\b(?:\\s+(\\d{4})\\b)?`, 'i')
  );
  const dayRange = explicitDayRange || namedDayRange;
  if (dayRange) {
    const a = Number(dayRange[1]);
    const b = Number(dayRange[2]);
    const month = dayRange[3] ? MONTH_INDEX[dayRange[3].toLowerCase()] : today.m;
    const year = dayRange[4] ? Number(dayRange[4]) : today.y;
    if (month && a >= 1 && b >= 1 && a <= daysInMonth(year, month) && b <= daysInMonth(year, month) && a <= b) {
      return {
        from: isoDate(year, month, a),
        to: isoDate(year, month, b),
        label: `${a}–${shortDate(isoDate(year, month, b))}`,
      };
    }
  }

  // 2) Satu hari: "tanggal 10 Agustus 2025".
  const singleDay = t.match(
    new RegExp(`\\b(?:tanggal|tgl)\\s*(\\d{1,2})(?:\\s+(${MONTH_PATTERN})\\b)?(?:\\s+(\\d{4})\\b)?`, 'i')
  );
  if (singleDay) {
    const d = Number(singleDay[1]);
    const month = singleDay[2] ? MONTH_INDEX[singleDay[2].toLowerCase()] : today.m;
    const year = singleDay[3] ? Number(singleDay[3]) : today.y;
    if (month && d >= 1 && d <= daysInMonth(year, month)) {
      const iso = isoDate(year, month, d);
      return { from: iso, to: iso, label: shortDate(iso) };
    }
  }

  // 3) Bulan bernama: "Agustus", "Agustus 2025".
  const monthOnly = t.match(new RegExp(`\\b(${MONTH_PATTERN})\\b(?:\\s+(\\d{4})\\b)?`, 'i'));
  if (monthOnly) {
    const month = MONTH_INDEX[monthOnly[1].toLowerCase()];
    const year = monthOnly[2] ? Number(monthOnly[2]) : today.y;
    if (month) return monthRange(year, month);
  }

  // 4) Tahun: "tahun 2025".
  const yearOnly = t.match(/\btahun\s+(\d{4})\b/i);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return {
      from: isoDate(year, 1, 1),
      to: isoDate(year, 12, 31),
      label: `Tahun ${year}`,
    };
  }

  // 5) Periode relatif.
  // 5a) Rentang "dari kemarin sampai sekarang/hari ini" (2 hari kalender WIB).
  //     Diperiksa sebelum aturan "kemarin" agar tidak dipersempit jadi 1 hari.
  if (
    /\bkemarin\b/.test(t) &&
    /\b(sekarang|hari ini)\b/.test(t) &&
    /\b(dari|sampai|hingga|sd|s\/d)\b/.test(t)
  ) {
    const y = new Date(Date.UTC(today.y, today.m - 1, today.d) - 86400000);
    const from = isoDate(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate());
    const to = isoDate(today.y, today.m, today.d);
    return {
      from,
      to,
      label: `Kemarin – Hari ini (${shortDate(from)} – ${shortDate(to)})`,
    };
  }
  if (/\bkemarin\b/.test(t)) {
    const d = new Date(Date.UTC(today.y, today.m - 1, today.d) - 86400000);
    const iso = isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return { from: iso, to: iso, label: `Kemarin (${shortDate(iso)})` };
  }
  // 5a) Dua pekan terakhir = 14 hari kalender WIB termasuk hari ini.
  //     Jangan memakai "minggu ini" (Senin–sekarang) karena rentangnya berbeda.
  if (
    /\b(?:dua|2)\s+(?:minggu|pekan)\s+(?:terakhir|belakangan)\b/.test(t) ||
    /\b14\s+hari\s+terakhir\b/.test(t)
  ) {
    const fromDate = new Date(Date.UTC(today.y, today.m - 1, today.d) - 13 * 86400000);
    const from = isoDate(fromDate.getUTCFullYear(), fromDate.getUTCMonth() + 1, fromDate.getUTCDate());
    const to = isoDate(today.y, today.m, today.d);
    return {
      from,
      to,
      label: `14 hari terakhir (${shortDate(from)} – ${shortDate(to)})`,
    };
  }
  if (/\b(minggu|pekan)\s+(lalu|kemarin)\b/.test(t)) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d));
    const dow = (base.getUTCDay() + 6) % 7; // Senin = 0
    const mondayThisWeek = new Date(base.getTime() - dow * 86400000);
    const from = new Date(mondayThisWeek.getTime() - 7 * 86400000);
    const to = new Date(from.getTime() + 6 * 86400000);
    const f = isoDate(from.getUTCFullYear(), from.getUTCMonth() + 1, from.getUTCDate());
    const l = isoDate(to.getUTCFullYear(), to.getUTCMonth() + 1, to.getUTCDate());
    return { from: f, to: l, label: `Minggu lalu (${shortDate(f)} – ${shortDate(l)})` };
  }
  if (/\bbulan\s+(lalu|kemarin)\b/.test(t)) {
    const m = today.m === 1 ? 12 : today.m - 1;
    const y = today.m === 1 ? today.y - 1 : today.y;
    return monthRange(y, m);
  }
  if (/\btahun\s+(lalu|kemarin)\b/.test(t)) {
    return { from: isoDate(today.y - 1, 1, 1), to: isoDate(today.y - 1, 12, 31), label: `Tahun ${today.y - 1}` };
  }
  return null;
}

// ============================================================================
// EKSTRAKSI SLOT (fungsi murni — diuji langsung)
// ============================================================================

export function extractIdFragment(text: string): string | undefined {
  const m =
    text.match(/#?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) ||
    text.match(/(?:laporan|id|tugas)\s*#?\s*([0-9a-f]{8})/i) ||
    text.match(/#([0-9a-f]{8})/i);
  return m ? m[1] : undefined;
}

/**
 * Pencocokan frasa yang toleran terhadap imbuhan tetapi TIDAK cocok di tengah
 * kata lain. Contoh: "alur" cocok pada "alur laporan"/"alurnya", tetapi TIDAK
 * cocok pada "saluran". "jalan" cocok pada "laporan jalan", bukan "penjalanan".
 */
function hasAny(text: string, words: string[]): boolean {
  const isWordChar = (ch: string) => /[a-z0-9\u00C0-\u024F]/.test(ch);
  return words.some((w) => {
    if (!w) return false;
    let from = 0;
    let i = text.indexOf(w, from);
    while (i !== -1) {
      const end = i + w.length;
      // Harus cocok sebagai KATA UTUH di kedua sisi. Sebelumnya hanya sisi kiri
      // yang diperiksa, sehingga "wa" cocok dengan "warga" dan "ig" dengan
      // kata lain — menyebabkan pertanyaan warga salah diklasifikasi sebagai
      // pertanyaan kontak.
      if (
        (i === 0 || !isWordChar(text[i - 1])) &&
        (end >= text.length || !isWordChar(text[end]))
      ) {
        return true;
      }
      from = i + 1;
      i = text.indexOf(w, from);
    }
    return false;
  });
}

/** Kata umum setelah "petugas" yang BUKAN nama orang (mis. "petugas aktif"). */
const OFFICER_NAME_STOPWORDS = new Set([
  'yang', 'itu', 'ini', 'tadi', 'tersebut', 'mana', 'siapa', 'apa', 'paling',
  'banyak', 'terbanyak', 'minggu', 'pekan', 'bulan', 'hari', 'tahun', 'desa',
  'kami', 'kita', 'baru', 'lama', 'sedang', 'belum', 'sudah', 'dan', 'atau',
  'untuk', 'dengan', 'dari', 'pada', 'tugas', 'laporan', 'pegang', 'memegang',
  'menangani', 'bertanggung', 'jawab', 'saja', 'semua', 'aktif', 'nonaktif',
  'lapangan', 'punya', 'memiliki', 'dapat', 'mendapat', 'dikerjakan', 'ditangani',
  'tanpa', 'tidak', 'ada', 'saya', 'aku', 'ku', 'sendiri', 'ke', 'kepada', 'oleh',
  // Kata peran — bukan nama orang. Tanpa ini, "laporan yang ditangani petugas"
  // dianggap meminta detail petugas bernama "petugas".
  'petugas', 'admin', 'administrator', 'warga', 'masyarakat', 'pengguna', 'user',
  'tim', 'orang', 'mereka',
]);

/**
 * Ambil nama petugas spesifik dari frasa "petugas <nama>", "ditugaskan ke
 * <nama>", atau "ditangani oleh <nama>". Nama yang dikembalikan sudah
 * dinormalisasi ke huruf kecil; pemakaiannya hanya untuk filter pencocokan
 * sebagian, bukan untuk ditampilkan sebagai identitas.
 */
function extractOfficerName(text: string): string | undefined {
  const patterns = [
    /\bpetugas\s+([a-z\u00C0-\u024F]{3,})/,
    /\b(?:ditugaskan|ditangani|dikerjakan|menangani|memegang)\s+(?:(?:ke|kepada|oleh|sama)\s+)?([a-z\u00C0-\u024F]{3,})/,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const name = match[1];
    if (OFFICER_NAME_STOPWORDS.has(name)) continue;
    return name;
  }
  return undefined;
}

export function detectPeriod(t: string): Period | undefined {
  if (hasAny(t, TODAY_HINTS)) return 'today';
  if (hasAny(t, WEEK_HINTS)) return 'week';
  if (hasAny(t, MONTH_HINTS)) return 'month';
  return undefined;
}

export function detectCategory(t: string): string | undefined {
  for (const [cat, hints] of CATEGORY_SYNONYMS) {
    if (hasAny(t, hints)) return cat;
  }
  return undefined;
}

export function detectDamageType(t: string): string | undefined {
  for (const [dt, hints] of DAMAGE_SYNONYMS) {
    if (hasAny(t, hints)) return dt;
  }
  return undefined;
}

export function detectStatuses(t: string): string[] | undefined {
  // Bila "belum selesai" muncul, itu negasi status final — bukan COMPLETED.
  if (hasAny(t, ['belum selesai', 'belum beres', 'belum tuntas', 'belum kelar'])) return undefined;

  // "Belum ditugaskan" adalah negasi penugasan. Tanpa penjagaan ini, kata
  // "ditugaskan" (sinonim ASSIGNED) akan ikut terbaca dan menghasilkan dua
  // status yang saling bertentangan.
  if (hasAny(t, [
    'belum ditugaskan', 'belum di tugaskan', 'tidak ditugaskan',
    'belum pernah ditugaskan', 'belum ada petugas',
  ])) {
    return ['VERIFIED'];
  }

  // "Menunggu verifikasi hasil/bukti" adalah REVIEW. Frasa itu mengandung
  // "menunggu verifikasi" yang juga sinonim SUBMITTED, jadi SUBMITTED harus
  // dilewati bila penanda REVIEW yang lebih spesifik muncul.
  const reviewSpecific = hasAny(t, [
    'menunggu verifikasi bukti', 'menunggu verifikasi hasil', 'menunggu hasil',
    'menunggu review', 'verifikasi hasil', 'verifikasi bukti', 'review',
  ]);

  const out: string[] = [];
  for (const [code, hints] of STATUS_SYNONYMS) {
    if (code === 'SUBMITTED' && reviewSpecific) continue;
    if (hasAny(t, hints)) out.push(code);
  }

  // "Sudah diverifikasi dan ditugaskan" merujuk status terakhir (ASSIGNED),
  // bukan dua status sekaligus. Negasi "belum ditugaskan" sudah ditangani di atas.
  if (out.includes('ASSIGNED') && out.includes('VERIFIED')) {
    out.splice(out.indexOf('VERIFIED'), 1);
  }
  return out.length ? out : undefined;
}

export function detectStatusNotFinal(t: string): boolean {
  return hasAny(t, STATUS_NOT_FINAL_HINTS.filter((h) => h !== 'aktif')) ||
    /belum\s+(selesai|beres|tuntas|kelar)/.test(t);
}

/**
 * Pertanyaan pendek yang HANYA menyebut status (mis. "laporan yang ditugaskan?")
 * dimaksudkan sebagai jumlah status itu, bukan ringkasan seluruh sistem.
 * Pertanyaan yang meminta daftar/detail atau menambahkan filter lain tidak
 * masuk ke sini agar tetap menjadi listReports.
 */
export function isStatusOnlyCountQuestion(t: string): boolean {
  if (hasAny(t, COUNT_HINTS) || hasAny(t, LIST_HINTS)) return false;
  if (hasAny(t, ['mana', 'detail', 'rinci', 'jelaskan', 'sebutkan', 'siapa', 'kapan'])) return false;
  if (extractOfficerName(t)) return false;
  if (
    detectCategory(t) || detectDamageType(t) || detectSeverities(t) ||
    detectLocation(t) || detectReporterName(t)
  ) return false;
  if (detectStatusNotFinal(t)) return false;
  return Boolean(detectStatuses(t)?.length);
}

/**
 * Permintaan kreatif/umum di luar domain laporan. Jangan pernah mengubahnya
 * menjadi query laporan hanya karena kebetulan menyebut "jalan", "lampu", dll.
 */
export function detectOffTopicRequest(t: string): boolean {
  return hasAny(t, [
    'puisi', 'pantun', 'cerpen', 'cerita fiksi', 'dongeng', 'lagu', 'syair',
    'resep', 'fotosintesis', 'matematika', 'soal matematika', 'terjemahkan',
    'translate', 'javascript', 'typescript', 'python', 'html', 'css', 'react',
    'node.js', 'coding', 'ngoding', 'pemrograman', 'algoritma', 'debug',
    'kode program', 'tulis kode', 'buat kode', 'contoh kode',
    // Teknologi/bahasa lain yang sering ditanyakan tetapi di luar layanan desa.
    'tensorflow', 'machine learning', 'deep learning', 'laravel', 'golang',
    'kotlin', 'belajar coding', 'tutorial coding', 'tutorial python',
    'tutorial javascript', 'sql injection', 'docker', 'kubernetes',
  ]);
}

export function detectSeverities(t: string): string[] | undefined {
  const out: string[] = [];
  for (const [sev, hints] of SEVERITY_SYNONYMS) {
    if (hasAny(t, hints)) out.push(sev);
  }
  // "severity tinggi" juga mencakup KRITIS (sama seperti tool lama HighSeverity).
  if (out.includes('TINGGI') && !out.includes('KRITIS')) out.push('KRITIS');
  return out.length ? out : undefined;
}

/**
 * Kata yang TIDAK boleh dianggap nama orang. Daftar ini sengaja luas karena
 * pola "laporan <X>" mudah keliru: frasa seperti "laporan bulan ini berapa"
 * TIDAK boleh dibaca sebagai nama pelapor "bulan ini berapa".
 */
const NAME_STOPWORDS = new Set([
  // kata tanya & perintah
  'berapa', 'jumlah', 'total', 'banyak', 'hitung', 'apa', 'apakah', 'saja', 'mana',
  'yang', 'bagaimana', 'gimana', 'kenapa', 'mengapa', 'kapan', 'dimana', 'siapa',
  'sebutkan', 'tampilkan', 'tunjukkan', 'berikan', 'lihat', 'cari', 'daftar', 'list',
  'semua', 'rincian', 'detail', 'tolong', 'mohon', 'ada', 'adakah', 'masuk', 'terbaru',
  // kata waktu
  'hari', 'ini', 'itu', 'bulan', 'minggu', 'pekan', 'tahun', 'kemarin', 'besok',
  'terlama', 'lama', 'baru', 'sekarang', 'saja',
  // kata domain / status
  'jalan', 'lampu', 'trotoar', 'drainase', 'taman', 'jembatan', 'selokan', 'got',
  'saluran', 'kerusakan', 'rusak', 'lubang', 'retak', 'patah', 'tergenang', 'padam',
  'tinggi', 'rendah', 'sedang', 'kritis', 'parah', 'ringan', 'berat',
  'belum', 'sudah', 'tidak', 'bukan', 'final', 'diverifikasi', 'diverifikasi',
  'verifikasi', 'ditugaskan', 'selesai', 'ditolak', 'proses', 'status', 'kategori',
  'petugas', 'admin', 'warga', 'masyarakat', 'desa', 'ciperna', 'pelapor', 'laporan',
  'laporannya', 'bukti', 'penyelesaian', 'duplikat', 'semua',
  // kata sambung / preposisi / ganti
  'dengan', 'untuk', 'dari', 'dan', 'atau', 'pada', 'ke', 'di', 'oleh', 'atas',
  'nama', 'milik', 'punya', 'saya', 'aku', 'kami', 'kita', 'mereka', 'dia', 'orang',
  'sebagai', 'tentang', 'per', 'tiap', 'masing-masing',
]);

/** Kandidat nama yang wajar: 1-3 kata, tanpa angka, tanpa kata umum. */
function looksLikePersonName(raw: string): boolean {
  if (raw.length < 2 || raw.length > 40) return false;
  if (/\d/.test(raw)) return false;
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  // Tolak bila ADA kata yang termasuk kata umum (bukan nama orang).
  if (words.some((w) => NAME_STOPWORDS.has(w))) return false;
  return true;
}

export function detectReporterName(message: string): string | undefined {
  const patterns = [
    /lapor(?:an)?(?:-nya)?\s+(?:milik|punya|dari|oleh|atas nama|dengan nama|dibuat oleh|ada di)\s+([A-Za-z\u00C0-\u024F'`.-]+(?:\s+[A-Za-z\u00C0-\u024F'`.-]+){0,3})/i,
    /^\s*(?:tampilkan|lihat|cari|daftar|list|semua)?\s*lapor(?:an)?\s+([A-Za-z\u00C0-\u024F'`.-]+(?:\s+[A-Za-z\u00C0-\u024F'`.-]+){0,2})\s*\??$/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (!m) continue;
    const raw = m[1].replace(/[.,?!]+$/, '').trim();
    if (!looksLikePersonName(raw)) continue;
    return raw;
  }
  return undefined;
}

export function detectReference(t: string): boolean {
  return REFERENCE_PATTERN.test(t);
}

//(formatCandidateClarification & pickReportCandidate kini berada di aiCandidates.ts
// dan diekspor ulang di atas — lihat catatan impor di bagian atas berkas ini.)

/**
 * Tentukan laporan yang sedang dirujuk pada pertanyaan lanjutan.
 * - Bila ada beberapa kandidat dan pengguna tidak memilih → klarifikasi.
 * - Bila pengguna memilih nomor/urutan → pakai kandidat itu.
 * - Bila hanya satu kandidat/ID eksplisit → pakai ID tersebut.
 */
function followUpTarget(
  t: string,
  ctx: AiContext
): { id?: string; clarification?: string } {
  if (Array.isArray(ctx.lastReportCandidates) && ctx.lastReportCandidates.length > 0) {
    const picked = pickReportCandidate(t, ctx.lastReportCandidates);
    if (picked) return { id: picked.id };
    if (ctx.lastReportCandidates.length > 1) {
      return { clarification: formatCandidateClarification(ctx.lastReportCandidates) };
    }
    return { id: ctx.lastReportCandidates[0].id };
  }
  return { id: ctx.lastReportRef };
}

export function detectDimension(t: string): Dimension | undefined {
  if (hasAny(t, ['jenis kerusakan', 'jenis kerusakannya', 'tipe kerusakan', 'tipe kerusakannya', 'kerusakan apa', 'kerusakan yang paling', 'macam kerusakan', 'macam kerusakannya'])) return 'damageType';
  if (hasAny(t, ['jenis fasilitas', 'kategori', 'jenis laporan', 'kategori fasilitas'])) return 'category';
  if (hasAny(t, ['severity', 'keparahan', 'tingkat kerusakan', 'tingkat keparahan', 'tingkat bahaya'])) return 'severity';
  if (hasAny(t, ['wilayah', 'lokasi', 'daerah', 'area'])) return 'location';
  if (hasAny(t, ['status apa', 'macam status', 'daftar status'])) return 'status';
  if (hasAny(t, ['petugas', 'kinerja', 'beban kerja'])) return 'officer';
  return undefined;
}

// ----------------------------------------------------------------------------
// Deteksi DIREKTORI AKUN (role, status aktif/nonaktif, kata kunci).
// Dipakai router Admin untuk memetakan pertanyaan pengguna ke tool akun.
// ----------------------------------------------------------------------------

/** Role akun yang disebut pengguna ("warga", "petugas", "admin"). */
export function detectAccountRole(t: string): 'CITIZEN' | 'OFFICER' | 'ADMIN' | undefined {
  if (hasAny(t, ['petugas', 'officer', 'petugas desa', 'petugas lapangan'])) return 'OFFICER';
  if (hasAny(t, ['warga', 'masyarakat', 'citizen', 'penduduk'])) return 'CITIZEN';
  if (hasAny(t, ['admin', 'administrator'])) return 'ADMIN';
  return undefined;
}

const ACCOUNT_INACTIVE_HINTS = [
  'nonaktif', 'non aktif', 'non-aktif', 'dinonaktifkan', 'di nonaktifkan', 'di-nonaktifkan',
  'tidak aktif', 'tdk aktif', 'gak aktif', 'ga aktif', 'tidak bisa login', 'diblokir', 'di blokir',
  'dibekukan', 'di bekukan', 'dimatikan', 'di matikan', 'off',
];
const ACCOUNT_ACTIVE_HINTS = ['aktif', 'masih aktif', 'bisa login', 'masih bisa login'];

/**
 * Status aktif akun yang dimaksud pengguna.
 * "nonaktif"/"dinonaktifkan" â†’ false; "aktif" (tanpa penanda nonaktif) â†’ true.
 * PENTING: hasAny memakai batas kata, sehingga "nonaktif" TIDAK terbaca sebagai "aktif".
 */
export function detectAccountActive(t: string): boolean | undefined {
  if (hasAny(t, ACCOUNT_INACTIVE_HINTS)) return false;
  if (hasAny(t, ACCOUNT_ACTIVE_HINTS)) return true;
  return undefined;
}

// ----------------------------------------------------------------------------
// PERTANYAAN KEAMANAN AKUN ("apakah akun data warga aman?")
// ----------------------------------------------------------------------------
/**
 * Mengapa dipisah: sebelumnya kata "akun" + "warga" langsung dianggap permintaan
 * DIREKTORI AKUN, sehingga pertanyaan keamanan dijawab dengan daftar nama,
 * email, dan nomor telepon. Pertanyaan keamanan harus dinilai dari kontrol
 * aplikasi (hash kata sandi, sesi, otorisasi), bukan dengan membuka data akun.
 */
const ACCOUNT_SECURITY_HINTS = [
  'aman', 'keamanan', 'terlindungi', 'terlindung', 'dilindungi', 'perlindungan',
  'bocor', 'kebocoran', 'dibocorkan', 'privasi', 'rahasia', 'rahasia tidak',
  'diretas', 'peretas', 'hacker', 'disusupi', 'penyusupan', 'celah',
  'kerentanan', 'risiko', 'enkripsi', 'terenkripsi', 'hash', 'hashed',
  '2fa', 'dua faktor', 'aman tidak', 'apakah aman', 'masih aman',
];

export function detectAccountSecurityQuestion(t: string): boolean {
  if (!hasAny(t, ACCOUNT_SECURITY_HINTS)) return false;
  // Wajib membahas AKUN/DATA PENGGUNA. "apakah jalan itu aman?" bukan
  // pertanyaan keamanan akun dan tetap ditangani sebagai pertanyaan biasa.
  return hasAny(t, [
    'akun', 'akunku', 'akunnya', 'data warga', 'data pengguna', 'data masyarakat',
    'data akun', 'data pribadi', 'warga', 'masyarakat', 'pengguna', 'user',
    'petugas', 'admin', 'kata sandi', 'password', 'login', 'sesi', 'privasi',
  ]);
}

/**
 * Kata kunci pencarian akun (nama, email, atau nomor telepon) yang benar-benar
 * disebut pengguna. Sengaja konservatif agar tidak salah membaca kata umum
 * seperti "warga"/"nonaktif" sebagai nama.
 */
export function detectAccountQuery(message: string): string | undefined {
  const quoted = message.match(/"([^"]{2,60})"/);
  if (quoted) return quoted[1].trim();
  const named = message.match(
    /(?:bernama|atas nama|dengan nama|namanya|nama)\s+([A-Za-z\u00C0-\u024F'.-]+(?:\s+[A-Za-z\u00C0-\u024F'.-]+){0,2})/i
  );
  if (named) {
    const raw = named[1].replace(/[.,?!]+$/, '').trim();
    // Frasa "bernama/atas nama/dengan nama" adalah sinyal kuat. Tetap terima
    // nama yang mengandung kata umum (mis. "Tidak Ada") selama ada minimal
    // satu kata yang benar-benar bersifat nama. Untuk prefix lemah "nama",
    // aturan stopword tetap berlaku agar "nama saya" tidak jadi pencarian.
    const strongNaming = /(?:bernama|atas\s+nama|dengan\s+nama|namanya)\s+/i.test(message);
    const hasNameWord = raw
      .toLowerCase()
      .split(/\s+/)
      .some((w) => w.length >= 2 && !NAME_STOPWORDS.has(w));
    if (looksLikePersonName(raw) || (strongNaming && hasNameWord && raw.length <= 40 && !/\d/.test(raw))) {
      return raw;
    }
  }
  const email = message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (email) return email[0];
  const wa = message.match(/(?:no\.?\s*(?:hp|wa|whatsapp)|nomor)\s*[:=]?\s*(0?8\d{7,13}|62\d{8,14})/i);
  if (wa) return wa[1];
  // "Cari akun Erza." / "siapa akun Erza?" — kata kerja pencarian + nama.
  // Kata umum ("yang nonaktif", "petugas aktif") ditolak oleh looksLikePersonName
  // sehingga tidak berubah menjadi pencarian seluruh direktori.
  const searched = message.match(
    /\b(?:cari|carikan|temukan|lihat|tampilkan|cek|siapa)\s+(?:akun|user|pengguna|warga|masyarakat|petugas|admin)?\s*([A-Za-z\u00C0-\u024F'.-]+(?:\s+[A-Za-z\u00C0-\u024F'.-]+){0,2})\s*\??$/i
  );
  if (searched) {
    const raw = searched[1].replace(/[.,?!]+$/, '').trim();
    if (looksLikePersonName(raw)) return raw;
  }
  return undefined;
}

/**
 * Status verifikasi WhatsApp akun (`User.phoneVerifiedAt`).
 * Dipisahkan dari `detectStatuses` karena "belum verifikasi" pada pertanyaan
 * AKUN berarti nomor WhatsApp belum diverifikasi — bukan status laporan.
 */
export function detectAccountVerified(t: string): boolean | undefined {
  if (
    hasAny(t, [
      'belum verifikasi', 'belum terverifikasi', 'belum diverifikasi', 'belum verif',
      'tidak terverifikasi', 'tidak verifikasi', 'unverified', 'belum konfirmasi',
      'belum verifikasi wa', 'belum verifikasi whatsapp',
    ])
  ) {
    return false;
  }
  if (
    hasAny(t, [
      'sudah verifikasi', 'sudah terverifikasi', 'sudah diverifikasi', 'terverifikasi',
      'sudah verif', 'verified', 'sudah konfirmasi wa', 'sudah konfirmasi whatsapp',
    ])
  ) {
    return true;
  }
  return undefined;
}

/** Sinyal pertanyaan tentang PENDAFTARAN akun (bukan daftar laporan). */
const REGISTRATION_STRONG_HINTS = [
  'registrasi', 'pendaftaran', 'pendaftar', 'mendaftar',
  'akun baru', 'user baru', 'warga baru', 'pengguna baru', 'anggota baru',
  'baru daftar', 'baru mendaftar', 'baru registrasi', 'baru bikin akun', 'baru buat akun',
  'bikin akun', 'buat akun', 'membuat akun', 'signup', 'sign up',
];
/**
 * Kata lemah: "terdaftar"/"daftar" saja belum tentu soal pendaftaran baru —
 * "Ada berapa petugas terdaftar?" adalah hitungan direktori akun. Baru dianggap
 * pendaftaran bila disertai kata akun DAN penanda waktu/ kebaruan.
 */
const REGISTRATION_WEAK_HINTS = ['terdaftar', 'daftar'];
const REGISTRATION_ACCOUNT_WORDS = [
  'warga', 'masyarakat', 'akun', 'user', 'pengguna', 'pendaftar', 'orang', 'siapa',
  // "ada yang daftar hari ini?" â†’ subjek orang, bukan daftar laporan.
  'yang',
];
const REGISTRATION_NEW_WORDS = [
  'baru', 'terbaru', 'terakhir', 'tadi', 'kemarin', 'hari ini', 'minggu ini',
  'pekan ini', 'bulan ini', 'registrasi', 'pendaftar', 'mendaftar',
];
/** Pertanyaan laporan/tugas tidak boleh dibajak menjadi pertanyaan pendaftaran. */
const REGISTRATION_REPORTISH = [
  'laporan', 'tugas', 'penugasan', 'kerusakan', 'fasilitas', 'pelapor', 'melapor',
  'ditugaskan', 'mengerjakan',
];

export function detectRegistrationSignal(t: string): boolean {
  if (hasAny(t, REGISTRATION_REPORTISH)) return false;
  if (hasAny(t, REGISTRATION_STRONG_HINTS)) return true;
  return (
    hasAny(t, REGISTRATION_WEAK_HINTS) &&
    hasAny(t, REGISTRATION_ACCOUNT_WORDS) &&
    hasAny(t, REGISTRATION_NEW_WORDS)
  );
}

// ----------------------------------------------------------------------------
// Deteksi PERTANYAAN PORTAL DESA (profil, pemerintahan, layanan, pengumuman,
// lokasi). Dijawab dari data desa di database; bukan dari pengetahuan model.
// Diperiksa LEBIH DULU agar "desa ciperna ada di mana?" tidak jatuh ke menu
// website dan "perangkat desa" tidak tertukar dengan akun petugas.
// ----------------------------------------------------------------------------

const VILLAGE_ANNOUNCEMENT_HINTS = ['pengumuman', 'kabar desa', 'berita desa', 'informasi terbaru desa'];
const VILLAGE_OFFICIAL_HINTS = [
  'kepala desa', 'kades', 'sekretaris desa', 'sekdes', 'perangkat desa',
  'struktur pemerintahan', 'struktur desa', 'struktur organisasi desa', 'pemerintah desa', 'pejabat desa',
  'ketua rw', 'ketua rt', 'rt dan rw', 'rt/rw', 'rt rw', 'kepala dusun', 'kadus',
  'kepala seksi', 'kepala urusan', 'siapa saja perangkat', 'daftar perangkat',
];
const VILLAGE_SERVICE_HINTS = [
  'layanan desa', 'pelayanan desa', 'jenis layanan', 'daftar layanan',
  'apa saja layanan', 'layanan apa', 'persyaratan layanan', 'prosedur layanan',
];
const VILLAGE_MAP_HINTS = [
  'petunjuk arah', 'cara menuju', 'rute ke', 'arah ke', 'jalan ke kantor',
  'lokasi kantor desa', 'peta desa', 'titik lokasi desa',
  'kantor desa di mana', 'kantor desa dimana', 'lokasi desa',
];
const VILLAGE_PROFILE_HINTS = [
  'profil desa', 'tentang desa', 'sejarah desa', 'asal usul desa', 'asal-usul',
  'visi misi', 'visi dan misi', 'misi desa', 'potensi desa', 'kondisi desa',
  'geografis', 'letak desa', 'desa ciperna di mana', 'desa ciperna dimana',
  'ciperna terletak', 'ciperna ada di', 'kode pos', 'alamat desa', 'kontak desa',
  'jumlah penduduk', 'luas desa', 'demografi', 'jam pelayanan', 'jam layanan',
  'jam operasional', 'jam kantor',
  // Variasi umum "apa itu desa ciperna / info desa". Sebelumnya pertanyaan ini
  // bisa nyasar ke daftar fitur (Admin) atau filter lokasi laporan (Warga).
  'apa itu desa', 'desa ciperna itu', 'info desa', 'informasi desa',
  'mengenai desa', 'tentang desa ciperna', 'profil ciperna',
];

export function detectVillageIntent(t: string): ToolCall | null {
  if (hasAny(t, VILLAGE_ANNOUNCEMENT_HINTS)) return { name: 'getVillageAnnouncements', args: { limit: 5 } };
  if (hasAny(t, VILLAGE_OFFICIAL_HINTS)) return { name: 'getVillageOfficials', args: {} };
  if (hasAny(t, VILLAGE_MAP_HINTS)) return { name: 'getVillageMapInfo', args: {} };

  if (hasAny(t, VILLAGE_SERVICE_HINTS)) return { name: 'getVillageServices', args: {} };

  // Variasi umum pertanyaan lokasi/alamat yang tidak selalu memakai frasa
  // "lokasi desa" atau "kantor desa di mana". Contoh: "Di mana Desa Ciperna?",
  // "Ciperna itu di mana?", "Alamat kantor desa?", "Apa alamat Desa Ciperna?".
  // Jawab ringkas dari peta/alamat, jangan membuang seluruh profil desa.
  const locationWord = /\b(di\s*mana|dimana|lokasi|letak|terletak|alamat|peta|rute|arah|menuju)\b/.test(t);
  const reportTopic = /\b(laporan|tugas|petugas|akun|pengguna|statistik|pengumuman)\b/.test(t);
  const villageSubject =
    /\b(ciperna|kantor desa|desa ini|pemerintah desa)\b/.test(t) ||
    (/\bdesa\b/.test(t) && !reportTopic);
  if (locationWord && villageSubject) {
    return { name: 'getVillageMapInfo', args: {} };
  }

  if (hasAny(t, VILLAGE_PROFILE_HINTS)) return { name: 'getVillageProfileInfo', args: {} };
  return null;
}

// ============================================================================
// DETEKSI NIAT
// ============================================================================

const COUNT_HINTS = ['berapa', 'jumlah', 'total', 'banyak', 'hitung', 'ada berapa', 'brp'];
const LIST_HINTS = [
  'daftar', 'list', 'tampilkan', 'sebutkan', 'apa saja', 'yang mana', 'mana saja',
  'tunjukkan', 'berikan', 'rincian', 'lihat', 'melihat', 'menampilkan', 'semua', 'contoh', 'siapa saja',
];
const DETAIL_HINTS = [
  'detail', 'rinci', 'jelaskan', 'status laporan', 'kondisi', 'perkembangan',
  'progress', 'progres', 'timeline', 'riwayat laporan', 'kenapa', 'mengapa',
  'alasan', 'kapan', 'petugasnya', 'siapa yang menangani', 'siapa yang mengerjakan',
];
const EXPLAIN_HINTS = [
  'cara ', 'bagaimana cara', 'bagaimana proses', 'bagaimana alur', 'gimana cara',
  'alur', 'tahapan', 'langkah', 'apa itu', 'fungsinya', 'fungsi ', 'di mana', 'dimana',
  'di mana ', 'menu apa', 'halaman apa', 'fitur apa', 'cara pakai', 'cara meng',
];

interface QueueDef {
  tool: string;
  /** Status yang dipakai bila pertanyaan menambahkan filter lain. */
  status?: string[];
  /** Slot tambahan yang melekat pada antrean (mis. hanya laporan belum final). */
  extra?: Partial<ReportFilter>;
}

const QUEUE_RULES: [string[], QueueDef][] = [
  [['duplikat', 'dobel', 'ganda', 'kejadian yang sama', 'laporan sama'], { tool: 'getDuplicateOverview' }],
  [['menunggu verifikasi hasil', 'menunggu verifikasi bukti', 'menunggu hasil', 'verifikasi hasil', 'bukti penyelesaian', 'menunggu review'], { tool: 'getPendingResultVerification', status: ['REVIEW'] }],
  [['belum diverifikasi', 'menunggu verifikasi', 'belum diperiksa'], { tool: 'getUnverifiedQueue', status: ['SUBMITTED'] }],
  [['menunggu penugasan', 'belum ditugaskan', 'belum ada petugas', 'belum ditangani'], { tool: 'getPendingAssignment', status: ['VERIFIED'] }],
  [['terbengkalai', 'terlalu lama', 'lama belum', 'tidak ditangani'], { tool: 'getStaleReports' }],
  [['sedang dikerjakan', 'sedang ditangani', 'in progress', 'dalam proses'], { tool: 'listReports', status: ['IN_PROGRESS'] }],
  [['belum selesai', 'sedang berjalan', 'aktif'], { tool: 'listReports', extra: { statusNotFinal: true } }],
];

/**
 * Frasa pengelolaan akun (khusus Admin): menambah petugas, melihat detail akun,
 * reset kata sandi, aktif/nonaktifkan. Dijawab dari pengetahuan fitur
 * (getWebsiteInfo topic 'adminAccounts'), bukan dari query data.
 */
const ACCOUNT_ADMIN_EXPLAIN_HINTS = [
  'tambah petugas', 'menambah petugas', 'tambahkan petugas', 'daftarkan petugas', 'mendaftarkan petugas',
  'buat akun petugas', 'membuat akun petugas', 'registrasi petugas', 'tambah akun', 'buat akun',
  'reset kata sandi', 'reset password', 'mereset kata sandi', 'mereset password',
  'kata sandi petugas', 'kata sandi warga', 'password petugas', 'password warga', 'kata sandi akun',
  'nonaktifkan akun', 'aktifkan akun', 'menonaktifkan akun', 'mengaktifkan akun', 'menonaktifkan pengguna',
  'detail akun', 'detail pengguna', 'detail warga', 'lihat detail akun', 'tambah petugas baru',
];

function buildReportSlots(message: string, t: string): ReportFilter {
  const filter: ReportFilter = {};
  const located = extractExplicitLocation(message, t);
  const category = extractExplicitCategory(message, t);
  // "laporan di Jl. Merdeka" menyebut JALAN sebagai bagian nama tempat, bukan
  // kategori fasilitas. Jangan menyaring kategori "Jalan" hanya karena itu.
  const locationIsStreet = !!located && /^(?:jl\.?|jalan|gang|gg\.?)\b/i.test(located);
  const explicitCategoryWord = /\b(?:kategori|kategorinya|jenis fasilitas|jenis laporan)\b/.test(t);
  const hasDamageHint = !!detectDamageType(t);
  if (category && !(locationIsStreet && category === 'Jalan' && !explicitCategoryWord && !hasDamageHint)) {
    filter.category = category;
  }
  const damageType = detectDamageType(t);
  if (damageType) filter.damageType = damageType;
  const severity = detectSeverities(t);
  if (severity) filter.severity = severity;
  // Rentang tanggal eksplisit lebih spesifik daripada periode relatif.
  const dateRange = detectDateRange(t);
  if (dateRange) {
    filter.dateFrom = dateRange.from;
    filter.dateTo = dateRange.to;
  } else {
    const period = detectPeriod(t);
    if (period) filter.period = period;
  }
  const status = detectStatuses(t);
  if (status) filter.status = status;
  if (detectStatusNotFinal(t)) filter.statusNotFinal = true;
  const reporter = detectReporterName(message);
  if (reporter) filter.reporterName = reporter;
  const officer = extractOfficerName(t);
  if (officer) filter.officerName = officer;
  if (located) filter.location = located;
  const quotedTitle = message.match(/"([^"]{4,80})"/);
  if (quotedTitle) filter.title = quotedTitle[1].trim();
  return filter;
}

// Kata yang tidak boleh menjadi nama kategori saat pengguna menyebut
// "kategori X" tetapi X bukan salah satu kategori resmi formulir.
const UNKNOWN_CATEGORY_STOPWORDS = new Set([
  'apa', 'apakah', 'yang', 'mana', 'saja', 'berapa', 'jumlah', 'total', 'paling',
  'terbanyak', 'tersebut', 'itu', 'ini', 'laporan', 'laporannya', 'fasilitas',
  'umum', 'desa', 'ciperna', 'semua', 'terbaru', 'baru', 'lama', 'tersering',
  'sering', 'banyak', 'sedikit', 'tertinggi', 'terendah',
]);

/**
 * Ekstrak kategori yang disebut EKSPLISIT ("kategori Kolam Renang").
 *
 * Mengapa perlu: sebelumnya filter kategori yang tidak dikenal (mis. "Kolam
 * Renang") dibuang diam-diam, lalu `countReports({})` menjawab TOTAL seluruh
 * laporan. Pengguna mengira angka itu adalah jumlah kategori yang ditanyakan.
 * Dengan menyimpan frasa tak dikenal sebagai filter, query menghasilkan 0 dan
 * jawaban tetap jujur ("tidak ada laporan kategori tersebut").
 */
function extractExplicitCategory(message: string, t: string): string | undefined {
  const known = detectCategory(t);
  if (known) return known;

  const match = message.match(
    /\b(?:kategori|kategorinya|jenis fasilitas|jenis laporan)\s*(?:adalah|yaitu|:)?\s*([A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F .'\-]{1,40})/i
  );
  if (!match) return undefined;

  const cleaned = match[1]
    .replace(/[?.!,;:]+$/g, '')
    .replace(/\b(?:yang|di|desa|ini|itu|saja|ada|berapa|jumlah|total)\b.*$/i, '')
    .trim();
  if (cleaned.length < 3) return undefined;
  if (UNKNOWN_CATEGORY_STOPWORDS.has(cleaned.toLowerCase())) return undefined;
  return cleaned.slice(0, 40);
}

// Nama tempat generik yang BUKAN filter lokasi laporan.
const LOCATION_STOPWORDS = new Set([
  'desa', 'kecamatan', 'kabupaten', 'kota', 'provinsi', 'kantor', 'sini', 'sana',
  'mana', 'mana saja', 'atas', 'bawah', 'dalam', 'luar', 'rumah', 'lokasi',
]);

/**
 * Ekstrak lokasi yang disebut eksplisit ("di Jl. Sudirman", "lokasi: Blok A").
 *
 * Tanpa ini, pertanyaan seperti "berapa laporan di Jl. Sudirman?" kehilangan
 * filter lokasi dan dijawab dengan total seluruh laporan.
 */
function extractExplicitLocation(message: string, t: string): string | undefined {
  const known = detectLocation(t);
  if (known) return known;

  const patterns = [
    /\b(?:lokasi|daerah|wilayah|kawasan|area|di|dari)\s+((?:jl\.?|jalan|gang|gg\.?|blok|dusun|kampung|perumahan|komplek|kompleks)\s+[A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F .'\-]{1,50})/i,
    /\b(?:lokasi|daerah|wilayah|kawasan|area)\s*[:=]?\s*([A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F .'\-]{2,50})/i,
  ];

  for (const re of patterns) {
    const match = message.match(re);
    if (!match) continue;
    let cleaned = match[1]
      .replace(/[?.!,;:]+$/g, '')
      .replace(/\s+\b(?:hari ini|minggu ini|bulan ini|tahun ini|kemarin|berapa|jumlah|total|yang|saja)\b.*$/i, '')
      .trim();
    // "Jl. Merdeka" / "Jalan Merdeka" → "Merdeka" agar pencocokan `contains`
    // tetap menemukan lokasi yang ditulis dengan singkatan berbeda.
    const street = cleaned.match(/^(?:jl\.?|jalan|gang|gg\.?)\s+(.{3,})$/i);
    if (street) cleaned = street[1].trim();
    if (!cleaned) continue;
    if (LOCATION_STOPWORDS.has(cleaned.toLowerCase())) continue;
    return cleaned.slice(0, 60);
  }
  return undefined;
}

// Nama lokasi/daerah yang benar-benar muncul di kolom location.
// Memakai batas kata agar "rt"/"rw" tidak salah cocok di tengah kata lain.
const LOCATION_PATTERN =
  /\b(ciperna|tegal|losari|buntet|kubang|sindang|japura|ciwaringin|karangsari|blok|dusun|kampung|pesantren|rt|rw)\b/;

function detectLocation(t: string): string | undefined {
  const m = t.match(LOCATION_PATTERN);
  return m ? m[1] : undefined;
}

function slotsEmpty(f: ReportFilter): boolean {
  return Object.keys(f).length === 0;
}

// ============================================================================
// PERMINTAAN TINDAKAN TULIS (TIDAK boleh dieksekusi dari jalur AI)
// ============================================================================
/**
 * Asisten AI bersifat READ-ONLY. Permintaan seperti "hapus laporan X" atau
 * "verifikasi laporan X" harus dijawab dengan panduan halaman yang tepat —
 * bukan dengan query data dan bukan dengan klaim "sudah dilakukan".
 *
 * Deteksi ini sengaja konservatif: frasa informasi seperti "menunggu
 * verifikasi" atau "siapa yang memverifikasi" TIDAK dianggap permintaan tulis.
 */
const WRITE_INFO_CONTEXT = [
  'menunggu verifikasi', 'belum diverifikasi', 'sudah diverifikasi', 'sudah di verifikasi',
  'belum verifikasi', 'sudah verifikasi', 'belum terverifikasi', 'sudah terverifikasi',
  'status verifikasi', 'proses verifikasi', 'antrean verifikasi', 'verifikasi hasil',
  'perlu verifikasi', 'butuh verifikasi', 'harus diverifikasi', 'menunggu review',
  'verifikasi whatsapp', 'verifikasi wa', 'status akun', 'akun aktif', 'akun nonaktif',
  'sudah ditugaskan', 'belum ditugaskan', 'menunggu penugasan', 'perlu ditugaskan',
  'sudah selesai', 'sudah dihapus', 'yang memverifikasi', 'siapa yang verifikasi',
  'siapa yang menugaskan', 'alur verifikasi', 'tahapan verifikasi', 'status pengiriman',
  'notifikasi wa', 'status wa', 'pengiriman whatsapp', 'sudah terbit', 'belum terbit',
  'pengumuman aktif', 'pengumuman terjadwal',
];

const WRITE_ACTIONS: [string, string[]][] = [
  ['delete', ['hapus', 'menghapus', 'delete', 'hilangkan']],
  ['verify', ['verifikasi', 'memverifikasi', 'verifikasi ulang', 'setujui', 'menyetujui', 'approve', 'tolak laporan', 'menolak laporan', 'reject']],
  ['assign', ['tugaskan', 'menugaskan', 'assign', 'bagikan ke petugas', 'beri tugas']],
  ['status', ['ubah status', 'mengubah status', 'ganti status', 'update status', 'tandai selesai', 'selesaikan laporan']],
  ['announcement', ['terbitkan', 'menerbitkan', 'publikasikan', 'mempublikasikan', 'buat pengumuman', 'tambah pengumuman']],
  ['account', ['buat akun', 'membuat akun', 'tambah petugas', 'menambah petugas', 'tambahkan petugas', 'reset password', 'reset kata sandi', 'nonaktifkan akun', 'aktifkan akun', 'hapus akun', 'ubah password', 'ganti password', 'ubah profil']],
  ['send', ['kirim wa', 'kirim whatsapp', 'kirim pesan', 'broadcast', 'blast']],
  ['update', ['ubah', 'mengubah', 'edit', 'mengedit', 'ganti', 'mengganti', 'tambah', 'menambah', 'perbarui', 'memperbarui']],
];
const WRITE_TARGETS = [
  'laporan', 'status', 'akun', 'petugas', 'warga', 'pengumuman', 'tugas', 'penugasan',
  'password', 'kata sandi', 'wa', 'whatsapp', 'pesan', 'profil', 'data',
];

export function detectWriteRequest(t: string): string | null {
  if (hasAny(t, WRITE_INFO_CONTEXT)) return null;
  // Pertanyaan "bagaimana cara â€¦"/"alur â€¦" adalah permintaan PENJELASAN,
  // bukan perintah eksekusi — kecuali untuk penghapusan (tidak ada menu
  // penjelasan khusus; panduan read-only lebih tepat).
  const askingHow = hasAny(t, [
    'cara', 'bagaimana', 'gimana', 'alur', 'proses', 'tahapan', 'langkah',
    'panduan', 'prosedur',
  ]);
  const destructive = hasAny(t, ['hapus', 'menghapus', 'delete']);
  if (askingHow && !destructive) return null;

  // Pertanyaan informasi ("siapa yang baru bikin akun?", "berapa akun yang
  // dibuat hari ini?") BUKAN perintah tulis. Tanpa penjaga ini, kalimat seperti
  // "siapa user terakhir yang bikin akun?" salah dianggap permintaan membuat akun.
  const askingQuestion = hasAny(t, [
    'siapa', 'siapakah', 'berapa', 'kapan', 'adakah', 'apakah', 'mana', 'mana saja',
    'yang mana', 'apa saja',
  ]);
  const explicitImperative = hasAny(t, [
    'tolong', 'mohon', 'coba buat', 'buatkan', 'tambahkan', 'hapuskan', 'segera',
    'bikinin', 'daftarkan', 'reset sekarang', 'kirim sekarang',
  ]);
  if (askingQuestion && !explicitImperative && !destructive) return null;

  for (const [action, verbs] of WRITE_ACTIONS) {
    if (hasAny(t, verbs) && hasAny(t, WRITE_TARGETS)) return action;
  }
  return null;
}

/**
 * Potongan kata kunci untuk pencarian laporan (ADMIN). Hanya dipicu penanda
 * eksplisit ("kata kunci", "keyword", "mengandung") atau "tentang/mengenai"
 * yang bukan kategori/kerusakan yang sudah dikenali.
 */
export function extractKeywordFragment(message: string): string | undefined {
  const explicit = message.match(
    /\b(?:kata kunci|keyword|mengandung kata|berisi kata)\b[\s:=]*["']?([^"'?!]{2,80})/i
  );
  let raw = explicit?.[1];
  if (!raw) {
    const about = message.match(/\b(?:tentang|mengenai)\s+([^?!]{2,80})/i);
    if (about && !detectCategory(message.toLowerCase()) && !detectDamageType(message.toLowerCase())) {
      raw = about[1];
    }
  }
  if (!raw) return undefined;
  const cleaned = raw
    .split(/[?!]/)[0]
    .replace(/\b(yang|dengan|status|bulan|hari|minggu|tahun|tanggal|di|pada|untuk|dari)\b[\s\S]*$/i, '')
    .replace(/["']/g, '')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 60) : undefined;
}

// ============================================================================
// ROUTER ADMIN
// ============================================================================

/** Penanda bahwa pengguna minta SEBARAN per dimensi, bukan daftar per entitas. */
const DISTRIBUTION_HINTS = [
  'paling banyak', 'terbanyak', 'paling tinggi', 'tertinggi', 'sebaran', 'distribusi',
  'tiap kategori', 'masing-masing', 'per kategori', 'per wilayah', 'per status', 'per petugas',
];

function slotsHave(f: ReportFilter, key: keyof ReportFilter): boolean {
  const v = (f as any)[key];
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
}

/**
 * Ambil potongan JUDUL laporan dari kalimat ("laporan berjudul Jalan Berlubang
 * statusnya apa?" â†’ "Jalan Berlubang"). Dipakai sebelum ekstraksi kategori,
 * karena nama jalan pada judul (mis. "Jalan Berlubang") mudah keliru dibaca
 * sebagai kategori "Jalan".
 */
function extractTitledFragment(message: string): string | undefined {
  const m = message.match(
    /\b(?:berjudul|bertajuk|dengan judul|judulnya|judul)\b[\s:="']*([^"'?.,!]{4,80})/i
  );
  if (!m) return undefined;
  const fragment = m[1]
    .replace(/\b(?:statusnya|status|apa|apakah|bagaimana|gimana|sekarang|saat ini)\b[\s\S]*$/i, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  return fragment.length >= 4 ? fragment : undefined;
}

/**
 * Ambil subjek laporan pada pertanyaan analisis, mis.
 * "kenapa laporan pompa rusak masuk kategori sedang?" â†’ "pompa rusak".
 * Dipakai agar Admin dapat bertanya memakai judul, bukan hanya ID.
 */
function extractAnalysisSubject(message: string): string | undefined {
  const afterLaporan = message.match(/\blaporan\s+([^?"'\n]{4,80})/i);
  if (!afterLaporan) return undefined;
  const raw = afterLaporan[1]
    .replace(/\s+(?:masuk|dengan|kategori|urgensi|severity|keparahan|status|itu|tersebut|dianalisis|dapat|mendapat|kenapa|mengapa|apa|apakah)\b[\s\S]*$/i, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  const cleaned = raw.replace(/^(?:yang|itu|tersebut)\s+/i, '').trim();
  return cleaned.length >= 4 ? cleaned : undefined;
}

/**
 * Deteksi intent KONFIRMASI / BATAL penyimpanan pengetahuan (dua fase).
 *
 * - 'confirm' → pengguna menyetujui usulan yang tadi (token ikut disebut).
 * - 'cancel'  → pengguna membatalkan usulan.
 *
 * Sengaja SANGAT spesifik ('konfirmasi', 'ya simpan', 'batalkan usulan'):
 * kata umum seperti 'batal' atau 'ya' tidak boleh menyalakan jalur konfirmasi
 * untuk pesan lain (mis. 'batalkan laporan saya').
 */
export function detectKnowledgeConfirmation(
  message: string
): { kind: 'confirm' | 'cancel'; token?: string } | null {
  const raw = String(message || '');
  const t = raw.toLowerCase().trim();
  if (!t) return null;

  const cancelHints = ['batal', 'batalkan', 'jangan simpan', 'hapus usulan', 'tidak simpan', 'ga jadi simpan'];
  const cancelContext = ['simpan', 'usulan', 'catatan', 'pengetahuan', 'knowledge'];
  const isShortCancel = t.length <= 12;
  if (hasAny(t, cancelHints) && (hasAny(t, cancelContext) || isShortCancel)) {
    return { kind: 'cancel' };
  }

  const confirmHints = [
    'konfirmasi', 'konfirmasi simpan', 'setuju simpan', 'ya simpan', 'iya simpan',
    'simpan saja', 'simpan dong', 'simpan usulan', 'simpan yang tadi',
  ];
  if (hasAny(t, confirmHints)) {
    const tokenMatch = raw.match(/\b([0-9a-f]{16,40})\b/i);
    return tokenMatch ? { kind: 'confirm', token: tokenMatch[1] } : { kind: 'confirm' };
  }
  return null;
}

function resolveAdmin(message: string, t: string, ctx: AiContext): IntentResult {
  const id = extractIdFragment(message);
  const quoted = message.match(/"([^"]{4,80})"/);
  const nth = t.match(/laporan\s*(?:nomor|no\.?|#)\s*(\d{1,5})\b/);
  const slots = buildReportSlots(message, t);
  const dimension = detectDimension(t);
  const reference = detectReference(t);
  const asksCount = hasAny(t, COUNT_HINTS);
  const asksList = hasAny(t, LIST_HINTS);
  const wantsDistribution = hasAny(t, DISTRIBUTION_HINTS);
  // Kata pemicu "sebaran per dimensi". Sengaja BUKAN sekadar kata dimensi:
  // "tampilkan 5 laporan terbaru beserta jenis kerusakannya" meminta DAFTAR
  // laporan (jenis kerusakan tiap baris), bukan distribusi jumlah per jenis.
  const enumeratesDimension = hasAny(t, [
    'apa saja', 'apa sajakah', 'sebutkan', 'rincian', 'rinciannya', 'macam', 'tipe',
    'jenis-jenis', 'sebaran', 'distribusi', 'berdasarkan',
    'per kategori', 'per jenis', 'per wilayah', 'per lokasi', 'per status', 'per petugas',
    'masing-masing', 'daftar kategori', 'daftar jenis', 'daftar wilayah', 'daftar lokasi',
    'berapa saja',
  ]) || wantsDistribution;
  // "laporan ... beserta/disertai X" = minta field pada daftar, bukan distribusi.
  const asksWithFields = hasAny(t, ['beserta', 'disertai', 'lengkap dengan']);

  const audit = (tools: ToolCall[], kind: Kind, dim?: Dimension): IntentResult => ({
    tools,
    context: {
      ...ctx,
      ...slots,
      lastCategory: slots.category ?? ctx.lastCategory,
      lastKind: kind,
      lastDimension: dim,
      lastOfficerName: slots.officerName ?? ctx.lastOfficerName,
      // Hanya niat pendaftaran yang mempertahankan penanda ini; niat lain
      // mereset agar pertanyaan lanjutan tidak nyasar ke data pendaftaran.
      lastRegistration: kind === 'registration',
    },
  });

  // 0) Konfirmasi/batal usulan penyimpanan pengetahuan (dua fase) — dicek
  //    paling awal (setelah helper audit) agar tidak tertangkap pola lain.
  const knowledgeConfirm = detectKnowledgeConfirmation(message);
  if (knowledgeConfirm) {
    if (knowledgeConfirm.kind === 'cancel') {
      return audit([{ name: 'saveAiKnowledge', args: { cancel: true } }], 'explain');
    }
    return audit(
      [{ name: 'saveAiKnowledge', args: { confirmationToken: knowledgeConfirm.token || '' } }],
      'explain'
    );
  }

  // -1) Tindakan mengubah data: asisten hanya membaca. Jawab dengan panduan
  //     halaman resmi, jangan pernah mengklaim perubahan sudah dilakukan.
  const writeAction = detectWriteRequest(t);
  if (writeAction) {
    return audit([{ name: 'refuseWrite', args: { action: writeAction } }], 'none');
  }

  // -0a) SIMPAN INFORMASI KE MEMORI AI — dicek LEBIH DULU agar tidak tertangkap
  //     oleh pola laporan, statistik, atau direktori akun lainnya.
  const saveHintsAdmin = [
    'simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan',
    'tinggalkan catatan', 'simpan ke', 'catat ke', 'simpan ini', 'catat ini',
    'simpan informasi', 'catatkan informasi', 'ingatkan informasi',
    'terima informasi', 'terima keterangan', 'catat keterangan',
  ];
  const saveTargetAdmin = [
    'informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan',
    'kondisi', 'keluhan', 'saran', 'masalah', 'fasilitas', 'kegiatan',
  ];
  const isSaveAdmin = hasAny(t, saveHintsAdmin) && hasAny(t, saveTargetAdmin);
  if (isSaveAdmin) {
    const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
    const content = message;
    return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
  }

  // -0c) PENDAPAT / KELUHAN / PENGALAMAN — TIDAK lagi disimpan otomatis.
  //     Dulu kalimat pendapat langsung menulis entri ke memori AI. Sekarang
  //     pendapat hanya diperlakukan sebagai percakapan biasa; penyimpanan ke
  //     Pusat Pengetahuan harus lewat usulan + konfirmasi eksplisit pengguna.
  //     (Entri yang sudah terlanjur tersimpan TIDAK diubah/dihapus.)
  const opinionHintsAdmin = [
    'menurut saya', 'menurut kami', 'saya pikir', 'saya rasa', 'saya yakin',
    'pendapat saya', 'pendapat kami', 'keluhan saya', 'keluhan kami',
    'masukan saya', 'masukan kami', 'pengalaman saya', 'pengalaman kami',
    'saya mengalami', 'saya lihat', 'saya dengar', 'saya tahu',
    'saya mengeluhkan', 'saya merekomendasikan', 'saya menyarankan',
    'saya mengusulkan',
  ];
  const opinionTargetAdmin = [
    'kinerja', 'petugas', 'petugas desa', 'petugas lapangan', 'fasilitas',
    'kegiatan', 'desa', 'pelayanan', 'masalah', 'keluhan', 'saran', 'masukan',
    'pendapat', 'pengalaman', 'buruk', 'jelek', 'bagus', 'baik', 'ramah',
  ];
  const isOpinionAdmin = hasAny(t, opinionHintsAdmin) && hasAny(t, opinionTargetAdmin);
  if (isOpinionAdmin) {
    // Penyimpanan TIDAK otomatis: pendapat diperlakukan sebagai percakapan
    // biasa. Simpan ke Pusat Pengetahuan harus lewat usulan + konfirmasi.
    return audit([], 'explain');
  }

  // -0d) ANALISIS PENGETAHUAN ADMIN — mencari entri tersimpan dan memberikan
  //     ringkasan berdasarkan kategori, sumber, dan status verifikasi.
  //     Hanya Admin yang dapat mengakses analisis ini.
  const analysisHintsAdmin = [
    'analisis pengetahuan', 'ringkasan pengetahuan', 'entri pengetahuan',
    'apakah ada keluhan tentang', 'keluhan tentang kinerja', 'keluhan tentang petugas',
    'petugas yang sering', 'sering dikeluhkan', 'penilaian buruk',
    'masukan masyarakat', 'masalah yang sering', 'sering dibicarakan',
    'siapa yang sering dikeluhkan', 'berapa keluhan',
  ];
  const analysisTargetAdmin = [
    'kinerja', 'petugas', 'petugas desa', 'petugas lapangan', 'fasilitas',
    'kegiatan', 'desa', 'pelayanan', 'masalah', 'keluhan', 'saran', 'masukan',
    'pendapat', 'pengalaman', 'buruk', 'jelek', 'bagus', 'baik', 'ramah',
  ];
  const isAnalysisAdmin = hasAny(t, analysisHintsAdmin) && hasAny(t, analysisTargetAdmin);
  if (isAnalysisAdmin) {
    // Ekstrak kategori dari pesan jika ada
    let category: string | undefined;
    if (hasAny(t, ['kinerja', 'petugas'])) category = 'KINERJA_PETUGAS';
    else if (hasAny(t, ['keluhan', 'masalah'])) category = 'KELUHAN';
    else if (hasAny(t, ['saran', 'masukan'])) category = 'SARAN';
    else if (hasAny(t, ['fasilitas'])) category = 'FASILITAS';
    else if (hasAny(t, ['kegiatan'])) category = 'KEGIATAN_DESA';
    return audit([{ name: 'analyzeAiKnowledge', args: { category, limit: 20 } }], 'explain');
  }

  // -0f) STATUS KONEKSI/PERANGKAT WhatsApp Fonnte — dicek lebih awal agar
  //     "apakah WhatsApp aktif?" tidak tertukar dengan "laporan aktif".
  const asksWaConnection =
    hasAny(t, ['whatsapp', 'wa', 'fonnte', 'notifikasi wa', 'pesan wa']) &&
    hasAny(t, [
      'status koneksi', 'koneksi', 'terhubung', 'terkoneksi', 'online', 'putus',
      'perangkat', 'device', 'monitoring', 'siap kirim', 'siap mengirim',
      'bisa kirim', 'bisa mengirim', 'token',
    ]);
  const asksWaActive =
    hasAny(t, ['whatsapp', 'fonnte']) &&
    hasAny(t, ['aktif', 'hidup', 'jalan']) &&
    !hasAny(t, ['akun', 'verifikasi', 'nomor saya', 'nomor wa saya', 'registrasi']);
  if (asksWaConnection || asksWaActive) {
    return audit([{ name: 'getWhatsAppMonitoringStatus', args: {} }], 'stats');
  }

  // -0e) ANALISIS FASILITAS UMUM dari data laporan — kelompokkan laporan
  //     berdasarkan jenis fasilitas dan hitung frekuensiya. Hanya Admin yang
  //     dapat meminta ini; dicek lebih dulu agar tidak tertangkap pola laporan
  //     umum atau statistik saja.
  const facilityAnalysisHints = [
    'analisis fasilitas', 'fasilitas umum', 'daftar fasilitas', 'jenis fasilitas',
    'kategori fasilitas', 'perkiraan fasilitas',
  ];
  // Pastikan tidak tertangkap oleh rencana statistik umum - hanya untuk pertanyaan
  // yang spesifik menanyakan "jenis fasilitas apa yang paling sering" atau "frekuensi
  // fasilitas berdasarkan kategori".
  const facilityAnalysisTargets = ['laporan', 'fasilitas', 'jenis', 'kategori', 'frekuensi', 'hitung', 'berapa'];
  if (hasAny(t, facilityAnalysisHints) && hasAny(t, facilityAnalysisTargets)) {
    // Gunakan listReports dengan filter kategori untuk mengelompokkan laporan
    // berdasarkan kategori fasilitas, lalu hitung frekuensi per kategori.
    // Jika ada filter kategori eksplisit, gunakannya; jika tidak, hitung semua
    // kategori yang ada di database.
    const explicitCategory = detectCategory(t);
    const filter: ReportFilter = {};
    if (explicitCategory) {
      filter.category = explicitCategory;
    }
    return audit([{ name: 'listReports', args: { ...filter, limit: 100 } }], 'list');
  }
  // -0c) KELUHAN TENTANG KINERJA PETUGAS — dicek lebih dulu agar tidak tertangkap
  //     pola laporan umum atau statistik. Hanya Admin yang dapat meminta ini;
  //     hasil disimpan ke pengetahuan AI dengan kategori KINERJA_PETUGAS.
  const officerComplaintHints = [
    'keluhan tentang petugas', 'keluhan tentang kinerja', 'petugas buruk',
    'petugas jelek', 'penilaian petugas', 'kinerja petugas',
    'petugas yang buruk', 'petugas tidak bagus', 'pelayanan buruk',
  ];
  const officerComplaintTargets = ['petugas', 'kinerja', 'pelayanan', 'desa', 'masyarakat'];
  if (hasAny(t, officerComplaintHints) && hasAny(t, officerComplaintTargets)) {
    // Cek apakah ada entri pengetahuan sebelumnya tentang petugas yang sama.
    // CATATAN: parameter keyword HARUS `q` (kontrak tool searchAiKnowledge).
    return audit([{ name: 'searchAiKnowledge', args: { q: t, limit: 10, category: 'KINERJA_PETUGAS' } }], 'explain');
  }
  // -0d) INFORMASI PERKATAAN PERCAKAPAN MASYARAKAT — dicek lebih dulu agar tidak
  //     tertangkap pola laporan/statistik. Hanya Admin yang dapat meminta ini;
  //     info disimpan dari percakapan lintas pengguna, bukan dari database laporan.
  const conversationMemoryHints = [
    'informasi penting dari AI', 'catatan percakapan AI', 'yang disimpan AI',
    'riwayat chat AI', 'informasi dari memori AI', 'catatan AI sebelumnya',
    'yang diingat AI', 'sebelum ini AI simpan',
  ];
  const conversationMemoryTargets = ['AI', 'percakapan', 'catatan', 'riwayat', 'disimpan',
    'informasi', 'sebelum ini'];
  if (hasAny(t, conversationMemoryHints) && hasAny(t, conversationMemoryTargets)) {
    // Gunakan searchAiKnowledge untuk mencari entri pengetahuan yang pernah disimpan
    // dari percakapan pengguna, bukan dari database laporan atau akun.
    // CATATAN: parameter keyword HARUS `q` (kontrak tool searchAiKnowledge).
    return audit([{ name: 'searchAiKnowledge', args: { q: t, limit: 10 } }], 'explain');
  }
  // -0b) KEAMANAN AKUN. Dicek SEBELUM direktori akun & profil agar pertanyaan
  //      "apakah akun data warga aman?" TIDAK dijawab dengan daftar akun
  //      (nama/email/telepon). Penilaian memakai kontrol keamanan yang
  //      terverifikasi + agregat, tanpa data pribadi.
  const accountSecurity = detectAccountSecurityQuestion(t);
  const asksOwnAccount = hasAny(t, ['akun saya', 'akunku', 'akun ku', 'akun sendiri']);
  if (accountSecurity) {
    const secRole = asksOwnAccount ? undefined : detectAccountRole(t);
    const args: Record<string, unknown> = {};
    if (secRole) args.role = secRole;
    if (asksOwnAccount) args.scope = 'self';
    return {
      tools: [{ name: 'getAccountSecurityOverview', args }],
      context: {
        ...ctx,
        lastKind: 'stats',
        lastAccountSecurity: true,
        lastAccountRole: secRole ?? ctx.lastAccountRole,
      },
    };
  }
  // Lanjutan penilaian keamanan: "kenapa?", "apa yang harus diperbaiki?".
  if (ctx.lastAccountSecurity && detectFollowUp(t)) {
    const args: Record<string, unknown> = {};
    if (ctx.lastAccountRole) args.role = ctx.lastAccountRole;
    return {
      tools: [{ name: 'getAccountSecurityOverview', args }],
      context: { ...ctx, lastKind: 'stats', lastAccountSecurity: true },
    };
  }

  // Data pribadi milik Admin (profil).
  if (hasAny(t, ['profil saya', 'profilku', 'akun saya', 'data diri', 'data saya', 'siapa saya', 'nama saya'])) {
    return audit([{ name: 'getMyProfile', args: {} }], 'profile' as Kind);
  }

  // 0a) KOREKSI atas jawaban sebelumnya. Pengguna yang mengatakan "bukan itu"
  //     atau "kalau itu kan semua laporan" sedang meminta query LAIN — bukan
  //     pengulangan jawaban lama. Jangan memakai periode dari konteks lama
  //     (mis. "hari ini") kecuali periode itu disebut ulang di pesan koreksi.
  if (detectCorrection(t)) {
    const otherTopic = hasAny(t, [
      'akun', 'pengguna', 'user', 'petugas', 'pengumuman', 'wilayah', 'rt', 'rw',
      'profil desa', 'layanan desa', 'struktur', 'whatsapp',
    ]);
    // Koreksi yang sebenarnya meminta PENJELASAN (bukan data) tidak boleh
    // dipaksa menjadi daftar laporan.
    const explanatory = hasAny(t, [
      'cara', 'bagaimana', 'alur', 'fitur', 'menu', 'halaman', 'laman',
      'prosedur', 'langkah', 'di mana', 'dimana',
    ]);
    if (!otherTopic && !explanatory) {
      // Filter hanya diambil dari pesan koreksi saat ini. Bila tidak ada filter,
      // tampilkan daftar terbaru (bukan statistik dan bukan "hari ini").
      return audit([{ name: 'listReports', args: { ...slots, limit: 10 } }], 'list');
    }
  }

  // 0a) Wilayah (RW/RT) & jumlah warga per RT — KHUSUS Admin. Dicek sebelum
  //     pertanyaan portal desa agar "rt/rw" tidak dijawab sebagai struktur
  //     pemerintahan (perangkat desa). Wilayah bukan role: warga tetap CITIZEN.
  const REGION_HINTS = [
    'wilayah', 'rt/rw', 'rt rw', 'rt dan rw', 'per rt', 'per rw', 'master wilayah',
    'data wilayah', 'jumlah warga per', 'warga per rt', 'sebaran warga', 'jumlah rt', 'jumlah rw',
  ];
  const REGION_OFFICIAL_WORDS = ['ketua', 'kepala', 'perangkat', 'struktur', 'jabatan', 'pejabat', 'pengurus'];
  // Pertanyaan tentang LAPORAN per wilayah/lokasi tetap ke statistik lokasi,
  // bukan ke master data wilayah.
  const REGION_REPORTISH = ['laporan', 'laporannya', 'kerusakan', 'fasilitas', 'dilaporkan', 'paling banyak', 'terbanyak'];
  if (hasAny(t, REGION_HINTS) && !hasAny(t, REGION_OFFICIAL_WORDS) && !hasAny(t, REGION_REPORTISH)) {
    return audit([{ name: 'getRegionOverview', args: {} }], 'stats');
  }

  // -0e) INFO/KELUHAN MASYARAKAT BELUM DIVERIFIKASI — dicek lebih dulu agar tidak
  //     tertangkap pola laporan/akun. Hanya Admin yang dapat meminta ini;
  //     hasil dari searchAiKnowledge dengan filter kategori LAINNYA (belum diverifikasi).
  const unverifiedHints = [
    'belum diverifikasi AI', 'belum verifikasi dalam sistem', 'masih dugaan AI',
    'informasi belum diverifikasi AI', 'status verifikasi AI belum lengkap',
    'keluhan masih dugaan', 'catatan masukan belum terverifikasi',
  ];
  const unverifiedTargets = ['AI', 'sistem', 'masyarakat', 'status', 'verifikasi', 'keluhan'];
  if (hasAny(t, unverifiedHints) && hasAny(t, unverifiedTargets)) {
    // Cari entri pengetahuan dengan kategori LAINNYA (meliputi keluhan, masukan, saran,
    // dan info belum diverifikasi) tanpa status verifikasi yang pasti.
    // CATATAN: parameter keyword HARUS `q` (kontrak tool searchAiKnowledge).
    return audit([{ name: 'searchAiKnowledge', args: { q: t, limit: 10, category: 'LAINNYA' } }], 'explain');
  }
  // -0f) STATISTIK LAPORAN — dicek lebih dulu agar tidak tertangkap pola lain.
  //     Menghitung total laporan, total selesai (COMPLETED), dan total belum selesai.
  //     Hanya Admin yang dapat meminta ini; hasil dari aggregasi database lengkap.
  const statsHints = [
    'ringkasan statistik laporan lengkap', 'total dan rincian laporan', 'overview statistik complete laporan',
    'berapa jumlah seluruh laporan beserta status selesai/blum selesai', 'distribusi status laporan total',
  ];
  const statsTargets = ['laporan', 'selesai', 'belum', 'status', 'ringkasan', 'total'];
  if (hasAny(t, statsHints) && hasAny(t, statsTargets)) {
    // Gunakan getSystemStats untuk menghitung total dan COMPLETED dari seluruh data
    // di database (bukan hanya 10 hasil pertama). Bandingkan total dengan COMPLETED.
    return audit([{ name: 'getSystemStats', args: {} }], 'stats');
  }
  // 0b) Tren laporan SELESAI per bulan ("berapa laporan yang diselesaikan
  //     setiap bulan?"). Dibedakan dari "laporan bulan ini" (yang memakai
  //     periode) melalui kata per-bulan / tren.
  const MONTHLY_HINTS = ['per bulan', 'setiap bulan', 'tiap bulan', 'bulanan', 'perbulan', 'tren', 'trend'];
  const COMPLETED_WORDS = ['selesai', 'diselesaikan', 'penyelesaian', 'terselesaikan', 'dituntaskan'];
  if (hasAny(t, MONTHLY_HINTS) && hasAny(t, COMPLETED_WORDS)) {
    return audit([{ name: 'getMonthlyCompletionTrend', args: { months: 6 } }], 'stats');
  }

  // 0c) Status pengiriman WhatsApp sebuah laporan. Butuh rujukan laporan yang
  //     jelas; bila tidak ada, dibiarkan jatuh ke alur umum (jangan mengarang).
  const WHATSAPP_HINTS = ['whatsapp', 'wa ', 'fonnte', 'pesan wa', 'notifikasi wa'];
  const WHATSAPP_STATUS_WORDS = ['berhasil', 'terkirim', 'gagal', 'sudah dikirim', 'status pengiriman', 'sampai'];
  if (hasAny(t, WHATSAPP_HINTS) && hasAny(t, WHATSAPP_STATUS_WORDS)) {
    const frag = id || ctx.lastReportRef;
    if (frag) {
      return audit([{ name: 'getWhatsAppDeliveryStatus', args: { idFragment: frag } }], 'detail');
    }
  }

  // 0) Pertanyaan Portal Desa (profil/pemerintahan/layanan/pengumuman/lokasi)
  //    dijawab dari data desa di database, didahulukan sebelum logika laporan.
  //    Khusus ADMIN: pertanyaan RINGKASAN/status pengumuman (aktif/terjadwal/draf)
  //    dijawab dari data pengumuman internal (termasuk yang belum terbit), karena
  //    Admin berwenang melihat seluruh status.
  if (
    hasAny(t, ['pengumuman', 'kabar desa', 'berita desa']) &&
    hasAny(t, ['status', 'aktif', 'terjadwal', 'draf', 'draft', 'arsip', 'kedaluwarsa', 'berapa', 'ringkas', 'ringkasan', 'semua', 'internal'])
  ) {
    return audit([{ name: 'getAnnouncementOverview', args: {} }], 'stats');
  }
  // Khusus Admin: "ada pengumuman hari ini?" harus memfilter tanggal terbit
  // hari ini (WIB), bukan sekadar mengambil lima pengumuman terbaru.
  if (
    hasAny(t, ['pengumuman', 'kabar desa', 'berita desa']) &&
    hasAny(t, ['hari ini', 'tadi', 'barusan'])
  ) {
    return audit([{ name: 'getVillageAnnouncements', args: { limit: 10, period: 'today' } }], 'explain');
  }
  const village = detectVillageIntent(t);
  if (village) return audit([village], 'explain');

  // Subjek yang valid untuk tool berbasis rujukan laporan (hindari menangkap
  // kata topik seperti "duplikat"/"analisis"/"hari ini" sebagai judul).
  const validSubject = (v?: string): string | undefined => {
    if (!v) return undefined;
    const s = v.trim();
    if (s.length < 4) return undefined;
    if (/\b(?:duplikat|dobel|ganda|analisis|status|kategori|urgensi|hari ini|minggu ini|bulan ini|kemarin|semua|terbaru)\b/i.test(s)) {
      return undefined;
    }
    return s;
  };

  // 0y) Penjelasan HASIL ANALISIS AI — dicek SEBELUM detail laporan, karena
  //     "kenapa laporan X masuk kategori sedang?" harus dijawab dari hasil
  //     analisis yang TERSIMPAN, bukan dikarang ulang oleh LLM.
  const analysisTopic = hasAny(t, [
    'analisis', 'kategori', 'urgensi', 'severity', 'keparahan', 'klasifikasi',
    'confidence', 'keyakinan', 'tingkat kepercayaan',
  ]);
  const analysisWhy = hasAny(t, [
    'kenapa', 'mengapa', 'alasan', 'jelaskan', 'jelasin', 'dasar', 'pertimbangan', 'kok',
  ]);
  if (analysisTopic && analysisWhy) {
    const target =
      id ||
      validSubject(ctx.lastReportRef) ||
      (quoted ? validSubject(quoted[1]) : undefined) ||
      validSubject(extractTitledFragment(message)) ||
      validSubject(extractAnalysisSubject(message)) ||
      validSubject(slots.title as string | undefined);
    if (target) {
      return audit([{ name: 'explainReportAnalysis', args: { idFragment: target } }], 'explain');
    }
    return audit([{ name: 'getAnalysisStatusRecap', args: {} }], 'stats');
  }

  // 0z) Rekap status ANALISIS AI (terpisah dari status operasional).
  if (
    hasAny(t, [
      'status analisis', 'rekap analisis', 'belum dianalisis', 'gagal dianalisis',
      'perlu ditinjau', 'menunggu analisis', 'analisis ai',
    ])
  ) {
    return audit([{ name: 'getAnalysisStatusRecap', args: {} }], 'stats');
  }

  // 0x) Kandidat duplikat untuk SATU laporan (bila subjeknya jelas).
  if (hasAny(t, ['duplikat', 'dobel', 'ganda', 'kejadian yang sama', 'laporan sama'])) {
    const target =
      id ||
      (quoted ? validSubject(quoted[1]) : undefined) ||
      validSubject(extractTitledFragment(message)) ||
      validSubject(extractAnalysisSubject(message)) ||
      validSubject(ctx.lastReportRef);
    if (target) {
      return audit([{ name: 'findReportDuplicateCandidates', args: { idFragment: target } }], 'explain');
    }
  }

  // 1) Rujukan eksplisit ke satu laporan.
  if (id) return audit([{ name: 'getReportFullDetail', args: { idFragment: id } }], 'detail');
  if (nth) return audit([{ name: 'getNthReport', args: { n: parseInt(nth[1], 10) } }], 'detail');
  if (quoted) return audit([{ name: 'searchReportsByTitle', args: { fragment: quoted[1] } }], 'detail');

  // 1b) Lanjutan tentang PETUGAS penanggung jawab laporan yang sedang dibahas
  //     ("Siapa petugas yang pegang laporan itu?") â†’ detail laporan terakhir,
  //     yang memuat petugas yang ditugaskan. Tidak menebak bila tak ada konteks.
  if (
    reference &&
    ctx.lastReportRef &&
    hasAny(t, ['petugas', 'pegang', 'memegang', 'menangani', 'ditugaskan', 'penanggung jawab'])
  ) {
    return audit([{ name: 'getReportFullDetail', args: { idFragment: ctx.lastReportRef } }], 'detail');
  }
  // Judul eksplisit tanpa tanda kutip: "laporan berjudul Jalan Berlubang statusnya apa?"
  // Harus diperiksa SEBELUM ekstraksi kategori, karena "Jalan Berlubang" bisa keliru
  // ditangkap sebagai kategori "Jalan".
  const titledFragment = extractTitledFragment(message);
  if (titledFragment) {
    return audit([{ name: 'searchReportsByTitle', args: { fragment: titledFragment, limit: 5 } }], 'detail');
  }

  // Pencarian kata kunci bebas: "cari laporan dengan kata kunci lampu".
  // Ditempatkan sebelum ekstraksi kategori agar kata kunci tidak dipotong
  // menjadi filter kategori yang lebih sempit dari maksud pengguna.
  const keyword = extractKeywordFragment(message);
  if (keyword) {
    return audit([{
      name: 'searchReportsByKeyword',
      args: {
        keyword,
        ...(slots.period ? { period: slots.period } : {}),
        ...(slots.dateFrom ? { dateFrom: slots.dateFrom, dateTo: slots.dateTo } : {}),
      },
    }], 'list');
  }

  // 1c) Lanjutan tentang AKUN ("kok nol nonaktif?", "kalau yang aktif berapa?").
  //     Tanpa aturan ini, pertanyaan lanjutan setelah ringkasan warga jatuh ke
  //     klarifikasi generik atau malah ke daftar laporan.
  {
    const accountFollowUp =
      (detectFollowUp(t) || detectCorrection(t)) &&
      hasAny(t, [
        'akun', 'warga', 'masyarakat', 'pengguna', 'user', 'petugas', 'admin',
        'nonaktif', 'non aktif', 'tidak aktif', 'aktif', 'terverifikasi', 'verifikasi',
      ]);
    const hasAccountContext =
      ctx.lastAccountSecurity === true ||
      ctx.lastAccountRole !== undefined ||
      ctx.lastAccountActive !== undefined ||
      ctx.lastAccountQuery !== undefined;
    if (accountFollowUp && hasAccountContext && !ctx.lastAccountSecurity) {
      const followRole = detectAccountRole(t) ?? ctx.lastAccountRole;
      const followActive = detectAccountActive(t);
      const followVerified = detectAccountVerified(t);
      const followQuery = detectAccountQuery(message) ?? (reference ? ctx.lastAccountQuery : undefined);
      const filter: AccountFilter = {};
      if (followRole) filter.role = followRole;
      if (followActive !== undefined) filter.isActive = followActive;
      if (followVerified !== undefined) filter.verified = followVerified;
      if (followQuery) filter.q = followQuery;
      const nextCtx: AiContext = {
        ...ctx,
        lastAccountRole: followRole,
        lastAccountActive: followActive !== undefined ? followActive : ctx.lastAccountActive,
        lastAccountQuery: followQuery ?? ctx.lastAccountQuery,
      };
      // "kok nol nonaktif?" = pertanyaan ANGKA â†’ hitung, jangan daftar panjang.
      const wantsNumber = asksCount || hasAny(t, ['nol', 'kosong']);
      if (wantsNumber && !asksList) {
        return { tools: [{ name: 'countAccounts', args: { ...filter } }], context: { ...nextCtx, lastKind: 'stats' } };
      }
      if (asksList || followActive !== undefined || followVerified !== undefined || followQuery) {
        return {
          tools: [{ name: 'searchAccounts', args: { ...filter, limit: 10 } }],
          context: { ...nextCtx, lastKind: 'list' },
        };
      }
      return { tools: [{ name: 'countAccounts', args: { ...filter } }], context: { ...nextCtx, lastKind: 'stats' } };
    }
  }

  // Pertanyaan lanjutan murni ("kenapa?", "terus?", "petugasnya siapa?") →
  // buka kembali data yang sedang dibahas. Data tetap dibaca ulang dari
  // database, bukan dari riwayat.
  if (detectFollowUp(t)) {
    const target = followUpTarget(t, ctx);
    if (target.clarification) {
      return audit([{ name: 'askClarification', args: { message: target.clarification } }], 'none');
    }
    if (target.id) {
      return audit([{ name: 'getReportFullDetail', args: { idFragment: target.id } }], 'detail');
    }
    if (ctx.lastReportTitle) {
      return audit([{ name: 'searchReportsByTitle', args: { fragment: ctx.lastReportTitle, limit: 5 } }], 'detail');
    }
    if (ctx.lastCategory) {
      return audit([{ name: 'listReports', args: { category: ctx.lastCategory, limit: 8 } }], 'list');
    }
    if (ctx.lastDimension) {
      const dimFilter: DimensionStatsFilter = { period: ctx.lastPeriod };
      const map: Record<Dimension, ToolCall> = {
        category: { name: 'getStatsByCategory', args: { ...dimFilter, limit: 10 } },
        damageType: { name: 'getDamageTypeStats', args: { ...dimFilter, limit: 8 } },
        severity: { name: 'getStatsBySeverity', args: { ...dimFilter, limit: 10 } },
        location: { name: 'getStatsByLocation', args: { ...dimFilter, limit: 8 } },
        status: { name: 'getWebsiteInfo', args: { topic: 'statuses' } },
        officer: { name: 'getOfficerStats', args: {} },
      };
      return audit([map[ctx.lastDimension]], 'breakdown', ctx.lastDimension);
    }
    // "Bulannya?" setelah pertanyaan periode → daftar pada periode yang sama.
    if (ctx.lastPeriod) {
      return audit([{ name: 'listReports', args: { period: ctx.lastPeriod, limit: 5 } }], 'list');
    }
  }

  if (ctx.lastReportTitle && reference && !asksList && !asksCount) {
    return audit([{ name: 'searchReportsByTitle', args: { fragment: ctx.lastReportTitle } }], 'detail');
  }

  // 2) Lanjutan memakai kata ganti â†’ pakai konteks percakapan, jangan mengarang.
  if (reference && slotsEmpty(slots) && !dimension) {
    if (ctx.lastReportRef) {
      return audit([{ name: 'getReportFullDetail', args: { idFragment: ctx.lastReportRef } }], 'detail');
    }
    if (ctx.lastPeriod === 'today' && hasAny(t, ['siapa', 'nama'])) {
      return audit([{ name: 'getTodayReporters', args: {} }], 'reporters');
    }
    if (ctx.lastCategory) {
      return audit([{ name: 'listReports', args: { category: ctx.lastCategory, limit: 5 } }], 'list');
    }
    // "tampilkan detailnya" setelah pertanyaan jumlah per status harus
    // menampilkan laporan dengan status yang sedang dibahas, bukan seluruh
    // laporan desa.
    if (ctx.lastStatus?.length) {
      return audit([{ name: 'listReports', args: { status: ctx.lastStatus, limit: 10 } }], 'list');
    }
    if (ctx.lastPeriod) {
      return audit([{ name: 'listReports', args: { period: ctx.lastPeriod, limit: 5 } }], 'list');
    }
    if (ctx.lastReporterName) {
      return audit([
        { name: 'findReportersByName', args: { name: ctx.lastReporterName } },
        { name: 'listReports', args: { reporterName: ctx.lastReporterName, limit: 8 } },
      ], 'list');
    }
    // Lanjutan tentang PETUGAS yang baru dibahas ("berapa tugas mereka?").
    if (
      hasAny(t, ['tugas', 'penugasan', 'beban', 'dikerjakan', 'ditangani']) &&
      (ctx.lastAccountRole === 'OFFICER' || (ctx.lastOfficerNames && ctx.lastOfficerNames.length > 0))
    ) {
      return audit([{
        name: 'getOfficerTaskCounts',
        args: { isActive: ctx.lastAccountActive, names: ctx.lastOfficerNames },
      }], 'officers');
    }
    // "Kalau warga itu punya laporan, tampilkan laporannya."
    if (ctx.lastAccountQuery && hasAny(t, ['laporan', 'laporannya'])) {
      return audit([
        { name: 'findReportersByName', args: { name: ctx.lastAccountQuery } },
        { name: 'listReports', args: { reporterName: ctx.lastAccountQuery, limit: 8 } },
      ], 'list');
    }
    // Ulangi daftar AKUN yang baru dibahas ("tadi yang kamu sebut siapa saja?").
    if (
      !hasAny(t, ['laporan', 'tugas', 'penugasan']) &&
      (ctx.lastAccountRole || ctx.lastAccountActive !== undefined || ctx.lastAccountQuery) &&
      hasAny(t, ['siapa', 'nama', 'sebut', 'daftar', 'tampilkan', 'tadi', 'mereka', 'siapa saja'])
    ) {
      const filter: AccountFilter = {};
      if (ctx.lastAccountRole) filter.role = ctx.lastAccountRole;
      if (ctx.lastAccountActive !== undefined) filter.isActive = ctx.lastAccountActive;
      if (ctx.lastAccountQuery) filter.q = ctx.lastAccountQuery;
      return audit([{ name: 'searchAccounts', args: { ...filter, limit: 10 } }], 'list');
    }
  }

  // 3) Penjelasan fitur/alur (tidak memerlukan database). Diperiksa SEBELUM
  //    sebaran dimensi agar "fitur apa saja untuk petugas" tidak dianggap
  //    permintaan statistik petugas.
  // 3) Penjelasan fitur pengelolaan akun (tambah petugas, detail akun, reset
  //    kata sandi, aktif/nonaktif) — khusus Admin, dijawab dari pengetahuan fitur.
  //    PENTING: "buat akun" juga muncul pada pertanyaan DATA seperti "siapa user
  //    terakhir yang bikin akun?" — itu bukan panduan, jadi dicek lebih dulu.
  const registrationExplainHints = [
    'cara', 'bagaimana', 'gimana', 'alur', 'tahapan', 'langkah', 'panduan',
    'prosedur', 'bisa', 'boleh',
  ];
  const registrationAsk =
    detectRegistrationSignal(t) &&
    !hasAny(t, registrationExplainHints) &&
    (hasAny(t, [
      'siapa', 'berapa', 'tadi', 'barusan', 'terbaru', 'terakhir', 'kemarin',
      'hari ini', 'minggu ini', 'bulan ini', 'tampilkan', 'cek',
    ]) ||
      !hasAny(t, ACCOUNT_ADMIN_EXPLAIN_HINTS));

  if (hasAny(t, ACCOUNT_ADMIN_EXPLAIN_HINTS) && !registrationAsk) {
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'adminAccounts' } }], 'explain');
  }

  // 3a) KEMAMPUAN ASISTEN / FITUR SESUAI ROLE. Pertanyaan seperti "apa yang
  //     bisa Anda lakukan?" atau "apa saja yang bisa saya lakukan di website
  //     ini?" BUKAN permintaan daftar laporan. Dijawab dari registry fitur
  //     yang memang boleh diakses role tersebut.
  const capabilityHints = [
    'apa yang bisa anda lakukan', 'apa yang bisa kamu lakukan', 'apa yang bisa kau lakukan',
    'apa yang bisa saya lakukan', 'apa saja yang bisa saya lakukan',
    'anda bisa apa', 'kamu bisa apa', 'bisa membantu apa', 'bisa bantu apa',
    'kemampuan anda', 'kemampuanmu', 'kemampuan kamu', 'apa kemampuan',
    'fitur apa saja', 'fitur apa', 'bisa apa saja', 'apa saja fiturnya',
    'cara pakai website', 'cara menggunakan website',
  ];
  if (hasAny(t, capabilityHints)) {
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'features' } }], 'explain');
  }

  // 3b) DAFTAR LAPORAN TERBARU. Frasa "laporan terbaru" tidak memuat kata
  //     perintah seperti "tampilkan", sehingga sebelumnya jatuh ke statistik
  //     keseluruhan. Di sini niatnya jelas: daftar laporan terbaru (5–10),
  //     diurutkan dari createdAt terbaru oleh tool listReports.
  const recentListHints = ['terbaru', 'terakhir', 'paling baru', 'paling anyar', 'baru masuk', 'recent'];
  const recentReportAsk =
    hasAny(t, recentListHints) &&
    hasAny(t, ['laporan', 'laporannya']) &&
    !hasAny(t, [
      'pengumuman', 'akun', 'pengguna', 'user', 'registrasi', 'pendaftaran',
      'petugas', 'tugas', 'pelapor', 'siapa yang melapor',
      'di mana', 'dimana', 'halaman apa', 'menu apa',
    ]);
  if (recentReportAsk && !asksCount) {
    return audit([{ name: 'listReports', args: { ...slots, limit: 10 } }], 'list');
  }

  const wantsExplain = hasAny(t, EXPLAIN_HINTS) && !id;
  if (wantsExplain) {
    const workflowWord = hasAny(t, [
      'alur', 'proses', 'tahapan', 'langkah', 'cara kerja',
      'verifikasi', 'memverifikasi', 'diverifikasi', 'menugaskan', 'penugasan', 'menangani',
    ]);
    const topic = workflowWord
      ? 'workflow'
      : hasAny(t, ['status'])
        ? 'statuses'
        : hasAny(t, ['menu'])
          ? 'menus'
          : 'features';
    return audit([{ name: 'getWebsiteInfo', args: { topic } }], 'explain');
  }

  // 4) Sebaran per dimensi (jenis kerusakan apa saja, wilayah terbanyak, dll).
  //    TIDAK berlaku bila pengguna menyebut nilai filter spesifik (mis.
  //    "berapa laporan severity tinggi") — itu lebih tepat dijawab dengan hitungan filter.
  // Rekap tugas PER PETUGAS harus memakai data penugasan, bukan breakdown
  // dimensi laporan. Dicek sebelum cabang distribusi agar "masing-masing"
  // tidak membelokkan pertanyaan petugas menjadi statistik laporan.
  if (
    hasAny(t, ['petugas', 'officer']) &&
    hasAny(t, ['tugas', 'penugasan']) &&
    hasAny(t, [
      'masing-masing', 'tiap petugas', 'per petugas', 'jumlah tugas',
      'banyak tugas', 'berapa tugas', 'total tugas',
    ]) &&
    !hasAny(t, ['paling banyak', 'terbanyak', 'laporan', 'pengumuman', 'akun'])
  ) {
    const earlyArgs: Record<string, unknown> = { limit: 10, assignment: 'all' };
    const earlyOfficerName = extractOfficerName(t);
    if (earlyOfficerName) earlyArgs.names = [earlyOfficerName];
    if (hasAny(t, [
      'petugas nonaktif', 'petugas yang nonaktif', 'petugas dinonaktifkan',
      'petugas tidak aktif', 'petugas yang tidak aktif', 'petugas tdk aktif',
    ])) {
      earlyArgs.isActive = false;
    } else if (hasAny(t, ['petugas aktif', 'petugas yang aktif', 'petugas masih aktif'])) {
      earlyArgs.isActive = true;
    }
    const earlyUnfinished = hasAny(t, [
      'belum selesai', 'belum tuntas', 'belum beres', 'belum kelar', 'belum menyelesaikan',
    ]);
    if (!earlyUnfinished && hasAny(t, ['belum', 'tidak punya', 'tidak memiliki', 'tidak ada', 'tanpa'])) {
      earlyArgs.assignment = 'without_active';
    } else if (hasAny(t, ['sudah punya', 'sudah memiliki', 'dengan tugas', 'ada tugas'])) {
      earlyArgs.assignment = 'with_active';
    }
    return audit([{ name: 'getOfficerTaskCounts', args: earlyArgs }], 'officers');
  }

  if (dimension) {
    const filterForDimension: Partial<Record<Dimension, keyof ReportFilter>> = {
      category: 'category', damageType: 'damageType', severity: 'severity', location: 'location',
      status: 'status', officer: 'category',
    };
    const dimensionFilterKey = filterForDimension[dimension];
    const dimensionFilterPresent =
      dimension === 'officer' ? false : dimensionFilterKey ? slotsHave(slots, dimensionFilterKey) : false;
    const shouldBreakdown =
      wantsDistribution ||
      (enumeratesDimension && !asksWithFields && !(asksCount && dimensionFilterPresent));
    if (shouldBreakdown) {
      // Periode & filter lain diteruskan ke statistik dimensi agar pertanyaan
      // seperti "jenis kerusakan apa saja HARI INI" tidak dijawab dengan data
      // sepanjang waktu.
      const dimFilter: DimensionStatsFilter = {
        period: slots.period,
        statusNotFinal: slots.statusNotFinal,
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
      };
      if (dimension !== 'category' && slots.category) dimFilter.category = slots.category;
      if (dimension !== 'severity' && slots.severity) dimFilter.severity = slots.severity;
      const map: Record<Dimension, ToolCall> = {
        category: { name: 'getStatsByCategory', args: { ...dimFilter, limit: 10 } },
        damageType: { name: 'getDamageTypeStats', args: { ...dimFilter, limit: 8 } },
        severity: { name: 'getStatsBySeverity', args: { ...dimFilter, limit: 10 } },
        location: { name: 'getStatsByLocation', args: { ...dimFilter, limit: 8 } },
        status: { name: 'getWebsiteInfo', args: { topic: 'statuses' } },
        officer: { name: 'getOfficerStats', args: {} },
      };
      return audit([map[dimension]], 'breakdown', dimension);
    }
  }

  // 4b) PENDAFTARAN AKUN (Admin) — "siapa yang baru regis hari ini?".
  //     Dicek SEBELUM direktori akun, antrean laporan, dan statistik agar
  //     pertanyaan pendaftaran tidak dijawab dengan jumlah laporan.
  {
    const registrationFollowUp =
      !!ctx.lastRegistration &&
      (!!detectDateRange(t) || !!detectPeriod(t) || detectAccountVerified(t) !== undefined);
    // `registrationAsk` sudah mengecualikan panduan ("cara registrasi petugas").
    const registrationSignal = registrationAsk || registrationFollowUp;

    if (registrationSignal) {
      const dateRange = detectDateRange(t);
      // "tadi"/"barusan" pada pertanyaan pendaftaran berarti hari ini (WIB).
      const period =
        detectPeriod(t) ?? (hasAny(t, ['tadi', 'barusan']) ? 'today' : undefined);
      const verified = detectAccountVerified(t);
      const role = detectAccountRole(t) ?? 'CITIZEN';
      const args: Record<string, unknown> = { limit: 10 };
      if (dateRange) {
        // Rentang eksplisit ("kemarin", "1-15 Agustus", "dari kemarin sampai sekarang").
        args.dateFrom = dateRange.from;
        args.dateTo = dateRange.to;
      } else if (period) {
        args.period = period;
      }
      if (verified !== undefined) args.verified = verified;
      if (role !== 'CITIZEN') args.role = role;
      return audit([{ name: 'getRecentRegistrations', args }], 'registration');
    }
  }

  // 4c) DIREKTORI & PENUGASAN PETUGAS (Admin). Diletakkan SEBELUM direktori
  //     akun dan sebelum fallback laporan. Tanpa aturan ini, "Siapa saja
  //     petugas di sini?" jatuh ke listReports karena kata "siapa saja", dan
  //     "Apakah semua sudah ada tugas?" jatuh ke daftar laporan terbaru.
  {
    const officerWord = hasAny(t, ['petugas', 'officer', 'petugas desa', 'petugas lapangan']);
    const accountish = hasAny(t, [
      'akun', 'pengguna', 'user', 'terdaftar', 'registrasi', 'pendaftaran',
      'kata sandi', 'password', 'verifikasi', 'whatsapp',
    ]);
    const otherRoleWord = hasAny(t, ['warga', 'masyarakat', 'admin', 'administrator']);
    const officerFocus = officerWord && !accountish && !otherRoleWord;
    const reportTopic = hasAny(t, [
      'laporan', 'bukti penyelesaian', 'verifikasi hasil', 'menunggu review',
    ]);
    const contextOfficer = ctx.lastOfficerFocus === true || ctx.lastAccountRole === 'OFFICER';
    const assignmentWords = hasAny(t, [
      'tugas', 'penugasan', 'ditugaskan', 'ditangani', 'dikerjakan', 'menangani', 'memegang',
    ]);
    const rankingAsk = hasAny(t, ['paling banyak', 'terbanyak', 'kinerja', 'tugas paling']);
    const asksAllOfficers = hasAny(t, ['semua', 'seluruh']);
    // "Belum selesai" berarti tugas MASIH aktif, bukan petugas tanpa tugas.
    const unfinishedQualifier = hasAny(t, [
      'belum selesai', 'belum tuntas', 'belum beres', 'belum kelar', 'belum menyelesaikan',
    ]);
    const asksWithout = !unfinishedQualifier && hasAny(t, [
      'belum', 'tidak punya', 'tidak memiliki', 'tidak ada', 'tanpa', 'kosong',
      'gak punya', 'ga punya', 'gak ada', 'ga ada', 'nggak ada',
    ]);
    const asksWith = hasAny(t, [
      'sudah', 'punya', 'memiliki', 'dapat', 'mendapat', 'dengan tugas', 'ada tugas',
    ]);
    const wantsPerOfficer = hasAny(t, [
      'masing-masing', 'tiap petugas', 'per petugas', 'rekap tugas', 'jumlah tugas',
      'banyak tugas',
    ]);
    // Pertanyaan yang subjeknya JELAS laporan (mis. "Laporan apa yang sedang
    // ditangani petugas?") tidak boleh dibajak menjadi rekap petugas.
    const reportQueueAsk =
      reportTopic &&
      hasAny(t, [
        'laporan apa', 'laporan yang', 'daftar laporan', 'berapa laporan',
        'tampilkan laporan', 'sedang ditangani', 'sedang dikerjakan',
        'bukti penyelesaian', 'verifikasi hasil', 'menunggu review',
      ]);
    // "Tugas AKTIF" bukan berarti "petugas aktif". Filter status akun hanya
    // dipakai bila pertanyaannya memang tentang status akun petugas.
    const mentionsBothStatuses = hasAny(t, ['aktif']) && hasAny(t, ['nonaktif', 'non aktif']);
    const officerActive = mentionsBothStatuses
      ? undefined
      : hasAny(t, [
          'petugas nonaktif', 'petugas yang nonaktif', 'petugas dinonaktifkan',
          'petugas tidak aktif', 'petugas yang tidak aktif', 'petugas tdk aktif',
          'akun petugas nonaktif', 'akun petugas tidak aktif',
        ])
        ? false
        : hasAny(t, [
            'petugas aktif', 'petugas yang aktif', 'petugas masih aktif',
            'akun petugas aktif',
          ])
          ? true
          : undefined;

    // Nama petugas spesifik. Kata umum BUKAN nama (mencegah "petugas minggu
    // ini" atau "petugas aktif" dianggap nama orang).
    const officerName = extractOfficerName(t);
    if (
      officerName &&
      !rankingAsk &&
      !hasAny(t, ['berapa', 'jumlah', 'statistik', 'mana yang'])
    ) {
      return audit([{ name: 'getOfficerDetail', args: { name: officerName } }], 'officerDetail');
    }

    if (rankingAsk && officerWord) {
      return audit([{ name: 'getOfficerStats', args: {} }], 'officers');
    }

    const assignmentQuestion =
      assignmentWords &&
      !reportQueueAsk &&
      (officerFocus ||
        (contextOfficer && !reportTopic) ||
        (!reportTopic && asksAllOfficers));

    if (assignmentQuestion) {
      const args: Record<string, unknown> = { limit: 10 };
      if (officerName) args.names = [officerName];
      if (officerActive !== undefined) args.isActive = officerActive;
      if (asksWithout && !asksAllOfficers) {
        return audit([{ name: 'getOfficerTaskCounts', args: { ...args, assignment: 'without_active' } }], 'officers');
      }
      if (asksWith && !asksAllOfficers && !wantsPerOfficer) {
        return audit([{ name: 'getOfficerTaskCounts', args: { ...args, assignment: 'with_active' } }], 'officers');
      }
      return audit([{ name: 'getOfficerTaskCounts', args: { ...args, assignment: 'all' } }], 'officers');
    }

    // "Siapa yang belum?" / "Siapa yang sudah?" sebagai lanjutan dari daftar
    // atau pemeriksaan penugasan petugas.
    if (contextOfficer && !reportTopic && !reportQueueAsk && (asksWithout || asksWith)) {
      const args: Record<string, unknown> = { limit: 10 };
      if (officerActive !== undefined) args.isActive = officerActive;
      return audit([{
        name: 'getOfficerTaskCounts',
        args: { ...args, assignment: asksWithout ? 'without_active' : 'with_active' },
      }], 'officers');
    }

    if (officerFocus && !reportQueueAsk) {
      const args: Record<string, unknown> = { limit: 10 };
      if (officerActive !== undefined) args.isActive = officerActive;
      return audit([{ name: 'getOfficerWorkload', args }], 'officers');
    }

    // Pertanyaan penugasan/follow-up tanpa subjek yang jelas ("Apakah semua
    // sudah ada tugas?", "Siapa yang belum?") tidak boleh ditebak sebagai
    // daftar laporan. Minta klarifikasi.
    if (
      !reportTopic &&
      !contextOfficer &&
      ((assignmentWords && hasAny(t, ['semua', 'sudah', 'belum', 'siapa', 'tugas'])) ||
        (hasAny(t, ['siapa yang belum', 'siapa yang sudah']) &&
          !hasAny(t, ['daftar', 'registrasi', 'akun', 'verifikasi', 'whatsapp'])))
    ) {
      return audit([{
        name: 'askClarification',
        args: {
          message:
            'Admin, saya ingin memastikan dulu agar tidak salah data: yang dimaksud tugas para petugas, atau laporan yang belum ditugaskan ke petugas?',
        },
      }], 'none');
    }
  }

  // 4c-follow-up) Lanjutan direktori akun: "yang nonaktif?", "berapa
  // jumlahnya?", "tampilkan lagi". Tanpa aturan ini, pertanyaan lanjutan
  // setelah daftar warga jatuh ke daftar laporan atau penolakan tulis.
  const accountFollowUp =
    !!ctx.lastAccountRole &&
    !id &&
    !slots.reporterName &&
    !slots.category &&
    !hasAny(t, ['laporan', 'tugas', 'penugasan', 'pelapor']) &&
    (detectAccountActive(t) !== undefined ||
      detectAccountVerified(t) !== undefined ||
      hasAny(t, [
        'berapa jumlahnya', 'jumlahnya', 'totalnya', 'berapa banyaknya',
        'tampilkan lagi', 'yang lain', 'selanjutnya', 'berikutnya', 'lagi', 'lanjut',
        'siapa saja', 'daftar',
      ]));
  if (accountFollowUp) {
    const filter: AccountFilter = { role: ctx.lastAccountRole };
    const active = detectAccountActive(t);
    const verified = detectAccountVerified(t);
    if (active !== undefined) filter.isActive = active;
    else if (ctx.lastAccountActive !== undefined) filter.isActive = ctx.lastAccountActive;
    if (verified !== undefined) filter.verified = verified;
    if (ctx.lastAccountQuery) filter.q = ctx.lastAccountQuery;
    const wantsCount =
      hasAny(t, ['berapa', 'jumlah', 'total']) &&
      !hasAny(t, ['daftar', 'tampilkan', 'siapa saja', 'lihat', 'melihat']);
    if (wantsCount) {
      return {
        tools: [{ name: 'countAccounts', args: { ...filter } }],
        context: {
          ...ctx,
          lastKind: 'stats',
          lastAccountRole: filter.role,
          lastAccountActive: filter.isActive,
        },
      };
    }
    return {
      tools: [{ name: 'searchAccounts', args: { ...filter, limit: 10 } }],
      context: {
        ...ctx,
        lastKind: 'list',
        lastAccountRole: filter.role,
        lastAccountActive: filter.isActive,
      },
    };
  }

  // 4d) DIREKTORI AKUN (Admin): cari/hitung warga & petugas dengan filter role,
  //     status aktif/nonaktif, kata kunci nama/email/telepon, dan tanggal daftar.
  //     Tanpa aturan ini, "siapa warga yang akunnya dinonaktifkan?" atau
  //     "berapa akun petugas aktif?" jatuh ke statistik umum â†’ AI menjawab
  //     "data tidak tersedia" padahal datanya ada di database.
  const ACCOUNT_REPORTISH = [
    'laporan', 'tugas', 'penugasan', 'kinerja', 'beban', 'melapor', 'pelapor',
    'mendaftar', 'mengerjakan', 'ditangani', 'menangani', 'ditugaskan', 'memproses',
  ];
  const ACCOUNT_DIR_HINTS = [
    'akun', 'akun warga', 'akun petugas', 'akun pengguna', 'pengguna', 'user', 'terdaftar',
    // Frasa daftar warga. Jangan memakai kata tunggal "warga"/"siapa saja" karena
    // akan menyerobot "siapa saja petugas desa?" yang memang milik tool petugas.
    'daftar warga', 'siapa saja warga', 'semua warga', 'data warga', 'nama warga',
    'tampilkan warga', 'lihat warga', 'melihat warga', 'jumlah warga', 'berapa warga',
    'warga terdaftar', 'warga yang terdaftar', 'warga di sini', 'warga di desa',
    'masyarakat terdaftar', 'daftar masyarakat', 'data masyarakat', 'akun masyarakat',
    'pengguna terdaftar', 'pengguna yang sudah mendaftar', 'pengguna yang terdaftar',
  ];
  const acctRole = detectAccountRole(t);
  const acctActive = detectAccountActive(t);
  const acctVerified = detectAccountVerified(t);
  const acctQuery = detectAccountQuery(message) ?? (reference ? ctx.lastAccountQuery : undefined);
  const accountWord = hasAny(t, ['akun', 'warga', 'masyarakat', 'petugas', 'pengguna', 'user', 'citizen', 'officer']);
  // Email/nomor telepon hanya diambil bila pengguna MEMINTANYA secara eksplisit.
  // Tanpa ini, setiap daftar akun otomatis mengirim data pribadi ke model.
  const wantsContact = hasAny(t, [
    'email', 'e-mail', 'surel', 'nomor telepon', 'nomor hp', 'no hp', 'no. hp',
    'telepon', 'kontak', 'whatsapp', 'nomor wa',
  ]);
  const looksAccountQuery =
    accountWord &&
    !hasAny(t, ACCOUNT_REPORTISH) &&
    (acctActive !== undefined ||
      acctVerified !== undefined ||
      hasAny(t, ACCOUNT_DIR_HINTS) ||
      acctQuery !== undefined);
  if (looksAccountQuery) {
    const filter: AccountFilter = {};
    if (acctRole) filter.role = acctRole;
    if (acctActive !== undefined) filter.isActive = acctActive;
    if (acctVerified !== undefined) filter.verified = acctVerified;
    if (acctQuery) filter.q = acctQuery;
    if (wantsContact) filter.contact = true;
    const nextCtx: AiContext = {
      ...ctx,
      ...slots,
      lastAccountRole: acctRole ?? ctx.lastAccountRole,
      lastAccountActive: acctActive !== undefined ? acctActive : ctx.lastAccountActive,
      lastAccountQuery: acctQuery ?? ctx.lastAccountQuery,
      lastAccountSecurity: false,
    };
    if (asksCount && !asksList) {
      return { tools: [{ name: 'countAccounts', args: { ...filter } }], context: { ...nextCtx, lastKind: 'stats' } };
    }
    return { tools: [{ name: 'searchAccounts', args: { ...filter, limit: 10 } }], context: { ...nextCtx, lastKind: 'list' } };
  }

  // 4b) Jumlah akun (petugas/warga/admin) — agregat aman untuk Admin.
  //     Dikecualikan bila pertanyaannya jelas tentang laporan/tugas.
  //
  //     PENTING (perbaikan angka 58 vs 73): dulu SEMUA pertanyaan jumlah di
  //     sini dijawab getUserCounts, yang menghitung SELURUH pengguna. Akibatnya
  //     "berapa jumlah warga?" = 73 (semua role), sedangkan "berapa jumlah akun
  //     warga?" = 58 (CITIZEN saja). Sekarang jumlah per role memakai
  //     countAccounts dengan filter role yang sama seperti searchAccounts,
  //     sehingga kedua cara bertanya menghasilkan angka yang identik.
  if (
    asksCount &&
    hasAny(t, ['petugas', 'warga', 'masyarakat', 'pengguna', 'akun']) &&
    !hasAny(t, [
      'laporan', 'tugas', 'penugasan', 'kinerja', 'beban',
      'melapor', 'pelapor', 'mendaftar', 'pendaftar', 'warga baru', 'akun baru', 'registrasi',
    ])
  ) {
    const countRoles = new Set<AccountRole>();
    if (hasAny(t, ['warga', 'masyarakat'])) countRoles.add('CITIZEN');
    if (hasAny(t, ['petugas', 'pegawai', 'officer'])) countRoles.add('OFFICER');
    if (hasAny(t, ['admin', 'administrator'])) countRoles.add('ADMIN');

    // Satu role â†’ hitung role itu saja (konsisten dengan searchAccounts).
    if (countRoles.size === 1) {
      const only = [...countRoles][0];
      return {
        tools: [{ name: 'countAccounts', args: { role: only } }],
        context: { ...ctx, lastKind: 'stats', lastAccountRole: only },
      };
    }
    // Beberapa role sekaligus ("petugas dan warga") atau pengguna umum â†’
    // rincian per role dari getUserCounts.
    return {
      tools: [{ name: 'getUserCounts', args: {} }],
      context: { ...ctx, lastKind: 'stats' },
    };
  }

  // 4b) Ringkasan pekerjaan/beban petugas (Admin) — mendukung pertanyaan
  //     sehari-hari seperti "Ringkas pekerjaan petugas minggu ini.".
  if (
    hasAny(t, ['ringkas', 'ringkasan', 'rekap', 'rangkum', 'pekerjaan petugas', 'kinerja petugas']) &&
    hasAny(t, ['petugas', 'pegawai', 'staff'])
  ) {
    return audit([{ name: 'getOfficerWorkload', args: {} }], 'officers');
  }

  // 5b) Laporan belum selesai beserta penyebab yang TERCATAT (khusus Admin).
  //     Dibuat lebih kaya dari sekadar daftar status: menyertakan status, umur,
  //     petugas, dan catatan riwayat terakhir — tanpa menebak penyebab.
  //     Bila pengguna menambahkan filter (mis. "severity tinggi yang belum
  //     selesai"), filter itu HARUS dipertahankan — jangan diganti daftar umum.
  if (hasAny(t, ['belum selesai', 'belum tuntas', 'belum beres', 'belum kelar'])) {
    // `statusNotFinal` sendiri BUKAN filter tambahan; pertanyaan umum
    // "ada berapa laporan yang belum selesai?" tetap memakai ringkasan
    // getUnfinishedReports. Filter lain (severity/kategori/periode/â€¦)
    // harus dipertahankan lewat countReports/listReports.
    const hasReportFilter =
      !!slots.category ||
      !!slots.location ||
      !!slots.reporterName ||
      !!slots.title ||
      !!slots.damageType ||
      (slots.severity?.length ?? 0) > 0 ||
      (slots.status?.length ?? 0) > 0 ||
      !!slots.dateFrom ||
      !!slots.dateTo ||
      !!slots.period;
    if (hasReportFilter) {
      return asksCount
        ? audit([{ name: 'countReports', args: { ...slots, statusNotFinal: true } }], 'count')
        : audit([{ name: 'listReports', args: { ...slots, statusNotFinal: true, limit: 10 } }], 'list');
    }
    if (asksCount && !asksList) {
      return audit([{ name: 'countReports', args: { ...slots, statusNotFinal: true } }], 'count');
    }
    return audit([{ name: 'getUnfinishedReports', args: { limit: 8 } }], 'list');
  }

  // 6) Pertanyaan "apa tindak lanjut / apa yang perlu dilakukan" â†’ ringkasan
  //    kondisi sistem + antrean nyata, bukan jawaban kosong.
  if (
    hasAny(t, [
      'tindak lanjut', 'ditindaklanjuti', 'tindaklanjut', 'apa yang perlu',
      'apa yg perlu', 'perlu dilakukan', 'perlu ditangani', 'perlu segera',
      'prioritas utama', 'paling perlu', 'apa selanjutnya', 'langkah selanjutnya',
    ]) &&
    !id
  ) {
    return audit([{ name: 'getSystemOverview', args: {} }], 'stats');
  }

  // 7) Antrean operasional / duplikat.
  for (const [hints, def] of QUEUE_RULES) {
    if (!hasAny(t, hints)) continue;
    const hasExtraFilter = !!slots.category || !!slots.location || !!slots.reporterName || !!slots.title || !!slots.damageType;
    // Pertanyaan jumlah tentang satu status harus menjadi COUNT, bukan daftar
    // panjang. Beberapa antrean memakai filter status yang sama dengan
    // countReports; antrean yang punya kriteria tambahan (mis. belum
    // ditugaskan) tetap memakai tool khususnya agar angkanya tidak melebar.
    const countEquivalent =
      def.tool === 'listReports' ||
      def.tool === 'getUnverifiedQueue' ||
      def.tool === 'getPendingResultVerification';
    if (asksCount && !asksList && countEquivalent) {
      const args: Record<string, unknown> = { ...slots, ...(def.extra || {}) };
      if (!args.status && def.status) args.status = def.status;
      return audit([{ name: 'countReports', args }], 'count');
    }
    if (hasExtraFilter && def.tool === 'listReports') {
      return audit([{ name: 'listReports', args: { ...slots } }], 'list');
    }
    if (hasExtraFilter && def.status) {
      return audit([{ name: 'listReports', args: { ...slots, status: slots.status ?? def.status } }], 'list');
    }
    if (def.tool === 'listReports') {
      return audit([{ name: 'listReports', args: { ...(def.extra || {}), status: def.status } }], 'list');
    }
    if (def.tool === 'getStaleReports') {
      return audit([{ name: 'getStaleReports', args: { days: 7, limit: 8 } }], 'queue');
    }
    return audit([{ name: def.tool, args: { limit: 8 } }], 'queue');
  }

  // 7) Daftar pelapor.
  if (
    hasAny(t, ['siapa saja yang melapor', 'siapa yang melapor', 'siapa saja yang membuat', 'siapa yang membuat', 'daftar pelapor', 'pelapor']) &&
    !slots.reporterName && !slots.category
  ) {
    if (slots.period === 'today') return audit([{ name: 'getTodayReporters', args: {} }], 'reporters');
    return audit([{ name: 'getReporters', args: { limit: 10 } }], 'reporters');
  }
  if (slots.period === 'today' && hasAny(t, ['mendaftar', 'pendaftar', 'warga baru', 'akun baru', 'registrasi'])) {
    return audit([{ name: 'getTodayCitizens', args: { limit: 15 } }], 'reporters');
  }
  if (slots.period === 'today' && hasAny(t, ['masuk', 'baru']) && !asksCount) {
    return audit([{ name: 'getTodayReports', args: { limit: 15 } }], 'list');
  }

  // Subjek LAPORAN, petugas hanya penyebut pelaku: "laporan yang ditangani
  // petugas". Jangan jatuh ke statistik umum; default-nya laporan berjalan,
  // kecuali pengguna menyebut status lain.
  if (
    hasAny(t, ['laporan', 'laporannya']) &&
    hasAny(t, ['ditangani petugas', 'dikerjakan petugas', 'ditangani oleh petugas', 'dikerjakan oleh petugas'])
  ) {
    const status =
      Array.isArray(slots.status) && slots.status.length > 0
        ? slots.status
        : ['IN_PROGRESS'];
    const args = { ...slots, status, limit: 10 };
    if (asksCount && !asksList) {
      return audit([{ name: 'countReports', args }], 'count');
    }
    return audit([{ name: 'listReports', args }], 'list');
  }

  // 8) Pertanyaan operasional lain khas Admin.
  // 7b) Ringkasan pengiriman WhatsApp (agregat, ADMIN) & perbandingan periode.
  if (hasAny(t, ['whatsapp', 'notifikasi wa', 'pesan wa', 'wa gagal', 'wa terkirim', 'pengiriman wa', 'fonnte'])) {
    return audit([{ name: 'getWhatsAppSummary', args: {} }], 'stats');
  }
  if (
    hasAny(t, ['bulan lalu', 'bulan sebelumnya', 'dibanding bulan', 'dibandingkan bulan', 'dari bulan lalu', 'peningkatan', 'penurunan', 'meningkat', 'menurun'])
  ) {
    return audit([{ name: 'compareReportPeriods', args: {} }], 'stats');
  }
  if (hasAny(t, ['rata-rata', 'rata rata', 'berapa lama', 'lama penyelesaian'])) {
    return audit([{ name: 'getAvgResolutionDays', args: {} }], 'stats');
  }
  if (hasAny(t, ['confidence', 'keyakinan ai', 'akurasi ai'])) {
    return audit([{ name: 'getAvgAiConfidence', args: {} }], 'stats');
  }
  if (hasAny(t, ['diagnostik', 'diagnostic', 'cek sistem ai', 'kesehatan ai', 'uji ai', 'tes ai', 'status ai', 'debug ai'])) {
    return audit([{ name: 'runAiDiagnostics', args: {} }], 'stats');
  }
  if (hasAny(t, ['beban kerja', 'beban tugas', 'tanggung jawab'])) {
    return audit([{ name: 'getOfficerWorkload', args: {} }], 'officers');
  }
  if (hasAny(t, ['petugas']) && hasAny(t, ['paling banyak', 'terbanyak', 'kinerja', 'tugas paling'])) {
    return audit([{ name: 'getOfficerStats', args: {} }], 'officers');
  }
  if (hasAny(t, ['siapa petugas', 'daftar petugas', 'nama petugas', 'petugas desa', 'petugasnya siapa'])) {
    // "Siapa petugas yang mengerjakan?" lebih tepat dijawab dengan daftar
    // laporan yang sedang ditugaskan/dikerjakan beserta nama petugasnya.
    if (hasAny(t, ['mengerjakan', 'menangani', 'ditugaskan', 'dikerjakan', 'tugas'])) {
      return audit([{
        name: 'listReports',
        args: { status: ['ASSIGNED', 'IN_PROGRESS'], limit: 10 },
      }], 'list');
    }
    return audit([{ name: 'getOfficerWorkload', args: {} }], 'officers');
  }
  if (hasAny(t, ['siapa admin', 'siapakah admin', 'daftar admin', 'nama admin', 'adminnya'])) {
    return audit([{ name: 'getPublicAdmins', args: {} }], 'stats');
  }
  if (hasAny(t, ['warga', 'masyarakat terdaftar', 'pengguna terdaftar']) && !slots.reporterName) {
    // Simpan konteks AKUN agar lanjutan seperti "kok nol nonaktif?" tetap
    // dipahami sebagai pertanyaan tentang warga, bukan klarifikasi generik.
    return {
      tools: [{ name: 'getCitizenStats', args: {} }],
      context: { ...ctx, lastKind: 'stats', lastAccountRole: 'CITIZEN' },
    };
  }

  // 9) Nama pelapor (mis. "Tampilkan laporan milik Arsa").
  if (slots.reporterName) {
    return audit([
      { name: 'findReportersByName', args: { name: slots.reporterName } },
      { name: 'listReports', args: { ...slots, limit: 8 } },
    ], 'list');
  }

  // 9b) Lanjutan periode yang masih merujuk topik sebelumnya, mis.
  //     "kalau yang kemarin berapa?" setelah pertanyaan laporan ditolak.
  //     Pertahankan status dari konteks agar angkanya tetap menjawab topik
  //     yang sama, bukan berubah menjadi status lain yang kebetulan muncul.
  if (
    asksCount &&
    !asksList &&
    !slots.status &&
    ctx.lastStatus?.length &&
    (slots.period || slots.dateFrom) &&
    hasAny(t, ['kalau', 'kemarin', 'tadi', 'tersebut', 'itu'])
  ) {
    return audit([{ name: 'countReports', args: { ...slots, status: ctx.lastStatus } }], 'count');
  }

  // 10) Umum: hitung vs daftar vs ringkasan.
  //     Rekap/statistik dengan rentang tanggal eksplisit memakai countReports
  //     (menyertakan rincian per status) — bukan getSystemStats yang tidak
  //     mengenal rentang tanggal tersebut.
  if (slots.dateFrom && hasAny(t, ['rekap', 'statistik', 'ringkasan', 'per status', 'distribusi'])) {
    return audit([{ name: 'countReports', args: { ...slots, limit: 10 } }], 'stats');
  }
  if (asksCount) {
    return audit([{ name: 'countReports', args: { ...slots } }], 'count');
  }
  // "Rekap/statistik per status" â†’ countReports (memuat rincian per status).
  if (hasAny(t, ['rekap', 'statistik']) && hasAny(t, ['per status', 'status laporan', 'status'])) {
    return audit([{ name: 'countReports', args: { ...slots, limit: 10 } }], 'stats');
  }
  if (asksList || !slotsEmpty(slots)) {
    return audit([{ name: 'listReports', args: { ...slots, limit: 10 } }], 'list');
  }
  if (hasAny(t, ['laporan', 'sistem', 'kondisi', 'keseluruhan', 'ringkasan', 'statistik', 'dashboard', 'dasbor'])) {
    return audit([{ name: 'getSystemStats', args: {} }], 'stats');
  }
  // Pertanyaan tanpa subjek ("gimana statusnya?", "progresnya gimana?") TIDAK
  // boleh langsung dibalas dump seluruh statistik. Minta satu klarifikasi.
  // Pertanyaan lanjutan yang punya konteks sudah ditangani di atas.
  const bareStatusQuestion =
    /^(?:gimana|bagaimana|terus|statusnya|progresnya|progressnya|gimana\s+statusnya|bagaimana\s+statusnya|itu\s+gimana|maksudnya)\b/.test(t) &&
    slotsEmpty(slots) &&
    !dimension &&
    !id &&
    !reference;
  if (bareStatusQuestion) {
    return audit([{
      name: 'askClarification',
      args: {
        message:
          'Bisa diperjelas, Admin? Status/progres apa yang ingin diperiksa: laporan (sebutkan judul/ID), antrean verifikasi, penugasan petugas, atau statistik desa?',
      },
    }], 'none');
  }
  if (detectFollowUp(t)) {
    return audit([{
      name: 'askClarification',
      args: {
        message:
          'Saya ingin memastikan agar tidak salah data. Bagian mana yang ingin Anda lanjutkan: laporan, petugas/penugasan, akun, pengumuman, atau statistik desa?',
      },
    }], 'none');
  }
  // PUSAT PENGETAHUAN AI — pencarian informasi tersimpan dari percakapan & sumber lain.
  // Dicek sebelum fallback agar pertanyaan "ingat", "pengetahuan", "catatan" diarahkan
  // ke pencarian basis pengetahuan, bukan clarifikasi generik.
  const knowledgeHints = [
    'ingat', 'ingatkan', 'ingat-ingat', 'ingatkan saya', 'ingatkan kami',
    'pengetahuan', 'catatan', 'catatan ai', 'basis pengetahuan', 'pusat pengetahuan',
    'seperti yang dikatakan', 'seperti yang dinyatakan', 'seperti yang disebut',
    'pernah disebut', 'pernah dikatakan', 'belum pernah', 'ada catatan', 'ada catatan ai',
    'simpan informasi', 'simpan catatan', 'ingatkan saya tentang',
    'informasi tersimpan', 'data tersimpan', 'catatan tersimpan',
  ];
  if (hasAny(t, knowledgeHints)) {
    // Deteksi niat SIMPAN ke memori (bukan pencarian).
    const saveHints = ['simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan', 'tinggalkan catatan', 'simpan ke', 'catat ke'];
    const saveTarget = ['informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan', 'kondisi', 'keluhan', 'saran', 'masalah'];
    const isSave = hasAny(t, saveHints) && hasAny(t, saveTarget);
    if (isSave) {
      const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
      const content = message;
      return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
    }
    const q = extractKeywordFragment(message) || '';
    return audit([{ name: 'searchAiKnowledge', args: { q, limit: 10 } }], 'explain');
  }
  return audit([], 'none');
}

// ============================================================================
// ROUTER CITIZEN (hanya data milik sendiri — privasi diberlakukan server-side)
// ============================================================================

const CITIZEN_PRIVATE_PROBES = [
  'siapa saja yang melapor', 'siapa yang melapor', 'daftar pelapor', 'semua pelapor',
  'nama pelapor', 'pelapor hari ini', 'yang melapor hari ini', 'warga mana yang lapor',
  'laporan warga lain', 'laporan orang lain', 'milik warga lain', 'milik orang lain',
  'data warga lain', 'data pribadi', 'nomor hp', 'no hp', 'nomor telepon', 'alamat warga',
  'email warga', 'akun lain', 'laporan milik', 'data pelapor', 'kontak pelapor',
  'daftar warga', 'semua warga', 'data masyarakat', 'nomor wa warga', 'whatsapp warga',
];
const CITIZEN_SELF_MARKERS = ['laporan saya', 'laporanku', 'milik saya', 'milikku', 'punya saya', 'saya'];

/**
 * Pertanyaan tentang DIREKTORI AKUN/WARGA (bukan laporan/tugas).
 *
 * Dipakai untuk menolak dengan pesan yang tepat pada Warga/Petugas, dan untuk
 * memastikan Admin diarahkan ke searchAccounts/countAccounts — bukan ke
 * statistik agregat atau laporan pribadi.
 */
function isAccountDirectoryQuestion(t: string): boolean {
  const accountWord = hasAny(t, [
    'warga', 'masyarakat', 'pengguna', 'akun', 'user', 'pendaftar', 'registrasi', 'terdaftar',
  ]);
  if (!accountWord) return false;
  // Pertanyaan laporan/tugas tidak boleh dianggap direktori akun.
  if (hasAny(t, [
    'laporan', 'tugas', 'penugasan', 'melapor', 'pelapor', 'ditangani', 'menangani', 'mengerjakan',
  ])) {
    return false;
  }
  const listOrCount = hasAny(t, [
    'siapa saja', 'daftar', 'semua', 'data', 'nama', 'berapa', 'jumlah', 'banyak',
    'tampilkan', 'lihat', 'melihat', 'terdaftar', 'mendaftar', 'registrasi', 'pendaftar',
  ]);
  const self = hasAny(t, [
    'akun saya', 'profil saya', 'data saya', 'data diri', 'siapa saya', 'nama saya', 'laporan saya',
  ]);
  return listOrCount && !self;
}

function resolveCitizen(message: string, t: string, ctx: AiContext): IntentResult {
  const audit = (tools: ToolCall[], kind: Kind): IntentResult => {
    const slots = buildReportSlots(message, t);
    return { tools, context: { ...ctx, ...slots, lastCategory: slots.category ?? ctx.lastCategory, lastKind: kind } };
  };

  // 0) Konfirmasi/batal usulan penyimpanan pengetahuan (dua fase).
  const knowledgeConfirm = detectKnowledgeConfirmation(message);
  if (knowledgeConfirm) {
    if (knowledgeConfirm.kind === 'cancel') {
      return audit([{ name: 'saveAiKnowledge', args: { cancel: true } }], 'explain');
    }
    return audit(
      [{ name: 'saveAiKnowledge', args: { confirmationToken: knowledgeConfirm.token || '' } }],
      'explain'
    );
  }

  // -1) Tindakan mengubah data tidak pernah dieksekusi dari jalur AI.
  const writeAction = detectWriteRequest(t);
  if (writeAction) {
    return audit([{ name: 'refuseWrite', args: { action: writeAction } }], 'none');
  }

  // -0a) SIMPAN INFORMASI KE MEMORI AI — dicek LEBIH DULU agar tidak tertangkap
  //     oleh pola laporan, statistik, atau direktori akun lainnya.
  const saveHintsCitizen = [
    'simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan',
    'tinggalkan catatan', 'simpan ke', 'catat ke', 'simpan ini', 'catat ini',
    'simpan informasi', 'catatkan informasi', 'ingatkan informasi',
    'terima informasi', 'terima keterangan', 'catat keterangan',
  ];
  const saveTargetCitizen = [
    'informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan',
    'kondisi', 'keluhan', 'saran', 'masalah', 'fasilitas', 'kegiatan',
  ];
  const isSaveCitizen = hasAny(t, saveHintsCitizen) && hasAny(t, saveTargetCitizen);
  if (isSaveCitizen) {
    const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
    const content = message;
    return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
  }

  // -0b) PENDAPAT / KELUHAN / PENGALAMAN — TIDAK lagi disimpan otomatis.
  //     Penyimpanan hanya lewat usulan + konfirmasi eksplisit pengguna.
  const opinionHintsCitizen = [
    'menurut saya', 'menurut kami', 'saya pikir', 'saya rasa', 'saya yakin',
    'pendapat saya', 'pendapat kami', 'keluhan saya', 'keluhan kami',
    'masukan saya', 'masukan kami', 'pengalaman saya', 'pengalaman kami',
    'saya mengalami', 'saya lihat', 'saya dengar', 'saya tahu',
    'saya mengeluhkan', 'saya merekomendasikan', 'saya menyarankan',
    'saya mengusulkan',
  ];
  const opinionTargetCitizen = [
    'kinerja', 'petugas', 'petugas desa', 'petugas lapangan', 'fasilitas',
    'kegiatan', 'desa', 'pelayanan', 'masalah', 'keluhan', 'saran', 'masukan',
    'pendapat', 'pengalaman', 'buruk', 'jelek', 'bagus', 'baik', 'ramah',
  ];
  const isOpinionCitizen = hasAny(t, opinionHintsCitizen) && hasAny(t, opinionTargetCitizen);
  if (isOpinionCitizen) {
    // Penyimpanan TIDAK otomatis: pendapat diperlakukan sebagai percakapan
    // biasa. Simpan ke Pusat Pengetahuan harus lewat usulan + konfirmasi.
    return audit([], 'explain');
  }

  // 0) Informasi publik desa (berlaku untuk semua role, tanpa data privat).
  const village = detectVillageIntent(t);
  if (village) return audit([village], 'explain');

  // 0b) KEAMANAN AKUN SENDIRI — "apakah akun saya aman?". Dijawab dari kontrol
  //     keamanan aplikasi + status akun sendiri. Tool MEMAKSA scope self di
  //     server, sehingga argumen/role dari pesan tidak bisa membuka akun lain.
  //     Dicek sebelum blok privasi agar pertanyaan privasi milik sendiri tidak
  //     salah ditolak sebagai permintaan data warga lain.
  if (detectAccountSecurityQuestion(t)) {
    return {
      tools: [{ name: 'getAccountSecurityOverview', args: { scope: 'self' } }],
      context: { ...ctx, lastKind: 'stats', lastAccountSecurity: true },
    };
  }

  // Direktori akun/warga bukan hak Warga. Sebelumnya pertanyaan seperti
  // "berapa jumlah warga terdaftar?" jatuh ke ringkasan laporan pribadi.
  if (isAccountDirectoryQuestion(t)) {
    return audit([{ name: 'refusePrivate', args: { scope: 'accounts' } }], 'none');
  }

  // Privasi: permintaan identitas/laporan warga lain ditolak oleh SERVER.
  // Frasa "warga lain/orang lain" bersifat mutlak — kehadiran kata "saya"
  // ("bisakah SAYA melihat laporan warga lain?") tidak boleh membatalkan
  // penolakan. Marker "saya" hanya relevan untuk permintaan data sendiri.
  if (
    hasAny(t, [
      'warga lain', 'warga lainnya', 'orang lain', 'pengguna lain', 'akun lain',
      'masyarakat lain', 'petugas lain', 'data pribadi', 'nomor hp', 'no hp',
      'nomor telepon', 'alamat warga', 'email warga', 'kontak pelapor',
      'daftar warga', 'semua warga', 'data masyarakat', 'nomor wa warga', 'whatsapp warga',
    ])
  ) {
    return audit([{ name: 'refusePrivate', args: {} }], 'none');
  }
  if (hasAny(t, CITIZEN_PRIVATE_PROBES) && !hasAny(t, CITIZEN_SELF_MARKERS)) {
    return audit([{ name: 'refusePrivate', args: {} }], 'none');
  }

  const id = extractIdFragment(message);
  const reference = detectReference(t);
  const slots = buildReportSlots(message, t);

  // Data pribadi milik user.
  if (hasAny(t, ['profil saya', 'profilku', 'akun saya', 'data diri', 'data saya', 'siapa saya', 'nama saya'])) {
    return audit([{ name: 'getMyProfile', args: {} }], 'profile' as Kind);
  }
  if (hasAny(t, ['lupa password', 'reset password', 'ubah profil', 'ganti profil', 'edit profil', 'cara logout', 'keluar akun', 'log out'])) {
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'account' } }], 'explain');
  }
  // Kemampuan/fitur yang boleh diakses warga (dijawab dari registry fitur).
  if (
    hasAny(t, [
      'apa yang bisa anda lakukan', 'apa yang bisa kamu lakukan', 'apa yang bisa kau lakukan',
      'apa yang bisa saya lakukan', 'apa saja yang bisa saya lakukan',
      'anda bisa apa', 'kamu bisa apa', 'bisa membantu apa', 'bisa bantu apa',
      'kemampuan anda', 'kemampuanmu', 'kemampuan kamu', 'apa kemampuan',
      'fitur apa saja', 'fitur apa', 'bisa apa saja', 'apa saja fiturnya',
      'cara pakai website', 'cara menggunakan website',
    ])
  ) {
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'features' } }], 'explain');
  }
  if (hasAny(t, ['notifikasi', 'notif', 'pemberitahuan', 'pesan masuk'])) {
    return audit([{ name: 'getMyNotifications', args: { limit: 5 } }], 'none');
  }
  if (hasAny(t, ['bukti', 'evidence', 'foto hasil', 'foto pengerjaan', 'dokumentasi'])) {
    return audit([{ name: 'getMyEvidence', args: id ? { idFragment: id } : {} }], 'detail');
  }
  if (hasAny(t, ['duplikat', 'dobel', 'ganda', 'sama'])) {
    return audit([{ name: 'getMyDuplicateInfo', args: {} }], 'none');
  }

  // Detail satu laporan milik user.
  if (id) return audit([{ name: 'getMyReportFullDetail', args: { idFragment: id } }], 'detail');

  // Pertanyaan lanjutan ("kenapa?", "terus?", "maksudnya?") â†’ buka kembali
  // laporan yang sedang dibahas agar alasan penolakan/catatan terbaru
  // benar-benar dibaca dari database. Jangan mengulang jawaban sebelumnya.
  if (detectFollowUp(t)) {
    const target = followUpTarget(t, ctx);
    if (target.clarification) {
      return audit([{ name: 'askClarification', args: { message: target.clarification } }], 'none');
    }
    if (target.id) {
      return audit([{ name: 'getMyReportFullDetail', args: { idFragment: target.id } }], 'detail');
    }
    if (ctx.lastReportTitle) {
      return audit([{ name: 'searchMyReports', args: { title: ctx.lastReportTitle, limit: 5 } }], 'list');
    }
    if (ctx.lastStatus?.length) {
      return audit([{ name: 'searchMyReports', args: { status: ctx.lastStatus, limit: 5 } }], 'list');
    }
    if (ctx.lastCategory) {
      return audit([{ name: 'searchMyReports', args: { category: ctx.lastCategory, limit: 5 } }], 'list');
    }
    // "Bulannya?" setelah "berapa laporan saya bulan ini?" → tetap laporan
    // milik sendiri dengan periode yang sedang dibahas (dibaca ulang dari DB).
    if (ctx.lastPeriod) {
      return audit([{ name: 'searchMyReports', args: { period: ctx.lastPeriod, limit: 10 } }], 'list');
    }
  }

  // "Bagaimana statusnya?" / "progresnya?" tanpa laporan yang jelas tidak boleh
  // dijawab dengan ringkasan semua laporan. Minta satu klarifikasi singkat.
  // Namun bila pertanyaannya sudah menyebut laporan sendiri atau meminta
  // jumlah, itu bukan pertanyaan ambigu: jawab dari data milik pengguna.
  const titledOwn = extractTitledFragment(message);
  if (
    hasAny(t, ['statusnya', 'status apa', 'gimana status', 'bagaimana status', 'progresnya', 'progressnya', 'sudah sampai mana']) &&
    !hasAny(t, ['laporan terbaru', 'laporan terakhir', 'laporan paling baru', 'laporan baru'])
  ) {
    if (ctx.lastReportRef) {
      return audit([{ name: 'getMyReportFullDetail', args: { idFragment: ctx.lastReportRef } }], 'detail');
    }
    if (titledOwn) {
      return audit([{ name: 'searchMyReports', args: { title: titledOwn, limit: 5 } }], 'list');
    }
    if (ctx.lastReportTitle) {
      return audit([{ name: 'searchMyReports', args: { title: ctx.lastReportTitle, limit: 5 } }], 'list');
    }
    if (ctx.lastCategory) {
      return audit([{ name: 'searchMyReports', args: { category: ctx.lastCategory, limit: 5 } }], 'list');
    }
    if (ctx.lastStatus?.length) {
      return audit([{ name: 'searchMyReports', args: { status: ctx.lastStatus, limit: 5 } }], 'list');
    }
    if (hasAny(t, ['berapa', 'jumlah', 'total', 'laporan saya', 'laporanku', 'status laporan'])) {
      // Lanjut ke pemeriksaan jumlah/laporan milik sendiri di bawah.
    } else {
      return audit([{
        name: 'askClarification',
        args: {
          message:
            'Saya perlu tahu laporan mana yang Anda maksud. Sebutkan judul atau ID laporan (4-8 karakter awal) agar saya cek status dan alasannya langsung dari database.',
        },
      }], 'none');
    }
  }

  // "Status laporan terbaru saya" harus menjawab SATU laporan terbaru, bukan
  // ringkasan semua status laporan.
  if (
    hasAny(t, ['laporan terbaru', 'laporan terakhir', 'laporan paling baru', 'laporan baru']) &&
    hasAny(t, ['status', 'bagaimana', 'gimana', 'apa', 'cek', 'detail']) &&
    !hasAny(t, ['apa saja', 'daftar', 'tampilkan', 'semua'])
  ) {
    return audit([{ name: 'getMyRecentReports', args: { limit: 1 } }], 'detail');
  }

  if (reference && !hasAny(t, ['berapa', 'jumlah', 'total', 'statistik', 'daftar', 'tampilkan', 'apa saja'])) {
    if (ctx.lastReportRef) return audit([{ name: 'getMyReportFullDetail', args: { idFragment: ctx.lastReportRef } }], 'detail');
    if (ctx.lastCategory) return audit([{ name: 'searchMyReports', args: { category: ctx.lastCategory, limit: 5 } }], 'list');
  }

  // Judul laporan milik sendiri yang disebut eksplisit (mis. "laporan saya berjudul ...").
  if (titledOwn) {
    return audit([{ name: 'searchMyReports', args: { title: titledOwn, limit: 5 } }], 'list');
  }

  // Riwayat tindak lanjut lintas laporan (tanpa ID/judul tertentu). Dijawab dari
  // tabel riwayat status + assignment milik pengguna, bukan dari ringkasan model.
  if (
    !id &&
    hasAny(t, [
      'riwayat tindak lanjut', 'riwayat penanganan', 'riwayat status',
      'riwayat penugasan', 'tindak lanjut', 'perkembangan laporan',
    ])
  ) {
    return audit([{ name: 'getMyFollowUpHistory', args: { limit: 20 } }], 'detail');
  }

  // Perbandingan periode untuk laporan MILIK SENDIRI (bulan ini vs bulan lalu).
  // Dibedakan dari "bandingkan selesai dan ditolak" yang tetap memakai counts.
  if (
    hasAny(t, ['bandingkan', 'perbandingan', 'dibanding', 'vs', 'versus']) &&
    hasAny(t, ['bulan ini', 'bulan lalu', 'bulan kemarin', 'periode ini', 'periode lalu'])
  ) {
    return audit([{ name: 'compareMyReportPeriods', args: {} }], 'stats');
  }

  const hasStatusFilter = Array.isArray(slots.status) && slots.status.length > 0;
  const hasStatusNotFinal = !!slots.statusNotFinal;

  // Pertanyaan JUMLAH laporan dengan status ("berapa laporan belum selesai?")
  // adalah tentang laporan milik warga sendiri, bukan total desa. Sebelumnya
  // pertanyaan ini tertangkap registry publik `getTotalReports` sehingga warga
  // menerima angka seluruh desa. Total desa tetap dipakai bila pengguna
  // menyebut cakupan publik secara eksplisit ("laporan desa", "semua laporan").
  {
    const asksReportCount = hasAny(t, [
      'berapa laporan', 'jumlah laporan', 'total laporan', 'ada berapa laporan',
      'berapa banyak laporan', 'brp laporan', 'berapa jumlah laporan',
    ]);
    const explicitPublicScope = hasAny(t, [
      'laporan desa', 'laporan masyarakat', 'laporan warga', 'semua laporan',
      'seluruh laporan', 'laporan keseluruhan', 'laporan masuk', 'total laporan desa',
      'laporan publik', 'laporan umum',
    ]);
    const statusScope =
      hasStatusFilter || hasStatusNotFinal ||
      hasAny(t, [
        'belum selesai', 'selesai', 'diproses', 'ditangani', 'ditolak',
        'menunggu', 'status', 'aktif', 'belum final',
      ]);
    if (asksReportCount && (hasAny(t, CITIZEN_SELF_MARKERS) || statusScope) && !explicitPublicScope) {
      const statusFilter = Array.isArray(slots.status) && slots.status.length
        ? slots.status
        : (hasStatusNotFinal
            ? ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW']
            : undefined);
      return audit([{ name: 'getMyReportCounts', args: { status: statusFilter } }], 'count');
    }
  }

  // Registry intent publik (fitur, alur, status, kontak, direktori).
  for (const def of CITIZEN_PUBLIC_INTENTS) {
    if (hasAny(t, def.anyOf) && (!def.noneOf || !hasAny(t, def.noneOf))) {
      // Jangan menyerobot pertanyaan tentang laporan milik user sendiri.
      if (def.tool === 'getTotalReports' && hasAny(t, CITIZEN_SELF_MARKERS)) continue;
      return audit([{ name: def.tool, args: { ...(def.args || {}) } }], 'explain');
    }
  }

  if (hasAny(t, ['petugas']) && hasAny(t, ['siapa saja', 'siapakah', 'nama petugas', 'daftar petugas', 'berapa petugas', 'ada berapa', 'desa ini', 'petugasnya'])) {
    return audit([{ name: 'getPublicOfficers', args: {} }], 'explain');
  }
// "Berapa laporan ... sedang ditangani?" â†’ hitungan status IN_PROGRESS (bukan detail).
// "Siapa ... menangani ...?" / "berapa yang sedang ditangani?" / "tangani apa?" â†’ detail penanganan.
const isCountQuestion =
  hasAny(t, ['berapa laporan', 'berapa jumlah laporan', 'berapa banyak laporan']) ||
  (hasAny(t, ['berapa yang sedang', 'berapa yang sedang ditangani', 'berapa yang sedang dikerjakan', 'berapa yang sedang diproses']) && hasAny(t, ['laporan', 'laporanku', 'laporanku']));

if (hasAny(t, ['petugas', 'ditangani', 'menangani', 'dikerjakan', 'siapa yang', 'diperbaiki', 'diproses', 'dikerjakan siapa'])) {
  if (isCountQuestion) {
    const statusFilter = slots.status ?? (hasStatusNotFinal ? ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'] : undefined);
    return audit([{ name: 'getMyReportCounts', args: { status: statusFilter } }], 'count');
  }
  const target = followUpTarget(t, ctx);
  if (target.clarification) {
    return audit([{ name: 'askClarification', args: { message: target.clarification } }], 'none');
  }
  if (target.id) {
    return audit([{ name: 'getMyReportFullDetail', args: { idFragment: target.id } }], 'detail');
  }
  return audit([{ name: 'getMyLatestHandling', args: {} }], 'detail');
}

  // Check for count queries with an explicit status filter.
  // "Berapa jumlah laporan ..." with status (e.g. "menunggu verifikasi", "ditolak")
  // must route to getMyReportCounts with the status filter, not searchMyReports.
  const countKeyword = hasAny(
    t,
    ['berapa', 'jumlah', 'total', 'statistik', 'status laporan', 'sudah selesai', 'diproses', 'ditolak', 'aktif']
  );
  const statusHint = hasAny(
    t,
    ['menunggu verifikasi', 'tunggu verifikasi', 'menunggu', 'tunggu', 'verifikasi', 'ditolak', 'lunas', 'diselesaikan', 'proses', 'selesai', 'aktif']
  );
  // Pertanyaan YA/TIDAK tentang laporan TERTENTU (mis. laporan lampu mati saya
  // sudah selesai belum?) meminta DETAIL laporan, bukan jumlah. Tanpa aturan
  // ini, kata "selesai" langsung dianggap pertanyaan hitung sehingga pengguna
  // hanya menerima angka tanpa tahu laporan mana yang dimaksud.
  const explicitQuantity = hasAny(t, ['berapa', 'jumlah', 'total', 'statistik', 'brp', 'banyak']);
  const asksYesNo =
    /^(apakah|apa|udah|sudah|sydah|apa kah)\b/.test(t) || /\b(blm|belum|enggak|tidak)\b/.test(t);
  const specificSubject = Boolean(slots.category || slots.damageType || slots.location);
  const detailYesNo = !explicitQuantity && specificSubject && asksYesNo;
  // "apa saja/daftar/tampilkan" meminta DAFTAR, bukan angka. Tanpa penjaga ini,
  // "laporan saya yang ditolak apa saja?" hanya menjawab "ada 2" tanpa menyebut
  // laporan mana (dan rincian status lain yang tidak diminta).
  const wantsList = hasAny(t, [
    'apa saja', 'daftar', 'tampilkan', 'sebutkan', 'rincian', 'list', 'tunjukkan', 'contohkan',
  ]);
  if (countKeyword && (hasStatusFilter || hasStatusNotFinal || statusHint) && !detailYesNo && !wantsList) {
    const statusFilter = Array.isArray(slots.status) && slots.status.length
      ? slots.status
      : (hasStatusNotFinal
          ? ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW']
          : undefined);
    return audit([{ name: 'getMyReportCounts', args: { status: statusFilter } }], 'count');
  }

// Pencarian laporan milik sendiri dengan filter apa pun.
  const search: MyReportSearch = { limit: 50 };
  let hasSearch = false;
  if (slots.category) { search.category = slots.category; hasSearch = true; }
  if (slots.damageType) { search.damageType = slots.damageType; hasSearch = true; }
  if (slots.severity) { search.severity = slots.severity; hasSearch = true; }
  if (slots.location) { search.location = slots.location; hasSearch = true; }
  if (slots.title) { search.title = slots.title; hasSearch = true; }
  if (slots.status) { search.status = slots.status; hasSearch = true; }
  if (slots.statusNotFinal) { search.statusNotFinal = true; hasSearch = true; }
  if (slots.period) { search.period = slots.period; hasSearch = true; }
  if (slots.dateFrom) { search.dateFrom = slots.dateFrom; search.dateTo = slots.dateTo; hasSearch = true; }
  // "paling lama/tertua/awal" harus mengubah urutan query, bukan hanya label.
  const wantsOldest = hasAny(t, [
    'paling lama', 'tertua', 'paling awal', 'paling dulu', 'paling pertama',
    'pertama kali', 'awal dulu', 'dari awal', 'urutkan dari yang lama',
  ]);
  const wantsSorted = hasAny(t, ['urutkan', 'urut', 'sortir', 'pengurutan']);
  if ((wantsOldest || wantsSorted) && hasAny(t, ['laporan', 'laporanku', 'riwayat'])) {
    search.sort = wantsOldest ? 'oldest' : 'newest';
    hasSearch = true;
  }

  if (hasSearch) return audit([{ name: 'searchMyReports', args: search as Record<string, unknown> }], 'list');

  if (hasAny(t, ['berapa', 'jumlah', 'total', 'statistik', 'status laporan', 'sudah selesai', 'diproses', 'ditolak', 'aktif'])) {
    return audit([{ name: 'getMyReportCounts', args: {} }], 'count');
  }
  // Permintaan daftar eksplisit ("tampilkan semua/daftar/riwayat") harus
  // mengembalikan SEMUA laporan yang muat (hingga batas aman 50), bukan hanya
  // 5 laporan terbaru. Kasus Arsa: 11 laporan hanya tampil 5.
  const wantsRecent = hasAny(t, ['terbaru', 'terakhir', 'paling baru']);
  const wantsAllList = hasAny(t, [
    'tampilkan', 'daftar', 'list', 'semua', 'seluruh', 'riwayat', 'pernah', 'cari', 'tunjukkan', 'urutkan',
  ]) && !wantsRecent;
  if (wantsAllList) {
    return audit([{ name: 'searchMyReports', args: { limit: 50 } }], 'list');
  }
  if (hasAny(t, ['laporan saya', 'laporanku', 'terbaru', 'terakhir'])) {
    return audit([
      { name: 'getMyReportCounts', args: {} },
      { name: 'getMyRecentReports', args: { limit: 5 } },
    ], 'list');
  }
  if (detectFollowUp(t)) {
    return audit([{
      name: 'askClarification',
      args: {
        message:
          'Saya ingin memastikan agar tidak salah data. Laporan atau topik mana yang Anda maksud? Sebutkan judul/ID laporan, atau tanyakan status laporan Anda.',
      },
    }], 'none');
  }
  // PUSAT PENGETAHUAN AI — pencarian informasi tersimpan (Warga melihat non-private + milik sendiri).
  const knowledgeHints = [
    'ingat', 'ingatkan', 'ingat-ingat', 'ingatkan saya', 'ingatkan kami',
    'pengetahuan', 'catatan', 'catatan ai', 'basis pengetahuan', 'pusat pengetahuan',
    'seperti yang dikatakan', 'seperti yang dinyatakan', 'seperti yang disebut',
    'pernah disebut', 'pernah dikatakan', 'belum pernah', 'ada catatan', 'ada catatan ai',
    'simpan informasi', 'simpan catatan', 'ingatkan saya tentang',
    'informasi tersimpan', 'data tersimpan', 'catatan tersimpan',
  ];
  if (hasAny(t, knowledgeHints)) {
    // Deteksi niat SIMPAN ke memori (bukan pencarian).
    const saveHints = ['simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan', 'tinggalkan catatan', 'simpan ke', 'catat ke'];
    const saveTarget = ['informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan', 'kondisi', 'keluhan', 'saran', 'masalah'];
    const isSave = hasAny(t, saveHints) && hasAny(t, saveTarget);
    if (isSave) {
      const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
      const content = message;
      return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
    }
    const q = extractKeywordFragment(message) || '';
    return audit([{ name: 'searchAiKnowledge', args: { q, limit: 10 } }], 'explain');
  }
  return audit([], 'none');
}

// ============================================================================
// ROUTER OFFICER (hanya tugas milik sendiri)
// ============================================================================

function normalizePersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z\u00C0-\u024F\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Apakah nama yang disebut merujuk ke pengguna yang sedang login? */
function nameRefersToSelf(name: string, viewerName?: string): boolean {
  if (!viewerName) return false;
  const a = normalizePersonName(name);
  const b = normalizePersonName(viewerName);
  if (!a || !b) return false;
  if (a === b) return true;
  // Cocokkan per kata (mis. "Danu" vs "Danu Pratama"), minimal 3 karakter.
  const selfWords = new Set(b.split(' ').filter((w) => w.length >= 3));
  return a.split(' ').some((w) => w.length >= 3 && selfWords.has(w));
}

/**
 * Nama orang yang disebut setelah "tugas/penugasan", mis. "tugas Danu".
 * Dipakai HANYA untuk menolak permintaan tugas petugas lain — bukan untuk
 * mengambil data. Nama dari pesan tidak pernah menjadi kunci otorisasi.
 */
function extractTaskSubjectName(message: string): string | undefined {
  const match = message.match(
    /\b(?:tugas|penugasan)\s+(?:dari|untuk|milik|atas\s+nama|pegawai)?\s*([A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+(?:\s+[A-Z\u00C0-\u024F][a-z\u00C0-\u024F]+){0,2})/
  );
  if (!match) return undefined;
  const raw = match[1].trim();
  const first = raw.split(/\s+/)[0]?.toLowerCase();
  if (!first || OFFICER_NAME_STOPWORDS.has(first) || NAME_STOPWORDS.has(first)) return undefined;
  return raw;
}

function resolveOfficer(
  message: string,
  t: string,
  ctx: AiContext,
  viewerName?: string
): IntentResult {
  const audit = (tools: ToolCall[], kind: Kind): IntentResult => ({
    tools,
    context: { ...ctx, lastKind: kind },
  });

  // 0) Konfirmasi/batal usulan penyimpanan pengetahuan (dua fase).
  const knowledgeConfirm = detectKnowledgeConfirmation(message);
  if (knowledgeConfirm) {
    if (knowledgeConfirm.kind === 'cancel') {
      return audit([{ name: 'saveAiKnowledge', args: { cancel: true } }], 'explain');
    }
    return audit(
      [{ name: 'saveAiKnowledge', args: { confirmationToken: knowledgeConfirm.token || '' } }],
      'explain'
    );
  }

  // -1) Tindakan mengubah data tidak pernah dieksekusi dari jalur AI.
  const writeAction = detectWriteRequest(t);
  if (writeAction) {
    return audit([{ name: 'refuseWrite', args: { action: writeAction } }], 'none');
  }

  // -0a) SIMPAN INFORMASI KE MEMORI AI — dicek LEBIH DULU agar tidak tertangkap
  //     oleh pola laporan, statistik, atau direktori akun lainnya.
  const saveHintsOfficer = [
    'simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan',
    'tinggalkan catatan', 'simpan ke', 'catat ke', 'simpan ini', 'catat ini',
    'simpan informasi', 'catatkan informasi', 'ingatkan informasi',
    'terima informasi', 'terima keterangan', 'catat keterangan',
  ];
  const saveTargetOfficer = [
    'informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan',
    'kondisi', 'keluhan', 'saran', 'masalah', 'fasilitas', 'kegiatan',
  ];
  const isSaveOfficer = hasAny(t, saveHintsOfficer) && hasAny(t, saveTargetOfficer);
  if (isSaveOfficer) {
    const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
    const content = message;
    return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
  }

  // -0b) PENDAPAT / KELUHAN / PENGALAMAN — TIDAK lagi disimpan otomatis.
  //     Penyimpanan hanya lewat usulan + konfirmasi eksplisit pengguna.
  const opinionHintsOfficer = [
    'menurut saya', 'menurut kami', 'saya pikir', 'saya rasa', 'saya yakin',
    'pendapat saya', 'pendapat kami', 'keluhan saya', 'keluhan kami',
    'masukan saya', 'masukan kami', 'pengalaman saya', 'pengalaman kami',
    'saya mengalami', 'saya lihat', 'saya dengar', 'saya tahu',
    'saya mengeluhkan', 'saya merekomendasikan', 'saya menyarankan',
    'saya mengusulkan',
  ];
  const opinionTargetOfficer = [
    'kinerja', 'petugas', 'petugas desa', 'petugas lapangan', 'fasilitas',
    'kegiatan', 'desa', 'pelayanan', 'masalah', 'keluhan', 'saran', 'masukan',
    'pendapat', 'pengalaman', 'buruk', 'jelek', 'bagus', 'baik', 'ramah',
  ];
  const isOpinionOfficer = hasAny(t, opinionHintsOfficer) && hasAny(t, opinionTargetOfficer);
  if (isOpinionOfficer) {
    // Penyimpanan TIDAK otomatis: pendapat diperlakukan sebagai percakapan
    // biasa. Simpan ke Pusat Pengetahuan harus lewat usulan + konfirmasi.
    return audit([], 'explain');
  }

  // 0) Informasi publik desa (profil, pemerintahan, layanan, pengumuman, lokasi).
  const village = detectVillageIntent(t);
  if (village) return audit([village], 'explain');

  // 0b) KEAMANAN AKUN SENDIRI (lihat catatan di resolveCitizen).
  if (detectAccountSecurityQuestion(t)) {
    return {
      tools: [{ name: 'getAccountSecurityOverview', args: { scope: 'self' } }],
      context: { ...ctx, lastKind: 'stats', lastAccountSecurity: true },
    };
  }

  // Direktori akun/warga bukan hak Warga. Sebelumnya pertanyaan seperti
  // "berapa jumlah warga terdaftar?" jatuh ke ringkasan laporan pribadi.
  if (isAccountDirectoryQuestion(t)) {
    return audit([{ name: 'refusePrivate', args: { scope: 'accounts' } }], 'none');
  }

  // Privasi: petugas hanya berwenang atas tugas miliknya sendiri. Frasa
  // "siapa petugas yang mengerjakan?" TIDAK otomatis ditolak karena bisa
  // merujuk tugas pengguna sendiri; yang ditolak adalah permintaan data
  // petugas lain / direktori petugas.
  if (
    hasAny(t, [
      'petugas lain', 'petugas lainnya', 'rekan', 'petugas selain saya',
      'tugas orang lain', 'tugas petugas lain', 'warga lain', 'laporan orang lain',
      'data petugas lain', 'semua petugas', 'petugas desa', 'daftar petugas',
      'nama petugas', 'data warga', 'daftar warga',
      'data masyarakat', 'akun warga', 'akun petugas', 'data akun',
    ])
  ) {
    return audit([{ name: 'refusePrivate', args: {} }], 'none');
  }

  // Petugas yang disebut namanya secara eksplisit ("tugas Petugas Dua",
  // "tugas Danu"). Bila bukan nama pengguna yang login → tolak. Sebelumnya
  // permintaan ini diam-diam dijawab dengan tugas milik sendiri sehingga
  // pengguna mengira melihat data petugas lain.
  const namedOfficer = extractOfficerName(t) || extractTaskSubjectName(message);
  if (namedOfficer && !nameRefersToSelf(namedOfficer, viewerName)) {
    return audit([{ name: 'refusePrivate', args: {} }], 'none');
  }

  // Lanjutan ("kenapa?", "sudah diproses?", "petugasnya siapa?") membaca
  // ulang tugas/laporan yang sedang dibahas. Bila jawaban sebelumnya memuat
  // beberapa laporan, minta klarifikasi alih-alih menebak.
  if (detectFollowUp(t)) {
    const target = followUpTarget(t, ctx);
    if (target.clarification) {
      return audit([{ name: 'askClarification', args: { message: target.clarification } }], 'none');
    }
    if (target.id) {
      return audit([{ name: 'getMyTaskDetail', args: { idFragment: target.id } }], 'detail');
    }
    if (ctx.lastReportTitle) {
      return audit([{ name: 'searchMyTasks', args: { title: ctx.lastReportTitle, limit: 8 } }], 'list');
    }
    if (ctx.lastCategory) {
      return audit([{ name: 'searchMyTasks', args: { category: ctx.lastCategory, limit: 8 } }], 'list');
    }
    if (ctx.lastStatus?.length) {
      return audit([{ name: 'searchMyTasks', args: { status: ctx.lastStatus, limit: 8 } }], 'list');
    }
    if (ctx.lastPeriod) {
      return audit([{ name: 'searchMyTasks', args: { period: ctx.lastPeriod, limit: 8 } }], 'list');
    }
  }

  // "Siapa petugasnya?" tanpa konteks laporan yang jelas → tampilkan ringkasan
  // tugas sendiri, bukan menolak seolah-olah meminta data petugas lain.
  if (
    hasAny(t, [
      'petugasnya', 'siapa yang mengerjakan', 'siapa yang menangani',
      'ditangani siapa', 'dikerjakan siapa', 'siapa yang ditugaskan',
    ])
  ) {
    if (ctx.lastReportRef) {
      return audit([{ name: 'getMyTaskDetail', args: { idFragment: ctx.lastReportRef } }], 'detail');
    }
    return audit([
      { name: 'getMyTaskSummary', args: {} },
      { name: 'getMyActiveTasks', args: { limit: 5 } },
    ], 'list');
  }

  // Data pribadi milik petugas (profil).
  if (hasAny(t, ['profil saya', 'profilku', 'akun saya', 'data diri', 'data saya', 'siapa saya', 'nama saya'])) {
    return audit([{ name: 'getMyProfile', args: {} }], 'profile' as Kind);
  }

  // Kemampuan/fitur yang boleh diakses Petugas.
  if (
    hasAny(t, [
      'apa yang bisa anda lakukan', 'apa yang bisa kamu lakukan', 'apa yang bisa kau lakukan',
      'apa yang bisa saya lakukan', 'apa saja yang bisa saya lakukan',
      'anda bisa apa', 'kamu bisa apa', 'bisa membantu apa', 'bisa bantu apa',
      'kemampuan anda', 'kemampuanmu', 'kemampuan kamu', 'apa kemampuan',
      'fitur apa saja', 'fitur apa', 'bisa apa saja', 'apa saja fiturnya',
      'cara pakai website', 'cara menggunakan website',
    ])
  ) {
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'features' } }], 'explain');
  }

  // Rentang tanggal eksplisit pada tugas ("tugas saya bulan Agustus").
  const taskRange = detectDateRange(t);
  if (taskRange && hasAny(t, ['tugas', 'laporan', 'kerja', 'penugasan'])) {
    return audit([{
      name: 'searchMyTasks',
      args: { dateFrom: taskRange.from, dateTo: taskRange.to, limit: 10 },
    }], 'list');
  }

  if (hasAny(t, ['alur', 'cara', 'tahapan', 'langkah', 'upload', 'unggah', 'bukti', 'menu', 'di mana', 'dimana', 'fitur'])) {
    if (hasAny(t, ['status'])) return audit([{ name: 'getWebsiteInfo', args: { topic: 'statuses' } }], 'explain');
    if (hasAny(t, ['alur', 'proses', 'tahapan', 'langkah'])) return audit([{ name: 'getWebsiteInfo', args: { topic: 'workflow' } }], 'explain');
    return audit([{ name: 'getWebsiteInfo', args: { topic: 'features' } }], 'explain');
  }

  // Pertanyaan tentang pekerjaan yang SUDAH diselesaikan petugas sendiri.
  // Dicek sebelum pertanyaan agregat agar tidak dijawab dengan total laporan desa.
  if (hasAny(t, ['sudah saya selesaikan', 'sudah saya kerjakan', 'yang saya selesaikan', 'saya selesaikan', 'saya kerjakan', 'sudah saya tangani'])) {
    return audit([{ name: 'searchMyTasks', args: { done: true, limit: 8 } }], 'list');
  }

  // 1) Pertanyaan AGREGAT tentang laporan desa / antrean status. Petugas
  //    berhak atas statistik agregat (sama seperti Warga), tetapi TIDAK berhak
  //    atas daftar laporan/identitas warga. Sebelumnya pertanyaan seperti
  //    "berapa total laporan desa?" dijawab dengan jumlah tugas pribadi.
  const aggregateReportQuestion =
    hasAny(t, [
      'laporan desa', 'total laporan', 'jumlah laporan', 'statistik laporan',
      'semua laporan', 'laporan masuk', 'laporan masyarakat', 'rekap laporan',
      'antrean laporan', 'laporan keseluruhan', 'kondisi laporan',
    ]) ||
    (hasAny(t, ['laporan', 'antrean']) &&
      hasAny(t, [
        'menunggu verifikasi', 'belum diverifikasi', 'sudah diverifikasi',
        'menunggu penugasan', 'sedang ditangani', 'menunggu verifikasi bukti',
        'berapa', 'jumlah', 'total', 'statistik',
      ]) &&
      !hasAny(t, ['tugas saya', 'tugasku', 'laporan saya', 'laporanku', 'milik saya']));
  if (aggregateReportQuestion) {
    return audit([{ name: 'getTotalReports', args: {} }], 'stats');
  }

  if (hasAny(t, ['urgent', 'mendesak', 'prioritas', 'kritis', 'genting'])) {
    return audit([{ name: 'getMyUrgentTasks', args: { limit: 5 } }], 'list');
  }
  // "belum selesai" harus diperiksa SEBELUM "selesai" agar tidak salah tafsir.
  if (hasAny(t, [
    'belum selesai', 'belum kelar', 'masih aktif', 'sedang saya',
    'sedang dikerjakan', 'masih berjalan', 'belum ditangani', 'belum diproses',
    'belum dikerjakan', 'belum diperbaiki', 'masih proses',
  ])) {
    return audit([{ name: 'searchMyTasks', args: { done: false, limit: 8 } }], 'list');
  }
  if (hasAny(t, ['selesai', 'selesaikan', 'menyelesaikan', 'sudah saya', 'beres', 'tuntas', 'riwayat saya'])) {
    return audit([{ name: 'searchMyTasks', args: { done: true, limit: 8 } }], 'list');
  }
  if (hasAny(t, ['hari ini', 'today'])) {
    return audit([
      { name: 'getMyTaskSummary', args: {} },
      { name: 'getMyActiveTasks', args: { limit: 10 } },
    ], 'list');
  }
  // 2) Hitungan TUGAS pribadi. "Berapa" tanpa subjek yang jelas tidak boleh
  //    otomatis dianggap tugas pribadi (lihat klarifikasi di bawah).
  if (
    hasAny(t, ['tugas', 'tugasku', 'penugasan', 'kerjaan', 'dikerjakan', 'ditangani', 'laporan saya', 'laporanku']) &&
    hasAny(t, ['berapa', 'jumlah', 'total', 'statistik', 'ringkasan'])
  ) {
    return audit([{ name: 'getMyTaskSummary', args: {} }], 'count');
  }
  if (hasAny(t, ['tampilkan', 'daftar', 'list', 'tugas', 'laporan', 'kerja'])) {
    return audit([
      { name: 'getMyTaskSummary', args: {} },
      { name: 'getMyActiveTasks', args: { limit: 5 } },
    ], 'list');
  }
  if (hasAny(t, ['berapa', 'jumlah', 'total', 'statistik'])) {
    return audit([{
      name: 'askClarification',
      args: {
        message:
          'Bisa diperjelas, Bapak/Ibu? Apakah yang dimaksud tugas pribadi Anda, atau statistik laporan desa secara keseluruhan?',
      },
    }], 'none');
  }
  if (detectFollowUp(t)) {
    return audit([{
      name: 'askClarification',
      args: {
        message:
          'Saya ingin memastikan agar tidak salah data. Tugas atau laporan mana yang Anda maksud? Sebutkan ID laporan atau tanyakan tugas aktif Anda.',
      },
    }], 'none');
  }
  // PUSAT PENGETAHUAN AI — pencarian informasi tersimpan (Petugas melihat non-private + milik sendiri).
  const knowledgeHints = [
    'ingat', 'ingatkan', 'ingat-ingat', 'ingatkan saya', 'ingatkan kami',
    'pengetahuan', 'catatan', 'catatan ai', 'basis pengetahuan', 'pusat pengetahuan',
    'seperti yang dikatakan', 'seperti yang dinyatakan', 'seperti yang disebut',
    'pernah disebut', 'pernah dikatakan', 'belum pernah', 'ada catatan', 'ada catatan ai',
    'simpan informasi', 'simpan catatan', 'ingatkan saya tentang',
    'informasi tersimpan', 'data tersimpan', 'catatan tersimpan',
  ];
  if (hasAny(t, knowledgeHints)) {
    // Deteksi niat SIMPAN ke memori (bukan pencarian).
    const saveHints = ['simpan', 'catat', 'catatkan', 'ingatkan', 'ingat-ingatkan', 'tinggalkan catatan', 'simpan ke', 'catat ke'];
    const saveTarget = ['informasi', 'catatan', 'data', 'hal ini', 'ini', 'itu', 'keterangan', 'kondisi', 'keluhan', 'saran', 'masalah'];
    const isSave = hasAny(t, saveHints) && hasAny(t, saveTarget);
    if (isSave) {
      const title = extractKeywordFragment(message) || 'Catatan dari percakapan';
      const content = message;
      return audit([{ name: 'saveAiKnowledge', args: { title, content, category: 'LAINNYA' } }], 'explain');
    }
    const q = extractKeywordFragment(message) || '';
    return audit([{ name: 'searchAiKnowledge', args: { q, limit: 10 } }], 'explain');
  }
  return audit([], 'none');
}

// ============================================================================
// KONTEKS PERCAKAPAN
// ============================================================================

/**
 * Ambil slot penting dari riwayat percakapan (hanya pesan pengguna) agar
 * pertanyaan lanjutan seperti "siapa saja yang membuatnya?" dapat dijawab.
 * Data operasional TIDAK diambil dari riwayat — selalu dari database.
 */
export function extractContext(history: ChatTurn[]): AiContext {
  const ctx: AiContext = {};
  for (const turn of history) {
    if (!turn || typeof turn.content !== 'string') continue;

    // Jawaban asisten dapat menyebut ID laporan (mis. "(ID: a1b2c3d4)").
    // Bila jawaban memuat BEBERAPA ID (daftar laporan), simpan semuanya sebagai
    // kandidat dan JANGAN memilih salah satu. Pertanyaan lanjutan seperti
    // "petugasnya siapa?" harus meminta klarifikasi, bukan menebak laporan.
    if (turn.role === 'assistant') {
      const lines = turn.content.split(/\r?\n/);
      const candidates: { id: string; title?: string }[] = [];
      let pendingTitle: string | undefined;
      for (const line of lines) {
        const titleLine = line.match(/^\s*(?:Judul|Laporan|Tugas)\s*:\s*(.+)$/i);
        if (titleLine) {
          const cleaned = titleLine[1].split(/\s+[—–-]\s+/)[0].trim();
          if (cleaned && !/^ID\b/i.test(cleaned)) pendingTitle = cleaned.slice(0, 100);
        }
        const idMatch = line.match(/\bID\s*[:#]?\s*([0-9a-f]{8})\b/i);
        if (!idMatch) continue;
        const derived = line
          .replace(/^\s*\d+[.)]\s*/, '')
          .replace(/\(ID\s*[:#]?\s*[0-9a-f]{8}\)/i, '')
          .split(/\s+[—–-]\s+/)[0]
          .replace(/^\s*(?:Judul|Laporan|Tugas)\s*:\s*/i, '')
          .trim();
        const title = pendingTitle || (derived.length >= 3 && !/^ID\b/i.test(derived) ? derived : undefined);
        candidates.push({ id: idMatch[1].toLowerCase(), title: title?.slice(0, 100) });
      }
      if (candidates.length > 0) {
        const unique = candidates.filter(
          (c, i) => candidates.findIndex((x) => x.id === c.id) === i
        );
        if (unique.length === 1) {
          ctx.lastReportRef = unique[0].id;
          ctx.lastReportCandidates = undefined;
          if (unique[0].title) ctx.lastReportTitle = unique[0].title;
        } else {
          ctx.lastReportCandidates = unique.slice(-5);
          // Daftar = ambigu. Jangan menyimpan satu ID sebagai rujukan.
          ctx.lastReportRef = undefined;
        }
      }
      const catMatch = turn.content.match(/\bKategori\s*:\s*([^\n—–]{2,60})/i);
      if (catMatch) {
        const cat = catMatch[1].split('/')[0].trim();
        if (cat) ctx.lastCategory = cat;
      }
      continue;
    }
    if (turn.role !== 'user') continue;

    const t = normalizeIndonesian(turn.content);
    const id = extractIdFragment(turn.content);
    const quoted = turn.content.match(/"([^"]{4,80})"/);
    const titledMatch = turn.content.match(
      /\b(?:laporan|tugas)\s+(?:berjudul|bertajuk|dengan judul|tentang)\s+["“]?([^"”\n?]{4,80})/i
    );
    const titled = titledMatch ? titledMatch[1].trim().replace(/[.,!?]+$/, '') : undefined;
    const cat = detectCategory(t);
    const reference = detectReference(t);

    if (id) {
      ctx.lastReportRef = id;
      ctx.lastReportCandidates = undefined;
    } else if ((quoted || titled || cat) && !reference) {
      // Topik laporan BARU yang eksplisit: jangan biarkan rujukan laporan lama
      // menyerobot. Judul baru disimpan; kategori baru menggantikan kategori lama.
      ctx.lastReportRef = undefined;
      ctx.lastReportCandidates = undefined;
    }
    if (quoted) ctx.lastReportTitle = quoted[1];
    else if (titled) ctx.lastReportTitle = titled;
    if (cat) ctx.lastCategory = cat;
    const sev = detectSeverities(t);
    if (sev) ctx.lastSeverity = sev;
    const st = detectStatuses(t);
    if (st) ctx.lastStatus = st;
    const period = detectPeriod(t);
    if (period) ctx.lastPeriod = period;
    const reporter = detectReporterName(turn.content);
    if (reporter) ctx.lastReporterName = reporter;
    const located = extractExplicitLocation(turn.content, t);
    if (located) ctx.lastLocation = located;
    const dim = detectDimension(t);
    if (dim) ctx.lastDimension = dim;
    const acctRole = detectAccountRole(t);
    if (acctRole) ctx.lastAccountRole = acctRole;
    const acctActive = detectAccountActive(t);
    if (acctActive !== undefined) ctx.lastAccountActive = acctActive;
    const acctQuery = detectAccountQuery(turn.content);
    if (acctQuery) ctx.lastAccountQuery = acctQuery;
    // Topik KEAMANAN akun harus bertahan untuk lanjutan ("kenapa?") tetapi
    // tidak boleh menyerobot pertanyaan laporan berikutnya.
    if (detectAccountSecurityQuestion(t)) {
      ctx.lastAccountSecurity = true;
    } else if (hasAny(t, ['laporan', 'tugas', 'penugasan', 'pengumuman'])) {
      ctx.lastAccountSecurity = false;
    }

    // Topik petugas vs topik lain. Ini penting agar "Apakah semua sudah ada
    // tugas?" setelah daftar petugas tetap diarahkan ke penugasan petugas,
    // sedangkan "Siapa yang belum?" setelah daftar laporan tidak ikut nyasar.
    const officerWord =
      hasAny(t, ['petugas', 'officer']) &&
      !hasAny(t, ['akun', 'pengguna', 'user', 'terdaftar', 'registrasi', 'pendaftaran']);
    const assignmentWord = hasAny(t, ['tugas', 'penugasan', 'ditugaskan', 'ditangani', 'dikerjakan']);
    if (officerWord) {
      ctx.lastOfficerFocus = true;
    }
    if (assignmentWord && (officerWord || ctx.lastOfficerFocus || hasAny(t, ['semua', 'mereka']))) {
      ctx.lastOfficerAssignment = true;
    }
    const otherDataTopic =
      !officerWord &&
      hasAny(t, ['laporan', 'pengumuman', 'warga', 'masyarakat', 'akun', 'wilayah', 'statistik']);
    if (otherDataTopic) {
      ctx.lastOfficerFocus = false;
      ctx.lastOfficerAssignment = false;
      // Jangan biarkan konteks akun lama menyerobot pertanyaan laporan baru.
      if (!acctRole) ctx.lastAccountRole = undefined;
    }

    // Simpan apakah percakapan sedang membahas PENDAFTARAN akun. Hanya topik
    // laporan/tugas yang eksplisit yang mereset, agar "kalau kemarin?" tetap
    // diarahkan ke data pendaftaran.
    if (detectRegistrationSignal(t)) {
      ctx.lastRegistration = true;
    } else if (hasAny(t, ['laporan', 'tugas', 'penugasan'])) {
      ctx.lastRegistration = false;
    }
  }

  // Pertanyaan/tawaran TERAKHIR dari assistant. Ini yang menentukan bagaimana
  // balasan singkat pengguna harus dibaca (lihat classifyReplyTone).
  const lastAssistant = [...history].reverse().find((t) => t && t.role === 'assistant');
  if (lastAssistant && typeof lastAssistant.content === 'string' && lastAssistant.content.trim()) {
    ctx.lastAssistantQuestion = lastAssistant.content.trim().slice(-400);
    ctx.lastAssistantQuestionKind = classifyAssistantQuestion(lastAssistant.content);
  }

  return ctx;
}

// ============================================================================
// PEMAHAMAN BALASAN SINGKAT (AFFIRMATION / NEGATION / CONTINUATION)
// ============================================================================

/**
 * Balasan singkat yang berarti "ya, saya butuh bantuan" atau "boleh proceeded".
 *
 * Daftar ini HANYA berisi kata Indonesia yang lazim. Setiap kata dicocokkan
 * sebagai KATA UTUH pada pesan yang dinormalisasi, sehingga "ada laporan"
 * tidak pernah tertangkap sebagai affirmation.
 */
const AFFIRMATIVE_WORDS = new Set([
  'ada', 'iya', 'ya', 'yup', 'yep', 'yes', 'ok', 'oke', 'okey', 'siap', 'sip',
  'betul', 'benar', 'setuju', 'boleh', 'mau', 'ingin', 'silakan', 'lanjut',
  'lanjutkan', 'lanjut ya', 'boleh dong', 'ya dong', 'iya dong', 'ya boleh',
  'ya kak', 'yaasih', 'terima kasih', 'makasih', 'thanks',
]);

/**
 * Balasan singkat yang berarti "tidak" / "belum" / "jangan".
 *
 * "tidak ada laporan" TIDAK boleh tertangkap sebagai negation karena
 * pencocokan dilakukan pada SELURUH pesan, bukan pada substring.
 */
const NEGATIVE_WORDS = new Set([
  'tidak', 'nggak', 'ngga', 'enggak', 'gak', 'gk', 'nope', 'no', 'belum',
  'belum juga', 'jangan', 'bukan', 'stop', 'cukup', 'tidak perlu', 'tidak ada',
  'nggak ada', 'nggak perlu', 'belum selesai', 'belum dikirim',
]);

/**
 * Normalisasi pesan balasan singkat: huruf kecil, tanpa tanda baca, spasi rapat.
 */
function normalizeReplyText(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ambil kalimat terakhir dari teks.
 *
 * Pemisah kalimat dicari dari AKHIR ke awal dan hanya dianggap pemisah bila
 * tanda baca diikuti spasi atau akhir teks — sehingga angka desimal ("3.5")
 * tidak salah pecah menjadi dua kalimat.
 */
function lastSentence(text: string): string {
  const t = (text || '').trim();
  if (!t) return '';
  const isBreak = (i: number) => {
    const ch = t[i];
    if (ch !== '.' && ch !== '!' && ch !== '?') return false;
    const rest = t.slice(i + 1);
    return rest === '' || /^\s/.test(rest);
  };
  for (let i = t.length - 1; i >= 0; i--) {
    if (!isBreak(i)) continue;
    let start = 0;
    for (let j = i - 1; j >= 0; j--) {
      if (!isBreak(j)) continue;
      start = j + 1;
      break;
    }
    return t.slice(start).trim();
  }
  return t;
}

/**
 * Deteksi bentuk pertanyaan assistant terakhir.
 *
 * open_offer    : assistant menawar bantuan ("Ada yang bisa saya bantu?").
 * clarification : assistant meminta klarifikasi atas pilihan/objek.
 * yes_no       : assistant menanyakan konfirmasi ya/tidak.
 * data         : assistant terakhir menjawab dengan data (bukan pertanyaan).
 * none         : tidak ada pertanyaan yang menunggu.
 */
export function classifyAssistantQuestion(content: string): AssistantQuestionKind {
  const text = (content || '').trim();
  if (!text) return 'none';

  // Kalimat terakhir = penanda apakah assistant menutup dengan pertanyaan.
  const last = lastSentence(text);
  const lastLower = last.toLowerCase();
  const wholeLower = text.toLowerCase();

  // Permintaan klarifikasi diperiksa pada SELURUH jawaban, bukan hanya
  // kalimat terakhir: penjelasan klarifikasi sering diikuti kalimat
  // penjelasan ("Bisa diperjelas sedikit, Admin? Saya ingin memastikan ...").
  if (
    /yang mana/.test(wholeLower) ||
    /maksudnya/.test(wholeLower) ||
    /yang anda maksud/.test(wholeLower) ||
    /maksud yang/.test(wholeLower) ||
    /bisa diperjelas/.test(wholeLower) ||
    /memperjelas/.test(wholeLower) ||
    /sebutkan nomor atau id/.test(wholeLower) ||
    /pilih salah satu/.test(wholeLower)
  ) {
    return 'clarification';
  }

  // Tawaran bantuan terbuka (umumnya pertanyaan terakhir).
  if (
    /ada yang bisa saya bantu/.test(lastLower) ||
    /apa yang bisa saya bantu/.test(lastLower) ||
    /ada pertanyaan lain/.test(lastLower) ||
    /boleh saya bantu/.test(lastLower) ||
    /silakan menyatakan/.test(lastLower)
  ) {
    return 'open_offer';
  }

  // Pertanyaan ya/tidak di akhir jawaban.
  if (/[?]$/.test(last) || /\bapakah\b|\bmau\b|\bboleh\b|\bingin\b|\bsudah\b|\bbisa\b/.test(lastLower)) {
    return 'yes_no';
  }

  // Assistant menutup dengan data, bukan pertanyaan.
  return 'data';
}

/**
 * Baca balasan singkat pengguna BERDASARKAN pertanyaan assistant terakhir.
 *
 * Aturan (koreksi atas pendekatan keyword-bebas):
 *  - Nada (affirmative/negative) ditentukan dari pesan itu sendiri.
 *  - TAPI balasan hanya dianggap bermakna bila ada pertanyaan assistant
 *    yang benar-benar menunggu jawaban. Tanpa itu, "ada" pada pesan pertama
 *    tetap dianggap pesan biasa, bukan jawaban.
 *  - "open_offer" + affirmative = pengguna menyatakan ADA pertanyaan yang
 *    ingin diajukan (bukan "ya" atas tawaran data).
 *
 * Mengembalikan 'none' bila pesan bukan balasan singkat.
 */
export function classifyReplyTone(message: string, questionKind: AssistantQuestionKind): ReplyTone {
  // Tanpa pertanyaan assistant yang menunggu, balasan singkat tidak bermakna.
  if (questionKind === 'none' || questionKind === 'data') return 'none';

  const normalized = normalizeReplyText(message);
  if (!normalized) return 'none';

  // Balasan singkat = satu sampai tiga kata. Pesan normal bukan balasan.
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 3) return 'none';

  // Pesan yang merupakan pertanyaan baru TIDAK boleh dianggap balasan.
  if (/\?\s*$/.test((message || '').trim())) return 'none';

  const whole = normalized;
  const isAffirmative =
    AFFIRMATIVE_WORDS.has(whole) ||
    (AFFIRMATIVE_WORDS.has(words[0]) &&
      words.every((w) => AFFIRMATIVE_WORDS.has(w) || ['dong', 'kak', 'deh', 'sih'].includes(w)));
  const isNegative =
    NEGATIVE_WORDS.has(whole) ||
    (NEGATIVE_WORDS.has(words[0]) &&
      words.every((w) => NEGATIVE_WORDS.has(w) || ['dong', 'kak', 'deh', 'sih'].includes(w)));

  if (isNegative) return 'negative';
  if (isAffirmative) return 'affirmative';
  return 'none';
}

/**
 * Susun konteks balasan singkat untuk pesan terbaru.
 *
 * Mengembalikan null bila pesan terbaru bukan balasan singkat, atau bila
 * assistant terakhir tidak sedang menunggu jawaban.
 */
export function detectPendingReply(
  message: string,
  ctx: AiContext
): PendingReply | null {
  const kind = ctx.lastAssistantQuestionKind || 'none';
  if (kind === 'none' || kind === 'data') return null;
  const tone = classifyReplyTone(message, kind);
  if (tone === 'none') return null;
  return {
    tone,
    questionKind: kind,
    question: (ctx.lastAssistantQuestion || '').slice(0, 300),
  };
}

// ============================================================================
// ENTRY POINT
// ============================================================================

/**
 * Tentukan tool yang harus dipanggil untuk sebuah pertanyaan.
 * `history` opsional: bila diberikan, konteks percakapan sebelumnya dipakai
 * untuk memahami kata ganti dan pertanyaan lanjutan.
 */
const SYSTEM_UPDATE_HINTS = [
  'update terbaru', 'update apa saja', 'update website', 'update web', 'update sistem', 'update fitur',
  'pembaruan terbaru', 'pembaruan apa saja', 'pembaruan website', 'pembaruan web', 'pembaruan sistem',
  'pembaruan fitur', 'changelog', 'log pembaruan', 'riwayat pembaruan', 'riwayat update',
  'apa yang baru', 'fitur terbaru website', 'fitur terbaru sistem',
];

export function resolveIntent(
  role: ChatRole,
  message: string,
  history: ChatTurn[] = [],
  /** Nama tampilan pengguna dari sesi (opsional). Dipakai HANYA untuk membedakan
   *  "tugas saya" dari "tugas petugas bernama X" — bukan untuk otorisasi. */
  viewerName?: string
): IntentResult {
  // Normalisasi ringan untuk memahami ejaan santai/typo, tanpa mengubah teks
  // asli yang dipakai mengekstrak nama, judul, dan fragmen ID.
  const t = normalizeIndonesian(message);
  const ctx = extractContext(history);

  // Balasan singkat ("ada", "iya", "tidak") dibaca BERDASARKAN pertanyaan
  // assistant terakhir. Balasan ini TIDAK memanggil tool apa pun: isinya
  // mengarahkan percakapan, bukan meminta data baru. Jenis jawabannya
  // ditentukan di aiChat.ts (deterministik, tanpa LLM).
  const pendingReply = detectPendingReply(message, ctx);
  if (pendingReply) {
    return {
      tools: [],
      context: { ...ctx, pendingReply, lastKind: 'none' },
    };
  }

  // Changelog berlaku untuk semua role dan tidak menyentuh data privat.
  // Deteksi lebih awal agar tidak tertukar dengan "update status laporan".
  if (hasAny(t, SYSTEM_UPDATE_HINTS)) {
    return {
      tools: [{ name: 'getWebsiteInfo', args: { topic: 'updates' } }],
      context: { ...ctx, lastKind: 'explain' },
    };
  }

  // Puisi, kode program, resep, dan pengetahuan umum bukan data laporan.
  // Biarkan model menjawab tanpa memicu query database yang tidak relevan.
  if (detectOffTopicRequest(t)) {
    return { tools: [], context: { ...ctx, lastKind: 'none' } };
  }

  if (role === 'CITIZEN') return resolveCitizen(message, t, ctx);
  if (role === 'OFFICER') return resolveOfficer(message, t, ctx, viewerName);
  return resolveAdmin(message, t, ctx);
}

/** Kompatibilitas: versi lama hanya mengembalikan daftar tool tanpa konteks. */
export function planTools(role: ChatRole, message: string): ToolCall[] {
  return resolveIntent(role, message).tools;
}


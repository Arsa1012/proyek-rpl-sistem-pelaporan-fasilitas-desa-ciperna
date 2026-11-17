/**
 * VALIDASI JAWABAN AI — lapisan terakhir sebelum jawaban dikirim ke pengguna.
 *
 * Mengapa perlu:
 * - Prompt yang baik tetap bisa dilanggar model (halusinasi, bocor rahasia,
 *   atau mengklaim tindakan tulis yang tidak pernah dijalankan).
 * - Data yang sudah benar diambil dari database tidak menjamin narasi model
 *   benar. Validator ini menolak jawaban yang melanggar aturan keras, lalu
 *   pemanggil menggantinya dengan rangkuman deterministik dari hasil query.
 *
 * Prinsip:
 * - Hanya memeriksa pola yang TIDAK ambigu (rahasia, klaim tulis, JSON mentah,
 *   placeholder, penyangkalan akses data saat data tersedia).
 * - Tidak menebak angka; validasi angka tetap dilakukan oleh formatter
 *   deterministik di aiChat.ts.
 * - Tidak pernah mencatat isi jawaban/rahasia ke log; hanya kode alasan.
 */

import type { ChatRole } from './aiTools';

export type AnswerValidationReason =
  | 'empty'
  | 'secret_leak'
  | 'write_claim'
  | 'raw_json'
  | 'placeholder'
  | 'false_no_access'
  | 'error_as_empty';

export interface AnswerValidationResult {
  ok: boolean;
  reason?: AnswerValidationReason;
}

export interface AnswerValidationInput {
  answer: string;
  role: ChatRole;
  toolResults: { name: string; result: unknown }[];
  /** true bila ada tool database yang dijalankan untuk pertanyaan ini. */
  hasTools: boolean;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{30,}\b/, // Google API key
  /\bsk-or-v1-[0-9a-f]{20,}\b/i, // OpenRouter key
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{50,}/, // bcrypt hash
  /\b(?:DATABASE_URL|JWT_SECRET|GEMINI_API_KEY|OPENROUTER_API_KEY|FONNTE_TOKEN)\s*[:=]/i,
  /\b(?:passwordHash|otpHash|tokenHash)\b/,
];

// Klaim bahwa asisten MELAKUKAN perubahan data. Asisten bersifat READ-ONLY.
// "sudah saya cek/periksa/baca/tampilkan" sengaja TIDAK termasuk.
const WRITE_CLAIM_PATTERNS: RegExp[] = [
  /\b(?:saya|aku)\s+(?:sudah|telah)\s+(?:mem)?(?:verifikasi|menghapus|hapus|menugaskan|tugaskan|mengubah|ubah|membuat|buat|mengirim|kirim|mereset|reset|menonaktifkan|nonaktifkan|menerbitkan|terbitkan)\b/i,
  /\bberhasil\s+(?:saya\s+)?(?:mem)?(?:verifikasi|hapus|tugaskan|ubah|buat|kirim|reset|nonaktifkan|terbitkan)\b/i,
  /\b(?:laporan|akun|pengumuman|tugas|status)\s+(?:sudah|telah)\s+saya\s+(?:mem)?(?:verifikasi|hapus|tugaskan|ubah|buat|kirim|reset|nonaktifkan|terbitkan)\b/i,
];

const RAW_JSON_PATTERN = /\{\s*"(?:error|items|result|total|name|status|data)"\s*:/i;
const PLACEHOLDER_PATTERN = /\[object Object\]|\bundefined\b|\bNaN\b/;
const FALSE_NO_ACCESS_PATTERN =
  /tidak\s+(?:memiliki|punya)\s+akses\s+(?:ke\s+)?data\s+(?:real-?time|langsung)|saya\s+tidak\s+(?:bisa|dapat)\s+mengakses\s+(?:database|data\s+(?:real-?time|langsung))/i;
const EMPTY_CLAIM_PATTERN =
  /tidak\s+ada\s+(?:data|laporan|akun|tugas|pengumuman)|0\s+(?:laporan|akun|tugas|pengumuman)|nol\s+(?:laporan|akun|tugas|pengumuman)/i;

function hasQueryError(toolResults: AnswerValidationInput['toolResults']): boolean {
  return toolResults.some((t) => {
    const r = t.result as any;
    return !!r && typeof r === 'object' && (r.error === 'query gagal' || r.error === 'forbidden');
  });
}

/**
 * Periksa jawaban LLM. Mengembalikan { ok: true } bila aman, atau alasan
 * penolakan yang aman dicatat di log server.
 */
export function validateChatAnswer(input: AnswerValidationInput): AnswerValidationResult {
  const answer = String(input.answer || '').trim();

  if (answer.length < 2) return { ok: false, reason: 'empty' };

  for (const re of SECRET_PATTERNS) {
    if (re.test(answer)) return { ok: false, reason: 'secret_leak' };
  }
  for (const re of WRITE_CLAIM_PATTERNS) {
    if (re.test(answer)) return { ok: false, reason: 'write_claim' };
  }
  if (RAW_JSON_PATTERN.test(answer)) return { ok: false, reason: 'raw_json' };
  if (PLACEHOLDER_PATTERN.test(answer)) return { ok: false, reason: 'placeholder' };

  if (input.hasTools && FALSE_NO_ACCESS_PATTERN.test(answer)) {
    return { ok: false, reason: 'false_no_access' };
  }

  // Jangan biarkan gangguan query disamarkan sebagai "data kosong".
  if (hasQueryError(input.toolResults) && EMPTY_CLAIM_PATTERN.test(answer)) {
    return { ok: false, reason: 'error_as_empty' };
  }

  return { ok: true };
}

/**
 * Tipe bersama lapisan AI.
 *
 * Dipisah dari aiIntent.ts agar modul pendukung (mis. penyimpanan riwayat
 * percakapan) dapat memakai tipe ini TANPA mengimpor modul layanan AI.
 * Penjaga arsitektur (tests/ai.drift.test.ts) hanya mengizinkan modul AI
 * (aiChat/aiIntent/aiToolRegistry) yang dipakai endpoint chat; modul netral
 * seperti ini menjaga aturan itu tetap bermakna.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Batas giliran percakapan yang dipertahankan dan dikirim ke LLM.
 *
 * SATU-SATUNYA sumber angka ini. aiChat.ts, aiSessionStore.ts, aiIntent.ts,
 * dan ketiga komponen frontend memakai konstanta yang sama agar "berapa
 * giliran yang diingat" tidak berbeda antar lapisan (sebelumnya berbeda:
 * 6 di aiChat, 16 di aiSessionStore, dan 12 di slice frontend).
 *
 * SATU giliran = satu pesan (user ATAU assistant). 12 giliran berarti
 * 6 pasang tanya-jawab — cukup untuk seluruh skenario multi-turn dan
 * nyaman di dalam context window model mana pun.
 */
export const CHAT_HISTORY_TURNS = 12;

/**
 * Bentuk balasan singkat pengguna terhadap pertanyaan assistant terakhir.
 *
 * 'affirmative'  : ya/iya/ada/boleh/ok - menyatakan persetujuan atau kesediaan.
 * 'negative'     : tidak/belum/nope - menyatakan penolakan.
 * 'continuation' : lanjut/lanjutkan/berikutnya - meminta agar timid.
 * 'none'         : bukan balasan singkat (pesan normal).
 */
export type ReplyTone = 'affirmative' | 'negative' | 'continuation' | 'none';

/**
 * Konteks balasan singkat yang bergantung pada pertanyaan assistant TERAKHIR.
 *
 * 'open_offer'    : assistant menawar bantuan ("Ada yang bisa saya bantu?").
 *                   Balasan singkat di sini berarti "ya, saya ada pertanyaan".
 * 'clarification' : assistant meminta klarifikasi atas pilihan/jawaban.
 * 'yes_no'        : assistant menanyakan konfirmasi ya/tidak.
 * 'data'          : assistant terakhir menjawab dengan data (bukan pertanyaan).
 * 'none'          : tidak ada pertanyaan assistant yang menunggu jawaban.
 */
export type AssistantQuestionKind = 'open_offer' | 'clarification' | 'yes_no' | 'data' | 'none';

/**
 * Balasan singkat pengguna yang diinterpretasi BERDASARKAN pertanyaan
 * assistant terakhir, bukan berdasarkan kata kunci saja.
 */
export interface PendingReply {
  /** Nada balasan yang dikenali dari pesan pengguna. */
  tone: Exclude<ReplyTone, 'none'>;
  /** Bentuk pertanyaan assistant yang sedang menunggu jawaban. */
  questionKind: AssistantQuestionKind;
  /** Ringkasan pertanyaan assistant terakhir (dipotong). */
  question: string;
}

/** Permintaan pemanggilan tool (dipilih router, dieksekusi registry). */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Hasil eksekusi sebuah tool. */
export interface ToolResult {
  name: string;
  result: unknown;
}

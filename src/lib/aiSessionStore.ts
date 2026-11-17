/**
 * PENYIMPANAN RIWAYAT PERCAKAPAN (SESSION-SCOPED, PROSES LOKAL).
 *
 * Mengapa tidak memakai tabel database baru:
 * - Struktur yang ada (Report/Assignment/User/…) tidak menyimpan pesan chat.
 * - Menambah tabel adalah perubahan skema. Agar tidak mengambil risiko yang
 *   tidak perlu, modul ini menyimpan riwayat di memori proses dengan batas
 *   TTL dan ukuran. Riwayat tetap TERIKAT pada userId + sessionId, sehingga
 *   percakapan antar pengguna tidak pernah tercampur.
 *
 * Catatan jujur: penyimpanan ini tidak bertahan setelah server restart dan
 * tidak dibagi antar instance. Klien tetap mengirim riwayatnya sendiri
 * (body.history); modul ini adalah lapisan pendukung bila klien tidak
 * mengirimkannya. Untuk persistensi permanen, diperlukan tabel baru dan
 * persetujuan pemilik sistem.
 *
 * Isolasi:
 *  - Kunci sesi adalah userId + sessionId, sehingga percakapan antar pengguna
 *    tidak pernah tercampur.
 *  - Role ikut disimpan. Bila role akun BERUBAH di tengah sesi (mis. Admin
 *    diturunkan menjadi Masyarakat), konteks lama milik role sebelumnya
 *    dibuang: jawaban/ringkasan milik role lama tidak boleh terbawa ke role
 *    baru yang haknya lebih kecil.
 */

import type { ChatTurn } from './aiTypes';
import { CHAT_HISTORY_TURNS } from './aiTypes';

const TTL_MS = 2 * 60 * 60 * 1000; // 2 jam
const MAX_SESSIONS = 200;
/**
 * Batas giliran percakapan yang disimpan. memakai konstanta yang sama dengan
 * aiChat.ts dan aiTypes.ts supaya "berapa giliran yang diingat" konsisten di
 * semua lapisan (sebelumnya angka ini berbeda-beda: 6 / 16 / 12).
 */
const MAX_TURNS = CHAT_HISTORY_TURNS;
const MAX_CHARS = 1000;

interface StoredSession {
  userId: string;
  /** Role akun pemilik sesi saat giliran terakhir ditambahkan. */
  role?: string;
  turns: ChatTurn[];
  updatedAt: number;
}

const sessions = new Map<string, StoredSession>();

function prune(now = Date.now()): void {
  for (const [key, value] of sessions) {
    if (now - value.updatedAt > TTL_MS) sessions.delete(key);
  }
  // Batas keras: buang sesi paling lama bila melebihi kapasitas.
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < oldest.length - MAX_SESSIONS; i += 1) {
      sessions.delete(oldest[i][0]);
    }
  }
}

function keyOf(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

/** Validasi ID sesi dari klien; tolak nilai aneh/terlalu panjang. */
export function sanitizeSessionId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) return undefined;
  return id;
}

/**
 * Ambil riwayat percakapan milik satu sesi.
 *
 * Isolasi:
 *  - Sesi milik user lain TIDAK PERNAH dikembalikan (kunci userId+sessionId).
 *  - Bila role akun berubah sejak giliran terakhir disimpan, konteks lama
 *    milik role sebelumnya DIBUANG, bukan sekadar dibaca. Ini mencegah
 *    ringkasan data ADMIN (mis. daftar akun, angka internal) terbawa ke sesi
 *    yang sekarang dijalankan sebagai CITIZEN/OFFICER.
 *
 * `role` opsional: bila tidak diberikan, perilaku lama dipertahankan (hanya
 * isolasi per user+session).
 */
export function getSessionHistory(
  userId: string,
  sessionId: string,
  role?: string
): ChatTurn[] {
  prune();
  const key = keyOf(userId, sessionId);
  const found = sessions.get(key);
  if (!found || found.userId !== userId) return [];
  if (role && found.role && found.role !== role) {
    // Role berubah: buang seluruh konteks sesi ini.
    sessions.delete(key);
    return [];
  }
  return found.turns.slice(-MAX_TURNS);
}

/**
 * Simpan satu giliran (user atau assistant) ke riwayat sesi.
 *
 * `role` opsional. Bila diberikan dan berbeda dari role sesi sebelumnya,
 * giliran LAMA dibuang lebih dulu: sesi dianggap baru untuk role baru.
 */
export function appendSessionTurn(
  userId: string,
  sessionId: string,
  turn: ChatTurn,
  role?: string
): void {
  if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) return;
  const content = typeof turn.content === 'string' ? turn.content.trim().slice(0, MAX_CHARS) : '';
  if (!content) return;
  prune();
  const key = keyOf(userId, sessionId);
  const existing = sessions.get(key);
  const sameOwner = existing && existing.userId === userId;
  // Role berubah => mulai sesi baru (konteks lama tidak diwarisi).
  const roleChanged = !!(role && sameOwner && existing!.role && existing!.role !== role);
  const turns = sameOwner && !roleChanged ? existing!.turns : [];
  // Anti-duplikasi giliran user: bila giliran terakhir yang disimpan adalah
  // pesan user dengan isi yang sama (mis. pengguna menekan "kirim ulang"),
  // giliran itu DIPERBARUI, bukan ditambahkan lagi. Tanpa ini, riwayat
  // server akan menyimpan pesan terbaru dua kali.
  const lastTurn = turns[turns.length - 1];
  if (
    turn.role === 'user' &&
    lastTurn &&
    lastTurn.role === 'user' &&
    lastTurn.content === content
  ) {
    turns[turns.length - 1] = { role: turn.role, content };
  } else {
    turns.push({ role: turn.role, content });
  }
  sessions.set(key, {
    userId,
    role: role ?? (sameOwner ? existing!.role : undefined),
    turns: turns.slice(-MAX_TURNS),
    updatedAt: Date.now(),
  });
}

/**
 * Gabungkan riwayat server + riwayat dari klien. Deduplikasi berdasarkan
 * role+isi agar pesan yang dikirim ulang tidak muncul dua kali.
 */
export function mergeHistory(server: ChatTurn[], client: ChatTurn[]): ChatTurn[] {
  const seen = new Set<string>();
  const out: ChatTurn[] = [];
  for (const turn of [...server, ...client]) {
    if (!turn || typeof turn.content !== 'string') continue;
    const content = turn.content.trim().slice(0, MAX_CHARS);
    if (!content) continue;
    const key = `${turn.role}:${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role: turn.role, content });
  }
  return out.slice(-MAX_TURNS);
}

export function clearSession(userId: string, sessionId: string): void {
  sessions.delete(keyOf(userId, sessionId));
}

/** Untuk observabilitas/test: jumlah sesi aktif (tanpa isi pesan). */
export function sessionStoreSize(): number {
  prune();
  return sessions.size;
}

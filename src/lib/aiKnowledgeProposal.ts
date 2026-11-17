/**
 * USULAN PENYIMPANAN PENGETAHUAN AI — dua fase (usulan → konfirmasi → simpan).
 *
 * Mengapa dua fase:
 * - Dulu, satu kalimat pendapat/keluhan ("menurut saya petugasnya lambat")
 *   LANGSUNG menulis baris ke basis pengetahuan tanpa persetujuan siapa pun.
 * - Sekarang penyimpanan hanya terjadi setelah pengguna MENGAHKAN usulan
 *   tertentu, memakai token sekali pakai yang terikat pada pengguna + sesi.
 *
 * Sifat:
 * - Token hanya berlaku sekali (setelah dipakai atau dibatalkan tidak berlaku).
 * - Masa berlaku pendek (10 menit).
 * - Token terikat pada userId + sessionId: tidak bisa dipakai akun lain,
 *   dan tidak bisa dipakai di sesi/percakapan lain.
 * - Penyimpanan IN-MEMORY (tidak menambah tabel/migrasi). Usulan yang belum
 *   dikonfirmasi hilang bila server restart — dan itu aman: tidak ada data
 *   yang tersimpan tanpa persetujuan.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

const TTL_MS = 10 * 60 * 1000; // 10 menit
const MAX_PROPOSALS = 100;

export interface KnowledgeProposal {
  id: string;
  /** Token konfirmasi sekali pakai (disampaikan ke pengguna). */
  token: string;
  /** Pengguna yang membuat usulan (pemilik unik proposals). */
  userId: string;
  /** Sesi percakapan tempat usulan dibuat. */
  sessionId: string;
  title: string;
  content: string;
  category: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const proposals = new Map<string, KnowledgeProposal>();

function prune(now = Date.now()): void {
  for (const [id, p] of proposals) {
    if (now > p.expiresAt || (p.used && now > p.expiresAt)) proposals.delete(id);
  }
  if (proposals.size > MAX_PROPOSALS) {
    const oldest = [...proposals.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < oldest.length - MAX_PROPOSALS; i += 1) {
      proposals.delete(oldest[i].id);
    }
  }
}

/** Normalisasi session id (bisa kosong bila klien tidak mengirim sessionId). */
function sid(sessionId: string | undefined | null): string {
  return String(sessionId || '').slice(0, 80);
}

export interface CreateProposalInput {
  userId: string;
  sessionId?: string | null;
  title: string;
  content: string;
  category: string;
}

/** Buat usulan baru (belum tersimpan ke database). */
export function createKnowledgeProposal(input: CreateProposalInput): KnowledgeProposal {
  const now = Date.now();
  prune(now);
  const proposal: KnowledgeProposal = {
    id: randomBytes(8).toString('hex'),
    token: randomBytes(16).toString('hex'),
    userId: input.userId,
    sessionId: sid(input.sessionId),
    title: input.title.slice(0, 200),
    content: input.content.slice(0, 5000),
    category: input.category.slice(0, 40),
    createdAt: now,
    expiresAt: now + TTL_MS,
    used: false,
  };
  proposals.set(proposal.token, proposal);
  return proposal;
}

/** Cari usulan tanpa mengubah status (untuk menampilka daftar usulan aktif). */
export function listPendingProposals(userId: string, sessionId?: string | null): KnowledgeProposal[] {
  const now = Date.now();
  prune(now);
  const s = sid(sessionId);
  return [...proposals.values()].filter(
    (p) => p.userId === userId && p.sessionId === s && !p.used && p.expiresAt > now
  );
}

/**
 * Pakai token konfirmasi: WAJIB milik pengguna + sesi yang sama, belum
 * dipakai, dan belum kedaluwarsa. Token langsung ditandai terpakai sehingga
 * tidak dapat dipakai ulang.
 */
export function consumeKnowledgeProposal(
  userId: string,
  sessionId: string | null | undefined,
  token: string
): { ok: true; proposal: KnowledgeProposal } | { ok: false; reason: 'token_kosong' | 'tidak_ada' | 'kedaluwarsa' | 'tidak_sesuai' } {
  const now = Date.now();
  prune(now);
  const t = String(token || '').trim().toLowerCase();
  if (!t) return { ok: false, reason: 'token_kosong' };

  const proposal = proposals.get(t);
  if (!proposal) return { ok: false, reason: 'tidak_ada' };
  if (proposal.used) return { ok: false, reason: 'tidak_ada' };
  if (proposal.expiresAt <= now) return { ok: false, reason: 'kedaluwarsa' };

  // Perbandingan aman waktu (timing-safe) untuk id + user + sesi.
  const sameUser = proposal.userId.length === userId.length &&
    timingSafeEqual(Buffer.from(proposal.userId), Buffer.from(userId));
  const sameSession = proposal.sessionId === sid(sessionId);
  if (!sameUser || !sameSession) {
    return { ok: false, reason: 'tidak_sesuai' };
  }

  proposal.used = true;
  proposals.set(t, proposal);
  return { ok: true, proposal };
}

/** Batalkan seluruh usulan aktif milik pengguna+sesi. */
export function cancelKnowledgeProposals(userId: string, sessionId?: string | null): number {
  prune();
  const s = sid(sessionId);
  let count = 0;
  for (const [token, p] of proposals) {
    if (p.userId === userId && p.sessionId === s && !p.used) {
      proposals.delete(token);
      count += 1;
    }
  }
  return count;
}

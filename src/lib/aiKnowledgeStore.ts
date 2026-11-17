/**
 * Penulis entri Pengetahuan AI.
 *
 * Kenapa modul terpisah:
 * - Lapisan tool AI (src/lib/aiTools.ts) WAJIB read-only; penjaga
 *   arsitektur (tests/ai.drift.test.ts) menolak operasi tulis di file itu.
 * - Kemampuan "simpan pengetahuan" memang ada, tetapi harus terkisolasi di
 *   satu berkas yang jelas agar dapat diaudit, bukan tersamar di lapisan baca.
 *
 * Entri yang dibuat lewat sini SELALU berstatus belum diverifikasi
 * (verified=false): ia adalah dugaan/laporan pengguna, bukan fakta resmi.
 */

import { prisma } from '@/lib/prisma';
import type { ChatRole } from './aiTools';

export const AI_KNOWLEDGE_CATEGORIES = [
  'KELUHAN',
  'SARAN',
  'FASILITAS',
  'KINERJA_PETUGAS',
  'KEGIATAN_DESA',
  'LAINNYA',
] as const;

export interface SaveAiKnowledgeInput {
  title?: string;
  content?: string;
  category?: string;
}

/**
 * Simpan entri pengetahuan dari percakapan. Mengembalikan bentuk seragam:
 * `{ error: 'kategori_tidak_valid' | 'judul_atau_isi_kosong' }` atau
 * `{ saved: true, entry }`.
 */
export async function persistAiKnowledge(
  args: SaveAiKnowledgeInput,
  ctx: { userId: string; role: ChatRole }
): Promise<
  | { saved: true; entry: { id: string; title: string; category: string; verified: boolean; createdAt: Date } }
  | { error: 'kategori_tidak_valid' | 'judul_atau_isi_kosong' }
> {
  const title = String(args.title || 'Catatan dari percakapan').trim().slice(0, 200);
  const content = String(args.content || '').trim().slice(0, 5000);
  const category = String(args.category || 'LAINNYA').toUpperCase();
  if (!(AI_KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)) {
    return { error: 'kategori_tidak_valid' };
  }
  if (!title || !content) {
    return { error: 'judul_atau_isi_kosong' };
  }

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });

  const entry = await prisma.aiKnowledgeEntry.create({
    data: {
      title,
      content,
      category,
      sourceType: 'CHAT',
      sourceRole: ctx.role,
      sourceUserId: ctx.userId,
      sourceUserName: user?.name || null,
      // PENTING: entri dari percakapan SELALU belum diverifikasi.
      verified: false,
    },
    select: {
      id: true,
      title: true,
      category: true,
      verified: true,
      createdAt: true,
    },
  });

  return { saved: true, entry };
}

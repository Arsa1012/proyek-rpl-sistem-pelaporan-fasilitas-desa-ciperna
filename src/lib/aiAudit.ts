/**
 * AUDIT AKTIVITAS AI — memakai fasilitas audit yang SUDAH ADA (AdminAuditLog).
 *
 * Prinsip:
 * - Tidak ada tabel/migrasi baru: memakai `logAdminAction` (src/lib/auditLog.ts)
 *   yang sudah menulis ke model AdminAuditLog.
 * - Yang dicatat: siapa (userId), role, tool, waktu (createdAt), status, dan
 *   ringkasan hasil (jumlah baris/durasi). TIDAK ada argumen, isi hasil,
 *   nomor telepon, nama pengguna, token, atau kredensial.
 * - Best-effort: kegagalan audit tidak boleh menggagalkan jawaban AI.
 */

import { logAdminAction } from './auditLog';
import type { ChatRole } from './aiTools';

/** Tool yang tidak menyentuh data sehingga tidak perlu dicatat (mengganggu). */
const NON_AUDITED_TOOLS = new Set(['askClarification', 'refusePrivate', 'refuseWrite']);

export interface AiToolActivity {
  userId: string;
  role: ChatRole;
  tool: string;
  /** 'ok' | 'error' | 'forbidden'. */
  status: string;
  durationMs?: number;
  /** Jumlah hasil (baris) bila tersedia — bukan isi hasilnya. */
  resultCount?: number;
}

/**
 * Catat satu eksekusi tool AI ke AdminAuditLog.
 * Never throws (best-effort, ditangani di logAdminAction).
 */
export async function logAiToolActivity(input: AiToolActivity): Promise<void> {
  try {
    if (NON_AUDITED_TOOLS.has(input.tool)) return;
    const parts: string[] = [
      `role=${input.role}`,
      `status=${input.status}`,
    ];
    if (typeof input.durationMs === 'number') parts.push(`ms=${input.durationMs}`);
    if (typeof input.resultCount === 'number') parts.push(`rows=${input.resultCount}`);
    await logAdminAction({
      adminId: input.userId,
      action: `AI_TOOL_${input.tool}`,
      notes: parts.join(' '),
    });
  } catch {
    // Tidak ada yang boleh gagal di sini.
  }
}

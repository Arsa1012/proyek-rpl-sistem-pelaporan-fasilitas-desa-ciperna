/**
 * SMART RETRIEVAL — lapisan setelah tool pertama dijalankan.
 *
 * Mengapa perlu:
 * - Router memilih tool dari niat + konteks, tetapi ia belum tahu isi hasilnya.
 *   Akibatnya pertanyaan lanjutan seperti "petugasnya siapa?" bisa berhenti pada
 *   daftar 5 laporan, dan AI menjawab umum atau "tidak tahu".
 * - Pencarian dengan filter terlalu sempit (status/tanggal) bisa menghasilkan 0
 *   padahal data yang dimaksud ada. Lapisan ini mencoba pencarian alternatif
 *   yang AMAN: hanya melepas filter penyempit, TIDAK pernah melepas batas
 *   kepemilikan (userId) atau role.
 *
 * Lapisan ini tidak pernah menyentuh database secara langsung. Ia hanya
 * menyusun tool call tambahan yang tetap dieksekusi lewat aiToolRegistry
 * (otorisasi server-side).
 */

import type { ChatRole } from './aiTools';
import type { ToolCall, ToolResult } from './aiTypes';
import { formatCandidateClarification, pickReportCandidate } from './aiCandidates';

export interface RetrievalPlan {
  /** Tool tambahan yang harus dijalankan (detail atau pencarian longgar). */
  extraTools: ToolCall[];
  /** Bila ada beberapa kandidat, minta pengguna memilih. */
  clarification?: string;
  /** True bila rencana berisi pencarian alternatif. */
  relaxed: boolean;
  /** Penjelasan singkat untuk prompt/meta (bukan rahasia). */
  note?: string;
}

const DETAIL_TOOL: Record<ChatRole, string> = {
  CITIZEN: 'getMyReportFullDetail',
  OFFICER: 'getMyTaskDetail',
  ADMIN: 'getReportFullDetail',
};

const SEARCH_TOOLS = new Set([
  'searchMyReports',
  'searchMyTasks',
  'listReports',
  'searchReportsByKeyword',
  'searchReportsByTitle',
  'getMyRecentReports',
  'getMyActiveTasks',
]);

const DETAIL_TOOLS = new Set([
  'getMyReportFullDetail',
  'getMyReportById',
  'getMyTaskDetail',
  'getReportFullDetail',
  'getMyReportTimeline',
  'getMyTaskTimeline',
]);

function isError(result: unknown): boolean {
  return Boolean((result as any)?.error);
}

function resultItems(result: unknown): any[] {
  const r = result as any;
  if (Array.isArray(r)) return r;
  if (Array.isArray(r?.items)) return r.items;
  return [];
}

function resultTotal(result: unknown): number {
  const r = result as any;
  if (typeof r?.total === 'number') return r.total;
  const items = resultItems(result);
  if (items.length) return items.length;
  return 0;
}

function appliedFilters(result: unknown): string[] {
  const r = result as any;
  return Array.isArray(r?.appliedFilters) ? r.appliedFilters : [];
}

/**
 * Apakah pertanyaan meminta DETAIL satu laporan/tugas, bukan daftar/jumlah?
 * Sengaja konservatif: "berapa/daftar/tampilkan" dianggap bukan detail.
 */
export function wantsSpecificDetail(message: string): boolean {
  const text = (message || '').toLowerCase();
  const detail =
    /\b(petugas|petugasnya|ditangani|diproses|dikerjakan|diperbaiki|status|statusnya|kapan|terakhir|diperbarui|diupdate|update|progres|progress|perkembangan|timeline|riwayat|detail|rinci|kenapa|mengapa|kok|alasan|catatan|bukti|selesai|belum)\b/.test(
      text
    );
  const listOrCount =
    /\b(berapa|jumlah|total|daftar|tampilkan|sebutkan|apa saja|semua|rincian)\b/.test(text);
  return detail && !listOrCount;
}

function hasTextFilter(args: Record<string, unknown>): boolean {
  return ['category', 'damageType', 'location', 'title', 'keyword'].some(
    (k) => typeof args[k] === 'string' && String(args[k]).trim().length > 0
  );
}

function candidateId(item: any): string | undefined {
  const id = item?.id || item?.reportId;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

function candidateTitle(item: any): string | undefined {
  return typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : undefined;
}

function detailCall(role: ChatRole, id: string): ToolCall {
  return { name: DETAIL_TOOL[role], args: { idFragment: id } };
}

/**
 * Susun tool tambahan berdasarkan hasil tool pertama.
 *
 * Aturan:
 * 1. Jika pertanyaan meminta detail dan hasil pencarian hanya 1 → ambil detail.
 * 2. Jika hasil pencarian > 1 dan pengguna tidak memilih → klarifikasi.
 * 3. Jika hasil kosong tetapi ada filter teks → cari ulang tanpa filter
 *    penyempit (status/tanggal/keparahan). Scope kepemilikan tetap.
 */
export function analyzeRetrieval(
  role: ChatRole,
  message: string,
  tools: ToolCall[],
  toolResults: ToolResult[]
): RetrievalPlan {
  const called = new Set(toolResults.map((t) => t.name));
  const alreadyDetail = toolResults.some((t) => DETAIL_TOOLS.has(t.name));
  const primary = toolResults.find(
    (t) => SEARCH_TOOLS.has(t.name) && !isError(t.result)
  );

  if (!primary) return { extraTools: [], relaxed: false };

  const items = resultItems(primary.result);
  const total = resultTotal(primary.result);
  const wantsDetail = wantsSpecificDetail(message);

  // 1) Auto-detail bila tepat satu kandidat.
  if (wantsDetail && !alreadyDetail && items.length === 1) {
    const id = candidateId(items[0]);
    if (id) {
      return {
        extraTools: [detailCall(role, id)],
        relaxed: false,
        note: 'Satu kandidat ditemukan; detail dibaca langsung dari database.',
      };
    }
  }

  // 2) Klarifikasi bila banyak kandidat dan pengguna tidak memilih.
  if (wantsDetail && !alreadyDetail && items.length > 1) {
    const candidates = items
      .map((item) => {
        const id = candidateId(item);
        return id ? { id, title: candidateTitle(item) } : null;
      })
      .filter((x): x is { id: string; title: string | undefined } => !!x);

    if (candidates.length > 1) {
      const picked = pickReportCandidate(message.toLowerCase(), candidates);
      if (picked) {
        return {
          extraTools: [detailCall(role, picked.id)],
          relaxed: false,
          note: 'Pengguna memilih salah satu kandidat berdasarkan nomor/urutan.',
        };
      }
      return {
        extraTools: [],
        clarification: formatCandidateClarification(
          candidates,
          primary.name === 'searchMyTasks' || primary.name === 'getMyActiveTasks'
            ? 'tugas'
            : 'laporan'
        ),
        relaxed: false,
        note: 'Beberapa kandidat; klarifikasi diperlukan agar tidak salah data.',
      };
    }
  }

  // 3) Pencarian alternatif bila kosong dan filter teks terlalu sempit.
  if (total === 0 && !alreadyDetail) {
    const original = tools.find((t) => t.name === primary.name);
    const args = (original?.args || {}) as Record<string, unknown>;
    const filters = appliedFilters(primary.result);
    const hadFilters = filters.length > 0 || Object.keys(args).length > 0;
    if (!hadFilters || !hasTextFilter(args)) {
      return { extraTools: [], relaxed: false };
    }

    if (primary.name === 'searchMyReports' || primary.name === 'searchMyTasks' || primary.name === 'listReports') {
      const relaxedArgs: Record<string, unknown> = { ...args };
      // Hanya melepas filter penyempit. Filter teks (kategori/lokasi/judul/
      // kata kunci) dipertahankan agar hasil tetap relevan.
      for (const key of [
        'status',
        'statusNotFinal',
        'severity',
        'period',
        'dateFrom',
        'dateTo',
        'sort',
        'offset',
      ]) {
        delete relaxedArgs[key];
      }
      if (primary.name === 'listReports') {
        delete relaxedArgs.reporterName;
        delete relaxedArgs.officerName;
      }
      relaxedArgs.limit = Math.min(Math.max(Number(args.limit) || 8, 5), 10);
      return {
        extraTools: [{ name: primary.name, args: relaxedArgs }],
        relaxed: true,
        note:
          'Filter awal tidak menemukan hasil; filter status/tanggal/keparahan dilepas, ' +
          'tetapi batas kepemilikan dan role tetap dipertahankan.',
      };
    }
  }

  return { extraTools: [], relaxed: false };
}

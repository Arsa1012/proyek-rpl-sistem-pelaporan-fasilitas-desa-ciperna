/**
 * TOOL REGISTRY — SATU tempat yang menentukan:
 *   1. tool apa saja yang boleh dipanggil AI,
 *   2. role mana yang berhak memakainya (otorisasi server-side),
 *   3. fungsi database mana yang menjalankannya.
 *
 * Mengapa: versi sebelumnya memakai `switch` panjang di aiChat.ts. Jika ada tool
 * baru tetapi lupa menambahkan `case`, tool tersebut diam-diam mengembalikan
 * "unknown tool". Dengan registry ini, test dapat memastikan SETIAP tool yang
 * mungkin dihasilkan aiIntent.ts benar-benar terdaftar, dan role yang tidak
 * berhak otomatis ditolak sebelum query dijalankan.
 *
 * Aturan: tool AI tidak pernah mengubah DATA BISNIS aplikasi (verifikasi,
 * penugasan, ubah status, kirim WhatsApp, dsb). Satu-satunya kemampuan tulis
 * milik AI adalah penyimpanan entri PENGETAHUAN, dan itupun dua fase:
 * usulan → konfirmasi eksplisit pengguna → disimpan sebagai entri BELUM
 * DIVERIFIKASI. Implementasi tulisnya diisolasi di src/lib/aiKnowledgeStore.ts.
 */

import type { ChatRole, ReportFilter, MyReportSearch, MyTaskFilter, DimensionStatsFilter } from './aiTools';
import * as T from './aiTools';
import type { ToolCall, ToolResult } from './aiTypes';
import { logAiToolActivity } from './aiAudit';

export type { ToolCall, ToolResult } from './aiTypes';

interface ToolDef {
  /** Role yang diizinkan memanggil tool ini. */
  roles: ChatRole[];
  /** Deskripsi singkat (dipakai untuk audit/testing). */
  description: string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Konteks eksekusi tool — berasal dari session server, bukan dari model. */
export interface ToolContext {
  userId: string;
  role: ChatRole;
  /** Sesi percakapan (dipakai untuk mengikat usulan penyimpanan). */
  sessionId?: string;
}

const ADMIN: ChatRole[] = ['ADMIN'];
const CITIZEN: ChatRole[] = ['CITIZEN'];
const OFFICER: ChatRole[] = ['OFFICER'];
const ALL_ROLES: ChatRole[] = ['CITIZEN', 'ADMIN', 'OFFICER'];

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  // --- Umum (semua role), hanya membaca pengetahuan fitur website ---
  askClarification: {
    roles: ALL_ROLES,
    description: 'Meminta satu klarifikasi singkat saat pertanyaan ambigu; tidak membaca/mengubah data.',
    run: (a) =>
      Promise.resolve({
        clarification: true,
        message:
          String(a.message || '').trim() ||
          'Bisa diperjelas sedikit, Admin? Saya ingin memastikan pertanyaannya sebelum mengambil data.',
      }),
  },
  getWebsiteInfo: {
    roles: ALL_ROLES,
    description: 'Menjelaskan halaman, menu, fitur, status, dan alur website sesuai role.',
    run: (a, ctx) => T.getWebsiteInfo(String(a.topic || 'help'), ctx.role),
  },
  getVillageProfileInfo: {
    roles: ALL_ROLES,
    description: 'Profil/identitas Desa Ciperna dari database (sejarah, kondisi, visi & misi, kontak, status verifikasi).',
    run: () => T.getVillageProfileInfo(),
  },
  getVillageOfficials: {
    roles: ALL_ROLES,
    description: 'Perangkat desa/RT/RW yang sudah diverifikasi (data publik, tanpa nomor pribadi).',
    run: (a) => T.getVillageOfficials(a.position ? String(a.position) : undefined),
  },
  getVillageServices: {
    roles: ALL_ROLES,
    description: 'Daftar layanan/pelayanan desa yang tercatat dan terverifikasi.',
    run: () => T.getVillageServices(),
  },
  getVillageAnnouncements: {
    roles: ALL_ROLES,
    description:
      'Pengumuman desa yang sudah diterbitkan; bisa difilter tanggal terbit hari ini (WIB).',
    run: (a) => T.getVillageAnnouncements(Number(a.limit) || 5, {
      period: typeof a.period === 'string' ? a.period : undefined,
    }),
  },
  getVillageMapInfo: {
    roles: ALL_ROLES,
    description: 'Lokasi, alamat, dan tautan peta desa (untuk pertanyaan arah/lokasi).',
    run: () => T.getVillageMapInfo(),
  },

  // --- Masyarakat: HANYA data milik sendiri ---
  getMyReportCounts: {
    roles: CITIZEN,
    description: 'Jumlah laporan milik pengguna beserta rincian status.',
    run: (a, ctx) => {
      const status = a?.status;
      const statusList =
        typeof status === 'string'
          ? [status]
          : Array.isArray(status)
            ? status
            : undefined;
      return T.getMyReportCounts(ctx.userId, statusList);
    },
  },
  compareMyReportPeriods: {
    roles: CITIZEN,
    description: 'Perbandingan jumlah laporan milik pengguna bulan ini vs bulan lalu.',
    run: (_a, ctx) => T.compareMyReportPeriods(ctx.userId),
  },
  getMyRecentReports: {
    roles: CITIZEN,
    description: 'Laporan terbaru milik pengguna.',
    run: (a, ctx) => T.getMyRecentReports(ctx.userId, Number(a.limit) || 5),
  },
  getMyReportById: {
    roles: CITIZEN,
    description: 'Ringkas satu laporan milik pengguna berdasarkan fragmen ID.',
    run: (a, ctx) => T.getMyReportById(ctx.userId, String(a.idFragment || '')),
  },
  getMyReportTimeline: {
    roles: CITIZEN,
    description: 'Riwayat perubahan status satu laporan milik pengguna.',
    run: (a, ctx) => T.getMyReportTimeline(ctx.userId, String(a.idFragment || '')),
  },
  getMyReportFullDetail: {
    roles: CITIZEN,
    description: 'Detail lengkap satu laporan milik pengguna (status, petugas, bukti, timeline).',
    run: (a, ctx) => T.getMyReportFullDetail(ctx.userId, String(a.idFragment || '')),
  },
  searchMyReports: {
    roles: CITIZEN,
    description: 'Cari laporan milik pengguna dengan filter kategori/status/keparahan/periode/lokasi.',
    run: (a, ctx) => T.searchMyReports(ctx.userId, (a || {}) as MyReportSearch),
  },
  getMyEvidence: {
    roles: CITIZEN,
    description: 'Bukti penyelesaian pada laporan milik pengguna.',
    run: (a, ctx) => T.getMyEvidence(ctx.userId, String(a.idFragment || '') || undefined),
  },
  getMyProfile: {
    roles: CITIZEN,
    description: 'Profil pengguna yang sedang login (tanpa password).',
    run: (_a, ctx) => T.getMyProfile(ctx.userId),
  },
  getMyNotifications: {
    roles: CITIZEN,
    description: 'Notifikasi milik pengguna.',
    run: (a, ctx) => T.getMyNotifications(ctx.userId, Number(a.limit) || 5),
  },
  getMyDuplicateInfo: {
    roles: CITIZEN,
    description: 'Info laporan milik pengguna yang ditandai duplikat.',
    run: (_a, ctx) => T.getMyDuplicateInfo(ctx.userId),
  },
  getMyLatestHandling: {
    roles: CITIZEN,
    description: 'Petugas yang menangani laporan terbaru milik pengguna.',
    run: (_a, ctx) => T.getMyLatestHandling(ctx.userId),
  },
  getMyFollowUpHistory: {
    roles: CITIZEN,
    description: 'Riwayat tindak lanjut/status terbaru dari laporan-laporan milik pengguna.',
    run: (a, ctx) => T.getMyFollowUpHistory(ctx.userId, Number(a.limit) || 20),
  },
  getPublicOfficers: {
    roles: CITIZEN,
    description: 'Daftar nama petugas desa (data publik).',
    run: () => T.getPublicOfficers(),
  },
  getPublicAdmins: {
    roles: ALL_ROLES,
    description: 'Daftar nama admin sistem (data publik).',
    run: () => T.getPublicAdmins(),
  },
  getPublicCategories: {
    roles: CITIZEN,
    description: 'Kategori fasilitas yang sudah pernah dilaporkan (agregat publik).',
    run: () => T.getPublicCategories(),
  },
  getPublicLocations: {
    roles: CITIZEN,
    description: 'Lokasi dengan laporan terbanyak (agregat publik).',
    run: (a) => T.getPublicLocations(Number(a.limit) || 8),
  },
  getUserCounts: {
    roles: ALL_ROLES,
    description: 'Jumlah pengguna per role (tanpa identitas).',
    run: () => T.getUserCounts(),
  },
  getTotalReports: {
    // Agregat publik (jumlah per status), bukan identitas/isi laporan. Warga
    // dan Petugas boleh menerima angka agregat; daftar laporan tetap khusus
    // Admin atau milik sendiri.
    roles: [...CITIZEN, ...OFFICER],
    description: 'Total laporan sistem (agregat publik).',
    run: () => T.getTotalReports(),
  },
  refuseWrite: {
    roles: ALL_ROLES,
    description: 'Menolak tindakan mengubah/menghapus data dari percakapan; memberi panduan halaman resmi (READ-ONLY).',
    run: (a, ctx) => Promise.resolve(T.refuseWrite(String(a.action || ''), ctx.role)),
  },
  refusePrivate: {
    roles: [...CITIZEN, ...OFFICER],
    description: 'Menolak permintaan data milik pengguna lain dengan pesan tetap (sesuai role).',
    run: async (a, ctx) => {
      const scope = String(a.scope || '');
      if (scope === 'accounts') {
        const roleLabel = ctx.role === 'OFFICER' ? 'Petugas' : 'Masyarakat';
        return {
          refused: true,
          message:
            'Maaf, daftar akun dan data warga terdaftar bersifat internal dan hanya dapat diakses oleh Admin. ' +
            `Sesi login Anda saat ini tercatat sebagai ${roleLabel}. ` +
            'Jika Anda memang memegang akun Admin, pastikan sudah login dengan akun tersebut. ' +
            'Saya tetap dapat membantu dengan informasi publik desa atau data laporan/tugas milik Anda sendiri.',
        };
      }
      return {
        refused: true,
        message:
          ctx.role === 'OFFICER'
            ? 'Maaf, saya hanya dapat menampilkan tugas yang ditugaskan kepada Anda. Tugas petugas lain bersifat pribadi. Silakan buka menu Tugas Saya (/petugas/tugas) untuk melihat daftar tugas Anda.'
            : 'Maaf, daftar pelapor dan laporan milik warga lain bersifat pribadi dan tidak dapat saya tampilkan. Silakan lihat laporan milik Anda sendiri di halaman Laporan Saya (/masyarakat/laporan).',
      };
    },
  },

  // --- Petugas: HANYA tugas milik sendiri ---
  getMyTaskSummary: {
    roles: OFFICER,
    description: 'Ringkasan tugas petugas (total, aktif, dalam proses, selesai, menunggu verifikasi).',
    run: (_a, ctx) => T.getMyTaskSummary(ctx.userId),
  },
  getMyActiveTasks: {
    roles: OFFICER,
    description: 'Tugas aktif milik petugas.',
    run: (a, ctx) => T.getMyActiveTasks(ctx.userId, Number(a.limit) || 5),
  },
  getMyUrgentTasks: {
    roles: OFFICER,
    description: 'Tugas aktif dengan keparahan tinggi/kritis.',
    run: (a, ctx) => T.getMyUrgentTasks(ctx.userId, Number(a.limit) || 5),
  },
  searchMyTasks: {
    roles: OFFICER,
    description: 'Cari tugas petugas dengan filter status/keparahan/kategori/judul/lokasi/periode.',
    run: (a, ctx) => T.searchMyTasks(ctx.userId, (a || {}) as MyTaskFilter),
  },
  getMyTaskDetail: {
    roles: OFFICER,
    description:
      'Detail lengkap satu laporan yang ditugaskan kepada petugas yang login (status, petugas, bukti, riwayat). Menolak laporan yang bukan tugasnya.',
    run: (a, ctx) => T.getMyTaskDetail(ctx.userId, String(a.idFragment || '')),
  },

  // --- Admin: data operasional seluruh sistem ---
  getSystemStats: {
    roles: ADMIN,
    description: 'Statistik laporan per status (keseluruhan/bulan/pekan).',
    run: (a) => T.getSystemStats(Boolean(a.monthOnly), Boolean(a.weekOnly)),
  },
  getSystemOverview: {
    roles: ADMIN,
    description: 'Ringkasan kondisi sistem dalam satu panggilan.',
    run: () => T.getSystemOverview(),
  },
  getStatsByCategory: {
    roles: ADMIN,
    description: 'Jumlah laporan per kategori fasilitas (bisa dibatasi periode/severity).',
    run: (a) => T.getStatsByCategory((a || {}) as DimensionStatsFilter, Number(a.limit) || 10),
  },
  getStatsBySeverity: {
    roles: ADMIN,
    description: 'Jumlah laporan per tingkat keparahan (bisa dibatasi periode/kategori).',
    run: (a) => T.getStatsBySeverity((a || {}) as DimensionStatsFilter, Number(a.limit) || 10),
  },
  getStatsByLocation: {
    roles: ADMIN,
    description: 'Jumlah laporan per lokasi/wilayah (bisa dibatasi periode/kategori).',
    run: (a) => T.getStatsByLocation((a || {}) as DimensionStatsFilter, Number(a.limit) || 8),
  },
  getDamageTypeStats: {
    roles: ADMIN,
    description: 'Jumlah laporan per jenis kerusakan (bisa dibatasi periode/kategori).',
    run: (a) => T.getDamageTypeStats((a || {}) as DimensionStatsFilter, Number(a.limit) || 8),
  },
  getOfficerStats: {
    roles: ADMIN,
    description: 'Kinerja petugas (total/aktif/selesai).',
    run: () => T.getOfficerStats(),
  },
  getOfficerWorkload: {
    roles: ADMIN,
    description:
      'Direktori/beban kerja petugas: total, status akun, dan tugas aktif yang ditangani (dibatasi + hasMore).',
    run: (a) => T.getOfficerWorkload({
      isActive: typeof a.isActive === 'boolean' ? a.isActive : undefined,
      limit: Number(a.limit) || undefined,
      offset: Number(a.offset) || undefined,
    }),
  },
  getOfficerDetail: {
    roles: ADMIN,
    description: 'Detail seorang petugas berdasarkan nama.',
    run: (a) => T.getOfficerDetail(String(a.name || '')),
  },
  getAvgResolutionDays: {
    roles: ADMIN,
    description: 'Rata-rata waktu penyelesaian laporan (hari).',
    run: () => T.getAvgResolutionDays(),
  },
  getAvgAiConfidence: {
    roles: ADMIN,
    description: 'Rata-rata confidence hasil analisis AI.',
    run: () => T.getAvgAiConfidence(),
  },
  getCitizenStats: {
    roles: ADMIN,
    description: 'Statistik warga terdaftar.',
    run: () => T.getCitizenStats(),
  },
  getRecentCitizens: {
    roles: ADMIN,
    description: 'Warga yang baru mendaftar.',
    run: (a) => T.getRecentCitizens(Number(a.limit) || 8),
  },
  getReporters: {
    roles: ADMIN,
    description: 'Warga yang paling banyak melapor.',
    run: (a) => T.getReporters(Number(a.limit) || 10),
  },
  getRecentReports: {
    roles: ADMIN,
    description: 'Laporan terbaru di sistem.',
    run: (a) => T.getRecentReports(Number(a.limit) || 5),
  },
  getTodayReports: {
    roles: ADMIN,
    description: 'Laporan yang dibuat hari ini (WIB).',
    run: (a) => T.getTodayReports(Number(a.limit) || 15),
  },
  getTodayReporters: {
    roles: ADMIN,
    description: 'Nama pelapor hari ini (WIB).',
    run: () => T.getTodayReporters(),
  },
  getTodayCitizens: {
    roles: ADMIN,
    description: 'Warga yang mendaftar hari ini (WIB).',
    run: (a) => T.getTodayCitizens(Number(a.limit) || 15),
  },
  getTodaySummary: {
    roles: ADMIN,
    description: 'Rekap laporan hari ini per status.',
    run: () => T.getTodaySummary(),
  },
  getReportFullDetail: {
    roles: ADMIN,
    description: 'Detail lengkap satu laporan (pelapor, petugas, bukti, timeline, duplikat).',
    run: (a) => T.getReportFullDetail(String(a.idFragment || '')),
  },
  searchReportsByTitle: {
    roles: ADMIN,
    description: 'Cari laporan berdasarkan potongan judul (menyertakan penanda ambigu).',
    run: (a) => T.searchReportsByTitle(String(a.fragment || '')),
  },
  searchReportsByKeyword: {
    roles: ADMIN,
    description: 'Cari laporan dengan kata kunci bebas pada judul/deskripsi/lokasi/kategori/jenis (maks 15 hasil).',
    run: (a) => T.searchReportsByKeyword(String(a.keyword || a.q || ''), (a || {}) as ReportFilter),
  },
  getNthReport: {
    roles: ADMIN,
    description: 'Laporan ke-N berdasarkan urutan waktu pembuatan.',
    run: (a) => T.getNthReport(Number(a.n) || 0),
  },
  getUnverifiedQueue: {
    roles: ADMIN,
    description: 'Antrean laporan baru (SUBMITTED) menunggu verifikasi.',
    run: (a) => T.getUnverifiedQueue(Number(a.limit) || 8),
  },
  getPendingAssignment: {
    roles: ADMIN,
    description: 'Laporan terverifikasi yang belum ditugaskan ke petugas.',
    run: (a) => T.getPendingAssignment(Number(a.limit) || 8),
  },
  getPendingResultVerification: {
    roles: ADMIN,
    description: 'Laporan dengan bukti penyelesaian menunggu verifikasi admin (REVIEW).',
    run: (a) => T.getPendingResultVerification(Number(a.limit) || 8),
  },
  getHighSeverityReports: {
    roles: ADMIN,
    description: 'Laporan berkeparahan tinggi/kritis yang belum selesai.',
    run: (a) => T.getHighSeverityReports(Number(a.limit) || 8),
  },
  getStaleReports: {
    roles: ADMIN,
    description: 'Laporan lama yang belum ditangani.',
    run: (a) => T.getStaleReports(Number(a.days) || 7, Number(a.limit) || 8),
  },
  getRepeatedLocations: {
    roles: ADMIN,
    description: 'Lokasi dengan laporan berulang.',
    run: (a) => T.getRepeatedLocations(Number(a.limit) || 8),
  },
  getDuplicateOverview: {
    roles: ADMIN,
    description: 'Ringkasan laporan duplikat dan kandidatnya.',
    run: () => T.getDuplicateOverview(),
  },
  explainReportAnalysis: {
    roles: ADMIN,
    description: 'Menjelaskan hasil analisis AI tersimpan: kategori, urgensi + alasan, confidence, fakta, informasi yang belum tersedia, dan tindakan disarankan.',
    run: (a) => T.explainReportAnalysis(String(a.idFragment || a.fragment || '')),
  },
  findReportDuplicateCandidates: {
    roles: ADMIN,
    description: 'Menilai kandidat duplikat untuk satu laporan (termasuk kategori "Tidak cukup bukti"). READ-ONLY.',
    run: (a) => T.findReportDuplicateCandidates(String(a.idFragment || a.fragment || ''), Number(a.limit) || 3),
  },
  getAnalysisStatusRecap: {
    roles: ADMIN,
    description: 'Rekap status analisis AI (menunggu/sedang/berhasil/gagal/perlu ditinjau) beserta daftar yang gagal.',
    run: () => T.getAnalysisStatusRecap(),
  },
  listReports: {
    roles: ADMIN,
    description: 'Daftar laporan terfilter (status, kategori, keparahan, lokasi, pelapor, periode).',
    run: (a) => T.listReports((a || {}) as ReportFilter),
  },
  countReports: {
    roles: ADMIN,
    description: 'Jumlah laporan terfilter beserta rincian per status/kategori/keparahan.',
    run: (a) => T.countReports((a || {}) as ReportFilter),
  },
  findReportersByName: {
    roles: ADMIN,
    description: 'Cari pengguna berdasarkan potongan nama (menyertakan penanda ambigu).',
    run: (a) => T.findReportersByName(String(a.name || '')),
  },
  searchAccounts: {
    roles: ADMIN,
    description: 'Cari akun (warga/petugas/admin) dengan filter role, status aktif, kata kunci nama/email/telepon, dan tanggal daftar.',
    run: (a) => T.searchAccounts((a || {}) as T.AccountFilter),
  },
  countAccounts: {
    roles: ADMIN,
    description: 'Jumlah akun terfilter beserta rincian aktif/nonaktif dan per role.',
    run: (a) => T.countAccounts((a || {}) as T.AccountFilter),
  },
  getAccountSecurityOverview: {
    // Semua role boleh bertanya "apakah akun saya aman?". Untuk non-Admin,
    // tool MEMAKSA scope 'self' di server (lihat aiTools) sehingga tidak
    // mungkin membuka data akun lain lewat argumen.
    roles: ALL_ROLES,
    description:
      'Penilaian keamanan akun READ-ONLY: agregat jumlah akun (Admin) atau status akun sendiri, plus kontrol keamanan terverifikasi. Tidak memuat email/telepon.',
    run: (a, ctx) =>
      T.getAccountSecurityOverview(
        {
          role:
            a.role === 'CITIZEN' || a.role === 'OFFICER' || a.role === 'ADMIN'
              ? a.role
              : undefined,
          scope: a.scope === 'self' ? 'self' : 'all',
        },
        ctx
      ),
  },
  getRecentRegistrations: {
    roles: ADMIN,
    description:
      'Pendaftaran akun terbaru (createdAt WIB) dengan filter periode/rentang tanggal dan status verifikasi WhatsApp.',
    run: (a) => T.getRecentRegistrations((a || {}) as T.RegistrationQuery),
  },
  getOfficerTaskCounts: {
    roles: ADMIN,
    description:
      'Jumlah tugas per petugas + status penugasan (semua/punya tugas aktif/tanpa tugas aktif).',
    run: (a) => T.getOfficerTaskCounts({
      names: Array.isArray(a.names) ? (a.names as string[]) : undefined,
      isActive: typeof a.isActive === 'boolean' ? a.isActive : undefined,
      limit: Number(a.limit) || undefined,
      offset: Number(a.offset) || undefined,
      assignment:
        a.assignment === 'with_active' || a.assignment === 'without_active' || a.assignment === 'all'
          ? a.assignment
          : undefined,
    }),
  },
  getMonthlyCompletionTrend: {
    roles: ADMIN,
    description: 'Jumlah laporan SELESAI per bulan (tren penyelesaian, kalender WIB).',
    run: (a) => T.getMonthlyCompletionTrend(Number(a.months) || 6),
  },
  getWhatsAppDeliveryStatus: {
    roles: ADMIN,
    description: 'Status pengiriman WhatsApp untuk sebuah laporan (dari catatan WhatsAppLog).',
    run: (a) => T.getWhatsAppDeliveryStatus(String(a.idFragment || '')),
  },
  getRegionOverview: {
    roles: ADMIN,
    description: 'Master data wilayah (RW/RT) + jumlah warga terdaftar per RT.',
    run: () => T.getRegionOverview(),
  },
  getWhatsAppSummary: {
    roles: ADMIN,
    description: 'Ringkasan status pengiriman notifikasi WhatsApp (berhasil/gagal) dari catatan sistem.',
    run: () => T.getWhatsAppSummary(),
  },
  getWhatsAppMonitoringStatus: {
    roles: ADMIN,
    description: 'Status monitoring koneksi WhatsApp Fonnte (device, konfigurasi, dan ringkasan pengiriman).',
    run: () => T.getWhatsAppMonitoringStatus(),
  },
  getAnnouncementOverview: {
    roles: ADMIN,
    description: 'Ringkasan pengumuman desa per status + daftar pengumuman aktif & terjadwal.',
    run: () => T.getAnnouncementOverview(),
  },
  compareReportPeriods: {
    roles: ADMIN,
    description: 'Perbandingan jumlah laporan bulan ini vs bulan lalu (mendukung pertanyaan "lebih banyak/tidak").',
    run: () => T.compareReportPeriods(),
  },
  getUnfinishedReports: {
    roles: ADMIN,
    description: 'Laporan yang belum selesai beserta status dan alasan yang tercatat di riwayat.',
    run: (a) => T.getUnfinishedReports(Number(a.limit) || 8),
  },
  runAiDiagnostics: {
    roles: ADMIN,
    description: 'Diagnostik READ-ONLY: memeriksa keterbacaan tiap domain data AI (Admin/development).',
    run: () => T.runAiDiagnostics(),
  },
  searchAiKnowledge: {
    roles: ALL_ROLES,
    description: 'Cari entri di Pusat Pengetahuan AI (informasi yang disimpan dari percakapan & sumber lain). Entri belum diverifikasi ditandai sebagai dugaan/laporan.',
    run: (a, ctx) => T.searchAiKnowledge((a || {}) as T.AiKnowledgeSearchArgs, ctx),
  },
  saveAiKnowledge: {
    roles: ALL_ROLES,
    description:
      'Dua fase: tanpa confirmationToken hanya membuat USULAN (tidak menulis ke database) dan mengembalikan token sekali pakai; dengan confirmationToken yang valid, usulan disimpan sebagai entri BELUM DIVERIFIKASI.',
    run: (a, ctx) =>
      T.saveAiKnowledge(
        {
          title: a?.title as string | undefined,
          content: a?.content as string | undefined,
          category: a?.category as string | undefined,
          confirmationToken: a?.confirmationToken as string | undefined,
          cancel: a?.cancel === true,
        },
        ctx
      ),
  },
  analyzeAiKnowledge: {
    roles: ['ADMIN'],
    description: 'Analisis entri Pusat Pengetahuan AI untuk Admin — ringkasan berdasarkan kategori, sumber, dan status verifikasi.',
    run: (a, ctx) => T.analyzeAiKnowledge((a || {}) as T.AiKnowledgeAnalysisArgs, ctx),
  },
};

/** Nama semua tool yang terdaftar (untuk test drift). */
export const TOOL_NAMES = Object.keys(TOOL_REGISTRY);

/** Apakah role berhak memanggil tool ini? */
export function isToolAllowed(role: ChatRole, name: string): boolean {
  const def = TOOL_REGISTRY[name];
  return !!def && def.roles.includes(role);
}

/** Batas jumlah tool per pertanyaan (mencegah query berlebihan). */
export const MAX_TOOL_CALLS = 4;

/**
 * Jalankan tool yang dipilih intent router. Role & userId SELALU berasal dari
 * session server. Tool tanpa izin role → 'forbidden' (tanpa menyentuh database).
 * Kegagalan query dibedakan dari data kosong: hasilnya { error: 'query gagal' }.
 */
export async function executeTools(
  role: ChatRole,
  userId: string,
  calls: ToolCall[],
  sessionId?: string
): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  for (const c of (calls || []).slice(0, MAX_TOOL_CALLS)) {
    if (!c || typeof c.name !== 'string') continue;
    const t0 = Date.now();
    try {
      if (!isToolAllowed(role, c.name)) {
        console.warn(`[ai-tool] ${c.name} ditolak role=${role} (di luar wewenang)`);
        out.push({ name: c.name, result: { error: 'forbidden' } });
        await logAiToolActivity({ userId, role, tool: c.name, status: 'forbidden', durationMs: Date.now() - t0 });
        continue;
      }
      const result = await TOOL_REGISTRY[c.name].run(c.args || {}, { userId, role, sessionId });
      // Observabilitas aman: hanya nama tool, role, durasi, ukuran, dan jumlah hasil
      // (tidak ada isi data pribadi/kredensial yang dicatat).
      const r: any = result;
      const count = Array.isArray(r?.items)
        ? r.items.length
        : Array.isArray(r)
          ? r.length
          : typeof r?.total === 'number'
            ? r.total
            : undefined;
      console.log(
        `[ai-tool] ${c.name} ok role=${role} ms=${Date.now() - t0} bytes=${JSON.stringify(result).length}` +
        `${count !== undefined ? ` count=${count}` : ''}`
      );
      out.push({ name: c.name, result });
      await logAiToolActivity({
        userId,
        role,
        tool: c.name,
        status: 'ok',
        durationMs: Date.now() - t0,
        resultCount: count,
      });
    } catch (e: any) {
      // Kegagalan query TIDAK boleh disamarkan sebagai data kosong.
      console.error(`[ai-tool] ${c.name} gagal role=${role} ms=${Date.now() - t0} err=${e?.message || e}`);
      out.push({ name: c.name, result: { error: 'query gagal' } });
      await logAiToolActivity({ userId, role, tool: c.name, status: 'error', durationMs: Date.now() - t0 });
    }
  }
  return out;
}

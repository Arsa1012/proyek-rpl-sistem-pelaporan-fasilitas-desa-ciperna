/**
 * KONFIGURASI PENGETAHUAN SISTEM - sumber kebenaran untuk FITUR & PEMBARUAN.
 *
 * Pembagian sumber data:
 * - DATA (angka laporan, user, laporan terbaru, antrean) dibaca LIVE dari Prisma
 *   lewat src/lib/aiContext.ts pada setiap permintaan chat.
 * - FITUR, ALUR STATUS, STRUKTUR DATABASE, dan CHANGELOG ada di file ini.
 *
 * Prinsip:
 * - Jangan menulis status/kategori yang tidak ada di schema Prisma.
 * - Istilah ramah pengguna (mis. PENDING) dipetakan ke kode database sebenarnya.
 * - Tidak ada kredensial, token, atau data pribadi di file ini.
 * - Setiap pembaruan fitur cukup ditambahkan ke SYSTEM_CHANGELOG; prompt chatbot
 *   dan jawaban "update terbaru" otomatis mengikuti.
 */

import { REPORT_STATUS_LABELS } from './status';

/** Peran yang dikenali prompt pengetahuan sistem. */
export type SystemRole = 'CITIZEN' | 'ADMIN' | 'OFFICER';

export const SYSTEM_LAST_UPDATED = '2026-10-21';

export const VILLAGE_CONTACT = {
  name: 'Desa Ciperna',
  district: 'Talun',
  regency: 'Cirebon',
  province: 'Jawa Barat',
  administrativeArea: 'Desa Ciperna, Kecamatan Talun, Kabupaten Cirebon, Jawa Barat',
  adminWhatsapp: '082118727522',
  /** Akun Instagram yang benar-benar tertaut di beranda/footer proyek. */
  instagramHandle: '@syajehh',
  instagramUrl: 'https://www.instagram.com/syajehh/',
} as const;

/**
 * Alur status versi ramah pengguna. Nilai database yang sebenarnya tetap
 * SUBMITTED/VERIFIED/ASSIGNED/IN_PROGRESS/REVIEW/COMPLETED/REJECTED.
 */
export const REPORT_STATUS_FLOW_TEXT =
  'PENDING (Menunggu Verifikasi) -> IN_PROGRESS (Sedang Diproses) -> COMPLETED (Selesai) / REJECTED (Ditolak)';

/** Istilah kategori umum yang sering dipakai pengguna (bukan nilai baru DB). */
export const COMMON_REPORT_CATEGORY_TERMS = [
  'Infrastruktur',
  'Jalan Raya',
  'Kebersihan',
  'Lampu Jalan',
  'Fasilitas Umum',
] as const;

/**
 * Relasi utama antar tabel. Berguna agar chatbot memahami alur data, bukan
 * hanya menghafal nama tabel.
 */
export const DATABASE_RELATIONS = [
  'User (pelapor) 1 -> banyak Report',
  'Report 1 -> 1 ReportAnalysis (opsional, hasil analisis AI)',
  'Report 1 -> banyak Assignment; Assignment 1 -> banyak ReportEvidence',
  'Report 1 -> banyak ReportStatusHistory (timeline perubahan status)',
  'User 1 -> banyak Notification; User 1 -> banyak WhatsAppLog (jejak notifikasi)',
  'VillageRw 1 -> banyak VillageRt; VillageRt -> banyak User (wilayah opsional)',
  'VillageProfile, VillageOfficial, VillageService, dan VillageAnnouncement adalah data publik desa',
] as const;

/**
 * Alur lengkap pemakaian sistem per peran. Ditampilkan di prompt chatbot agar
 * jawaban panduan selalu konsisten dengan fitur yang benar-benar ada.
 */
export const SYSTEM_FLOWS = [
  {
    role: 'WARGA',
    title: 'Alur Warga / Masyarakat',
    steps: [
      'Registrasi akun (verifikasi OTP WhatsApp).',
      'Login memakai email atau nomor WhatsApp + kata sandi.',
      'Buat Laporan dengan judul, deskripsi, kategori, lokasi, dan foto kerusakan.',
      'Lacak Status melalui menu Laporan Saya (timeline dan status terkini).',
      'Terima notifikasi WhatsApp saat status laporan berubah.',
      'Gunakan Chatbot Asisten Desa Ciperna untuk panduan, status laporan sendiri, dan info desa.',
    ],
  },
  {
    role: 'ADMIN',
    title: 'Alur Admin / Petugas',
    steps: [
      'Login Admin (memicu Login Alert WhatsApp berisi waktu, perangkat, dan IP).',
      'Verifikasi laporan baru: setujui (VERIFIED) atau tolak (REJECTED).',
      'Ubah status operasional: PENDING/SUBMITTED -> IN_PROGRESS -> COMPLETED/REJECTED.',
      'Manajemen User: aktif/nonaktifkan akun dengan alasan; alasan dikirim via WhatsApp dan akun nonaktif tetap bisa login tetapi tidak bisa melapor.',
      'Broadcast Pengumuman: pengumuman terbit disiarkan otomatis ke WhatsApp seluruh warga dan petugas aktif.',
      'Petugas mengerjakan tugas, mengunggah bukti, lalu Admin memverifikasi bukti sebelum COMPLETED.',
    ],
  },
] as const;

/** Kategori yang benar-benar tersedia pada formulir Buat Laporan warga. */
export const REPORT_CATEGORIES = [
  'Jalan',
  'Lampu Jalan',
  'Trotoar',
  'Drainase',
  'Taman',
  'Jembatan',
  'Fasilitas Umum Lainnya',
] as const;

/**
 * Istilah umum yang sering dipakai pengguna. Ini HANYA padanan pemahaman,
 * bukan nilai baru yang boleh disimpan ke database.
 */
export const REPORT_CATEGORY_ALIASES = [
  { term: 'Infrastruktur', mapsTo: 'Jalan, Jembatan, Trotoar, atau Drainase sesuai objek yang rusak' },
  { term: 'Jalan Raya', mapsTo: 'Jalan' },
  { term: 'Lampu Jalan', mapsTo: 'Lampu Jalan (kategori resmi pada formulir)' },
  { term: 'Penerangan Jalan', mapsTo: 'Lampu Jalan' },
  { term: 'Kebersihan', mapsTo: 'Drainase bila menyangkut saluran air; Fasilitas Umum Lainnya bila menyangkut sampah/fasilitas' },
  { term: 'Fasilitas Umum', mapsTo: 'Fasilitas Umum Lainnya' },
] as const;

export interface ReportStatusKnowledge {
  code: string;
  label: string;
  simplified: string;
  description: string;
}

/**
 * Alur status operasional yang tersimpan di Report.status.
 * REVIEW adalah tahap validasi bukti oleh Admin sebelum COMPLETED.
 */
export const REPORT_STATUS_KNOWLEDGE: ReportStatusKnowledge[] = [
  {
    code: 'SUBMITTED',
    label: REPORT_STATUS_LABELS.SUBMITTED,
    simplified: 'PENDING',
    description: 'Laporan baru masuk dan menunggu verifikasi Admin.',
  },
  {
    code: 'VERIFIED',
    label: REPORT_STATUS_LABELS.VERIFIED,
    simplified: 'IN_PROGRESS',
    description: 'Laporan disetujui Admin dan menunggu penugasan Petugas (sudah masuk tahap penanganan).',
  },
  {
    code: 'ASSIGNED',
    label: REPORT_STATUS_LABELS.ASSIGNED,
    simplified: 'IN_PROGRESS',
    description: 'Laporan sudah ditugaskan kepada Petugas.',
  },
  {
    code: 'IN_PROGRESS',
    label: REPORT_STATUS_LABELS.IN_PROGRESS,
    simplified: 'IN_PROGRESS',
    description: 'Petugas sedang mengerjakan penanganan.',
  },
  {
    code: 'REVIEW',
    label: REPORT_STATUS_LABELS.REVIEW,
    simplified: 'IN_PROGRESS',
    description: 'Bukti pekerjaan sudah diunggah dan menunggu verifikasi Admin.',
  },
  {
    code: 'COMPLETED',
    label: REPORT_STATUS_LABELS.COMPLETED,
    simplified: 'COMPLETED',
    description: 'Pekerjaan disetujui Admin dan laporan selesai.',
  },
  {
    code: 'REJECTED',
    label: REPORT_STATUS_LABELS.REJECTED,
    simplified: 'REJECTED',
    description: 'Laporan ditolak Admin; alasan dapat dilihat pada detail laporan.',
  },
];

/** Terjemahan istilah ringkas yang sering diminta menjadi kode database. */
export const STATUS_TERM_MAP = {
  PENDING: {
    databaseCodes: ['SUBMITTED'],
    note: 'Menunggu verifikasi Admin. VERIFIED juga masih menunggu penugasan, tetapi bukan antrean verifikasi baru.',
  },
  IN_PROGRESS: {
    databaseCodes: ['VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW'],
    note: 'Sudah diverifikasi dan dalam penanganan: menunggu penugasan, ditugaskan, sedang dikerjakan, atau bukti menunggu verifikasi Admin.',
  },
  COMPLETED: {
    databaseCodes: ['COMPLETED'],
    note: 'Selesai setelah bukti pekerjaan disetujui Admin.',
  },
  REJECTED: {
    databaseCodes: ['REJECTED'],
    note: 'Ditolak Admin dengan alasan pada laporan.',
  },
} as const;

export interface FeatureGroup {
  role: string;
  title: string;
  items: { name: string; description: string }[];
}

export const FEATURE_STRUCTURE: FeatureGroup[] = [
  {
    role: 'MASYARAKAT',
    title: 'Fitur Warga',
    items: [
      { name: 'Buat Laporan', description: 'Mengisi judul, deskripsi, kategori, lokasi, dan mengunggah foto kerusakan.' },
      { name: 'Laporan Saya', description: 'Melihat daftar dan detail laporan milik sendiri beserta foto serta timeline.' },
      { name: 'Lacak Status', description: 'Memantau status dan riwayat penanganan laporan.' },
      { name: 'Profil', description: 'Melihat data akun dan mengubah kata sandi.' },
      { name: 'Notifikasi', description: 'Menerima pemberitahuan perubahan status dan pengumuman desa.' },
      { name: 'Asisten AI', description: 'Bertanya tentang cara memakai website, status laporan sendiri, dan informasi desa.' },
    ],
  },
  {
    role: 'ADMIN',
    title: 'Fitur Admin',
    items: [
      { name: 'Verifikasi Laporan', description: 'Menyetujui (VERIFIED) atau menolak (REJECTED) laporan baru.' },
      { name: 'Penugasan Petugas', description: 'Menugaskan laporan terverifikasi kepada Petugas lapangan.' },
      { name: 'Verifikasi Bukti', description: 'Memeriksa bukti pekerjaan (REVIEW) lalu menyelesaikan laporan (COMPLETED).' },
      { name: 'Ubah Status', description: 'Mengelola alur Menunggu Verifikasi -> Diproses -> Selesai/Ditolak melalui halaman resmi.' },
      { name: 'Manajemen User', description: 'Melihat data warga/petugas, menambah petugas, reset kata sandi, serta mengaktifkan/menonaktifkan akun.' },
      { name: 'Nonaktifkan Akun + Alasan', description: 'Menonaktifkan akun warga/petugas dengan alasan. Alasan dikirim ke WhatsApp pemilik akun, disimpan, dan ditampilkan pada banner dashboard; akun tetap bisa login tetapi fitur utama dibatasi.' },
      { name: 'Broadcast Pengumuman', description: 'Menerbitkan pengumuman yang otomatis disiarkan ke WhatsApp seluruh warga dan petugas aktif, berjalan di latar belakang dengan status per penerima.' },
      { name: 'WhatsApp Gateway', description: 'Integrasi Fonnte untuk notifikasi ke Admin dan warga, dengan catatan status pengiriman.' },
      { name: 'Duplikat, Statistik, Wilayah, dan Portal Desa', description: 'Meninjau laporan ganda, rekap statistik, master RT/RW, profil desa, layanan, dan pengumuman.' },
    ],
  },
  {
    role: 'PETUGAS',
    title: 'Fitur Petugas',
    items: [
      { name: 'Tugas Saya', description: 'Melihat tugas yang ditugaskan Admin.' },
      { name: 'Kerjakan Tugas', description: 'Memperbarui progres penanganan.' },
      { name: 'Unggah Bukti', description: 'Mengirim foto dan catatan hasil pekerjaan untuk diverifikasi Admin.' },
      { name: 'Riwayat Tugas', description: 'Melihat tugas yang sudah selesai.' },
      { name: 'Profil', description: 'Melihat data akun dan mengubah kata sandi.' },
    ],
  },
];

export interface DatabaseTableKnowledge {
  name: string;
  description: string;
}

/** Struktur tabel utama yang relevan untuk pemahaman chatbot. */
export const DATABASE_TABLES: DatabaseTableKnowledge[] = [
  { name: 'User', description: 'Akun CITIZEN/ADMIN/OFFICER, status aktif, nomor WhatsApp, wilayah RT; kata sandi hanya berupa hash dan tidak pernah ditampilkan.' },
  { name: 'Report', description: 'Laporan: pelapor, judul, deskripsi, kategori, lokasi, foto, status, keparahan, duplikat, dan status analisis AI.' },
  { name: 'ReportAnalysis', description: 'Hasil analisis AI tersimpan: kategori, jenis kerusakan, keparahan, confidence, alasan, dan rekomendasi.' },
  { name: 'Assignment', description: 'Penugasan laporan kepada Petugas, termasuk status review, catatan, dan pembatalan.' },
  { name: 'ReportEvidence', description: 'Foto dan catatan bukti penyelesaian dari Petugas.' },
  { name: 'ReportStatusHistory', description: 'Timeline perubahan status laporan beserta catatan dan aktor.' },
  { name: 'Notification', description: 'Notifikasi dalam aplikasi milik satu pengguna.' },
  { name: 'AdminAuditLog', description: 'Jejak tindakan Admin seperti menonaktifkan akun atau menyetujui pekerjaan.' },
  { name: 'VillageProfile', description: 'Profil resmi desa, alamat, kontak, peta, visi/misi, dan status verifikasi.' },
  { name: 'VillageOfficial', description: 'Perangkat desa/RT/RW yang sudah diverifikasi; data publik tanpa nomor pribadi.' },
  { name: 'VillageService', description: 'Informasi layanan desa, syarat, prosedur, jadwal, dan kontak.' },
  { name: 'VillageAnnouncement', description: 'Pengumuman desa yang diterbitkan Admin.' },
  { name: 'AnnouncementDelivery', description: 'Status pengiriman WhatsApp pengumuman per penerima (PENDING/SENT/FAILED/SKIPPED).' },
  { name: 'VillageRw', description: 'Master data RW.' },
  { name: 'VillageRt', description: 'Master data RT di bawah RW; menautkan warga untuk administrasi, bukan role.' },
  { name: 'WhatsAppLog', description: 'Catatan pengiriman notifikasi: jenis, nomor samaran, status, error, tanpa token atau isi pesan penuh.' },
  { name: 'RegistrationOtp', description: 'Pendaftaran tertunda dan OTP WhatsApp; hanya hash yang disimpan, bukan OTP mentah.' },
  { name: 'AccountToken', description: 'Token aktivasi/reset kata sandi sekali pakai; hanya hash token yang disimpan.' },
];

export interface ChangelogEntry {
  id: string;
  title: string;
  description: string;
}

/**
 * Daftar pembaruan sistem terbaru. Urutan = terbaru lebih dahulu.
 * Catatan: ini log fitur, BUKAN bukti bahwa setiap pesan WhatsApp berhasil
 * terkirim. Status kirim aktual selalu mengacu pada WhatsAppLog/AnnouncementDelivery.
 */
export const SYSTEM_CHANGELOG: ChangelogEntry[] = [
  {
    id: 'wa-fonnte-admin',
    title: 'Notifikasi WhatsApp Real-time via Fonnte ke WA Admin (082118727522)',
    description: 'Sistem mengirim notifikasi WhatsApp otomatis ke nomor Admin 082118727522 untuk pendaftaran akun dan laporan baru; status pengiriman dicatat di log.',
  },
  {
    id: 'admin-login-alert',
    title: 'Fitur Keamanan Login Admin (Alert WA Waktu, Perangkat, dan IP Address)',
    description: 'Setiap login Admin memicu alert WhatsApp berisi waktu akses, perangkat, dan alamat IP/lokasi.',
  },
  {
    id: 'tema-responsif',
    title: 'Pengaturan Tema Terang & Gelap (Light / Dark Mode)',
    description: 'Pengguna dapat berganti tema terang/gelap dan tampilan dirapikan agar nyaman di HP maupun laptop.',
  },
  {
    id: 'perbaikan-registrasi',
    title: 'Perbaikan Formulir Registrasi (Pembersihan Auto-fill & Peningkatan Keamanan)',
    description: 'Isi auto-fill dibersihkan, validasi registrasi diperkuat, dan alur pendaftaran dibuat lebih aman.',
  },
  {
    id: 'upload-foto-responsif',
    title: 'UI Form Upload Foto Kerusakan Lebih Rapi & Responsif di HP/Laptop',
    description: 'Area unggah foto kerusakan diperbaiki agar lebih rapi, mudah dipakai, dan responsif di layar HP maupun laptop.',
  },
  {
    id: 'akun-nonaktif',
    title: 'Penonaktifan Akun Warga/Petugas dengan Notifikasi WA Alasan Suspend & Pembatasan Akses',
    description: 'Admin dapat menonaktifkan akun beserta alasan. Pemilik akun menerima notifikasi WhatsApp, tetap bisa login untuk melihat status, tetapi tidak dapat membuat laporan atau memulai tugas baru.',
  },
  {
    id: 'broadcast-pengumuman',
    title: 'Broadcast Pengumuman Otomatis ke Seluruh Nomor WA Terdaftar',
    description: 'Saat pengumuman diterbitkan, sistem mengirim siaran WhatsApp ke seluruh warga dan petugas aktif yang memiliki nomor terdaftar, berjalan di latar belakang dan dicatat per penerima.',
  },
];

export const SYSTEM_KNOWLEDGE = {
  brand: 'Sistem Pelaporan Fasilitas Umum Desa Ciperna',
  lastUpdated: SYSTEM_LAST_UPDATED,
  village: VILLAGE_CONTACT,
  reportCategories: REPORT_CATEGORIES,
  commonCategoryTerms: COMMON_REPORT_CATEGORY_TERMS,
  categoryAliases: REPORT_CATEGORY_ALIASES,
  statusFlow: REPORT_STATUS_FLOW_TEXT,
  statuses: REPORT_STATUS_KNOWLEDGE,
  statusTermMap: STATUS_TERM_MAP,
  relations: DATABASE_RELATIONS,
  flows: SYSTEM_FLOWS,
  features: FEATURE_STRUCTURE,
  tables: DATABASE_TABLES,
  changelog: SYSTEM_CHANGELOG,
} as const;

function numberedChangelog(): string {
  return SYSTEM_CHANGELOG.map((item, index) => `${index + 1}. ${item.title}: ${item.description}`).join('\n');
}

/** Jawaban siap pakai untuk pertanyaan "Ada update apa saja di web?". */
export function formatLatestUpdatesAnswer(): string {
  return (
    `Pembaruan terbaru ${VILLAGE_CONTACT.name}:\n` +
    `${numberedChangelog()}\n\n` +
    'Catatan: daftar ini menjelaskan fitur yang tersedia. Status pengiriman WhatsApp yang sebenarnya tetap mengacu pada catatan pengiriman sistem.'
  );
}

const CITIZEN_TABLE_NAMES = [
  'User',
  'Report',
  'ReportAnalysis',
  'ReportStatusHistory',
  'Notification',
  'VillageProfile',
  'VillageOfficial',
  'VillageService',
  'VillageAnnouncement',
  'VillageRw',
  'VillageRt',
];

const OFFICER_TABLE_NAMES = CITIZEN_TABLE_NAMES.concat(['Assignment', 'ReportEvidence']);

function selectedFlows(role?: SystemRole) {
  if (!role) return SYSTEM_FLOWS;
  return SYSTEM_FLOWS.filter((group) =>
    role === 'CITIZEN' ? group.role === 'WARGA' : group.role === 'ADMIN'
  );
}

function selectedFeatures(role?: SystemRole) {
  if (!role) return FEATURE_STRUCTURE;
  const roleName = role === 'CITIZEN' ? 'MASYARAKAT' : role === 'OFFICER' ? 'PETUGAS' : 'ADMIN';
  return FEATURE_STRUCTURE.filter((group) => group.role === roleName);
}

function selectedTables(role?: SystemRole) {
  if (!role || role === 'ADMIN') return DATABASE_TABLES;
  const allowed = role === 'CITIZEN' ? CITIZEN_TABLE_NAMES : OFFICER_TABLE_NAMES;
  return DATABASE_TABLES.filter((table) => allowed.includes(table.name));
}

/**
 * Blok pengetahuan statis untuk system prompt.
 * Data live (angka/statistik/laporan terbaru) TIDAK diambil dari sini.
 *
 * Bila `role` diberikan, hanya alur/fitur/tabel yang relevan untuk peran itu
 * yang dimasukkan. Ini membuat prompt lebih fokus dan hemat token, tanpa
 * mengurangi fakta yang dibutuhkan role tersebut.
 */
export function formatSystemKnowledgeForPrompt(role?: SystemRole): string {
  const flowLines = selectedFlows(role)
    .map((group) => `- ${group.title}: ${group.steps.join(' -> ')}`)
    .join('\n');

  const featureLines = selectedFeatures(role)
    .map(
      (group) =>
        `- ${group.title} (${group.role}): ` +
        group.items.map((item) => `${item.name} (${item.description})`).join('; ')
    )
    .join('\n');

  const tableLines = selectedTables(role)
    .map((table) => `- ${table.name}: ${table.description}`)
    .join('\n');

  const statusLines = REPORT_STATUS_KNOWLEDGE.map(
    (status) =>
      `- ${status.code} = ${status.label}. ${status.description} Istilah ringkas: ${status.simplified}.`
  ).join('\n');

  const categoryAliasLines = REPORT_CATEGORY_ALIASES.map(
    (alias) => `- "${alias.term}" -> ${alias.mapsTo}`
  ).join('\n');

  const relationLines = DATABASE_RELATIONS.map((relation) => `- ${relation}`).join('\n');

  const roleFocus =
    role === 'CITIZEN'
      ? 'MASYARAKAT — fokus pada data milik pengguna sendiri dan statistik desa agregat.'
      : role === 'OFFICER'
        ? 'PETUGAS — fokus pada tugas milik petugas yang login; jangan membuka data petugas lain atau internal Admin.'
        : role === 'ADMIN'
          ? 'ADMIN — seluruh data operasional desa, antrean verifikasi/penugasan/bukti, akun, dan WhatsApp gateway.'
          : 'Semua peran (prompt pengetahuan umum).';

  const roleInstruction =
    role === 'CITIZEN'
      ? '- MASYARAKAT: prioritaskan alur registrasi/login, cara membuat laporan (foto & lokasi), lacak status, status/laporan milik sendiri, profil, statistik desa agregat, kontak WhatsApp Admin/Instagram, lokasi/profil desa, dan daftar pembaruan web. Jangan membuka data warga lain.\n- AI tetap READ-ONLY: jangan mengklaim telah membuat laporan, mengubah status, atau mengirim WhatsApp.'
      : role === 'OFFICER'
        ? '- PETUGAS: prioritaskan tugas yang ditugaskan kepadanya, progres, unggah bukti, dan riwayat. Jangan menyebut tugas petugas lain atau data internal Admin.\n- AI tetap READ-ONLY: jangan mengklaim telah mengerjakan tugas, mengunggah bukti, atau mengubah status.'
        : role === 'ADMIN'
          ? '- ADMIN: berikan ringkasan operasional, antrean verifikasi/penugasan/bukti, statistik desa dan statistik akun, panduan verifikasi laporan, cara menonaktifkan akun beserta alasan via WhatsApp, serta cara broadcast pengumuman.\n- AI tetap READ-ONLY: jangan mengklaim telah memverifikasi, menugaskan, mengubah status, atau mengirim WhatsApp.'
          : '- MASYARAKAT: prioritaskan alur registrasi/login, cara membuat laporan (foto & lokasi), lacak status, status/laporan milik sendiri, profil, statistik desa agregat, kontak WhatsApp Admin/Instagram, lokasi/profil desa, dan daftar pembaruan web. Jangan membuka data warga lain.\n- PETUGAS: prioritaskan tugas yang ditugaskan kepadanya, progres, unggah bukti, dan riwayat. Jangan menyebut tugas petugas lain.\n- ADMIN: berikan ringkasan operasional, antrean verifikasi/penugasan/bukti, statistik desa dan statistik akun, panduan verifikasi laporan, cara menonaktifkan akun beserta alasan via WhatsApp, serta cara broadcast pengumuman.\n- AI tetap READ-ONLY dan tidak melakukan tindakan apa pun.';

  return `PENGETAHUAN LENGKAP STRUKTUR DATABASE & ALUR LAPORAN (konfigurasi, bukan data live):
- Fokus peran pada prompt ini: ${roleFocus}
- Wilayah: ${VILLAGE_CONTACT.administrativeArea}.
- WhatsApp Admin: ${VILLAGE_CONTACT.adminWhatsapp}.
- Instagram Office Admin: ${VILLAGE_CONTACT.instagramHandle} (${VILLAGE_CONTACT.instagramUrl}).
- Konfigurasi terakhir diperbarui: ${SYSTEM_LAST_UPDATED}.

- Tabel Users (User): menyimpan Warga (CITIZEN), Petugas (OFFICER), dan Admin (ADMIN), termasuk status aktif, nomor WhatsApp, dan wilayah RT. Kata sandi hanya berupa hash dan tidak pernah ditampilkan.
- Tabel Reports (Report): menyimpan laporan warga: pelapor, judul, deskripsi, kategori, lokasi, foto, status, keparahan, duplikat, dan analisis AI.
  * Status Flow: ${REPORT_STATUS_FLOW_TEXT}.
  * Kategori umum: ${COMMON_REPORT_CATEGORY_TERMS.join(', ')}.
  * Kategori formulir aktual: ${REPORT_CATEGORIES.join(', ')}.
  * Padanan istilah:
${categoryAliasLines}
- Relasi database:
${relationLines}
- Setiap laporan baru & pendaftaran akun akan mengirimkan notifikasi WA otomatis ke Admin ${VILLAGE_CONTACT.adminWhatsapp}. Status kirim aktual HANYA boleh dinyatakan berdasarkan catatan pengiriman.

STATISTIK REAL-TIME DATABASE:
- Angka Total Laporan Desa, Laporan Menunggu (PENDING/SUBMITTED), Diproses (VERIFIED/ASSIGNED/IN_PROGRESS/REVIEW), Selesai (COMPLETED), dan Ditolak (REJECTED) disuntikkan server pada blok KONTEKS LIVE DATABASE setiap permintaan.
- Jika statistik gagal dimuat, katakan belum berhasil dimuat; jangan menganggapnya nol.

ALUR LENGKAP SISTEM:
${flowLines}

STRUKTUR FITUR WEBSITE:
${featureLines}

TABEL DATABASE TERKAIT:
${tableLines}

ALUR STATUS LAPORAN:
${statusLines}

PEMETAAN ISTILAH STATUS:
- PENDING = SUBMITTED (Menunggu Verifikasi Admin).
- IN_PROGRESS/DIPROSES = VERIFIED + ASSIGNED + IN_PROGRESS + REVIEW (sudah diverifikasi dan dalam penanganan).
- COMPLETED = COMPLETED (Selesai).
- REJECTED = REJECTED (Ditolak).
Gunakan kode database sebenarnya bila menyebut status; terjemahkan ke istilah ramah untuk warga.

ALUR BISNIS:
Warga membuat laporan -> Admin verifikasi -> Admin menugaskan Petugas -> Petugas mengerjakan dan mengunggah bukti -> Admin memverifikasi bukti -> laporan selesai atau ditolak. Setiap tahap dicatat pada timeline.

DAFTAR PEMBARUAN & FITUR TERBARU SYSTEM (UPDATE LOG):
${numberedChangelog()}

INSTRUKSI CARA MENJAWAB:
1. Jika ditanya "Ada update apa saja di web?", sebutkan poin-poin pembaruan terbaru di atas.
2. Jika ditanya oleh Warga tentang status laporannya, gunakan data laporan terkini milik Warga tersebut; jangan membuka laporan warga lain.
3. Jika ditanya oleh Admin/Petugas, berikan ringkasan laporan yang memerlukan verifikasi atau penanganan segera sesuai antrean/tugas pada KONTEKS LIVE.
4. Jawablah dengan bahasa Indonesia yang ramah, jelas, profesional, dan berbasis data akurat. Jangan mengarang angka/status dan jangan menyalin JSON mentah.

INSTRUKSI ADAPTASI ROLE:
${roleInstruction}`;
}

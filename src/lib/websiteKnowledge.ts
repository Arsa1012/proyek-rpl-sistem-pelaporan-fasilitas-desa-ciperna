/**
 * WEBSITE KNOWLEDGE LAYER — sumber kebenaran untuk FITUR website.
 *
 * DATABASE adalah source of truth untuk DATA (via tool Prisma di aiTools.ts).
 * FILE INI adalah source of truth untuk FITUR: halaman, menu, workflow, status.
 *
 * Cara menambah fitur baru agar chatbot otomatis memahaminya:
 * 1. Tambahkan halaman ke PAGES (route asli project, bukan URL dummy).
 * 2. Tambahkan kemampuan chatbot ke CITIZEN_PUBLIC_INTENTS (cukup 1 entri).
 * 3. Jika butuh data baru, tambahkan tool di aiTools.ts + case di executeTools.
 * Tanpa rewrite chatbot.
 */

export interface PageInfo {
  route: string;
  title: string;
  description: string;
  roles: string[];
}

export interface FeatureInfo {
  name: string;
  route: string;
  description: string;
  allowedRoles: string[];
}

export const WEBSITE = {
  brand: 'Sistem Pelaporan Fasilitas Umum Desa Ciperna',
  pages: [
    { route: '/', title: 'Beranda', description: 'Halaman utama, informasi layanan dan cara kerja.', roles: ['PUBLIK'] },
    { route: '/login', title: 'Masuk', description: 'Login dengan email atau nomor WhatsApp terdaftar + password.', roles: ['PUBLIK'] },
    { route: '/register', title: 'Daftar', description: 'Pendaftaran akun Masyarakat dan Petugas.', roles: ['PUBLIK'] },
    { route: '/profil-desa', title: 'Profil Desa', description: 'Identitas, sejarah, kondisi, potensi, visi & misi, serta informasi pelayanan Desa Ciperna.', roles: ['PUBLIK'] },
    { route: '/pemerintahan', title: 'Struktur Pemerintahan', description: 'Susunan perangkat desa, RT, dan RW yang sudah diverifikasi.', roles: ['PUBLIK'] },
    { route: '/layanan', title: 'Layanan Desa', description: 'Jenis layanan, persyaratan, prosedur, jadwal, dan kontak resmi.', roles: ['PUBLIK'] },
    { route: '/pengumuman', title: 'Pengumuman', description: 'Pengumuman resmi desa yang sudah diterbitkan.', roles: ['PUBLIK'] },
    { route: '/pengumuman/[slug]', title: 'Detail Pengumuman', description: 'Isi lengkap satu pengumuman desa.', roles: ['PUBLIK'] },

    { route: '/masyarakat/dashboard', title: 'Dashboard Masyarakat', description: 'Ringkasan dan laporan terbaru milik Anda.', roles: ['CITIZEN'] },
    { route: '/masyarakat/laporan/create', title: 'Buat Laporan', description: 'Formulir laporan: judul, deskripsi, kategori, foto, lokasi.', roles: ['CITIZEN'] },
    { route: '/masyarakat/laporan', title: 'Laporan Saya', description: 'Daftar seluruh laporan milik Anda beserta statusnya.', roles: ['CITIZEN'] },
    { route: '/masyarakat/laporan/[id]', title: 'Detail Laporan Saya', description: 'Detail, foto, timeline, bukti penyelesaian, dan hasil analisis AI.', roles: ['CITIZEN'] },
    { route: '/masyarakat/profile', title: 'Profil Saya', description: 'Data akun (nama, email, nomor WhatsApp) dan ubah password.', roles: ['CITIZEN'] },

    { route: '/admin/dashboard', title: 'Dashboard Admin', description: 'Statistik dan ringkasan seluruh sistem.', roles: ['ADMIN'] },
    { route: '/admin/laporan', title: 'Daftar Laporan', description: 'Daftar seluruh laporan dengan filter status, kategori, dan periode.', roles: ['ADMIN'] },
    { route: '/admin/laporan?status=SUBMITTED', title: 'Antrean Verifikasi Laporan', description: 'Tab "Menunggu Verifikasi" pada halaman Daftar Laporan; antrean laporan baru untuk disetujui atau ditolak Admin.', roles: ['ADMIN'] },
    { route: '/admin/laporan/[id]', title: 'Detail Laporan', description: 'Detail laporan, verifikasi, penugasan, bukti, dan timeline.', roles: ['ADMIN'] },
    { route: '/admin/duplikat', title: 'Laporan Duplikat', description: 'Tinjau kandidat duplikat dan tetapkan laporan utama.', roles: ['ADMIN'] },
    { route: '/admin/assign', title: 'Penugasan Petugas', description: 'Tugaskan laporan terverifikasi ke petugas, pantau, batalkan.', roles: ['ADMIN'] },
    { route: '/admin/masyarakat', title: 'Data Warga', description: 'Daftar akun masyarakat, cari, lihat detail, reset kata sandi, aktif/nonaktifkan akun.', roles: ['ADMIN'] },
    { route: '/admin/wilayah', title: 'Wilayah RT/RW', description: 'Master data wilayah: tambah/ubah RW dan RT, aktif/nonaktifkan, lihat jumlah warga tautan.', roles: ['ADMIN'] },
    { route: '/admin/petugas', title: 'Data Petugas', description: 'Daftar akun petugas lapangan: tambah petugas, cari, lihat detail, reset kata sandi, aktif/nonaktifkan.', roles: ['ADMIN'] },
    { route: '/admin/statistik', title: 'Statistik & Rekap', description: 'Grafik, tren, dan rekap laporan.', roles: ['ADMIN'] },
    { route: '/admin/asisten', title: 'Asisten AI', description: 'Chatbot Admin yang membaca data aktual database.', roles: ['ADMIN'] },
    { route: '/admin/map', title: 'Peta Laporan', description: 'Sebaran laporan pada peta (diakses dari tombol di Dashboard).', roles: ['ADMIN'] },
    { route: '/admin/profil-desa', title: 'Kelola Profil Desa', description: 'Admin mengisi identitas, sejarah, lokasi, visi & misi, dan status verifikasi profil desa.', roles: ['ADMIN'] },
    { route: '/admin/pemerintahan', title: 'Kelola Struktur Pemerintahan', description: 'Admin menambah, mengubah, memverifikasi, dan mengarsipkan profil perangkat desa/RT/RW.', roles: ['ADMIN'] },
    { route: '/admin/layanan-desa', title: 'Kelola Layanan Desa', description: 'Admin mengelola informasi pelayanan desa.', roles: ['ADMIN'] },
    { route: '/admin/pengumuman', title: 'Kelola Pengumuman', description: 'Admin membuat, menerbitkan, dan menarik pengumuman desa.', roles: ['ADMIN'] },
    { route: '/admin/profile', title: 'Profil Admin', description: 'Data akun Admin dan ubah password.', roles: ['ADMIN'] },

    { route: '/petugas/dashboard', title: 'Dashboard Petugas', description: 'Ringkasan tugas lapangan.', roles: ['OFFICER'] },
    { route: '/petugas/tugas', title: 'Tugas Saya', description: 'Daftar tugas aktif: kerjakan dan unggah bukti.', roles: ['OFFICER'] },
    { route: '/petugas/tugas/[id]', title: 'Detail Tugas', description: 'Ubah status pengerjaan dan unggah bukti penyelesaian.', roles: ['OFFICER'] },
    { route: '/petugas/riwayat', title: 'Riwayat Tugas', description: 'Tugas yang sudah selesai/terverifikasi.', roles: ['OFFICER'] },
    { route: '/petugas/profile', title: 'Profil Petugas', description: 'Data akun Petugas dan ubah password.', roles: ['OFFICER'] },
  ] as PageInfo[],
  /** Menu sidebar yang benar-benar tampil per role (sumber: components/layout/Sidebar.tsx). */
  menus: [
    { role: 'CITIZEN', items: ['Dashboard', 'Buat Laporan', 'Laporan Saya', 'Profil'] },
    {
      role: 'ADMIN',
      items: [
        'Dashboard', 'Asisten AI',
        'Daftar Laporan', 'Laporan Duplikat',
        'Data Warga', 'Wilayah RT/RW', 'Data Petugas',
        'Profil Desa', 'Struktur Pemerintahan', 'Layanan Desa', 'Pengumuman',
        'Penugasan Petugas', 'Statistik & Rekap', 'Profil',
      ],
    },
    { role: 'OFFICER', items: ['Dashboard', 'Tugas Saya', 'Riwayat Tugas', 'Profil'] },
  ],
  features: [
    { name: 'Buat Laporan', route: '/masyarakat/laporan/create', description: 'Masyarakat membuat laporan fasilitas umum (foto, kategori, lokasi).', allowedRoles: ['CITIZEN'] },
    { name: 'Laporan Saya', route: '/masyarakat/laporan', description: 'Melihat daftar, status, dan detail laporan milik sendiri.', allowedRoles: ['CITIZEN'] },
    { name: 'Analisis AI Laporan', route: '/masyarakat/laporan/[id]', description: 'Klasifikasi kategori, jenis kerusakan, severity, dan confidence otomatis.', allowedRoles: ['CITIZEN'] },
    { name: 'Chatbot Masyarakat', route: '/masyarakat/dashboard', description: 'Asisten AI lewat tombol chat mengapung di halaman masyarakat.', allowedRoles: ['CITIZEN'] },
    { name: 'Notifikasi', route: '/masyarakat/dashboard', description: 'Lonceng notifikasi perubahan status laporan milik Anda.', allowedRoles: ['CITIZEN'] },
    { name: 'Verifikasi Laporan', route: '/admin/laporan?status=SUBMITTED', description: 'Admin menyetujui (VERIFIED) atau menolak (REJECTED) laporan baru lewat tab "Menunggu Verifikasi" di halaman Daftar Laporan.', allowedRoles: ['ADMIN'] },
    { name: 'Penugasan Petugas', route: '/admin/assign', description: 'Admin menugaskan laporan terverifikasi ke petugas lapangan.', allowedRoles: ['ADMIN'] },
    { name: 'Verifikasi Bukti Penyelesaian', route: '/admin/laporan', description: 'Admin meninjau bukti dari petugas (status REVIEW) lalu menyelesaikan laporan.', allowedRoles: ['ADMIN'] },
    { name: 'Deteksi Duplikat', route: '/admin/duplikat', description: 'AI menandai laporan ganda, Admin memutuskan laporan utama.', allowedRoles: ['ADMIN'] },
    { name: 'Statistik & Rekap', route: '/admin/statistik', description: 'Grafik dan rekap laporan per kategori, status, wilayah.', allowedRoles: ['ADMIN'] },
    { name: 'Asisten AI Admin', route: '/admin/asisten', description: 'Chatbot Admin berbasis data aktual seluruh sistem.', allowedRoles: ['ADMIN'] },
    { name: 'Kelola Akun', route: '/admin/masyarakat', description: 'Admin melihat daftar warga/petugas, mencari, melihat detail, mengaktifkan/menonaktifkan akun.', allowedRoles: ['ADMIN'] },
    { name: 'Kelola Wilayah RT/RW', route: '/admin/wilayah', description: 'Admin menambah/mengubah RW dan RT, mengaktifkan atau menonaktifkan wilayah, dan melihat jumlah warga tertaut. Wilayah aktif muncul pada pilihan registrasi dan profil warga.', allowedRoles: ['ADMIN'] },
    { name: 'Tambah Petugas', route: '/admin/petugas', description: 'Admin mendaftarkan akun petugas baru (nama, email, no. WA, kata sandi awal atau kata sandi sementara otomatis). Role ditetapkan server sebagai OFFICER.', allowedRoles: ['ADMIN'] },
    { name: 'Detail Akun Pengguna', route: '/admin/masyarakat', description: 'Admin melihat detail akun warga/petugas: nama, email, no. WA, peran, status, tanggal registrasi, jumlah laporan/penugasan, dan riwayat terkait. Tanpa kata sandi.', allowedRoles: ['ADMIN'] },
    { name: 'Reset Kata Sandi Akun', route: '/admin/masyarakat', description: 'Admin mereset kata sandi warga/petugas. Sistem membuat kata sandi sementara yang ditampilkan sekali dan wajib diganti saat login berikutnya.', allowedRoles: ['ADMIN'] },
    { name: 'Tugas Saya', route: '/petugas/tugas', description: 'Petugas melihat tugas aktif dan mengubah status pengerjaan.', allowedRoles: ['OFFICER'] },
    { name: 'Upload Bukti Penyelesaian', route: '/petugas/tugas/[id]', description: 'Petugas mengunggah foto dan catatan penyelesaian lalu mengirim ke Admin.', allowedRoles: ['OFFICER'] },
    { name: 'Riwayat Tugas', route: '/petugas/riwayat', description: 'Petugas melihat tugas yang sudah selesai.', allowedRoles: ['OFFICER'] },
    { name: 'Hubungi Admin', route: '/', description: 'Tombol WhatsApp 082118727522 dan Instagram @syajehh di beranda dan footer.', allowedRoles: ['CITIZEN'] },
    { name: 'Profil Desa', route: '/profil-desa', description: 'Identitas, sejarah, kondisi, potensi, visi & misi, dan informasi pelayanan desa dari data terverifikasi.', allowedRoles: ['CITIZEN', 'OFFICER', 'ADMIN'] },
    { name: 'Struktur Pemerintahan', route: '/pemerintahan', description: 'Susunan perangkat desa, RT, dan RW yang sudah diverifikasi.', allowedRoles: ['CITIZEN', 'OFFICER', 'ADMIN'] },
    { name: 'Layanan Desa', route: '/layanan', description: 'Jenis layanan, persyaratan, prosedur, jadwal, dan kontak resmi desa.', allowedRoles: ['CITIZEN', 'OFFICER', 'ADMIN'] },
    { name: 'Pengumuman Desa', route: '/pengumuman', description: 'Pengumuman resmi desa yang sudah diterbitkan.', allowedRoles: ['CITIZEN', 'OFFICER', 'ADMIN'] },
    { name: 'Kelola Profil Desa', route: '/admin/profil-desa', description: 'Admin memperbarui profil resmi desa dan status verifikasinya.', allowedRoles: ['ADMIN'] },
    { name: 'Kelola Struktur Pemerintahan', route: '/admin/pemerintahan', description: 'Admin menambah/mengubah/memverifikasi/mengarsipkan perangkat desa.', allowedRoles: ['ADMIN'] },
    { name: 'Kelola Layanan Desa', route: '/admin/layanan-desa', description: 'Admin mengelola informasi pelayanan desa.', allowedRoles: ['ADMIN'] },
    { name: 'Kelola Pengumuman', route: '/admin/pengumuman', description: 'Admin membuat, menerbitkan, dan menarik pengumuman.', allowedRoles: ['ADMIN'] },
  ] as FeatureInfo[],
  // Alur bisnis aktual sesuai kode (bukan karangan)
  workflow: [
    'Masyarakat membuat laporan (status SUBMITTED)',
    'AI menganalisis kategori dan severity',
    'Admin memverifikasi (VERIFIED) atau menolak (REJECTED)',
    'Admin menugaskan ke petugas (ASSIGNED)',
    'Petugas mengerjakan (IN_PROGRESS) dan mengunggah bukti',
    'Hasil kerja menunggu verifikasi Admin (REVIEW)',
    'Admin menyetujui hasil (COMPLETED)',
  ],
  statuses: [
    { code: 'SUBMITTED', meaning: 'baru diajukan, menunggu verifikasi admin' },
    { code: 'VERIFIED', meaning: 'sudah diverifikasi admin' },
    { code: 'ASSIGNED', meaning: 'sudah ditugaskan ke petugas' },
    { code: 'IN_PROGRESS', meaning: 'sedang dalam proses penanganan' },
    { code: 'REVIEW', meaning: 'hasil kerja menunggu verifikasi admin' },
    { code: 'COMPLETED', meaning: 'selesai' },
    { code: 'REJECTED', meaning: 'ditolak admin (lihat alasan)' },
  ],
};

// Tingkat akses data: PUBLIC (semua) | PRIVATE (milik user) | INTERNAL (admin/petugas) | SECRET (tidak pernah keluar)
export const MODEL_REGISTRY = {
  User: {
    description: 'Akun pengguna (Masyarakat, Admin, Petugas)',
    publicFields: ['name'],
    privateFields: ['email'],
    forbiddenFields: ['password'],
    relations: 'User 1-N Report, Assignment (sebagai officer), Notification',
  },
  Report: {
    description: 'Laporan fasilitas umum',
    publicFields: ['title', 'category', 'location', 'status', 'severity', 'createdAt'],
    privateFields: ['description', 'photo'],
    relations: 'Report N-1 User, 1-N Assignment/ReportEvidence/ReportStatusHistory',
  },
  Assignment: {
    description: 'Penugasan laporan ke petugas',
    publicFields: ['officerName', 'assignedAt', 'completedAt'],
    relations: 'Assignment N-1 Report, N-1 User(officer)',
  },
  ReportEvidence: {
    description: 'Bukti penyelesaian dari petugas',
    publicFields: ['description', 'createdAt'],
    relations: 'N-1 Report',
  },
  ReportStatusHistory: {
    description: 'Timeline perubahan status',
    publicFields: ['status', 'notes', 'actorName', 'createdAt'],
    relations: 'N-1 Report',
  },
  Notification: {
    description: 'Notifikasi per pengguna',
    publicFields: ['title', 'message', 'isRead', 'createdAt'],
    relations: 'N-1 User (hanya milik user yang login)',
  },
  VillageRw: {
    description: 'Master data RW (wilayah administratif)',
    publicFields: ['number', 'name', 'isActive', 'order'],
    forbiddenFields: [],
    relations: 'VillageRw 1-N VillageRt',
  },
  VillageRt: {
    description: 'Master data RT di bawah sebuah RW',
    publicFields: ['number', 'name', 'isActive', 'order'],
    forbiddenFields: [],
    relations: 'VillageRt N-1 VillageRw, 1-N User (tautan wilayah, bukan role)',
  },
};

// Registry intent publik citizen: tambah entri = kemampuan baru (tanpa ubah planner).
export interface PublicIntentDef {
  tool: string;
  args?: Record<string, unknown>;
  anyOf: string[];
  noneOf?: string[];
}

export const CITIZEN_PUBLIC_INTENTS: PublicIntentDef[] = [
  {
    tool: 'getPublicAdmins',
    anyOf: ['siapa admin', 'siapakah admin', 'adminnya siapa', 'adminnya', 'nama admin', 'admin siapa', 'yang menjadi admin', 'daftar admin', 'siapa yang memverifikasi', 'memverifikasi laporan'],
    noneOf: ['laporan saya', 'milik saya', 'laporanku'],
  },
  {
    tool: 'getUserCounts',
    anyOf: [
      'berapa pengguna', 'jumlah pengguna', 'berapa masyarakat', 'jumlah masyarakat',
      'masyarakat yang terdaftar', 'berapa user', 'pengguna terdaftar',
      'siapa saja masyarakat', 'daftar masyarakat', 'masyarakatnya siapa',
    ],
  },
  {
    tool: 'getTotalReports',
    anyOf: ['berapa laporan', 'jumlah laporan', 'total laporan', 'ada berapa laporan'],
    noneOf: ['saya', 'milikku', 'laporanku', 'milik saya', 'punya saya'],
  },
  {
    tool: 'getPublicLocations',
    anyOf: ['lokasi mana', 'lokasi paling', 'daerah mana', 'wilayah mana', 'lokasi apa saja'],
    noneOf: ['saya', 'milikku', 'laporanku', 'milik saya'],
  },
  {
    tool: 'getWebsiteInfo',
    args: { topic: 'statuses' },
    anyOf: ['status apa saja', 'daftar status', 'macam status', 'apa saja status', 'status laporan apa', 'arti status', 'maksud status'],
  },
  {
    tool: 'getWebsiteInfo',
    args: { topic: 'workflow' },
    anyOf: ['alur', 'workflow', 'tahapan', 'bagaimana proses', 'proses laporan', 'cara kerja', 'langkah'],
  },
  {
    tool: 'getWebsiteInfo',
    args: { topic: 'features' },
    anyOf: ['fitur website', 'fitur apa saja', 'fitur apa', 'fungsi website', 'kegunaan website', 'ada fitur baru', 'ada fitur', 'fitur baru', 'bisa apa saja'],
  },
  {
    tool: 'getWebsiteInfo',
    args: { topic: 'navigation' },
    anyOf: ['di mana', 'dimana', 'letak', 'menu apa', 'halaman apa', 'cara logout', 'logout di mana', 'bagaimana cara', 'gimana cara', 'cara membuat', 'cara melihat', 'cara melapor'],
  },
  {
    tool: 'getWebsiteInfo',
    args: { topic: 'contact' },
    anyOf: ['hubungi admin', 'kontak admin', 'nomor admin', 'no admin', 'whatsapp admin', 'wa admin', 'instagram', 'telepon admin', 'menghubungi', 'bantuan admin', 'kontak darurat'],
  },
];

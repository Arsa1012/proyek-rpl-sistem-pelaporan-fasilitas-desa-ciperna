# Sistem Pengetahuan AI — Desa Ciperna

Dokumen ini menjelaskan **arsitektur, data, alur kerja, dan daftar tool** yang dipakai
chatbot/AI Assistant. Tujuannya: siapa pun yang menambah fitur dapat memperbarui AI
tanpa menulis ulang chatbot.

> Cara kerja singkat: **Database = sumber DATA. Dokumen & registry = sumber FITUR.**
> AI tidak pernah menebak angka; ia hanya menyusun jawaban dari hasil query tool.

---

## 1. Arsitektur (alur satu arah)

```
UI (Chatbot / AdminAiAssistant)
   │  POST { message, history }
   ▼
Route  /api/ai/chat         (semua role, butuh sesi)
       /api/admin/ai/chat   (ADMIN saja)
       /api/chat            (alias lama Masyarakat — didelegasikan ke pipeline yang sama)
   ▼
src/lib/aiChat.ts     handleChatRequest()
   │  1. role + userId SELALU dari sesi server (bukan dari body)
   │  2. rate limit per user
   ▼
src/lib/aiIntent.ts   resolveIntent(role, message, history)
   │  • normalisasi ejaan/singkatan Indonesia ("sya"→"saya", "gmna"→"gimana"),
   │    tanpa mengubah angka, ID, email, atau tautan
   │  • ekstraksi slot: periode/rentang tanggal eksplisit, status, kategori,
   │    keparahan, jenis kerusakan, lokasi, nama pelapor, judul, fragmen ID
   │  • penentuan niat: hitung / daftar / detail / sebaran-per-dimensi /
   │    antrean / pelapor / petugas / pencarian kata kunci / penjelasan fitur
   │  • pertanyaan lanjutan ("kenapa?", "terus?", "maksudnya?") memakai konteks
   │  • permintaan tindakan tulis → refuseWrite (TIDAK pernah dieksekusi)
   ▼
src/lib/aiToolRegistry.ts   executeTools(role, userId, calls)
   │  • SATU tempat izin per tool (roles) — diperiksa SEBELUM query
   │  • batas maksimal 4 tool per pertanyaan
   │  • error query → { error: "query gagal" } (TIDAK disamarkan jadi data kosong)
   ▼
src/lib/aiTools.ts    fungsi Prisma READ-ONLY (agregasi + LIMIT, tanpa data mentah)
   ▼
LLM (OpenRouter) menyusun jawaban HANYA dari hasil tool
   └─ bila LLM gagal/timeout: ringkasan langsung dari hasil query (meta.fallback=true),
      bukan jawaban kosong dan bukan fakta karangan
```

Kunci keamanan: `aiIntent.ts` **tidak** memeriksa izin; seluruh otorisasi ada di
`aiToolRegistry.ts` pada sisi server. Manipulasi prompt tidak dapat melewatinya.

---

## 2. Model data & relasi

| Model | Isi penting | Relasi |
|---|---|---|
| `User` | `name`, `email` (unik), `password` (hash bcrypt — JANGAN pernah dikirim ke AI/frontend), `phone`, `isActive` (soft-disable), `mustChangePassword` (wajib ganti sandi setelah reset Admin), `role` = `CITIZEN`/`ADMIN`/`OFFICER`, `rtId` (opsional — tautan wilayah) | `reports`, `assignments`, `notifications`, `rt` (VillageRt) |
| `Report` | `title`, `description`, `category`, `damageType`, `severity`, `location`, `latitude/longitude`, `photo`, `aiResult`, `aiConfidence`, `status`, `rejectionReason`, kolom duplikat (`duplicateStatus`, `duplicateOfReportId`, …) | `user` (pelapor), `assignments`, `evidences`, `histories` |
| `Assignment` | `reportId`, `officerId`, `assignedAt`, `completedAt`, `notes`, pembatalan (`cancelledAt`, `cancelReason`, `cancelledBy`), review hasil (`reviewStatus` = `PENDING`/`APPROVED`/`REVISION`, `reviewNotes`, `reviewedAt`), `notifyMode` (`TEXT`/`TEXT_PHOTO` — format pemberitahuan ke warga yang dipilih Admin) | `report`, `officer`, `evidences` |
| `ReportEvidence` | `photo`, `description`, `assignmentId` (nullable — bukti lama) | `report`, `assignment` |
| `ReportStatusHistory` | `status`, `notes`, `actorName` (nama publik), `actorRole`, `createdAt` → dipakai untuk **timeline** | `report` |
| `Notification` | `userId`, `title`, `message`, `type` (termasuk `ANNOUNCEMENT`), `isRead`, `url` (tautan detail, mis. `/pengumuman/<slug>`), `announcementId` (sumber pengumuman, unik per `userId`+`announcementId` → anti-duplikat) | `user`, `announcement` |
| `AdminAuditLog` | jejak tindakan administratif (`action`, `targetUserId`, `targetReportId`) | — |
| `WhatsAppLog` | `dedupeKey` (unik, **idempoten**), `kind`, `toMasked`, `status`, `providerMessageId` | — |
| `VillageProfile` | Satu baris (`id = "singleton"`): identitas (`name`, `district`, `regency`, `province`, `postalCode`, `address`, `phone`, `email`), lokasi (`mapLink`, `mapEmbedUrl`, `latitude`, `longitude`, `coordinateSource`), narasi (`history`, `geography`, `potential`, `demographics`, `vision`, `mission`, `serviceHours`), `heroPhoto`, `dataStatus` = `UNVERIFIED`/`PARTIAL`/`VERIFIED`, `sourceUrl`, `verifiedAt`, `updatedBy` | — |
| `VillageOfficial` | Perangkat desa / RT / RW: `name`, `position`, `category` = `KEPALA_DESA`/`SEKRETARIAT`/`KASI`/`KAUR`/`RT_RW`/`LAINNYA`, `level`, `order`, `area`, `period`, `photo`, `isActive`, `isVerified`, `sourceUrl`, `verifiedAt`, `archivedAt` (arsip, **tidak dihapus**) | — |
| `VillageService` | Layanan desa: `name`, `description`, `requirements`, `procedure`, `schedule`, `contact`, `link`, `order`, `isActive`, `isVerified`, `sourceUrl`, `verifiedAt` | — |
| `VillageAnnouncement` | Pengumuman: `title`, `slug` (unik), `content`, `excerpt`, `category`, `coverPhoto`, `photos` (JSON daftar foto tambahan), `target` (`ALL`/`CITIZEN`/`OFFICER`), `notifyWhatsApp`, `isPublished`, `publishedAt`, `validFrom`, `validUntil`, `archivedAt`, `deletedAt`/`deletedBy` (hapus lunak), `authorId` → status **diturunkan** (`DRAFT`/`SCHEDULED`/`PUBLISHED`/`EXPIRED`/`ARCHIVED`/`DELETED`) | `notifications`, `deliveries` |
| `AnnouncementDelivery` | Status pengiriman WhatsApp pengumuman per penerima: `announcementId`, `userId` (unik per pengumuman → idempoten), `status` (`PENDING`/`SENT`/`FAILED`/`SKIPPED`), `toMasked`, `providerMessageId`, `error`, `attempts`, `sentAt` | `announcement` |
| `VillageRw` | Master data RW: `number` (unik), `name`, `order`, `isActive` | `rts` (VillageRt) |
| `VillageRt` | Master data RT di bawah satu RW: `rwId`, `number`, `name`, `order`, `isActive`, unik (`rwId` + `number`) | `rw`, `users` |

> **Wilayah ≠ role.** `User.rtId` hanya menautkan akun warga ke RT/RW untuk
> administrasi & statistik; role pengguna tetap `CITIZEN`. Registrasi hanya boleh
> memilih RT yang **aktif** dan berada di RW yang **aktif** (divalidasi server).
> Wilayah tidak pernah dihapus permanen — cukup dinonaktifkan (`isActive = false`).

> **Aturan publikasi data desa:** hanya `VillageOfficial`/`VillageService` dengan
> `isActive = true` **dan** `isVerified = true` yang tampil di halaman publik dan
> dijawab AI. `VillageProfile.dataStatus` menentukan label verifikasi. Data kosong
> **tidak** ditampilkan sebagai data resmi, dan AI tidak boleh mengarangnya.

Nilai yang lazim:
- `Report.status`: lihat `src/lib/status.ts` (satu sumber kebenaran).
- `Report.severity`: `RENDAH`, `SEDANG`, `TINGGI`, `KRITIS`.
- `Report.damageType`: `Lubang`, `Retak`, `Rusak`, `Tergenang`, `Mati`, `Patah`, `Kerusakan Umum`.
- `Report.category`: `Jalan`, `Lampu Jalan`, `Trotoar`, `Drainase`, `Taman`, `Jembatan`, `Fasilitas Umum Lainnya`.

---

## 3. Alur kerja laporan (status)

```
SUBMITTED  ──(Admin verifikasi)──▶ VERIFIED ──(Admin tugaskan)──▶ ASSIGNED
    │                                  │                              │
    │                                  │                        (Petugas mulai)
    │                                  │                              ▼
    │                                  │                        IN_PROGRESS
    │                                  │                              │
    │                                  │                    (Petugas kirim bukti)
    │                                  │                              ▼
    │                                  │                           REVIEW
    │                                  │                              │
    │                                  │            (Admin setujui)   ▼
    │                                  │                        COMPLETED
    └──(Admin tolak)──▶ REJECTED
```

- `REVIEW` = bukti penyelesaian sudah dikirim petugas dan **menunggu verifikasi Admin**.
  Warga melihatnya sebagai laporan yang masih berjalan (dihitung "aktif").
- Laporan duplikat tidak dihapus: `duplicateStatus` = `POSSIBLE_DUPLICATE` → ditinjau Admin →
  `DUPLICATE` (menunjuk `duplicateOfReportId`) atau `NOT_DUPLICATE`.

---

## 4. Halaman & menu per role

Daftar halaman dan menu yang benar-benar ada tersimpan di `src/lib/websiteKnowledge.ts`
(`WEBSITE.pages`, `WEBSITE.menus`, `WEBSITE.features`). AI menjelaskannya lewat tool
`getWebsiteInfo` dengan topik: `statuses`, `workflow`, `menus`, `navigation`/`pages`,
`features`, `account`, `adminAccounts` (khusus Admin), `contact`.

Ringkas per role:

- **Masyarakat (CITIZEN)** — Dashboard, Buat Laporan, Laporan Saya, Profil.
- **Admin** — Dashboard, Asisten AI, Daftar Laporan (termasuk tab
  "Menunggu Verifikasi"), Laporan Duplikat, Data Warga, Wilayah RT/RW, Data Petugas,
  Portal Desa (Profil Desa, Struktur Pemerintahan, Layanan Desa, Pengumuman),
  Penugasan Petugas, Statistik & Rekap, Profil.
- **Petugas (OFFICER)** — Dashboard, Tugas Saya, Riwayat Tugas, Profil.

Halaman publik Portal Desa (dapat diakses siapa pun): `/profil-desa`,
`/pemerintahan`, `/layanan`, `/pengumuman`, `/pengumuman/[slug]`.

### 4c. Pengelolaan Portal Desa (khusus Admin)

Sumber tunggal data desa ada di `src/lib/village.ts` (baca/validasi) dan
`src/lib/villageInput.ts` (parser input). Semua perubahan hanya lewat endpoint
Admin yang memeriksa `getSession()` + `role === 'ADMIN'` **dan** dicatat ke `AdminAuditLog`:

- **Profil Desa** — `GET`/`PUT /api/admin/village/profile` (identitas, lokasi & tautan
  peta, sejarah + sumber, kondisi/potensi, visi & misi, jam pelayanan, foto, status
  `dataStatus`, `sourceUrl`, `verifiedAt`).
- **Struktur Pemerintahan** — `GET`/`POST /api/admin/village/officials`,
  `PATCH /api/admin/village/officials/[id]` (tambah/ubah, tandai `isVerified`,
  aktifkan, atau **arsipkan** lewat `action: "archive"`). Tidak ada DELETE.
- **Layanan Desa** — `GET`/`POST /api/admin/village/services`,
  `PATCH /api/admin/village/services/[id]` (sama: verifikasi + nonaktifkan).
- **Pengumuman** — `GET`/`POST /api/admin/village/announcements`,
  `PATCH /api/admin/village/announcements/[id]` (ubah, atau
  `action: "publish"`/`"unpublish"`/`"archive"`/`"unarchive"`), lalu
  `DELETE /api/admin/village/announcements/[id]` (**hapus lunak**: `deletedAt`,
  riwayat notifikasi & pengiriman tetap tersimpan). Status pengiriman WhatsApp:
  `GET`/`POST /api/admin/village/announcements/[id]/whatsapp` (POST = kirim ulang
  yang gagal, idempoten). Slug dijaga unik (`src/lib/villageSlug.ts`).
- **Pemroses terjadwal** — `GET`/`POST /api/cron/village` (butuh `CRON_SECRET`
  atau sesi Admin): mengarsipkan pengumuman kedaluwarsa + memproses pengumuman
  jatuh tempo (notifikasi in-app & WhatsApp) secara **idempoten**.
- **Unggah foto** — `POST /api/admin/village/upload` (JPG/PNG/WEBP, maks 2 MB,
  penamaan file dibuat server-side, isi file diverifikasi sebagai gambar).

Nilai `dataStatus` yang valid: `UNVERIFIED`, `PARTIAL`, `VERIFIED`. Tautan peta hanya
menerima host yang dikenal (Google Maps/OpenStreetMap) dengan `https`. Koordinat hanya
diterima dalam rentang valid. Tidak ada penghapusan permanen pada data desa.

### 4d. Master data Wilayah RT/RW (khusus Admin)

Sumber tunggal di `src/lib/region.ts`. Halaman Admin: `/admin/wilayah` (menu
**Wilayah RT/RW**). Endpoint (semua wajib `requireAdmin`, dicatat ke `AdminAuditLog`):

- `GET /api/regions` — **publik**: hanya RW/RT aktif yang punya RT, tanpa data pribadi.
  Dipakai formulir registrasi & profil warga.
- `GET /api/admin/regions` — seluruh RW/RT (termasuk nonaktif) + jumlah warga tertaut.
- `POST /api/admin/regions` — tambah `RW` atau `RT` (`type`, `number`, `name?`, `order?`,
  `rwId` untuk RT).
- `PATCH /api/admin/regions/[id]` — ubah nomor/nama/urutan, pindah RT antar-RW, atau
  aktif/nonaktifkan (`isActive`). **Tidak ada DELETE** — wilayah hanya dinonaktifkan agar
  historis tetap utuh.

Aturan: nomor RW unik; nomor RT unik **di dalam** RW-nya (RW berbeda boleh berimbang nomor).
Registrasi (`POST /api/auth/register`) dan ubah profil (`PATCH /api/profile`) memvalidasi
`rtId` di server. Akun lama tanpa RT tetap sah (kolom `rtId` opsional) dan dapat melengkapi
data lewat halaman Profil.

---

## 5. Daftar tool AI (READ-ONLY)

### 4b. Pengelolaan akun (khusus Admin)

Fitur nyata pada menu **Data Warga** (`/admin/masyarakat`) dan **Data Petugas**
(`/admin/petugas`):

- **Tambah Petugas** — buat akun `OFFICER` baru (nama, email, no. WA opsional, kata sandi
  awal atau kata sandi sementara otomatis). Role ditetapkan **server** (`role: 'OFFICER'`),
  bukan dari input browser. Endpoint: `POST /api/admin/officers`.
- **Lihat Detail** — detail aman warga/petugas (nama, email, no. WA, peran, status,
  tanggal registrasi, jumlah laporan/penugasan, riwayat terkait). Endpoint:
  `GET /api/admin/users/[id]`. **Tanpa** password/hash/token.
- **Reset Kata Sandi** — buat kata sandi sementara acak, simpan sebagai hash bcrypt, tandai
  `mustChangePassword = true`, tampilkan **sekali** ke Admin. Endpoint:
  `POST /api/admin/users/[id]/reset-password`. Pengguna wajib mengganti saat login
  berikutnya (`POST /api/auth/change-password`, halaman `/ubah-password`).
- **Aktif/Nonaktif & Edit Data** — `PATCH /api/admin/users/[id]` (`isActive` atau
  `name`/`email`/`phone`). Tidak ada penghapusan; role tidak dapat diubah.

Semua endpoint memeriksa `getSession()` + `role === 'ADMIN'` di server, memvalidasi input,
menolak akun `ADMIN` sebagai target, dan mencatat aksi ke `AdminAuditLog`
(`CREATE_OFFICER`, `EDIT_USER`, `RESET_PASSWORD`, `ENABLE_USER`/`DISABLE_USER`) tanpa pernah
mencatat kata sandi/token.

---

## 5. Daftar tool AI (READ-ONLY)

Semua tool berada di `src/lib/aiTools.ts` dan **wajib** didaftarkan di
`src/lib/aiToolRegistry.ts`. Tidak ada tool tulis.

### Umum (semua role)
| Tool | Kegunaan |
|---|---|
| `getWebsiteInfo` | Menjelaskan halaman, menu, fitur, status, alur, akun, kontak, dan pengelolaan akun Admin (`adminAccounts`) sesuai role. |
| `getVillageProfileInfo` | Profil/identitas Desa Ciperna dari database (alamat, kontak, sejarah + sumber, kondisi, potensi, visi & misi, jam pelayanan, status verifikasi). Field kosong → "belum tercatat". |
| `getVillageOfficials` | Perangkat desa/RT/RW yang **sudah diverifikasi** (nama, jabatan, wilayah, periode, sumber). Tanpa nomor pribadi. Kosong → AI menyatakan belum tersedia. |
| `getVillageServices` | Layanan desa terverifikasi (deskripsi, persyaratan, prosedur, jadwal, kontak resmi). |
| `getVillageAnnouncements` | Pengumuman desa yang sudah diterbitkan (judul, ringkasan, tanggal WIB, tautan). |
| `getVillageMapInfo` | Lokasi/alamat desa dan `mapLink` untuk petunjuk arah (tanpa mengarang patokan). |
| `getPublicAdmins` | Nama Admin (data publik). |
| `getUserCounts` | Jumlah pengguna per role (tanpa identitas) — tersedia untuk semua role. |
| `refuseWrite` | Menolak permintaan yang mengubah data (verifikasi, ubah status, hapus, reset sandi, kirim siaran) dan mengarahkan ke menu resmi. Tidak menulis apa pun. Pesan disesuaikan dengan role. |

### Masyarakat — hanya data milik sendiri
| Tool | Kegunaan |
|---|---|
| `getMyReportCounts` | Jumlah laporan sendiri + rincian status (termasuk `REVIEW`). |
| `getMyRecentReports` | Laporan terbaru milik sendiri. |
| `getMyReportById` | Ringkas satu laporan milik sendiri (fragmen ID). |
| `getMyReportTimeline` | Riwayat perubahan status satu laporan milik sendiri. |
| `getMyReportFullDetail` | Detail lengkap (status, petugas, bukti, timeline, duplikat, **alasan penolakan** bila ada). |
| `searchMyReports` | Filter kategori/status/keparahan/jenis kerusakan/periode/**rentang tanggal**/lokasi; hasil menyertakan `appliedFilters`, `dateRange`, dan `rejectionReason`. |
| `getMyEvidence` | Bukti penyelesaian pada laporan sendiri. |
| `getMyProfile` | Profil sendiri (tanpa password). |
| `getMyNotifications` | Notifikasi in-app sendiri. |
| `getMyDuplicateInfo` | Info laporan sendiri yang ditandai duplikat. |
| `getMyLatestHandling` | Petugas yang menangani laporan terbaru milik sendiri. |
| `getPublicOfficers` | Nama petugas desa (data publik). |
| `getPublicCategories` | Kategori yang pernah dilaporkan (agregat). |
| `getPublicLocations` | Lokasi dengan laporan terbanyak (agregat). |
| `getUserCounts` | Jumlah pengguna per role (tanpa identitas). |
| `getTotalReports` | Total laporan (agregat). |
| `refusePrivate` | Menolak permintaan data warga lain dengan pesan tetap. |

### Petugas — hanya tugas milik sendiri
| Tool | Kegunaan |
|---|---|
| `getMyTaskSummary` | Total/aktif/dalam proses/selesai/menunggu verifikasi. |
| `getMyActiveTasks` | Tugas aktif milik petugas. |
| `getMyUrgentTasks` | Tugas aktif dengan keparahan tinggi/kritis. |
| `searchMyTasks` | Filter tugas: sudah/belum selesai, status, keparahan, periode, rentang tanggal, atau **fragmen ID laporan** (untuk lanjutan "kenapa laporan itu?"). |

### Admin — data operasional seluruh sistem
| Tool | Kegunaan |
|---|---|
| `listReports` | **Daftar** laporan terfilter (status, kategori, keparahan, jenis kerusakan, lokasi, pelapor, periode, **rentang tanggal**) + total + paginasi. |
| `countReports` | **Jumlah** laporan terfilter + rincian per status/kategori/keparahan (mendukung periode & rentang tanggal). |
| `findReportersByName` | Cari pengguna dari potongan nama (menandai ambiguitas). |
| `searchReportsByTitle` | Cari laporan dari potongan judul (menandai ambiguitas). |
| `searchReportsByKeyword` | **Pencarian kata kunci bebas** pada judul, deskripsi, lokasi, kategori, dan jenis kerusakan (maks. 15 hasil). |
| `getReportFullDetail` | Detail lengkap satu laporan (fragmen ID). |
| `getNthReport` | Laporan ke-N menurut urutan waktu. |
| `getRecentReports` | Laporan terbaru. |
| `getTodayReports` | Laporan yang dibuat hari ini (WIB). |
| `getTodayReporters` | Nama pelapor hari ini (WIB). |
| `getTodayCitizens` | Warga yang mendaftar hari ini (WIB). |
| `getTodaySummary` | Rekap laporan hari ini per status. |
| `getSystemStats` | Statistik laporan per status (keseluruhan/bulan/pekan). |
| `getSystemOverview` | Ringkasan kondisi sistem dalam satu panggilan. |
| `getStatsByCategory` | Jumlah laporan per kategori. |
| `getStatsBySeverity` | Jumlah laporan per tingkat keparahan. |
| `getStatsByLocation` | Jumlah laporan per lokasi. |
| `getDamageTypeStats` | Jumlah laporan per jenis kerusakan. |
| `getOfficerStats` | Kinerja petugas (total/aktif/selesai). |
| `getOfficerWorkload` | Beban kerja petugas + judul laporan yang ditangani. |
| `getOfficerDetail` | Detail seorang petugas berdasarkan nama. |
| `getAvgResolutionDays` | Rata-rata waktu penyelesaian (hari). |
| `getAvgAiConfidence` | Rata-rata confidence analisis AI. |
| `getCitizenStats` / `getRecentCitizens` / `getReporters` | Statistik warga & pelapor teratas. |
| `getUnverifiedQueue` | Antrean laporan `SUBMITTED` menunggu verifikasi. |
| `getPendingAssignment` | Laporan `VERIFIED` yang belum ada petugas aktif. |
| `getPendingResultVerification` | Laporan `REVIEW` (bukti menunggu verifikasi). |
| `getHighSeverityReports` | Laporan `TINGGI`/`KRITIS` yang belum selesai. |
| `getStaleReports` | Laporan lama yang belum ditangani. |
| `getRepeatedLocations` | Lokasi dengan laporan berulang. |
| `getDuplicateOverview` | Ringkasan laporan duplikat & kandidatnya. |
| `searchAccounts` | **Cari akun** warga/petugas/admin: filter `role`, `isActive`, kata kunci nama/email/telepon, tanggal daftar (tanpa password/hash). |
| `countAccounts` | **Jumlah akun** terfilter + rincian aktif/nonaktif dan per role (agregasi database). |
| `getOfficerTaskCounts` | Jumlah tugas per petugas (total/aktif/selesai) untuk lanjutan "berapa tugas mereka". |
| `getMonthlyCompletionTrend` | **Tren penyelesaian**: jumlah laporan berstatus `COMPLETED` per bulan (kalender WIB, default 6 bulan). Satu `count` per bulan dijalankan di database — model AI tidak menghitung sendiri. |
| `getWhatsAppDeliveryStatus` | **Status pengiriman WhatsApp** sebuah laporan (fragmen ID) dari tabel `WhatsAppLog`: jenis (`kind`), status (`SENT`/`FAILED`/…), nomor **tersamar**, pesan kegagalan aman, dan waktu WIB. Tanpa catatan → AI menyatakan belum ada catatan (bukan mengklaim gagal/berhasil). |
| `getRegionOverview` | **Master data wilayah (RW/RT)** + jumlah warga terdaftar per RT (agregasi `groupBy`). Hanya agregat & label wilayah — tanpa identitas warga. |
| `runAiDiagnostics` | Diagnostik READ-ONLY keterbacaan tiap domain data (Admin/development). |

### 5b. Direktori akun, pencarian, dan pertanyaan lanjutan (Admin)

- **Pertanyaan akun**: "siapa warga yang akunnya dinonaktifkan?", "cari warga nonaktif",
  "ada berapa akun petugas aktif?", "berapa akun warga?", "cari warga bernama Budi"
  → `searchAccounts` (daftar) atau `countAccounts` (hitungan), dengan filter `role`,
  `isActive`, `q`, dan `period`. Tanpa tool ini, pertanyaan tersebut dulu jatuh ke
  statistik umum dan dijawab "data tidak tersedia" padahal datanya ada.
- **Pencarian kata kunci**: "cari laporan dengan kata kunci lubang", "laporan yang
  mengandung kata 'banjir'" → `searchReportsByKeyword`. Kata kunci dicari di judul,
  deskripsi, lokasi, kategori, dan jenis kerusakan; batas 15 hasil dan AI menyebut
  totalnya. Jika tidak ada yang cocok, AI mengatakan **tidak ditemukan** — bukan
  mengarang laporan.
- **Rentang tanggal eksplisit**: "laporan tanggal 1–15 Agustus 2025", "tugas saya
  kemarin", "laporan minggu lalu", "bulan Agustus 2025" → `dateFrom`/`dateTo`
  (kalender **WIB**, batas akhir inklusif). Angka seperti "tampilkan 5–10 laporan"
  **tidak** dianggap tanggal karena tidak didahului "tanggal"/nama bulan.
- **Pertanyaan lanjutan**: "berapa tugas mereka?" (setelah daftar petugas) →
  `getOfficerTaskCounts` memakai konteks role/status petugas; "tadi yang kamu sebut
  siapa saja?" → mengulang `searchAccounts` dengan filter dari konteks percakapan.
  "kenapa?", "terus?", "maksudnya?" → memakai laporan/status terakhir yang dibahas;
  bila asisten menyebut `ID: abc12345`, pertanyaan lanjutan membuka laporan itu
  (`getMyReportFullDetail`/`getReportFullDetail`) dan menampilkan **alasan penolakan**
  yang tercatat. Riwayat hanya dipakai untuk memahami maksud, bukan sebagai sumber fakta:
  angka dan status selalu dibaca ulang dari database.
- Email & nomor telepon **boleh** ditampilkan untuk Admin; `password`/hash/token
  tidak pernah ikut. Bila `phone` bernilai null, AI menyebut "belum tercatat".

---

## 6. Data baru langsung terbaca (tanpa retraining)

Setiap pertanyaan memicu **query database saat itu juga**:

1. `resolveIntent` memilih tool berdasarkan kalimat.
2. `executeTools` menjalankan query Prisma (agregasi `count`/`groupBy` + `LIMIT`).
3. LLM hanya menyusun kalimat dari hasil query tersebut.

Konsekuensinya: laporan baru, perubahan status, penugasan baru, dan verifikasi baru
**langsung terlihat** pada pertanyaan berikutnya. Tidak ada cache, tidak ada snapshot,
tidak ada training ulang. Tool juga memakai batas waktu **WIB (UTC+7)** yang konsisten,
dan menyertakan label tanggal/jam berakhiran `Wib` (mis. `createdAtWib`, `dateLabel`)
supaya AI tidak mengubah sendiri string ISO/UTC dan meleset satu hari.

Untuk statistik per dimensi (`getStatsByCategory`, `getStatsBySeverity`,
`getStatsByLocation`, `getDamageTypeStats`) hasilnya berisi `total` (jumlah laporan pada
cakupan filter), `covered` (jumlah yang tercakup rincian), dan `unclassified` (laporan
yang belum punya nilai dimensi tersebut). AI **wajib** memakai `total` dan menyebut
`unclassified` bila > 0, sehingga tidak ada lagi jawaban "total 60" yang tidak cocok
dengan rincian. Filter `period` juga diteruskan, sehingga "jenis kerusakan apa saja hari
ini" tidak dijawab dengan data sepanjang waktu.

Jika query gagal, hasilnya `{ error: "query gagal" }` dan AI wajib menyampaikan
gangguan pengambilan data — bukan mengaku "tidak ada data". Hasil kosong tetap `0`.
Setiap tool juga mencatat observabilitas server-side yang **aman** (nama tool, role,
durasi `ms`, ukuran hasil, jumlah baris) tanpa isi data pribadi/kredensial. Jawaban wajib
membedakan empat keadaan: **data kosong** (0 hasil), **field tidak tersedia**
(mis. `phone: null`), **tidak punya izin** (ditolak), dan **query gagal**.

Bila layanan LLM gagal/timeout setelah query berhasil, `handleChatRequest` **tidak**
mengembalikan error kosong: ia mengirim ringkasan langsung dari hasil query
(`formatFallbackAnswer`) dengan `meta.fallback = true`, dan mencatat
`fallback=true` di log server. Ringkasan itu tidak menambah fakta, tidak mengklaim
tindakan, dan tetap menyebutkan keterbatasan narasi. Bila tidak ada hasil query sama
sekali, error LLM tetap diteruskan (tidak disamarkan).

### 6b. Jawaban deterministik (tanpa LLM)

Beberapa pertanyaan yang paling sering ditanyakan dan paling rawan salah angka
dirangkai **langsung dari hasil query** (tanpa memanggil LLM), sehingga tidak mungkin
dikarang atau tertukar:

| Pertanyaan | Tool | Bentuk jawaban |
|---|---|---|
| "berapa laporan saya dan apa statusnya?" / "laporan saya gimana?" (warga) | `getMyReportCounts` (+ `getMyRecentReports`) | daftar status berlabel + jumlah laporan yang masih berjalan + laporan terbaru |
| "berapa tugas saya?" / "ada tugas baru?" (petugas) | `getMyTaskSummary` (+ `getMyActiveTasks`) | total, aktif, dikerjakan, menunggu verifikasi admin, selesai + tugas aktif |
| "laporan berjudul X statusnya apa?" (beberapa kandidat) | `searchReportsByTitle` | daftar kandidat + status masing-masing + permintaan klarifikasi ID |
| "laporan saya yang ... sudah selesai?" (warga) | `searchMyReports` | daftar laporan sendiri sesuai filter + status + alasan penolakan |
| "cari laporan dengan kata kunci X" (Admin) | `searchReportsByKeyword` | jumlah + daftar hasil (maks. 15) |
| "siapa petugas/admin di desa?" | `getPublicOfficers` / `getPublicAdmins` | daftar nama |
| "berapa jumlah pengguna / total laporan?" | `getUserCounts` / `getTotalReports` | angka agregat |
| "jalankan diagnostik AI" (Admin) | `runAiDiagnostics` | daftar domain data + jumlah + status baca per domain |
| permintaan data milik orang lain | `refusePrivate` | penolakan tetap (pesannya berbeda untuk warga dan petugas) |
| permintaan mengubah data (verifikasi/hapus/ubah status/…) | `refuseWrite` | penolakan + panduan menu resmi; menegaskan **tidak ada perubahan** yang dilakukan |

Deterministik dipakai untuk satu tool **atau pasangan tool yang sudah ditentukan**
(mis. jumlah + daftar terbaru). Pertanyaan lanjutan dan pertanyaan campuran lain tetap
disusun LLM (dengan struktur hasil yang sudah berlabel) agar jawaban tidak terasa
seperti template.

---

## 7. Notifikasi, pesan otomatis, dan anti-balasan ganda

- **Tidak ada webhook masuk.** Status `sent`/`delivered`/`read`/`failed` dari provider
  tidak pernah memicu percakapan AI. Tidak ada route `webhook`/`callback` di `src/app/api`.
- **Notifikasi otomatis tidak memanggil AI.** Hanya tiga endpoint chat yang boleh
  mengimpor layanan AI (`/api/ai/chat`, `/api/admin/ai/chat`, `/api/chat`). Setiap
  permintaan harus membawa pesan pengguna eksplisit. Dijaga oleh tes drift.
- **Idempotensi pengiriman.** Setiap `notify*` di `src/lib/whatsapp.ts` memakai
  `dedupeKey` (tercatat di `WhatsAppLog`) sehingga event ganda tidak mengirim pesan
  dua kali. Tidak ada retry tak terbatas.
- **Status "terkirim"** hanya diberikan setelah provider merespons sukses.
- Notifikasi in-app (`Notification`) hanya dibaca lewat tool `getMyNotifications`;
  AI tidak menulis notifikasi.

### 7a. Pengumuman desa → notifikasi in-app (target masyarakat/petugas)

Saat Admin **menerbitkan** pengumuman (`POST`/`PATCH /api/admin/village/announcements`),
sistem membuat notifikasi in-app (`Notification`, `type = ANNOUNCEMENT`,
`url = /pengumuman/<slug>`) untuk setiap pengguna aktif **sesuai `target`**
(`ALL` = masyarakat + petugas, `CITIZEN`, `OFFICER`) yang sudah terdaftar sebelum waktu
terbit. Ketentuan yang berlaku (lihat `src/lib/announcementNotify.ts`):

- **Idempoten.** Satu pengumuman = satu notifikasi per pengguna, dijamin oleh
  `@@unique([userId, announcementId])` + penyaringan penerima. Retry/permintaan ulang
  tidak menggandakan notifikasi.
- **Terjadwal.** Pengumuman dengan `publishedAt` di masa depan **belum** menotifikasi;
  notifikasi dibuat saat jatuh tempo.
- **Konsisten.** Pengumuman diubah → isi notifikasi diperbarui (dan ditandai belum dibaca
  bila isinya berubah); ditarik (unpublish) → notifikasi turunannya dihapus. Pengumuman
  yang diarsipkan, kedaluwarsa, atau dihapus lunak juga tidak lagi menotifikasi.
- **Chatbot** membaca pengumuman langsung dari database (`getVillageAnnouncements`), jadi
  judul/ringkasan/tanggal/tautan selalu sama dengan yang dilihat warga — tanpa menyalin
  ulang isi pengumuman ke prompt.

### 7a-2. Pengumuman desa → siaran WhatsApp (Fonnte, opsional, terpisah)

Jika Admin menyalakan `notifyWhatsApp`, sistem juga mengirim **WhatsApp** via Fonnte ke
penerima sesuai `target` — terpisah total dari status publikasi (lihat
`src/lib/announcementBroadcast.ts`):

- **Hanya saat jatuh tempo & belum kedaluwarsa/arsip.** Draft & pengumuman terjadwal
  belum dikirim.
- **Idempoten per penerima.** `@@unique([announcementId, userId])` pada
  `AnnouncementDelivery` + `dedupeKey` `announce:<id>:<userId>` di lapisan Fonnte. Penerima
  yang sudah `SENT` tidak pernah dikirim ulang (termasuk saat mengedit pengumuman).
- **Bertahap.** Setiap pemanggilan memproses satu batch (25 penerima); sisanya diproses
  pemanggilan berikutnya / tombol "Kirim ulang" / scheduler. Tidak ada blast tak terkendali.
- **Status jujur.** Per penerima dicatat `PENDING`/`SENT`/`FAILED`/`SKIPPED` (mis. nomor
  tidak valid) di `AnnouncementDelivery`; `SENT` berarti **diterima penyedia** (Fonnte),
  bukan konfirmasi dibaca. Kegagalan satu penerima tidak menghentikan sisanya maupun
  membatalkan publikasi.
- **Pesan** memuat judul, ringkasan, tanggal publikasi (WIB), masa berlaku (jika ada), dan
  tautan `/pengumuman/<slug>` bila ada.

### 7a-3. Penjadwalan & masa berlaku (scheduler idempoten)

`GET`/`POST /api/cron/village` (header `x-cron-secret` = `CRON_SECRET`, atau sesi Admin):
1. Mengarsipkan pengumuman yang `validUntil`-nya lewat (tanpa menghapus riwayat).
2. Memproses pengumuman jatuh tempo: notifikasi in-app + (bila `notifyWhatsApp`) siaran
   WhatsApp. Semua idempoten → aman dipanggil berulang.

Atur pemanggilan berkala (mis. tiap 5 menit) dari cron OS / scheduler hosting. Zona waktu
tampilan memakai **WIB** (`Asia/Jakarta`). Tanpa `CRON_SECRET`, endpoint hanya dapat
dijalankan Admin yang login (tidak ada jalur terbuka).

### 7b. Persetujuan bukti: pilihan "teks saja" atau "teks + foto" (Fonnte media)

Alur yang ada tidak berubah: petugas unggah bukti → laporan berstatus `REVIEW` → Admin
memverifikasi di halaman detail laporan → setujui (laporan `SELESAI`) atau minta perbaikan
(alasan wajib). Unggahan bukti **tidak** otomatis menyelesaikan laporan.

Di panel verifikasi, Admin memilih **format pemberitahuan ke warga** (radio yang terlihat,
default "teks saja"):

| Mode | Yang dikirim | `dedupeKey` |
|---|---|---|
| `TEXT` | Pesan teks (judul, status, hasil, petugas, catatan Admin) + tautan detail laporan. | `approved:<reportId>` |
| `TEXT_PHOTO` | Pesan teks yang sama **+ foto bukti** dilampirkan. | `approved-photo:<reportId>` |

Ketentuan teknis & keamanan:

- Foto dikirim sebagai **multipart parameter `file`** ke `https://api.fonnte.com/send`
  (bukan `url` publik), sehingga foto bukti privat tidak perlu dipublikasikan permanen.
  Parameter `file` memerlukan paket Fonnte tingkat lanjut (super/advanced/ultra) dan
  ukuran berkas < 4 MB.
- Sumber foto **hanya** `/uploads/...` (foto bukti milik laporan yang sedang ditinjau);
  path traversal, tipe non-gambar, dan berkas > 4 MB ditolak (`loadEvidenceMedia`).
- Opsi "teks + foto" **nonaktif** dan ditolak server (HTTP 400) bila laporan tidak punya
  foto bukti → tidak pernah mengirim foto secara diam-diam.
- **Status persetujuan terpisah dari status notifikasi.** Kegagalan WhatsApp tidak pernah
  membatalkan status `SELESAI`; kegagalan dicatat di `WhatsAppLog` (`FAILED` + alasan aman)
  dan panel menampilkan status + tombol **kirim ulang** (`POST /api/admin/reports/[id]/notify-completion`).
- Kirim ulang memakai **mode yang sama** seperti saat persetujuan (`Assignment.notifyMode`),
  tidak menyetujui ulang, dan tidak membuat laporan baru. Berkat `dedupeKey`, pesan yang sama
  tidak terkirim dua kali.
- Token hanya dibaca server-side (`FONNTE_TOKEN`, tanpa `NEXT_PUBLIC_`); token tidak pernah
  muncul di UI, log, atau respons API.
- **Belum diverifikasi secara langsung** pada lingkungan ini: pengiriman Fonnte (teks
  maupun media) belum pernah dilakukan ke nomor nyata. Jalur media diuji dengan mock pada
  `tests/`; aktifkan dengan mengisi `FONNTE_TOKEN` dan menguji lewat `POST /api/test-wa`
  (atau kirim ulang dari panel verifikasi) sambil memeriksa `WhatsAppLog`.

### 7c. Notifikasi pendaftaran warga (Fonnte) — konfigurasi & uji

Setiap registrasi masyarakat yang **berhasil tersimpan** memicu notifikasi WhatsApp ke
nomor Admin. Alurnya server-side (tidak pernah dari browser):

1. `POST /api/auth/register` menyimpan akun (dengan validasi RT/RW).
2. Best-effort: `notifyAdminNewUser()` di `src/lib/whatsapp.ts` mengirim pesan ke nomor
   Admin via Fonnte (`https://api.fonnte.com/send`).
3. Kegagalan pengiriman **tidak** membatalkan registrasi (hanya dicatat di `WhatsAppLog`).

Isi pesan memuat nama, email, nomor WhatsApp, RT, RW, dan waktu registrasi, ditutup teks
wajib: “Pesan ini otomatis. Tidak perlu membalas jika tidak ada keperluan lain.”
Pesan **tidak pernah** memuat kata sandi/token/OTP/hash.

Environment variable (server-side, lihat `.env.example`):

| Variabel | Wajib | Keterangan |
|---|---|---|
| `FONNTE_TOKEN` | ya | Token device dari dashboard Fonnte. |
| `WHATSAPP_ADMIN_NUMBER` | ya\* | Nomor Admin penerima (08xx/628xx). |
| `FONNTE_ADMIN_PHONE` | alternatif\* | Boleh dipakai menggantikan `WHATSAPP_ADMIN_NUMBER`. |
| `APP_URL` | tidak | Base URL untuk tautan di dalam pesan. |

\* Minimal salah satu dari `WHATSAPP_ADMIN_NUMBER` / `FONNTE_ADMIN_PHONE` harus terisi.
Semua nilai hanya dibaca server-side dan tidak memakai prefix `NEXT_PUBLIC_`.

Anti-duplikasi & status: setiap pesan memakai `dedupeKey` (mis. `register:<userId>`) yang
dicatat di `WhatsAppLog` (`PENDING`/`SENT`/`FAILED`) sehingga double-submit atau retry tidak
mengirim pesan kedua kali.

Cara menguji tanpa mengganggu data:
1. Isi `FONNTE_TOKEN` + nomor Admin, jalankan `npm run dev`.
2. Registrasi akun uji di `/register` → cek `WhatsAppLog` (`status = SENT`) dan pesan di
   perangkat Admin.
3. Uji terarah: `POST /api/test-wa` (Admin) untuk mengirim pesan contoh tanpa membuat akun.
4. Tanpa token, integrasi tetap aman: pesan dilewati (`not_configured`) dan registrasi tetap sukses.

---

## 8. Aturan privasi & keamanan

1. `role` dan `userId` **selalu** dari sesi server (`getSession()`), tidak pernah dari body/message.
2. Masyarakat hanya dapat membaca laporan **miliknya** (semua tool awalan getMy dan searchMyReports) —
   diverifikasi lewat `userId` di klausa `where`, bukan dari argumen AI.
3. Permintaan identitas/laporan warga lain dijawab `refusePrivate`.
4. Petugas hanya melihat tugas miliknya; permintaan tugas petugas lain dijawab penolakan
   tetap (`refusePrivate`) dengan arahan ke menu Tugas Saya.
5. Jawaban ke Admin tidak memuat kredensial: `password`, hash, token, API key tidak pernah
   dikirim ke LLM. Email pelapor di-mask untuk Petugas. Untuk Admin, field non-rahasia
   (email, nomor telepon, role, status) boleh ditampilkan lewat `searchAccounts`.
6. Argumen dari AI divalidasi: status/keparahan harus salah satu nilai dikenal, `limit`
   dan `offset` dibatasi, tanggal harus `YYYY-MM-DD` yang valid, tidak ada SQL mentah/`$queryRaw`.
7. Lapisan tool bersifat read-only untuk DATA BISNIS (dijaga tes): verifikasi,
   penugasan, ubah status hanya lewat alur bisnis resmi di halaman masing-masing.
   Satu-satunya kemampuan tulis AI adalah penyimpanan entri PENGETAHUAN, dan itu
   pun DUA FASE (usulan → konfirmasi eksplisit pengguna → tersimpan sebagai entri
   BELUM DIVERIFIKASI); implementasinya di `src/lib/aiKnowledgeStore.ts`.
8. **Permintaan tulis tidak pernah dieksekusi AI.** Kalimat seperti "verifikasi laporan X",
   "hapus laporan", "ubah status", "reset kata sandi warga", atau "kirim pengumuman"
   dijawab `refuseWrite` (untuk semua role) dengan arahan ke menu resmi. Pertanyaan
   "bagaimana cara …" tetap dijawab sebagai penjelasan fitur, bukan perintah.
9. **Fallback jujur.** Kegagalan LLM tidak boleh berubah menjadi "tidak ada data" atau
   jawaban karangan; hasil query yang berhasil tetap disajikan apa adanya dengan penanda
   `meta.fallback`.

---

## 9. Batasan yang diketahui

- Layanan AI memerlukan `OPENROUTER_API_KEY`. Tanpa itu, endpoint mengembalikan
  "Layanan AI belum dikonfigurasi." (HTTP 503) — bukan jawaban palsu.
- Pertanyaan di luar cakupan sistem (mis. "ibu kota Indonesia") tidak memicu query; AI
  menjelaskan keterbatasannya.
- Ambigu nama pelapor/judul laporan tidak ditebak: tool menandai `ambiguous` dan AI
  meminta klarifikasi singkat.
- Reset kata sandi **mandiri kini tersedia**: pengguna dapat meminta tautan reset di
  `/lupa-password` (tautan dikirim hanya ke nomor WhatsApp yang terdaftar pada akun;
  respons selalu umum sehingga tidak membocorkan apakah akun terdaftar). Admin tetap dapat
  melakukan **Reset Kata Sandi** akun via menu Data Warga/Data Petugas (hasil: kata sandi
  sementara sekali pakai + wajib ganti saat login).
- Akun **Petugas** baru disarankan dibuat dengan **tautan aktivasi** (token acak sekali pakai,
  berbatas waktu, dikirim ke nomor WhatsApp petugas). Kata sandi tidak pernah dikirim melalui
  WhatsApp; kata sandi dibuat sendiri oleh petugas di `/aktivasi`. Bila notifikasi WhatsApp
  gagal, akun tetap tersimpan dan Admin dapat **mengirim ulang tautan** (tanpa membuat akun baru).
- Deteksi periode memakai WIB tetap (UTC+7), tanpa penyesuaian DST (tidak berlaku di Indonesia).
- Pencarian akun dibatasi 20 hasil per halaman (field `hasMore`) dan semua hitungan berasal
  dari agregasi database, sehingga daftar besar tidak dikirim seluruhnya ke model.
- Dokumen ini menjelaskan **struktur** sistem; **data aktual** selalu dibaca dari database
  saat pertanyaan diajukan. Bila schema/API/aturan bisnis berubah, perbarui dokumen ini dan
  katalog tool (bagian 5) — AI hanya "tahu" kemampuan yang benar-benar terdaftar.
- Diagnostik keterbacaan data tersedia untuk ADMIN (endpoint `/api/admin/ai/diagnostics` dan
  pertanyaan "jalankan diagnostik AI"). Tidak dibuka untuk masyarakat umum.
- Data desa default sengaja **kosong** (tanpa pejabat/statistik contoh). Profil awal hanya memuat
  identitas administratif + ringkasan dari referensi awal Wikipedia dengan `dataStatus = PARTIAL`.
  Selama perangkat desa belum ditandai `isVerified`, AI akan berkata datanya belum tersedia.
- Master data wilayah RT/RW tersimpan di model terpisah (`VillageRw`/`VillageRt`) dan
  dipakai pada registrasi & profil warga. Perangkat desa (termasuk Ketua RT/RW) tetap
  entri `VillageOfficial` berkategori `RT_RW`; keduanya berbeda: wilayah = administratif,
  perangkat = jabatan/verifikasi.
- Notifikasi pengumuman in-app bersifat otomatis; **siaran WhatsApp pengumuman** kini
  tersedia tetapi bersifat **opt-in** (Admin menyalakan `notifyWhatsApp`) dan mencatat status
  per penerima di `AnnouncementDelivery`. Status `SENT` = diterima penyedia (Fonnte), bukan
  konfirmasi dibaca. Pengumuman tetap dapat diterbitkan & fotonya dilihat meski WhatsApp
  belum dikonfigurasi.
- Pengiriman **media** (foto bukti) ke Fonnte belum pernah diverifikasi ke nomor nyata pada
  lingkungan ini. Kode sudah lengkap dan diuji dengan mock; verifikasi langsung memerlukan
  `FONNTE_TOKEN` dengan paket Fonnte yang mendukung `file` (super/advanced/ultra) dan berkas
  < 4 MB.

---

## 10. Cara menambah fitur/alur baru agar AI ikut memahami

1. **Halaman/menu baru** → tambahkan ke `WEBSITE.pages` / `WEBSITE.menus` /
   `WEBSITE.features` di `src/lib/websiteKnowledge.ts`. AI otomatis dapat menjelaskannya.
2. **Status baru** → tambahkan ke `src/lib/status.ts` (`REPORT_STATUS_LABELS`) dan
   `WEBSITE.statuses`.
3. **Data baru** → tambahkan fungsi read-only di `src/lib/aiTools.ts`, daftarkan di
   `src/lib/aiToolRegistry.ts` (beserta `roles`), lalu tambahkan aturan di
   `src/lib/aiIntent.ts` bila perlu kata pemicu khusus.
4. **Jalankan `npm test`** — tes drift akan gagal bila dokumen/registry/schema tidak sinkron
   (halaman tak ada, menu tak ada, tool tak terdaftar, ada operasi tulis, atau ada jalur AI
   di luar endpoint chat).

---

## 11. Cara menjalankan & menguji

```
npm run dev        # jalankan aplikasi
npm test           # 269 tes: intent router, tool database, jawaban deterministik, skenario asisten (typo/privasi/rentang tanggal/read-only), manajemen akun, akun AI, portal desa, notifikasi & siaran pengumuman, akun petugas/aktivasi/reset, umpan balik simpan, alur persetujuan/struktur UI, drift/arsitektur
npm run lint
npx tsc --noEmit
npm run build
npx tsx prisma/seed-village.ts   # (opsional) buat profil desa awal bila belum ada; tidak menimpa data Admin
```

Tes tool berbicara ke database yang sama secara **read-only** (tidak ada data
dibuat/diubah/dihapus) dan membandingkan setiap angka dengan query Prisma independen.


---

## 12. Pembaruan terbaru: umpan balik simpan, notifikasi akun, aktivasi & reset

### 12a. Umpan balik simpan (toast) & pembedaan kegagalan (Fitur 1)

- Komponen bersama: `ToastProvider` + `useToast()` di `src/components/ui/Toast.tsx`
  (dipasang di `src/app/layout.tsx`, mode terang/gelap, `aria-live`, hormat
  `prefers-reduced-motion`).
- Penerjemah hasil request: `src/lib/clientFeedback.ts`
  (`describeFailure`/`describeError`/`runRequest`) membedakan **koneksi/timeout**
  (bisa diulang) vs **validasi**, **autentikasi**, **izin**, **konflik/tidak ditemukan**,
  dan **server**. Sukses hanya ditampilkan setelah `res.ok` (server mengonfirmasi).
- Diterapkan pada alur simpan: Profil Desa, Struktur Pemerintahan, Wilayah RT/RW,
  Layanan Desa, Pengumuman, dan pembuatan akun petugas. Tombol dinonaktifkan saat
  memproses (anti kirim ganda) dan kegagalan yang layak diulang menawarkan tombol
  "Coba lagi".

### 12b. Notifikasi WhatsApp akun (Fitur 2 & 3)

- Registrasi warga: selain notifikasi ke Admin, warga menerima pesan ke **nomor miliknya
  sendiri** (`notifyCitizenRegistrationWelcome`) berisi nama, email/username, dan imbauan
  tidak membagikan kata sandi/kode. Tidak pernah memuat kata sandi/hash/token.
- Akun petugas: `notifyOfficerAccountCreated` mengirim **tautan aktivasi** (tanpa kata sandi)
  atau info status akun. `notifyPasswordReset` mengirim tautan reset.
- Semua bersifat **best-effort & idempoten** (`dedupeKey`): kegagalan WhatsApp tidak
  membatalkan pembuatan akun; status pengiriman dipisahkan dari status akun dan dapat
  dikirim ulang. Token aktivasi/reset hanya disimpan sebagai **hash SHA-256**
  (`AccountToken`: `purpose`, `expiresAt`, `usedAt`) — sekali pakai & berbatas waktu.

### 12c. Endpoint & halaman baru

| Rute | Fungsi |
|---|---|
| `POST /api/auth/activate` | Setel kata sandi dari tautan aktivasi (token sekali pakai). |
| `POST /api/auth/forgot-password` | Minta tautan reset (respons selalu umum). |
| `POST /api/auth/reset-password` | Setel kata sandi baru dari tautan reset. |
| `POST /api/admin/officers/[id]/activation-link` | Kirim ulang tautan aktivasi tanpa membuat akun baru. |
| `/aktivasi`, `/reset-password`, `/lupa-password` | Halaman publik terkait. |

Tautan memakai `APP_URL` (lihat `.env.example`).

### 12d. Tool AI baru (khusus ADMIN, READ-ONLY)

| Tool | Kegunaan |
|---|---|
| `getWhatsAppSummary` | Ringkasan status pengiriman WhatsApp (berhasil/gagal) dari catatan sistem. |
| `getAnnouncementOverview` | Ringkasan pengumuman per status + daftar aktif & terjadwal. |
| `compareReportPeriods` | Perbandingan jumlah laporan bulan ini vs bulan lalu. |
| `getUnfinishedReports` | Laporan belum selesai beserta status & alasan yang **tercatat** di riwayat. |

Contoh pertanyaan yang dikenali (Admin): "Ada berapa laporan yang belum selesai?",
"Berapa notifikasi WA yang gagal?", "Pengumuman apa yang masih aktif?",
"Laporan bulan ini lebih banyak dari bulan lalu?", "Ringkas pekerjaan petugas minggu ini.",
"Siapa petugas yang pegang laporan itu?" (memakai konteks laporan sebelumnya).

Setiap jawaban menyertakan **transparansi**: waktu data diambil, periode, kategori sumber
data, penanda bila sebagian data gagal dimuat, dan tautan "Lihat data sumber" menuju
halaman berwenang (bukan data mentah).

### 12e. Pembaruan asisten: bahasa sehari-hari, rentang tanggal, read-only & UI

- **Normalisasi bahasa** (`normalizeIndonesian`): singkatan/typo umum
  (`sya`→`saya`, `gmna`→`gimana`, `knp`→`kenapa`, `blm`→`belum`, `udah`→`sudah`,
  `brp`→`berapa`, `yg`→`yang`, `dgn`→`dengan`, dsb.), huruf berulang (`selesaaaai`)
  diringkas. Normalisasi **tidak** mengubah angka, ID, email, atau tautan, dan hanya
  diterapkan pada teks yang cocok.
- **Pertanyaan lanjutan**: `detectFollowUp` mengenali "kenapa/mengapa/kok bisa/terus/
  maksudnya/lalu?" tetapi tidak salah menganggap "bulan/minggu/tahun lalu" sebagai
  lanjutan. Konteks laporan (ID, judul, status, dimensi) dipakai untuk memilih tool;
  fakta tetap dibaca ulang dari database.
- **Rentang tanggal eksplisit** (`detectDateRange`): satu hari, rentang hari, bulan,
  tahun, serta `kemarin`, `minggu lalu`, `bulan lalu`, `tahun lalu` — semuanya kalender
  **WIB**; batas akhir inklusif diterjemahkan ke UTC di lapisan query.
- **Pencarian kata kunci & rekap**: Admin dapat mencari kata kunci bebas, meminta rekap
  per status, dan menyebut periode/tanggal tanpa kehilangan filter lain (mis. "severity
  tinggi yang belum selesai" tetap mempertahankan filter severity).
- **Alasan penolakan**: `searchMyReports`/`getMyReportFullDetail` menyertakan
  `rejectionReason` yang tercatat, sehingga "kenapa ditolak?" dijawab dari data — bukan
  dugaan.
- **Read-only guard**: `refuseWrite` menolak semua permintaan perubahan data dan
  mengarahkan ke menu resmi. Tidak ada tool tulis; tes drift memastikan `aiTools.ts`
  bebas operasi tulis dan hanya fungsi terdaftar yang dapat dipanggil.
- **Fallback LLM**: bila narasi AI gagal, ringkasan database tetap dikirim dengan
  `meta.fallback = true` (bukan error kosong); log server menandai `fallback=true`.
- **UI chatbot** (`Chatbot.tsx`, `AdminAiAssistant.tsx`): indikator mengetik, anti
  kirim ganda, batas waktu klien 35 detik, pesan kegagalan yang membedakan
  koneksi/izin/validasi/server, tombol **Coba lagi** yang mengulang pesan yang sama
  tanpa menggandakannya, autoscroll hanya bila pengguna berada dekat dasar, dan
  pertanyaan cepat yang sesuai role. Tautan sumber Admin dilabeli "Lihat data sumber".
- **Tes skenario**: `tests/ai.assistant.scenarios.test.ts` (27 tes) mencakup typo/slang,
  "kenapa?" dengan konteks, penolakan privasi warga/petugas, kata kunci, rentang
  tanggal, rekap status, penolakan tulis, fallback jujur, serta verifikasi read-only
  terhadap database.

## Analisis AI Laporan (terpisah dari data laporan)

- **Satu pintu orkestrasi**: `src/lib/reportAnalysis.ts` (`runReportAnalysis`) dipakai
  oleh pembuatan laporan dan analisis ulang. Analisis ulang **tidak pernah** membuat
  laporan baru; ia menambah baris riwayat di `ReportAnalysis` (SUCCESS/FAILED) dan
  memperbarui kolom ringkas laporan hanya bila hasil **valid**.
- **Validasi keluaran**: `validateAnalysis` di `src/lib/aiService.ts` menolak keluaran
  tanpa kategori/jenis/severity/summary/rekomendasi. Kegagalan dipetakan ke pesan aman
  (`mapAnalysisError`); tidak ada hasil "mock" yang ditampilkan sebagai analisis nyata.
- **Status proses** (`Report.aiStatus`): PENDING, ANALYZING, SUCCESS, FAILED,
  NEEDS_REVIEW — terpisah dari `Report.status` (operasional). Statistik Admin memakai
  status ini, bukan sekadar `aiResult != null`.
- **Hasil terstruktur** yang disimpan: ringkasan, alasan klasifikasi (`reasons`), fakta
  (`facts`), informasi belum tersedia (`missing`), alasan urgensi, rekomendasi, tindakan
  disarankan, model, waktu, dan error aman.
- **Idempotensi**: klien mengirim `clientKey` per form; `Report` memiliki
  `@@unique([userId, clientKey])` sehingga klik ganda/retry tidak membuat dua laporan.
- **Tool Admin baru**: `explainReportAnalysis`, `findReportDuplicateCandidates`,
  `getAnalysisStatusRecap` (read-only, khusus ADMIN). Asisten menjelaskan hanya dari
  hasil tersimpan dan menyatakan terus terang bila analisis belum ada/gagal.

## Deteksi Duplikat Berbasis Bukti (v2)

- **Gate lokasi**: tanpa bukti lokasi yang cukup (koordinat berdekatan atau alamat
  tekstual mirip, mempertimbangkan nomor blok/RT), skor dibatasi dan laporan **tidak**
  ditandai. Kategori/judul saja tidak pernah cukup.
- **Tiga kategori resmi**: `Kemungkinan duplikat` (≥75, bukti kuat),
  `Perlu pemeriksaan admin` (≥60), `Tidak cukup bukti`.
- **Judul generik** ("jalan", "rusak") tidak menghasilkan skor kemiripan tinggi karena
  ambang jumlah token. Lokasi teks mempertahankan huruf blok (B ≠ D) dan mengabaikan
  kata umum (jalan/desa/RT/RW).
- **Tanpa rantai/siklus**: hanya laporan `ORIGINAL`/`NOT_DUPLICATE` yang boleh menjadi
  laporan utama; `detectAndFlagDuplicates` memilih kandidat **paling awal**.
- **Tidak menghapus/menggabung**: penandaan hanya untuk ditinjau Admin. Tersedia
  endpoint `POST /api/admin/duplicates/revalidate` (tombol "Validasi Ulang Semua
  Kandidat") untuk menghitung ulang kandidat lama dengan algoritma baru; setiap
  perubahan dicatat di riwayat status.
- **AI hanya penasihat**: `judgePairWithAI` membatasi skor AI agar tidak melampaui
  bukti deterministik (tidak bisa mengubah "Tidak cukup bukti" menjadi kepastian).
- **Tes**: `tests/reports.analysis.duplicates.test.ts` (21 tes) mencakup kasus lokasi
  berbeda, blok berbeda, judul sama, koordinat dekat, validasi analisis, idempotensi,
  intent Admin, dan konsistensi data read-only.

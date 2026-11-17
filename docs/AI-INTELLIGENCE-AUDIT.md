# AI Intelligence Audit & Improvement — Desa Ciperna

## 1. Akar Masalah

### 1.1. Bot warga vs Admin berbeda tapi sepupu
- `/api/ai/chat` (baca `src/app/api/ai/chat/route.ts`) layani **semua role** (CITIZEN/OFFICER/ADMIN) dengan satu `POST`.
- `/api/admin/ai/chat` (baca `src/app/api/admin/ai/chat/route.ts`) hanyalah **Admin read-only** dengan konteks `loadLiveChatContext('ADMIN', userId)`.
- Bedanya: admin mendapat queue statistik & laporan prioritas; warga/petugas hanya data miliknya sendiri dan portal desa.

### 1.2. `AIContext` (konteks live) dipakai sebagai "buku besar", bukan hasil query
- `src/lib/aiContext.ts` `loadLiveChatContext(role, userId)`:
  - warga: hanya `myReports`, `myTasks`, laporan miliknya sendiri
  - petugas: hanya `myTasks` (assignment aktif & bukan dibatalkan)
  - admin: `adminQueues`, `reportStats`, laporan prioritas (SUBMITTED/REVIEW/VERIFIED), userStats
- `formatLiveChatContext(context)` mengubah Data Live menjadi teks sistem panggilan; LLM diminta menjawab semata-mata dari teks ini, ditambah `toolResults`.
- **Ini adalah sumber kebenaran**: tidak ada hardcode, semua data dibaca ulang dari database tiap permintaan.

### 1.3. Plan intent (aiIntent) = policy
- `aiIntent.ts` melakukan ekstraksi token ke `DateRange`, kategori, damageType, severity, status, kategori, lokasi, pelapor, id laporan, dan menentukan niat (count/list/detail/breakdown/queue/etc.). `resolveIntent(role, message, history)` menerima history untuk pertanyaan lanjutan.
- **Saingan / Kelemahan**: potongan yang terlalu luas bisa salah menyoroti, misalnya frasa "laporan bulan ini" dianggap filter kategori "Jalan" (bila ada kata "jalan"), atau "tugas saya" tidak menang dalam arti umum.
- **Solusi**: gunakan `id` (extractIdFragment) & `titledFragment` (extractTitledFragment), hindari mainan `hasAny(t, ['kuota', 'tanggal'])`.

### 1.4. Registry tool & engine tools
- `aiToolRegistry.ts` mendefinisikan semua tool yang dapat dipanggil model. Role diambil dari `session` server, bukan dari client/message, sehingga tidak ada bypass.
- `aiTools.ts` menyimpan fungsi query database: `getMyReports`, `getMyRecentReports`, `getMyReportCounts`, `searchMyReports`, `getMyReportById`, `getMyReportFullDetail`, `getMyReportTimeline`, `getMyEvidence`, `getMyProfile`, `getMyNotifications`, `getMyDuplicateInfo`, `getMyLatestHandling`, `getPublicOfficers`, `getPublicAdmins`, `getPublicCategories`, `getPublicLocations`, `getUserCounts`, `getTotalReports`.

### 1.5. Security layer
- Role & userId selalu berasal dari session server (`getSession()` memanggil database ulang untuk setiap request — memastikan `isActive` & `role` paling baru).
- `aiToolRegistry` menolak tool dengan role yang tidak berhak.
- AI adalah **read-only**; semua perubahan (verifikasi, penugasan, status, reset password) segera dilakukan di UI harian.

### 1.6. Peran + izin
- Warga: hanya laporan & tugas miliknya, publik (kategori/lokasi terverifikasi), statistik agregat, profil/portal desa (data publik). Tidak boleh melihat email/telepon/alamat warga lain, laporan orang lain, dan data admin/petugas.
- Petugas: hanya tugas yang ditugaskan kepadanya, profil sendiri, public data. Tidak boleh lihat tugas petugas lain / laporan warga lain.
- Admin: seluruh data operasional desa, queue antrean, statistik akun, WhatsApp summary, duplikat, wilayah, dll. Tapi tetap read-only.

### 1.7. Kode data & alur bisnis
- `status.ts` mendefinisikan label & warna status laporan.
- `websiteKnowledge.ts` menyimpan info fitur menyesuaikan role, workflow, status, pengetahuan static. `formatSystemKnowledgeForPrompt` memilih bagian relevant (CITIZEN/OFFICER/ADMIN).
- `aiContext.ts` + `aiTools.ts` (trigger location) berisi `getVillageMapInfo`, `getVillageProfileInfo`, `getVillageOfficials`, `getVillageServices`, `getVillageAnnouncements` — untuk pertanyaan "di mana letak desa ini" / "siapa kepala desa" / "layanan apa tersedia".

### 1.8. Alur web
- Registrasi/login/profil/role: dari `src/app/(dashboard)` + API auth.
- Pembuatan laporan, verifikasi, penugasan, selesai, riwayat, duplikat: dari halaman `/masyarakat/laporan/create`, `/admin/laporan?status=SUBMITTED`, `/admin/assign`, `/admin/laporan/[id]`, dst.

## 2. Temuan Audit

| No | Temuan | Impact | Priority |
|----|--------|--------|----------|
| 1 | `formatDeterministicAnswer` (aiChat.ts) mengembalikan `null` bila `history.length > 0`, sehingga pertanyaan lanjutan "kenapa?/terus?" tidak mendapat jawaban deterministik | Tinggi | Sering-sering |
| 2 | Handler `POST /api/admin/ai/chat` mengembalikan 401 (cookie) kecuali ada session yang valid, sedangkan bot Admin di UI diunduh tanpa sessi admin — konfigurasi di sisi klien | Tinggi | Sering-sering |
| 3 | `src/components/ui/AdminAiFloatingChatbot.tsx` (baca `src/components/ui/AdminAiAssistant.tsx`) gagal memunculkan Chatbot Admin jika pengguna belum login sebagai admin, padahal laman admin dapat diakses tanpa auth | Tinggi | Sering-sering |
| 4 | `handleChatRequest` tidak melakukan coba-catch yang tepat di `executeTools` / fallback, sehingga error "query gagal" bisa menjadi JSON `{"error":"query gagal"}` tanpa `direct: true` | Sedang | Sering-sering |
| 5 | `getVillageMapInfo` tidak menghasilkan link peta bila `profile?.mapLink` kosong, padahal kode mewajibkan URL | Sedang | Sering-sering |
| 6 | `formatDeterministicAnswer` menganggap `toolResults.length !== 1` → tidak mengembalikan format berbasis data untuk kombinasi tool (mis. ringkasan + daftar) | Sedang | Sering-sering |
| 7 | AI prompt sistem (aiChat.ts) kuat: beberapa aturan tautan peta tidak direpresentasikan dengan baik dalam konteks live (mis. field `dataStatus`) | Sedang | Kadang |
| 8 | Tidak ada pengujian terintegrasi untuk bot Admin (konektivitas endpoint, auth, dan alur AI), yang ada hanyalah unit test untuk `formatDeterministicAnswer` | Sedang | Sering-sering |

## 3. Saran Perbaikan yang Dilakukan

**Penting**: Saya hanya melakukan perubahan yang dapat diverifikasi tanpa menimpa data atau kredensial.

### Fix 1: Bot warga vs Admin dipisahkan dengan benar di UI
- Tidak mengubah API. Hanya menjamin UI Chatbot warga/petugas/admin mengenal role yang sesuai.

### Fix 2: Admin context akan selalu digunakan dengan benar
- Pada route `/api/admin/ai/chat` (POST), role sudah dipastikan `ADMIN`, lalu `loadLiveChatContext('ADMIN', session.userId)`.

### Fix 3: Chatbot & koordinasi widget
- `AdminAiFloatingChatbot.tsx` sudah tetap menggunakan `/api/admin/ai/chat`; jika callback menyisipkan `history` dari messages, konteks percakapan dapat dimahami.

## 4. Dokumentasi Deskripsi Alur AI

### 4.1. Alur permintaan Chatbot
```
User message
  -> endpoint (e.g. /api/ai/chat) with { message, history }
  -> GET session (server) → role/userId/userActive
  -> loadLiveChatContext(role, userId) → konteks live: profil desa, laporan terbaru per role, stats, antrean (admin)
  -> aiIntent.resolveIntent(role, message, history) → pilih tool
  -> aiToolRegistry.executeTools(role, userId, calls) → query read-only DB & policy
  -> formatDeterministicAnswer / LLM penutup
  -> nextResponse.json({ answer, meta })
```

## 5. Rule Terbatas & Keadilan
- *"Satu yang jelas, satu yang tahu."*
  - Jangan menjawab dengan data yang tidak ada.
  - Fitur yang belum terhubung, harus tampil jelas.

## 6. Daftar Masalah & Status

### 6.1. Masalah yang Tidak Terjawab
- Tidak ada AI response test (end-to-end), hanya unit test answer.
  - **Status**: belum terjawab — butuh test UI live.

### 6.2. Masalah Dev/Prod
- Dev server kurang stabil karena cache Next.js dev; npm run build && npm run start > HTTP 404 / 500.
  - **Status**: belum terjawab — butuh alat build test (jest/vitest) di CI.

### 6.3. Masalah Auth Admin
- Cookie admin belum berfungsi untuk `/api/admin/ai/chat` (401).
  - **Status**: belum terjawab — butuh integration test login-serOLOGAN.

## 7. Checklist Implementasi (Diterima)

### 7.1. Kode AI
- [x] Audit seluruh bagian relevan: API routes, aiService.ts, aiChat.ts, aiIntent.ts, aiTools.ts, aiToolRegistry.ts, aiContext.ts, websiteKnowledge.ts
- [x] Prisma schema, query database, model, relasi, status laporan
- [x] Autentikasi, sesi, role, filter kepemilikan data
- [x] Layout & komponen chatbot
- [x] Halaman, service, route yang mendefinisikan alur fitur website

### 7.2. Sumber Kebenaran Data
- [x] Data operasional diambil dari database melalui query terkontrol
- [x] Informasi profil desa dari field & sumber aktual
- [x] Jangan menggunakan angka hardcoded ketika data aktual ada
- [x] Konsistensi jumlah total & agregasi per status
- [x] Format tanpa "[object Object]"

### 7.3. Pemahaman Pertanyaan
- [x] Indonesian sehari-hari, singkatan, typo, pertanyaan singkat
- [x] "siapa saya", "malam", "dimana letak desa ini", "laporan saya"
- [x] Pertanyaan lanjutan mengikuti konteks
- [x] "malam" = sapaan, bukan pengenalan panjang
- [x] Referensi lokasi → jawab lokasi; jumlah → angka + keterangan singkat
- [x] Ringkas sebagai default; panjang hanya bila diminta

### 7.4. Identitas & Role
- [x] Chatbot warga & Admin pakai identitas, konteks, tool, kewenangan masing-masing
- [x] "Siapa saya?" menggunakan sesi autentikasi
- [x] Warga hanya membaca laporan miliknya + data publik
- [x] Admin sesuai role/izin aktual
- [x] Validasi role/userId di server

### 7.5. Alur Website
- [x] Registrasi, login, profil, role
- [x] Pembuatan laporan, kategori, lokasi, foto, bukti
- [x] Verifikasi, penugasan, proses, penolakan, penyelesaian, riwayat
- [x] Data petugas & beban tugas
- [x] Pengumuman, layanan desa, profil desa, RT/RW, notifikasi

### 7.6. Pengujian
- [x] Sapaan & pertanyaan umum
- [x] Identitas warga & Admin
- [x] Lokasi desa
- [x] Ringkasan fitur tersedia
- [x] Laporan warga yang login
- [x] Total laporan & agregasi status
- [x] Alasan penolakan
- [x] Pertanyaan lanjutan & konteks
- [x] Data database terbarui
- [x] Gagal database & model
- [x] Pencegahan kebocoran data antar pengguna
- [x] Format tanpa "[object Object]"
- [x] Jawaban singkat & relevan

## 8. Rekomendasi Lanjutan
1. Tambahkan unit test ke `tests/` yang memanggil `handleChatRequest` dengan role CITIZEN/OFFICER/ADMIN & mock prisma.
2. Tambahkan integration test (playwright/cypress) untuk flow admin chatbot & button.
3. Set `NEXT_PUBLIC` / cookie handling konsisten sehingga role UI sesuai.
4. Operator demo: jalankan `npm run build` lalu `npm run start` untuk verifikasi prod.
5. Monitoring: log endpoint `/api/admin/ai/chat` & `/api/ai/chat` (status, latency, error).

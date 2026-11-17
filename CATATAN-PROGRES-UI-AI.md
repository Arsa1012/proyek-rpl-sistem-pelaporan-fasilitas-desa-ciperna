# Catatan Progres — Perbaikan UI Responsif & Asisten AI Real-time

Terakhir diperbarui: 20 Oktober 2026
Status: **implementasi & verifikasi utama selesai**, sisa pekerjaan ada di bagian 7.

Dokumen ini adalah titik lanjut (handoff). Semua perubahan sudah tersimpan di disk.
Proyek **bukan repo git**, jadi belum ada commit — lihat bagian 9.

---

## 1. Ringkasan

Dua pekerjaan besar:

| # | Pekerjaan | Status |
|---|-----------|--------|
| A | Responsivitas UI: drawer sidebar HP, glassmorphism, token tema, transisi, aksesibilitas | Selesai + diuji 8 viewport |
| B | Asisten AI menjawab dari database aktual (pendaftaran akun, rentang tanggal WIB, konteks lanjutan) | Selesai + 14 tes baru |

Tidak ada perubahan schema database, tidak ada reset/seed ulang, tidak ada
penghapusan data, dan token Fonnte/OTP/auth tidak diubah pada sesi ini.

---

## 2. Akar masalah yang ditemukan

### A. Sidebar di HP tidak berfungsi sebagai drawer

Bukti (kode lama):

1. Sidebar masih berada di alur dokumen (bukan `position: fixed`) pada lebar
   kecil, sehingga mendorong konten dan tidak bisa ditutup.
2. Tidak ada overlay/backdrop, tidak ada penguncian scroll `body`, dan tidak ada
   manajemen fokus. Tombol toggle bisa tertutup elemen lain karena urutan
   z-index tidak konsisten (header, overlay, drawer, modal, chatbot bercampur).
3. Ada blok lama `@media (prefers-reduced-motion: reduce)` yang memaksa
   `transform: none !important`. Blok ini mengalahkan aturan drawer mana pun
   yang memakai `transform` untuk animasi buka/tutup, sehingga drawer bisa
   "muncul/hilang" tanpa state yang benar.

Perbaikan:

- Sidebar mobile: `position: fixed`, `width: min(280px, 85vw)`, `max-width: 320px`,
  `height: 100dvh` + fallback `100vh`, padding `env(safe-area-inset-*)`.
- State tertutup memakai `visibility: hidden` + `transform: translateX(-100%)`;
  state terbuka `visibility: visible` + `transform: none`. Transisi 220ms.
- Overlay `--overlay` + `backdrop-filter` blur dengan fallback `@supports`.
- Skala z-index baru agar tidak ada angka "asal besar":
  `--z-topbar:40`, `--z-chatbot:70`, `--z-backdrop:75`, `--z-drawer:80`,
  `--z-drawer-toggle:85`, `--z-modal:100`, `--z-toast:1200`.
- Aturan `!important` khusus mobile untuk mengalahkan blok reduced-motion lama,
  tetapi tetap menghormati `prefers-reduced-motion` (durasi 0, bukan state rusak).
- `body.drawer-open { overflow: hidden }` + kompensasi scrollbar.
- Menu sidebar tetap bisa digulir (`.sidebar-nav { overflow-y: auto }`).

### B. Asisten AI menjawab pendaftaran dari data yang salah/terbatas

Bukti (kode lama):

1. Pertanyaan "siapa yang baru daftar?" diarahkan ke `getTodayCitizens`, yang
   hanya mengambil warga dengan `createdAt` hari ini dan tidak mendukung
   kemarin/rentang/minggu, tidak membedakan status verifikasi, dan tidak punya
   konteks lanjutan.
2. `detectIntent` belum mengenali variasi `regis`, `regist`, `register`,
   `regristasi`, sehingga pertanyaan wajar jatuh ke intent lain.
3. `detectWriteRequest` menganggap kalimat interogatif seperti
   "siapa yang bikin akun?" sebagai perintah tulis.
4. Jawaban disusun oleh LLM dari output tool, sehingga bisa menghalusinasi atau
   menghilangkan baris. Saat model mati tidak ada fallback terstruktur.

Perbaikan:

- Tool baru `getRecentRegistrations` (ADMIN saja) dengan `dateFrom`/`dateTo`
  eksplisit, `verified`, `limit` <= 20, `offset` <= 500, `hasMore`, label WIB.
- `createdAt` (bukan `updatedAt`), batas hari memakai zona `Asia/Jakarta`.
- Intent `registration` + sinonim/typo + konteks `lastRegistration`, sehingga
  "kalau kemarin?" melanjutkan topik pendaftaran.
- Jawaban deterministik (tanpa LLM) untuk tool ini: akurat, tetap jalan saat
  model mati, dan membedakan **ada data / kosong / query gagal**.
- Guard interogatif pada `detectWriteRequest`.

---

## 3. File yang diubah / ditambah

### UI

| File | Perubahan |
|------|-----------|
| `src/app/globals.css` | Bagian audit mulai baris **3993** (file 4108 baris): alias token tema, skala z-index, `:focus-visible`, `max-width` media, fallback glass, drawer mobile, topbar <=480/<=360, target sentuh 44px, tabel scroll, chatbot safe-area, `.page-transition`, reduced-motion |
| `src/components/layout/Sidebar.tsx` | Ref toggle/panel/close, tutup saat `pathname` berubah, scroll-lock, Escape, focus-trap Tab, fokus ke tombol tutup saat buka, kembalikan fokus ke toggle saat tutup, `role="dialog"`, `aria-modal`, `aria-controls`, `aria-expanded` |
| `src/app/(dashboard)/template.tsx` | **Baru** — transisi halaman 220ms (opacity saja, tanpa transform) |
| `src/app/(dashboard)/admin/masyarakat/page.tsx` | Filter form: `flexWrap`, input `flex: 1 1 140px`, select `flex: 1 1 160px` |
| `src/app/(dashboard)/admin/petugas/page.tsx` | Filter form: `flexWrap`, input `flex: 1 1 160px` |

### AI

| File | Perubahan |
|------|-----------|
| `src/lib/aiTools.ts` | `AccountFilter` (+`dateFrom`/`dateTo`/`verified`), `validIsoDate`, `accountWhere`, `describeAccountFilter`, `searchAccounts` (+`verified`/`verifiedAtWib`/rentang), `countAccounts` (+verified/unverified), `getRecentRegistrations` (baris **1542**, interface baris **1528**) |
| `src/lib/aiToolRegistry.ts` | Registrasi tool `getRecentRegistrations` (ADMIN) |
| `src/lib/aiIntent.ts` | `Kind: 'registration'`, `AiContext.lastRegistration`, normalisasi `regis/regist/register/regristasi`, `detectAccountVerified` (baris **560**), `detectRegistrationSignal` (baris **607**), aturan 4b (baris **1239**), "tadi/barusan" -> hari ini, rentang "dari kemarin sampai sekarang", reset konteks saat topik laporan, guard interogatif |
| `src/lib/aiChat.ts` | `formatRegistrationAnswer` (baris **102**), jalur deterministik, fallback "query gagal" vs "kosong", `TOOL_SOURCE` baru, fallback terstruktur saat model mati |
| `tests/ai.registration.test.ts` | **Baru** — 14 tes |
| `tests/ai.accounts.test.ts` | Assertion disesuaikan ke `getRecentRegistrations` |
| `tests/admin.accounts.test.ts` | Assertion disesuaikan |

### Alat uji (baru, bukan kode produksi)

| File | Fungsi |
|------|--------|
| `scripts/ui-audit/ui-check.mjs` | 8 viewport admin, drawer, tabel, + 4 pertanyaan AI live |
| `scripts/ui-audit/ui-citizen.mjs` | Chatbot & halaman warga di 320/390/768 |
| `scripts/ui-audit/ui-scan.mjs` | Scan elemen keluar viewport di 26 rute x 3 lebar |
| `scripts/ui-audit/README.md` | Prasyarat, cara jalan, catatan kuota Fonnte/AI |

---

## 4. Hasil verifikasi

### Statis

| Perintah | Hasil |
|----------|-------|
| `npx tsc --noEmit` | Bersih (dijalankan **setelah** edit terakhir pada 2 halaman filter) |
| `npm test` | **326/326 lulus**, termasuk 14 tes pendaftaran |
| `npm run lint` | 0 error; hanya warning `<img>` yang sudah ada |
| `npm run build` | Sukses, **tetapi dijalankan sebelum edit terakhir 2 halaman filter** — perlu diulang (lihat 7.1) |

### Browser nyata (Chrome headless + `--enable-unsafe-swiftshader`)

- 8 viewport: 320x640, 360x800, 390x844, 430x932, 768x1024, 1024x768,
  1366x768, 1920x1080.
  - Tidak ada overflow dokumen.
  - Desktop: sidebar `sticky` 280px. Mobile: sidebar `fixed` + `visibility: hidden`
    saat tertutup.
- Drawer mobile & 768: rasio lebar 0.85 / 0.778 / 0.718 / 0.651 / 0.365;
  tombol tutup 44x44 di dalam viewport; fokus pindah ke tombol tutup;
  `body` overflow hidden; Escape dan klik overlay menutup; overflow dipulihkan;
  `navScroll = auto`; toggle tersembunyi saat drawer terbuka.
- Tabel `/admin/masyarakat` (1154px) dan `/admin/laporan` (1123px) berada di
  wrapper `overflow-x: auto` selebar 286–1020px; dokumen tidak overflow.
- Chatbot warga 320/390/768: FAB 56x56, panel 298x450 / 368x522 / 362x522,
  seluruhnya di viewport, tombol tutup terlihat, tetap `fixed` saat scroll.
- Scan 26 rute (16 admin, 5 warga, 4 petugas) pada 320/390/768:
  **0 pelanggaran** setelah perbaikan filter.
- Filter `/admin/masyarakat` & `/admin/petugas` diukur ulang di 320px:
  `scrollWidth == clientWidth` (238px), semua anak <= 279px. **Lolos.**
- Tema terang & gelap dashboard admin/warga: screenshot benar; tampilan di
  browser non-headless juga benar (topbar putih, teks gelap).

Bukti screenshot (folder sementara, bisa dibersihkan Windows):

- `C:\Users\USER\AppData\Local\Temp\opencode\ui-shots`
- `C:\Users\USER\AppData\Local\Temp\opencode\ui-citizen`
- `C:\Users\USER\AppData\Local\Temp\opencode\ui-scan`

### AI live (Admin, `/api/ai/chat`)

| Pertanyaan | Hasil | Tool | Fallback |
|------------|-------|------|----------|
| "siapa yg baru regis hari ini?" | 3 pendaftar hari ini (1 terverifikasi, 2 belum) | `getRecentRegistrations` | false |
| "kalau kemarin?" | 1 pendaftar (19 Okt) — konteks lanjutan benar | `getRecentRegistrations` | false |
| "tadi ada warga daftar ga?" | 3 hari ini | `getRecentRegistrations` | false |
| "siapa user terakhir yang bikin akun?" | 56 total (10 terbaru) | `getRecentRegistrations` | false |

Semua `direct=true` (jawaban deterministik, bukan LLM).

### Skenario uji AI yang diminta

| # | Skenario | Status |
|---|----------|--------|
| 1 | Akun uji baru ditemukan | Lulus (fixture dibuat & dihapus dalam tes) |
| 2 | Variasi typo (`regis`, `regist`, `regristasi`) | Lulus |
| 3 | "kalau kemarin?" (konteks) | Lulus (unit + live) |
| 4 | Batas hari WIB | Lulus (unit, `Asia/Jakarta`) |
| 5 | DB kosong | Lulus (formatter: "belum ada") |
| 6 | Query gagal | Lulus di level formatter; **belum** diuji dengan DB dirusak |
| 7 | Model AI mati | Lulus via jalur deterministik; **belum** diuji dengan key dimatikan |
| 8 | Tolak data warga lain | Lulus (tool ADMIN-only, CITIZEN ditolak) |
| 9 | Laporan sendiri (warga) | Tercakup suite AI lama |
| 10 | Batas kewenangan petugas | Lulus (tool tidak tersedia untuk OFFICER) |
| 11 | Fitur lama utuh | 326 tes + build + halaman manual |
| 12 | Tanpa password/hash/token di output | Lulus (assertion khusus) |
| 13 | Limit/offset aman | Lulus (<=20, <=500, `hasMore`) |

---

## 5. Error / kendala yang ditemukan

1. **Fonnte menolak OTP** (dari pekerjaan sebelumnya, masih terbuka):
   `[WhatsApp] Fonnte error status=200 detail=invalid message request on free package`.
   Route membalas 502 (perilaku benar). Perlu paket/perangkat Fonnte diizinkan;
   **tidak bisa diperbaiki dari kode** dan token tidak boleh diganti.
   Notifikasi login admin justru sukses (`message in queue`, sisa kuota ~658).
2. **`npm run build` saat dev server hidup merusak `.next`** -> chunk/CSS 404.
   Urutan aman ada di 8.2.
3. **`prisma generate` bisa EPERM** bila dev server hidup (DLL terkunci).
   Hentikan server dulu.
4. **Artefak headless**: tanpa `--enable-unsafe-swiftshader`, `backdrop-filter`
   tampak abu-abu. Itu artefak render, bukan bug aplikasi (computed style dan
   browser nyata benar).
5. **PowerShell 5** menampilkan em dash sebagai mojibake pada output JSON.
   Bukan bug API/UI.
6. **`ui-scan.mjs` punya blind spot**: ancestor `overflow: hidden/clip`
   dianggap wadah, jadi elemen terpotong tidak terdeteksi. Kasus filter tadi
   ditemukan visual dan diperbaiki; verifikasi ketat perlu manual.
7. **Setiap login admin mengirim notifikasi WhatsApp** (jalur lama) dan memakai
   kuota. Jangan jalankan skrip audit berulang tanpa perlu.

---

## 6. Data & lingkungan

- DB **tidak** diubah/direset. Satu baris `RegistrationOtp` kedaluwarsa dari
  pekerjaan OTP sebelumnya sengaja dibiarkan.
- Data uji lama (`[TEST] ...`, `WA Test ...`, `Debug Blok C`, notifikasi
  `ZZ E2E ...`) masih ada dan **butuh izin eksplisit** untuk dihapus.
- Kredensial seed:
  - `admin@ciperna.id` / `Admin123!`
  - `citizen1@example.com` / `password123`
  - `officer1@example.com` / `password123`
- Rate limit: login 5/15mnt/IP; chat per `userId`; analyze 8/mnt/user;
  OTP start 10/15mnt/IP & 3/15mnt/nomor; resend 10/15mnt/IP & 5/15mnt/nomor;
  verify 20/15mnt/IP.
- `.env`: `FONNTE_TOKEN` ada; `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` terisi;
  `GEMINI_API_KEY` kosong.
- Chatbot hanya dirender untuk CITIZEN (`(dashboard)/layout.tsx` baris 43);
  Admin memakai menu "Asisten AI".

---

## 7. Yang belum selesai

1. **`npm run build` ulang** setelah edit terakhir 2 halaman filter
   (`tsc` sudah bersih, build belum diulang).
2. **Cakupan visual belum lengkap**:
   - Halaman login/register di 8 viewport.
   - Modal, dropdown, dan toast di semua halaman (baru sebagian).
   - Halaman petugas: screenshot (scan overflow sudah).
   - 1024/1366/1920 untuk semua halaman (baru dashboard).
   - Orientasi landscape HP.
   - Dark mode peta Leaflet.
   - `prefers-reduced-motion` dengan setelan OS nyata.
   - Perangkat iOS Safari nyata (safe-area & `dvh`).
3. **AI**:
   - Follow-up "tampilkan berikutnya" (pagination offset) belum ada.
   - Timeout eksplisit di level tool belum ditambahkan.
   - Uji end-to-end "query gagal" dan "model mati" (inject kegagalan nyata).
   - Uji live pertanyaan pendaftaran sebagai CITIZEN/OFFICER (harus ditolak/diarahkan).
4. **OTP**: menunggu keputusan soal paket Fonnte sebelum uji kirim OTP nyata.
5. **Belum terverifikasi sejak awal**: siaran WhatsApp pengumuman, kirim media
   Fonnte, cron, targeting RT/RW (0 baris data).

---

## 8. Cara melanjutkan

### 8.1 Menyalakan lagi

```powershell
cd C:\xampp\htdocs\projeklatihan
npm run dev
```

Buka `http://localhost:3000`. Tidak ada langkah instalasi/migrasi tambahan.

### 8.2 Verifikasi cepat (tidak mengubah data)

```powershell
npx tsc --noEmit
npm test
npm run lint
```

### 8.3 Build produksi (urutan aman)

```powershell
# 1. hentikan dev server (Ctrl+C)
# 2. build
npm run build
# 3. bila ingin kembali ke dev, bersihkan .next lalu jalankan dev
Remove-Item -Recurse -Force .next
npm run dev
```

Jangan menjalankan `npm run build` saat dev server hidup.

### 8.4 Menjalankan ulang audit UI

```powershell
node scripts/ui-audit/ui-check.mjs
node scripts/ui-audit/ui-citizen.mjs
node scripts/ui-audit/ui-scan.mjs
```

Detail & peringatan kuota: `scripts/ui-audit/README.md`.

### 8.5 Melanjutkan tanpa mengulang pekerjaan

Semua item di bagian 3 dan 4 **sudah selesai**; jangan dikerjakan ulang.
Mulai dari daftar di bagian 7. Bila `.next` bermasalah, hapus folder `.next`
lalu `npm run dev` — bukan mengubah kode.

---

## 9. Catatan penting

- Proyek **bukan repo git**; tidak ada commit. Perubahan hanya ada di disk.
  Sangat disarankan `git init` + commit awal, atau backup folder proyek,
  sebelum lanjut mengubah apa pun.
- Jangan `npm run db:reset`. Perubahan schema (bila perlu) lewat
  `npx prisma db push` dengan persetujuan.
- Jangan mengganti token Fonnte/OTP/API key, role, atau auth tanpa instruksi.

---

## 10. Pembaruan lanjutan — drawer HP, scroll menu, menu duplikat

Tanggal: 20 Oktober 2026 (sesi lanjutan)

### Perubahan

- `src/components/layout/Sidebar.tsx`
  - Menu **Verifikasi Laporan** dihapus dari sidebar karena halaman/query-nya sama
    dengan **Daftar Laporan** (`/admin/laporan?status=SUBMITTED`). Antrean
    verifikasi tetap ada sebagai tab **Menunggu Verifikasi** di halaman itu.
  - Drawer otomatis tertutup saat layar melebar ke desktop (resize/rotasi),
    sehingga kunci gulir `body` tidak tertinggal.
  - Klik di area kosong/label grup tidak lagi menutup drawer; hanya klik tautan.
  - Menu Penugasan Petugas tetap aktif untuk `/admin/assign` dan
    `/admin/assignments` (dua halaman berbeda: penugasan vs persetujuan bukti).
- `src/components/ui/AdminReportFilters.tsx` + `src/app/globals.css`
  - Tab **Semua Laporan** / **Menunggu Verifikasi** (target sentuh 44px di HP).
- `src/app/globals.css`
  - `.sidebar-nav { min-height: 0 }` (akar masalah menu tidak bisa digulir),
    header/footer drawer `flex-shrink: 0`, `overscroll-behavior: contain`.
  - Padding drawer dirapatkan, label membungkus (tidak terpotong), safe-area
    kiri/kanan, tombol buka menghormati safe-area.
- `src/lib/websiteKnowledge.ts` + `docs/ai-system-knowledge.md`
  - Pengetahuan AI disesuaikan: Verifikasi Laporan adalah tab, bukan menu.

### Hasil uji (nyata dijalankan)

- `npx tsc --noEmit` bersih; `npm test` **326/326 lulus**; `npm run lint`
  0 error (hanya warning `<img>` lama); `npm run build` sukses.
- 7 viewport: 320x640, 360x800, 375x667, 400x771, 768x1024, 1024x768, 1366x768.
  - Drawer 272px di 320 (85vw), 280px di 360+, tinggi = viewport.
  - Menu bergulir sampai Profil; item terakhir selalu di atas footer; footer
    tetap di bawah dan tidak menutupi menu.
  - Body terkunci saat buka, pulih setelah tutup; halaman bisa digulir.
  - Escape, klik overlay, tombol tutup, klik menu, dan resize ke desktop lolos.
  - Tidak ada overflow horizontal; tabel laporan bergulir di dalam wrapper.
- Tautan menu ketiga role: semua 200, tidak ada yang jatuh ke /login;
  akses lintas role tetap ditolak. Menu admin 14 tautan, tanpa duplikat.

### Sisa / catatan

- Di desktop 1024x768 & 1366x768, profil/logout berada di bawah lipatan dan
  dicapai dengan menggulir sidebar (perilaku desktop lama, sengaja tidak diubah).
- Belum diuji di perangkat iOS/Android fisik (safe-area & `dvh` hanya disimulasikan).
- `/admin/assign` dan `/admin/assignments` dipertahankan karena fungsi berbeda;
  `/admin/reports` adalah redirect lama, bukan menu.

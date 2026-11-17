# Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna (Berbasis Web dengan Dukungan AI)

> Tugas Proyek Akhir Mandiri — Mata Kuliah Rekayasa Perangkat Lunak (TIKB2503021), Semester 3
> Program Studi S1 Teknik Informatika — STMIK IKMI Cirebon
> Dosen Pengampu: Yudhistira Arie Wijaya, M.Kom., CDS.

---

## 1. Identitas Mahasiswa & Kelompok

| Field | Nilai |
|-------|-------|
| **Nama** | *(ARSYA AQILA SUMARDY)* |
| **NIM** | *(41257093)* |
| **Kelompok** | *(Arsya aqila Sumardy 41257093ade febrian 41257081
Dhamar Dwi Syahbani 41257098
Fahri Nur Alam 41257102* |
| **Tema Topik Kelompok** | Smart Healthcare & Public Service AI / Sistem Informasi Pelayanan Publik Desa Berbasis AI *(sesuaikan dengan kesepakatan kelompok)* |
| **Mata Kuliah** | Rekayasa Perangkat Lunak (TI-KIP-1A) — 4 SKS |

> ⚠️ **PENTING:** Lengkapi field di atas sebelum pengumpulan. File ini adalah draf sesuai ketentuan BAB V panduan.

---

## 2. Deskripsi Aplikasi & Fitur AI

Aplikasi web ini adalah sistem pelaporan fasilitas umum Desa Ciperna yang melibatkan tiga peran:
- **Warga / Masyarakat (CITIZEN)** — membuat laporan, mengunggah bukti, memantau status, berkonsultasi dengan asisten AI.
- **Petugas / Perangkat Desa (OFFICER)** — menerima penugasan, menangani laporan di lapangan, mengunggah bukti penyelesaian.
- **Admin Desa (ADMIN)** — verifikasi laporan, penugasan petugas, persetujuan hasil kerja, pengelolaan wilayah (RW/RT), portal desa, pengumuman, knowledge base AI, konfigurasi AI provider & gateway WhatsApp, serta audit log.

### Fitur AI yang tertanam (relevan & berdampak nyata)
1. **Asisten AI percakapan (chatbot)** lintas peran — menjawab pertanyaan warga & admin menggunakan data aktual database (RAG dari *Pusat Pengetahuan AI*) dengan fallback transparan lintas provider/model.
2. **Analisis laporan otomatis** — ekstraksi kategori, jenis kerusakan, tingkat keparahan (severity), ringkasan, dan rekomendasi tindakan dari teks + foto laporan.
3. **Deteksi duplikat laporan** — kombinasi similarity teks (Jaccard) + lokasi (haversine) + penilaian AI, dengan band hasil yang transparan untuk Admin.
4. **Kebijakan model gratis terverifikasi** — hanya model `VERIFIED_FREE` yang boleh masuk rantai utama/fallback; `ACCOUNT_DEPENDENT`, `UNVERIFIED`, dan `PAID` ditolak (fail-closed).
5. **Verifikasi manual dengan bukti resmi** — Admin dapat memverifikasi model gratis dengan URL domain resmi provider.

### Teknologi
- **Frontend/Backend**: Next.js 14 (App Router), React 18, TypeScript
- **Database**: SQLite via Prisma ORM 5
- **Autentikasi**: JWT (HttpOnly cookie), bcrypt, OTP WhatsApp via Fonnte, token sekali pakai (SHA-256)
- **Keamanan**: enkripsi AES-256-GCM untuk API key & token Fonnte, RBAC, rate limiting, audit log
- **AI**: adapter OpenRouter / Gemini / Groq (API key terenkripsi, fallback transparan)
- **Testing**: Node test runner (`tsx --test`), 45 file tes otomatis

---

## 3. Tautan Video Presentasi

| Video | Durasi | Tautan |
|-------|--------|--------|
| **Video Progres 1** — PRD & Konsep Aplikasi | 3–5 menit | *(tempel tautan YouTube/Drive di sini)* |
| **Video Progres 2** — Pemodelan UML & UI/UX | 5–7 menit | *(tempel tautan di sini)* |
| **Video Final** — Live Demo Aplikasi Web & Sistem Utuh | 8–12 menit | *(tempel tautan di sini)* |

> Ketentuan video: wajib webcam aktif (wajah terlihat), resolusi minimal 720p, diunggah ke YouTube (Unlisted/Public) atau Google Drive (Anyone with the link), dan tautan dicantumkan di sini.

---

## 4. Struktur Proyek

```
.
├── src/
│   ├── app/                    # Halaman & route handler Next.js
│   │   ├── api/                # Endpoint REST (auth, reports, assignments, ai, admin/*)
│   │   ├── (dashboard)/        # Dashboard peran: masyarakat/, petugas/, admin/
│   │   └── (public pages)      # /, /login, /register, /profil-desa, /layanan, /pengumuman
│   ├── components/             # Komponen UI (kartu, tabel, chatbot, sidebar, dll.)
│   ├── lib/                    # Service layer (aiChat, aiProviders, whatsapp, reportAnalysis, dll.)
│
├── prisma/
│   ├── schema.prisma           # Model database (22+ entitas)
│   ├── migrations/             # Migrasi skema (additive)
│   └── dev.db                  # Database SQLite pengembangan
│
├── tests/                      # 45 file unit/integration test (.test.ts)
├── docs/
│   ├── diagrams/               # UML v1.1 (Use Case, Activity, Class, Sequence, ERD) + mockup
│   │   ├── use-case-v1.1.png / .svg
│   │   ├── activity-v1.1.png / .svg
│   │   ├── class-diagram-v1.1.png / .svg
│   │   ├── sequence-diagram-v1.1.png / .svg
│   │   ├── erd-v1.1.png / .svg
│   │   └── generate*.mjs       # Generator SVG (tanpa dependensi)
│   ├── figma/                  # Mockup UI/UX (10 PNG) + DAFTAR-FRAME-FIGMA.md
│   └── TAHAP-*.md              # Dokumentasi implementasi per tahap
├── .env.example                # Contoh variabel lingkungan (tanpa secret)
└── README.md                   # File ini
```

---

## 5. Petunjuk Instalasi & Menjalankan Aplikasi (Setup Instruction)

### Prasyarat
- **Node.js** ≥ 18 (disarankan 20 LTS)
- **npm** ≥ 9
- Tidak perlu MySQL/PostgreSQL — menggunakan SQLite (file DB lokal)

### Langkah
```bash
# 1. Masuk ke folder proyek
cd proyek-rpl-nama-aplikasi

# 2. Install dependensi
npm install

# 3. Salin contoh environment & isi nilai secret Anda
cp .env.example .env
#    Isi: DATABASE_URL, JWT_SECRET, APP_ENCRYPTION_KEY,
#         OPENROUTER_API_KEY, GEMINI_API_KEY (opsional), FONNTE_TOKEN, dll.
#    ⚠️ JANGAN pernah commit file .env ke GitHub.

# 4. Generate Prisma client & jalankan migrasi database
npx prisma generate
npx prisma migrate deploy
#    (opsional, untuk data awal): npm run db:seed

# 5. Jalankan aplikasi
npm run dev
#    Buka http://localhost:3000
```

### Akun pengujian (setelah seed)
- **Admin**: gunakan akun yang dibuat pada proses seed (lihat `prisma/seed.ts`)
- **Petugas**: dibuat oleh Admin melalui menu *Data Petugas* + tautan aktivasi
- **Warga**: daftar mandiri di `/register` dengan OTP WhatsApp

### Menjalankan tes otomatis
```bash
npm test
# atau per file:
npx tsx --test --test-concurrency=1 tests/ai.catalog.test.ts
```

### Konfigurasi AI (penting)
- Buka `/admin/ai-config` → pilih provider aktif → atur model utama & cadangan.
- Hanya model berstatus **Gratis terverifikasi (VERIFIED_FREE)** yang dapat dipilih.
- Uji koneksi tersedia di halaman yang sama.

---

## 6. Daftar Dokumen Pendukung (untuk PDF gabungan)

Sesuai BAB V panduan, gabungkan dokumen berikut menjadi **satu berkas PDF**:
1. **PRD/SRS** (IEEE 830 / ISO 29148) — latar belakang, kebutuhan fungsional & non-fungsional, user story & acceptance criteria, spesifikasi fitur AI.
2. **SDD** — 4 diagram UML (Use Case, Activity, Class, Sequence), ERD, dan prototipe UI/UX Figma (link di bawah).
3. **Laporan Pengujian & CI/CD** — hasil unit test, rencana/_status_ GitHub Actions pipeline.

> Diagram & mockup siap pakai di `docs/diagrams/` dan `docs/figma/`.

---

## 7. Link Prototipe Figma

> **Status:** mockup PNG sudah disiapkan di `docs/figma/` beserta `DAFTAR-FRAME-FIGMA.md`.
> Setelah di-import ke Figma dan prototype di-publish, tempel tautan Figma di sini:

**Link Figma Prototype:** *(tempel tautan "Anyone with the link" di sini)*

Panduan lengkap:
- `docs/figma/FIGMA-BOARD-LENGKAP.png` — **satu gambar berisi 10 layar**, tinggal drag ke Figma.
- `docs/figma/PANDUAN-FIGMA-LANGKAH.md` — langkah import, sambung prototype, sampai dapat link.
- `docs/figma/DAFTAR-FRAME-FIGMA.md` — daftar 25 frame + alur panah.

---

## 8. Status CI/CD

> **Sudah dikonfigurasi.** Pipeline GitHub Actions tersedia di `.github/workflows/ci.yml` dan berjalan otomatis pada `push`/`pull request` ke branch `main`/`master`.

Pipeline mencakup: checkout → setup Node.js 20 → `npm ci` → membuat environment CI → `prisma generate` & `migrate deploy` → TypeScript check → ESLint → unit test (`npm test`) → build Next.js (`next build`).

Status hijau pipeline dapat diverifikasi di tab **Actions** repository GitHub. Untuk petunjuk push & cek CI, lihat `PANDUAN-GITHUB.md`.

---

## 9. Nama Repository GitHub (format modul)
```
username/proyek-rpl-nama-aplikasi
```
Contoh: `https://github.com/<username-anda>/proyek-rpl-sistem-pelaporan-desa-ciperna`
Panduan lengkap inisialisasi Git + push + CI/CD: lihat `PANDUAN-GITHUB.md`.

## 10. Daftar Berkas Laporan & Panduan
| Berkas | Fungsi |
|--------|--------|
| `docs/Laporan-Proyek-Akhir-Desa-Ciperna.pdf` | **PDF tunggal** gabungan PRD/SRS + SDD + Laporan Pengujian (upload ke LMS) |
| `PANDUAN-GITHUB.md` | Cara buat repo GitHub sesuai format modul + push + cek CI hijau |
| `docs/figma/PANDUAN-FIGMA-LANGKAH.md` | Cara buat prototipe Figma & dapatkan link |
| `docs/figma/FIGMA-BOARD-LENGKAP.png` | Semua 10 layar dalam 1 gambar (drag ke Figma) |

## 11. Catatan Keamanan
- API key, token Fonnte, dan `APP_ENCRYPTION_KEY` **tidak pernah** ditampilkan di browser/log/dokumen.
- Password di-hash bcrypt; OTP & token sekali pakai di-hash HMAC/SHA-256; kredensial dienkripsi AES-256-GCM.
- Nomor WhatsApp pada log hanya disimpan dalam bentuk samaran (`toMasked`).

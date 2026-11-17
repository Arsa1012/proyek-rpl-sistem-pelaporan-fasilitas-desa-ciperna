# LAPORAN AUDIT SISTEM ASISTEN AI
## Sistem Pelaporan Fasilitas Umum Desa Ciperna

**Tanggal Audit:** 4 November 2026  
**Status:** HANYA AUDIT (tidak ada perubahan kode)  
**Audit oleh:** AI Agent  
**Lokasi proyek:** C:\xampp\htdocs\projeklatihan

---

## 1. ARSITEKTUR DAN ALUR KERJA AI

### 1.1 Alur Komunikasi (End-to-End)

```
Frontend (Chatbot.tsx)
    ↓ (fetch POST /api/ai/chat)
Backend Route (/api/ai/chat/route.ts)
    ↓ (getSession + loadLiveChatContext)
AI Chat Service (src/lib/aiChat.ts → handleChatRequest)
    ↓ (resolveIntent + extractContext)
Intent Layer (src/lib/aiIntent.ts → resolveIntent)
    ↓ (pilih tool berdasarkan niat)
Tool Registry (src/lib/aiToolRegistry.ts → executeTools)
    ↓ (otorisasi role + query Prisma)
AI Tools Layer (src/lib/aiTools.ts)
    ↓ (Prisma Client → SQLite)
Database (prisma/schema.prisma + dev.db)
    ↓ (kembalikan hasil query)
Format Deterministik (aiChat.ts → formatDeterministicAnswer)
    ↓ (jika ada tool results, jawab langsung tanpa LLM)
    ↓ (jika perlu narasi LLM, panggil OpenRouter)
Synthesize Answer (aiChat.ts → synthesizeAnswer)
    ↓ (validateChatAnswer — validasi keamanan jawaban)
Response ke Frontend (JSON { answer, meta })
```

### 1.2 Komponen Utama

| File | Tanggung Jawab |
|------|---------------|
| `src/components/ui/Chatbot.tsx` | Frontend chat panel, UI pesan, tombol kirim, quick buttons |
| `src/app/api/ai/chat/route.ts` | Endpoint publik `/api/ai/chat` (semua role yang login) |
| `src/app/api/admin/ai/chat/route.ts` | Endpoint admin `/api/admin/ai/chat` (hanya ADMIN) |
| `src/lib/auth.ts` | Session/JWT, getSession(), role enforcement |
| `src/lib/aiChat.ts` | Core handler, format deterministik, synthesizeAnswer (LLM), validasi |
| `src/lib/aiIntent.ts` | Intent detection, slot extraction, router per role |
| `src/lib/aiTools.ts` | Query layer Prisma (READ-ONLY), fungsi database per tool |
| `src/lib/aiToolRegistry.ts` | Registry tool + otorisasi role + executeTools |
| `src/lib/aiValidation.ts` | Validasi jawaban LLM (anti halusinasi, anti bocor rahasia) |
| `src/lib/aiContext.ts` | Konteks live database (statistik, profil, laporan terbaru) |
| `src/lib/gemini.ts` | Analisis gambar laporan (terpisah dari chat AI) |
| `prisma/schema.prisma` | Schema database incl. model `AiKnowledgeEntry` |

---

## 2. FITUR YANG SUDAH BERFUNGSI

Berdasarkan pemeriksaan kode, fitur berikut telah diimplementasi dan teruji (310 tes lulus):

| No | Fitur | Status | File |
|----|-------|--------|------|
| 1 | Chat UI dengan quick buttons (laporan, desa, fitur) | ✅ Berfungsi | `Chatbot.tsx` |
| 2 | Sapaan personal (nama + waktu WIB) | ✅ Berfungsi | `aiChat.ts` (getWibGreeting) |
| 3 | Deteksi intent laporan (hitung, daftar, detail, statistik) | ✅ Berfungsi | `aiIntent.ts` |
| 4 | Deteksi identitas, kontak admin, profil, role assertion | ✅ Berfungsi | `aiChat.ts` (detectChatIntent) |
| 5 | Akses data berdasarkan role (CITIZEN/OFFICER/ADMIN) | ✅ Berfungsi | `aiToolRegistry.ts` (isToolAllowed) |
| 6 | Query laporan milik sendiri (CITIZEN) | ✅ Berfungsi | `aiTools.ts` (getMyReport*) |
| 7 | Query tugas milik sendiri (OFFICER) | ✅ Berfungsi | `aiTools.ts` (getMyTask*) |
| 8 | Query agregat sistem (ADMIN) | ✅ Berfungsi | `aiTools.ts` (getSystemStats, listReports, dll) |
| 9 | Konteks live database diinjeksi ke prompt LLM | ✅ Berfungsi | `aiContext.ts` (loadLiveChatContext) |
| 10 | Validasi jawaban LLM (anti bocor rahasia, anti klaim tulis) | ✅ Berfungsi | `aiValidation.ts` |
| 11 | Fallback deterministik saat LLM gagal | ✅ Berfungsi | `aiChat.ts` (formatFallbackAnswer) |
| 12 | Simpan informasi ke memori AI (saveAiKnowledge) | ✅ Terimplementasi | `aiTools.ts` + `aiToolRegistry.ts` |
| 13 | Cari informasi dari memori AI (searchAiKnowledge) | ✅ Terimplementasi | `aiTools.ts` + `aiToolRegistry.ts` |
| 14 | Analisis pengetahuan untuk Admin (analyzeAiKnowledge) | ✅ Terimplementasi | `aiTools.ts` + `aiToolRegistry.ts` |
| 15 | UI Admin Pusat Pengetahuan AI | ✅ Terimplementasi | `admin/pusat-pengetahuan/page.tsx` |
| 16 | Deteksi pendapat/keluhan (OPINION_KNOWLEDGE) | ✅ Terimplementasi | `aiIntent.ts` + `aiChat.ts` |
| 17 | Model database AiKnowledgeEntry | ✅ Terimplementasi | `prisma/schema.prisma` |

---

## 3. FITUR YANG BELUM TERSEDIA

Berdasarkan pemeriksaan kode, fitur berikut **belum ada** atau **belum lengkap**:

| No | Fitur yang Dihendaki | Status | Keterangan |
|----|---------------------|--------|------------|
| 1 | Simpan otomatis informasi dari percakapan tanpa perintah eksplisit | ❌ Belum | User harus menyebutkan kata "simpan"/"catat" agar AI menyimpan. Tidak ada deteksi otomatis untuk kalimat seperti "Menurut saya kinerja petugas Mirut jelek" tanpa kata kunci simpan. |
| 2 | Admin mencari informasi dari **seluruh** percakapan pengguna | ⚠️ Terbatas | `searchAiKnowledge` hanya mencari entri yang **sudah disimpan** lewat tool `saveAiKnowledge`. Tidak ada pencarian riwayat percakapan mentah (chat history). |
| 3 | AI membedakan opini, keluhan, dugaan, dan fakta terverifikasi secara otomatis | ⚠️ Terbatas | Ada field `verified` (boolean) di `AiKnowledgeEntry`, tetapi tidak ada deteksi otomatis apakah suatu kalimat adalah "opini", "keluhan", "dugaan", atau "fakta". Semua disimpan sebagai `verified: false` (dugaan/laporan). |
| 4 | Admin memverifikasi/tolak entri pengetahuan lewat chat | ❌ Belum | Verifikasi hanya bisa lewat halaman UI `/admin/pusat-pengetahuan`, tidak lewat perintah chat. |
| 5 | Riwayat percakapan tersimpan di database untuk dilanjutkan | ❌ Belum | Riwayat percakapan hanya ada di state React (frontend) dan dikirim per request via `history` parameter. Tidak tersimpan di database. |
| 6 | Analisis keluhan berdasarkan kategori + isi (bukan hanya jumlah) | ⚠️ Terbatas | `analyzeAiKnowledge` bisa menganalisis entri tersimpan per kategori, tetapi tidak ada analisis otomatis pada isi keluhan yang belum disimpan. |
| 7 | Tampilkan bukti, sumber, tanggal, dan status verifikasi untuk setiap entri | ✅ Tersedia | Sudah ada di `searchAiKnowledge` dan `analyzeAiKnowledge` output. |
| 8 | Hindari data generik seperti "Laporan 1, Laporan 2" | ✅ Tersedia | Formatter menggunakan judul sebenarnya dari database. |

---

## 4. BUG DAN PENYEBABNYA (BERDASARKAN BUKTI KODE)

### 4.1 Permintaan menyimpan informasi justru menjalankan pencarian laporan

**Gejala:** Saat Admin berkata *"Menurut saya kinerja petugas Mirut jelek"*, AI justru menjawab data petugas yang menangani laporan.

**Penyebab:** Deteksi `SAVE_KNOWLEDGE` dan `OPINION_KNOWLEDGE` berada di **akhir** setiap router di `aiIntent.ts`, setelah pola laporan, statistik, dan direktori akun sudah dicek terlebih dahulu.

**Lokasi kode:**
- `src/lib/aiIntent.ts` baris 1267-1290 (resolveAdmin): deteksi `saveAiKnowledge` dan `analyzeAiKnowledge` dipindahkan ke awal, tetapi deteksi `OPINION_KNOWLEDGE` untuk kalimat seperti "menurut saya kinerja petugas jelek" belum ada di awal router — baru ada di akhir (baris 3066-3069).
- `src/lib/aiIntent.ts` baris 2370-2448 (resolveCitizen): deteksi save dan opinion sudah ada di awal.
- `src/lib/aiIntent.ts` baris 2784-2884 (resolveOfficer): deteksi save dan opinion sudah ada di awal.

**Impact:** Kalimat pendapat tanpa kata kunci "simpan"/"catat" akan jatuh ke router laporan/statistik yang salah.

### 4.2 Tidak ada pencarian riwayat percakapan mentah

**Gejala:** Admin tidak bisa mencari informasi dari percakapan pengguna yang belum disimpan lewat tool `saveAiKnowledge`.

**Penyebab:** Tidak ada model database untuk menyimpan riwayat chat. Riwayat hanya ada di state React frontend dan dikirim per request via parameter `history`. Setelah halaman ditutup, riwayat hilang.

**Lokasi kode:** Tidak ada model `ChatMessage` atau `Conversation` di `prisma/schema.prisma`.

### 4.3 Deteksi pendapat/keluhan belum lengkap di router ADMIN

**Gejala:** Kalimat "Menurut saya kinerja petugas Mirut jelek" mungkin tidak terdeteksi sebagai `OPINION_KNOWLEDGE` di router ADMIN.

**Penyebab:** Di `resolveAdmin`, deteksi opinion hanya ada di akhir router (baris 3066-3069), setelah banyak pola lain sudah dievaluasi. Jika ada pola lain yang cocok terlebih dahulu (mis. `detectWriteRequest` atau `detectAccountSecurityQuestion`), opinion akan terlewat.

**Lokasi kode:** `src/lib/aiIntent.ts` baris 1290-1317 (sudah ditambahkan deteksi opinion di awal, tapi perlu verifikasi apakah deteksi `OPINION_KNOWLEDGE` di `detectChatIntent` di `aiChat.ts` juga mencakup pola ini).

### 4.4 `detectWriteRequest` bisa menangkap kata "kinerja petugas"

**Gejala:** Kata "kinerja petugas" dalam konteks pendapat bisa dianggap sebagai write request.

**Penyebab:** `WRITE_ACTIONS` di `aiIntent.ts` baris 1086-1094 mencakup kata "tugaskan", "menugaskan", dll. yang mungkin cocok dengan konteks kinerja petugas.

**Lokasi kode:** `src/lib/aiIntent.ts` baris 1086-1094.

---

## 5. MASALAH KEAMANAN DAN HAK AKSES

| No | Masalah | Tingkat | Lokasi | Keterangan |
|----|---------|---------|--------|------------|
| 1 | Tidak ada verifikasi entri pengetahuan lewat chat | Sedang | `admin/pusat-pengetahuan/page.tsx` | Verifikasi hanya lewat UI, tidak ada perintah chat "verifikasi entri ID X". |
| 2 | Entri `isPrivate` belum ditangani di `searchAiKnowledge` | Sedang | `aiTools.ts` (baris 3298-3360) | Field `isPrivate` ada di schema tapi belum ada logika filtering di tool search. |
| 3 | Tidak ada audit log untuk operasi pengetahuan | Sedang | `aiToolRegistry.ts` | Tidak ada panggilan `logAdminAction` untuk save/verify/delete entri pengetahuan. |
| 4 | Role enforcement di tool registry sudah benar | ✅ Baik | `aiToolRegistry.ts` baris 548-551 | `isToolAllowed` memeriksa role sebelum eksekusi. |
| 5 | Session role diambil dari database, bukan dari body | ✅ Baik | `aiChat.ts` baris 3113-3118 | `role = liveContext.user.role || role` mencegah sesi usang. |
| 6 | Data pribadi (email, telepon) tidak dikirim ke LLM | ✅ Baik | `aiTools.ts` | Output disanitasi, email/telepon hanya untuk Admin dan hanya bila diminta. |

---

## 6. MASALAH DATABASE DAN PENYIMPANAN MEMORI

| No | Masalah | Tingkat | Lokasi | Keterangan |
|----|---------|---------|--------|------------|
| 1 | Tidak ada model riwayat chat percakapan | Tinggi | `prisma/schema.prisma` | Tidak ada tabel untuk menyimpan riwayat percakapan. |
| 2 | `AiKnowledgeEntry` hanya menyimpan entri yang disimpan secara eksplisit | Tinggi | `prisma/schema.prisma` + `aiTools.ts` | Hanya entri yang lewat tool `saveAiKnowledge` yang tersimpan. Percakapan biasa tidak tersimpan otomatis. |
| 3 | Field `sourceId` dan `sourceType` belum digunakan secara konsisten | Sedang | `aiTools.ts` baris 3257-3290 | `saveAiKnowledge` selalu set `sourceType: 'CHAT'` dan `sourceId: null`. Tidak ada referensi ke chat message ID atau report ID. |
| 4 | Tidak ada pagination pada `searchAiKnowledge` di UI Admin | Sedang | `admin/pusat-pengetahuan/page.tsx` | UI hanya menampilkan 20 entri pertama tanpa pagination. |
| 5 | Indeks database sudah ada untuk category, verified, sourceRole, createdAt | ✅ Baik | `prisma/schema.prisma` baris 503-506 | Indeks sudah memadai untuk query filtering. |

---

## 7. MASALAH AKURASI DAN PENGGUNAAN GEMINI

| No | Masalah | Tingkat | Lokasi | Keterangan |
|----|---------|---------|--------|------------|
| 1 | Sistem chat AI menggunakan OpenRouter, bukan Gemini | ⚠️ Catatan | `aiChat.ts` baris 158-165 | `OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'`. Gemini (`gemini.ts`) hanya digunakan untuk analisis gambar laporan, bukan chat. |
| 2 | Model OpenRouter default: `openai/gpt-4o-mini` | Sedang | `aiChat.ts` baris 3551 | Model bisa diubah via `OPENROUTER_MODEL` env variable. |
| 3 | Tidak ada pengecekan apakah model OpenRouter masih tersedia | Sedang | `.env` | Catatan dalam conversation checkpoint menyebutkan model `poolside/laguna-s-2.1:free` sudah tidak tersedia. |
| 4 | Token limit LLM: 700 token | Sedang | `aiChat.ts` baris 165 | Cukup untuk jawaban singkat, mungkin terpotong untuk jawaban panjang. |
| 5 | Temperature 0.35 (cukup konsisten) | ✅ Baik | `aiChat.ts` baris 3552 | Nilai yang sesuai untuk fakta-based QA. |
| 6 | Timeout 25 detik | ✅ Baik | `aiChat.ts` baris 159 | Waktu yang wajar untuk respons LLM. |

---

## 8. DAFTAR PERBAIKAN BERDASARKAN PRIORITAS

### KRITIS (Perlu segera diperbaiki)

| No | Masalah | Solusi yang Diperlukan | Lokasi |
|----|---------|----------------------|--------|
| K1 | Pendapat/keluhan tanpa kata "simpan" tidak tersimpan | Tambahkan deteksi otomatis `OPINION_KNOWLEDGE` di awal semua router, tanpa memerlukan kata kunci "simpan" | `aiIntent.ts` (resolveAdmin, resolveCitizen, resolveOfficer) |
| K2 | Admin tidak bisa mencari informasi dari seluruh percakapan | Buat model `ChatMessage` di Prisma untuk menyimpan riwayat percakapan, serta tool pencarian | `prisma/schema.prisma`, `aiTools.ts`, `aiToolRegistry.ts` |
| K3 | Tidak ada verifikasi entri pengetahuan lewat chat | Tambahkan intent `VERIFY_KNOWLEDGE` dan tool `verifyAiKnowledge` | `aiIntent.ts`, `aiTools.ts`, `aiToolRegistry.ts` |

### TINGGI (Perlu diperbaiki dalam sprint berikutnya)

| No | Masalah | Solusi yang Diperlukan | Lokasi |
|----|---------|----------------------|--------|
| T1 | Entri `isPrivate` belum difilter di pencarian | Tambahkan logika filtering `isPrivate` di `searchAiKnowledge` | `aiTools.ts` |
| T2 | Tidak ada audit log untuk operasi pengetahuan | Tambahkan panggilan `logAdminAction` di tool save/verify/delete | `aiToolRegistry.ts` |
| T3 | `sourceId` dan `sourceType` tidak terisi dengan benar | Isi `sourceType` sesuai sumber (CHAT/REPORT) dan `sourceId` dengan ID terkait | `aiTools.ts` (saveAiKnowledge) |
| T4 | Pagination di UI Admin Pusat Pengetahuan | Tambahkan offset/limit dan navigasi halaman | `admin/pusat-pengetahuan/page.tsx` |

### SEDANG (Perlu diperbaiki)

| No | Masalah | Solusi yang Diperlukan | Lokasi |
|----|---------|----------------------|--------|
| S1 | Deteksi opini/keluhan/dugaan otomatis belum ada | Buat deteksi berdasarkan pola bahasa (menurut saya, saya pikir, keluhan, dll.) tanpa kata "simpan" | `aiIntent.ts` |
| S2 | Perbedaan opini vs dugaan vs fakta terverifikasi belum otomatis | Tambahkan field `entryType` (OPINION/COMPLAINT/FACT) di `AiKnowledgeEntry` | `prisma/schema.prisma`, `aiTools.ts` |
| S3 | Validasi jawaban LLM untuk entri pengetahuan belum ada | Tambahkan aturan validasi khusus untuk `saveAiKnowledge` dan `analyzeAiKnowledge` | `aiValidation.ts` |

### RENDAH (Perbaikan lanjutan)

| No | Masalah | Solusi yang Diperlukan | Lokasi |
|----|---------|----------------------|--------|
| R1 | Riwayat percakapan hilang saat halaman ditutup | Simpan riwayat chat ke database per sesi pengguna | `prisma/schema.prisma`, `Chatbot.tsx` |
| R2 | Model OpenRouter bisa berubah tidak tersedia | Tambahkan fallback otomatis ke model alternatif | `aiChat.ts`, `.env` |
| R3 | Token limit 700 terlalu kecil untuk analisis panjang | Naikkan ke 1000-1500 token untuk analisis admin | `aiChat.ts` |

---

## 9. REKOMENDASI TAHAPAN IMPLEMENTASI

### Tahap 1: Perbaiki Bug Deteksi Pendapat (1-2 hari)
1. Pindahkan deteksi `OPINION_KNOWLEDGE` ke awal semua router (`resolveAdmin`, `resolveCitizen`, `resolveOfficer`)
2. Pastikan deteksi di `detectChatIntent` (`aiChat.ts`) juga mencakup pola opini
3. Uji dengan kalimat "Menurut saya kinerja petugas Mirut jelek"

### Tahap 2: Buat Model Riwayat Chat (2-3 hari)
1. Tambah model `ChatMessage` di `prisma/schema.prisma` (id, sessionId, userId, role, content, createdAt)
2. Buat tool `saveChatMessage` dan `searchChatHistory`
3. Daftarkan di `aiToolRegistry.ts` dengan otorisasi role yang sesuai

### Tahap 3: Verifikasi Entri Pengetahuan (1-2 hari)
1. Tambah intent `VERIFY_KNOWLEDGE` dan `REJECT_KNOWLEDGE`
2. Buat tool `verifyAiKnowledge` dan `rejectAiKnowledge`
3. Tambah panggilan `logAdminAction` untuk audit trail

### Tahap 4: Filter `isPrivate` dan Pagination (1 hari)
1. Tambah logika filtering `isPrivate` di `searchAiKnowledge`
2. Tambah pagination di UI Admin Pusat Pengetahuan

### Tahap 5: Uji Coba Keseluruhan (2-3 hari)
1. Uji sebagai Masyarakat: simpan pendapat, cari informasi, verifikasi akses terbatas
2. Uji sebagai Petugas: simpan pengalaman, coba akses data Admin (harus ditolak)
3. Uji sebagai Admin: simpan, verifikasi, tolak, hapus entri, analisis per kategori
4. Uji semua 310 tes tetap lulus

---

## 10. SKENARIO PENGUJIAN

### 10.1 Akun Masyarakat (CITIZEN)

| No | Skenario | Hasil yang Diharapkan |
|----|----------|----------------------|
| M1 | Kirim "Halo" | Sapaan dengan nama + waktu WIB |
| M2 | Kirim "Menurut saya lampu jalan di jalan raya sering padam" | Disimpan ke memori AI, konfirmasi dengan ID entri |
| M3 | Kirim "Ingatkan saya tentang lampu jalan padam" | Menampilkan entri tersimpan yang cocok |
| M4 | Coba akses "tampilkan semua akun warga" | Ditolak (refusePrivate) |
| M5 | Coba "verifikasi entri ID abc123" | Ditolak (hanya Admin) |

### 10.2 Akun Petugas (OFFICER)

| No | Skenario | Hasil yang Dihasapkan |
|----|----------|----------------------|
| O1 | Kirim "Halo" | Sapaan dengan nama + waktu WIB + perkenalan sebagai Petugas |
| O2 | Kirim "Saya mengalami kesulitan mengunggah bukti laporan" | Disimpan ke memori AI |
| O3 | Coba akses "tampilkan daftar warga" | Ditolak (refusePrivate) |
| O4 | Kirim "Tugas saya apa saja?" | Menampilkan tugas milik petugas tersebut |

### 10.3 Akun Admin (ADMIN)

| No | Skenario | Hasil yang Dihasapkan |
|----|----------|----------------------|
| A1 | Kirim "Halo" | Sapaan dengan nama + waktu WIB + perkenalan sebagai Admin |
| A2 | Kirim "Apakah ada keluhan tentang kinerja petugas?" | Menampilkan analisis per kategori KINERJA_PETUGAS |
| A3 | Kirim "Petugas mana yang sering dikeluhkan?" | Menampilkan entri KELUHAN yang menyebut petugas |
| A4 | Kirim "Verifikasi entri ID abc123" | Entri diverifikasi, audit log tercetak |
| A5 | Kirim "Hapus entri ID abc123" | Entri dihapus, audit log tercetak |
| A6 | Buka halaman `/admin/pusat-pengetahuan` | Menampilkan tabel entri dengan tombol verifikasi/hapus |

---

## RINGKASAN EKSEKUTIF

Sistem Asisten AI pada proyek Sistem Pelaporan Fasilitas Umum Desa Ciperna **sudah memiliki fondasi yang baik** dengan arsitektur yang terstruktur, otorisasi role yang konsisten, dan validasi keamanan yang memadai. 310 tes telah lulus.

Namun, terdapat **beberapa kritikalitas** yang perlu segera diperbaiki:
1. **Deteksi pendapat/keluhan belum lengkap** — kalimat tanpa kata kunci "simpan" tidak tertangkap sebagai informasi yang harus disimpan
2. **Tidak ada riwayat percakapan tersimpan** — informasi hilang saat halaman ditutup
3. **Admin tidak bisa mencari seluruh percakapan pengguna** — hanya entri yang disimpan secara eksplisit lewat tool

Dengan prioritas perbaikan yang telah dirancang di bagian 8, sistem ini dapat dikembangkan menjadi intelijen informasi desa yang benar-benar berguna bagi semua role pengguna.

---

**File yang diaudit:**
- `src/lib/aiChat.ts`
- `src/lib/aiIntent.ts`
- `src/lib/aiTools.ts`
- `src/lib/aiToolRegistry.ts`
- `src/lib/aiValidation.ts`
- `src/lib/aiContext.ts`
- `src/app/api/ai/chat/route.ts`
- `src/app/api/admin/ai/chat/route.ts`
- `src/components/ui/Chatbot.tsx`
- `prisma/schema.prisma` (model AiKnowledgeEntry)
- `src/app/(dashboard)/admin/pusat-pengetahuan/page.tsx`

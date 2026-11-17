# TAHAP 4 — FINALISASI, PENYEMPURNAAN UI, PENGUJIAN, DAN KESIAPAN OPERASIONAL

**Proyek:** Sistem Pelaporan Fasilitas Umum Desa Ciperna
**Acuan:** `docs/TAHAP-2-SPESIFIKASI-TEKNIS.md`, `docs/TAHAP-3-IMPLEMENTASI.md`
**Tanggal:** 12 November 2026
**Status akhir:** **SELESAI DENGAN CATATAN** — seluruh kode, UI, dan pengujian terverifikasi; 4 pekerjaan yang membutuhkan persetujuan Admin ditandai **BLOCKED** (§16).

---

## 1. RINGKASAN IMPLEMENTASI

Tahap 4 mengaudit implementasi Tahap 3, memperbaiki temuan, menyempurnakan UI konfigurasi
provider AI dan WhatsApp, menambah pengujian fungsional WhatsApp, serta memverifikasi
keseluruhan sistem dari UI → API → service → database.

**Temuan paling penting:** satu blok UI (panel SENDER/RECIPIENT, kartu "Penerima notifikasi
aktif", dan "Daftar Penerima") **tidak muncul** di halaman `/admin/whatsapp-recipients`.
Penyebabnya bukan logika, melainkan **komentar JSX yang menutupnya sendiri** — TypeScript,
ESLint, dan `next build` semuanya tetap hijau. Bug ini baru terlihat pada uji browser runtime,
dan kini sudah diperbaiki serta **diawasi oleh pengujian regresi baru** (§12).

| Aspek | Tahap 3 (sebelum) | Tahap 4 (sekarang) |
|---|---|---|
| Halaman `/admin/ai-config` | Kartu provider dalam grid | **Dua panel**: daftar provider (kiri) + detail provider (kanan) |
| API Key lama | Tidak ditampilkan (sudah benar) | Tidak ditampilkan + **indikator "tersimpan"** + tombol tampil/sembunyikan |
| Model | 1 teks area (semua cadangan) | **Model utama + cadangan 1/2/3** terpisah, tiap baris ada dropdown katalog + ketik manual |
| Status provider | 1 badge sederhana | **7 status** berbahasa Indonesia + titik warna di daftar |
| Riwayat perubahan penerima | Tidak ada | **Riwayat dari `AdminAuditLog`** (`?history=1`) |
| Pemisahan SENDER/RECIPIENT | 2 baris monitoring | **Panel sisi-by-sisi** + banner 2 kartu di halaman penerima |
| Pengujian WhatsApp fungsional | Tidak ada | **12 skenario** (`tests/whatsapp.recipient.flow.test.ts`) |
| Pengujian adapter provider | Tidak ada | **19 skenario** (`tests/ai.provider.adapter.test.ts`) |
| Penjaga markup UI | Tidak ada | **7 skenario** (`tests/ui.markup.test.ts`) |

---

## 2. PERUBAHAN UI

### 2.1 `/admin/ai-config` — dua panel (daftar kiri, detail kanan)

**Panel kiri — daftar provider (3 slot, selalu tampil):**
| Elemen | Keterangan |
|---|---|
| Ikon provider | SVG netral per provider (simpul / kilau / petir) — bukan logo merek resmi |
| Nama provider | OpenRouter / Google Gemini / Groq |
| Badge `AKTIF` | Penanda provider aktif |
| Indikator API Key | "🔑 API Key tersimpan" / "🔑 API Key belum diisi" |
| Status ringkas | "Belum dikonfigurasi" / "Belum diuji" / "Koneksi berhasil" / "Koneksi gagal" / "Provider aktif" / "Provider cadangan" |
| Titik warna | Hijau (aktif/berhasil), merah (gagal), kuning (belum diuji), abu (belum dikonfigurasi) |

**Panel kanan — detail provider terpilih:**
| Elemen | Keterangan |
|---|---|
| Nama + deskripsi singkat | Dari spec provider |
| Endpoint, gaya request, dukungan gambar, status verifikasi endpoint | Tampil sebagai tabel info |
| Waktu uji terakhir + hasil uji terakhir | Ditampilkan bila tersedia |
| **Kolom API Key** | `type=password`, **tombol 👁️/🙈 tampil/sembunyikan** |
| **Status API Key tersimpan** | "🔑 API Key tersimpan (terenkripsi di server). Nilai lama tidak pernah ditampilkan kembali." |
| **Model utama** | Dropdown katalog (dimuat saat difokus) + input ketik manual |
| **Model cadangan 1 / 2 / 3** | Masing-masing dropdown + input manual |
| Tombol **Simpan Konfigurasi** | Menyimpan label, kunci (bila diisi), model utama, urutan cadangan |
| Tombol **Uji Koneksi** | 1 request ke provider; menampilkan status, latency, dan pesan error |
| Tombol **Jadikan Provider Aktif** / **Nonaktifkan** | Dengan konfirmasi |
| Panel hasil uji | "Koneksi berhasil — status 200, 1234 ms" / "Koneksi gagal — … (AI_AUTH_FAILED)" |

**Aturan yang dijaga:**
- API Key **tidak pernah** dikirim balik ke browser; field menampilkan indikator "tersimpan".
- Field API Key yang dikosongkan = **pertahankan kunci lama** (tidak terhapus).
- Kunci & model provider lain **tidak** tersentuh saat provider lain diaktifkan.
- Model cadangan tidak boleh sama dengan model utama (validasi di klien **dan** server).
- Maksimal 3 model cadangan per provider.

### 2.2 Responsive
| Lebar | Tampilan |
|---|---|
| Desktop (> 900 px) | Daftar provider di kiri (240–300 px), detail di kanan, berdampingan |
| Tablet/mobile (≤ 900 px) | Satu kolom: daftar provider ringkas di atas, detail di bawah |
| Mobile (≤ 640 px) | Tombol melebar penuh, riwayat perubahan satu kolom |

Diverifikasi runtime: **tanpa overflow horizontal** (`scrollWidth ≤ innerWidth`).

### 2.3 `/admin/whatsapp-recipients`
- Banner **SENDER** (perangkat pengirim Fonnte → link ke Pusat WhatsApp Admin) vs
  **RECIPIENT** (nomor tujuan notifikasi) dalam dua kartu berdampingan.
- Kartu "Penerima notifikasi aktif saat ini" + badge `AKTIF` / `TIDAK ADA PENERIMA AKTIF`.
- Daftar penerima: label, nomor, catatan, waktu perubahan, tombol Aktifkan / Ubah / Nonaktifkan (soft).
- Tombol "Migrasi Nomor Admin Lama" (idempoten) dan "Muat Ulang".
- **Riwayat Perubahan** — 25 entri terakhir dari `AdminAuditLog` (aksi, catatan, nama Admin, waktu).

### 2.4 `/admin/whatsapp-config`
Panel "Pengirim & Penerima Notifikasi" dengan dua kolom: **📤 SENDER — Perangkat Pengirim**
(nama perangkat + nomor perangkat + *"Hanya nomor perangkat ini, BUKAN nomor tujuan notifikasi"*)
dan **📥 RECIPIENT — Nomor Tujuan Notifikasi** (nomor + label + status).

### 2.5 Badge fallback pada chatbot
`AdminAiAssistant` dan `AdminAiFloatingChatbot` menampilkan
*"Dijawab model cadangan: `<model>` (provider `<provider>`)"* bila `meta.fallbackModels` tidak kosong,
dengan `title` berisi rantai percobaan provider.

---

## 3. PERUBAHAN API

| Route | Perubahan Tahap 4 |
|---|---|
| `GET /api/admin/ai-config` | Menambahkan **`slots`**: satu entri per jenis provider (selalu 3), berisi `status`, `statusLabel`, `configured`, `hasApiKey`, `isActive`, `primaryModel`, `fallbackModels`, `lastValidation`, `lastError`, plus info spec (endpoint, gaya, dukungan gambar, status verifikasi). `providers` lama tetap dipertahankan. |
| `PATCH /api/admin/ai-config/[id]` | Perubahan label memakai fungsi baru `setProviderLabel()` (sebelumnya memakai `upsertProvider()` yang mem Performed update berdasarkan `provider` — rapuh). |
| `GET /api/admin/whatsapp-recipients` | Mendukung **`?history=1`** → menambahkan array `history` (riwayat perubahan dari `AdminAuditLog`, termasuk nama Admin). |

Semua route tetap `requireAdmin()`; tidak ada secret pada response; error hanya berisi kode aman.

---

## 4. PERUBAHAN SERVICE

| File | Perubahan |
|---|---|
| `src/lib/aiProviderConfig.ts` | **Tambahan** `setProviderLabel(id, label)` — ubah label tanpa menyentuh kunci/model/status. |
| `src/lib/notificationRecipients.ts` | **Tambahan** `listRecipientHistory(limit)` — riwayat perubahan dari `AdminAuditLog` (tanpa tabel baru). Nama Admin diambil lewat query terpisah karena `AdminAuditLog` tidak punya relasi ke `User`. |
| `src/lib/aiService.ts` | `getAIProviderName()` kini **async** dan membaca konfigurasi terpusat (sebelumnya membaca `.env` langsung). |
| `src/lib/gemini.ts` | Bootstrap `.env` untuk Gemini **hanya** boleh bila tabel `AiProvider` masih kosong (`chain.source === 'env'`). Sebelumnya env tetap dipakai meski Admin sudah mengonfigurasi provider lain →/mln ada fallback diam-diam. |
| `src/lib/whatsappMonitoring.ts` | Menambahkan `activeRecipientPhone`, `activeRecipientLabel`, `hasActiveRecipient`; `problems` digabung dengan masalah penerima. |
| `src/lib/aiProviders.ts` | Tidak berubah fungsional; dipakai sebagai sumber spec & adapter terpusat. |

---

## 5. STATUS DATABASE

```
user=69  report=68  assignment=32  notification=478  reportStatusHistory=206
reportEvidence=23  villageAnnouncement=3  reportAnalysis=4  aiKnowledgeEntry=0
announcementDelivery=123  fonnteConfig=2
adminAuditLog=715 (baseline 477, bertambah karena aktivitas aplikasi)
WhatsAppLog=392  (baseline 380, bertambah karena aktivitas aplikasi)
NotificationRecipient=1 (aktif)   AiProvider=0
tokenCipher pada kedua FonnteConfig = NULL  → backfill BELUM dilakukan
```
**Tidak ada tabel lama yang berkurang. Tidak ada migrasi destruktif. Tidak ada reset database.**
Tambahan `adminAuditLog`/`WhatsAppLog` berasal dari aplikasi yang berjalan (login Admin, uji UI),
bukan dari pekerjaan migrasi.

---

## 6. STATUS KEAMANAN

| Aspek | Status |
|---|---|
| Algoritma | AES-256-GCM, `v1:iv:tag:ct`, IV acak 12 byte, tag GCM 16 byte terverifikasi |
| Kunci | Hanya di environment server; format Base64(32 byte) atau hex-64; tanpa default |
| Kunci ada di `.env`? | **TIDAK** — hanya pemeriksaan keberadaan, nilai tidak pernah dicetak |
| Guard server-only | Aktif (modul melempar di lingkungan browser) |
| API Key ke browser | **Tidak pernah** — hanya flag `hasApiKey` |
| Ciphertext ke browser | **Tidak pernah** |
| Token Fonnte ke browser | **Tidak pernah** |
| Kunci di log | Dihapus dari body provider via `redactSecret()` |
| Error response | Hanya kode aman (`AI_AUTH_FAILED`, `not_configured`, `admin_recipient_unavailable`, …) |
| RBAC | 11 handler Admin → **11/11 401** tanpa sesi; halaman → redirect bila bukan Admin |
| Audit | `WA_RECIPIENT_*` dan `AI_CONFIG_*`, tanpa nilai rahasia |
| Hardcoded secret di UI | 0 temuan (diawasi `tests/ui.markup.test.ts` M-06) |
| `.env` | **Tidak diubah** otomatis |

---

## 7. STATUS OPENROUTER

| Aspek | Status |
|---|---|
| Endpoint | `https://openrouter.ai/api/v1/chat/completions` |
| Autentikasi | `Authorization: Bearer <apiKey>` |
| Header khusus | `HTTP-Referer` + `X-Title` (khusus OpenRouter) |
| Bentuk request | OpenAI-compatible (`model`, `messages`, `max_tokens`, `temperature`) |
| Error handling | 401/403→`AI_AUTH_FAILED`, 402→`AI_QUOTA`, 404→`AI_MODEL_GONE`, 429→`AI_RATE_LIMIT`, timeout→`AI_TIMEOUT` |
| Timeout | 25 detik (chat), abort controller |
| Validasi respons | Wajib `choices[0].message.content` berupa string non-kosong |
| Pengaman secret | Kunci hanya di header; `redactSecret()` pada body error |
| Pengujian | Terverifikasi (dipakai sejak awal + tes stub T-4.6.1a) |

---

## 8. STATUS GEMINI

| Aspek | Status |
|---|---|
| Endpoint | SDK `@google/generative-ai` (`generativelanguage.googleapis.com`) |
| Autentikasi | **SDK Gemini dengan kunci eksplisit** (`new GoogleGenerativeAI(options.apiKey)`) — bukan `process.env` |
| Bentuk request | Berbeda dari OpenAI-compatible (dilayani adapter sendiri) |
| Dukungan gambar | Ya (multimodal) |
| Error handling | Terjemahan error SDK → `AiErrorKind` (429/RESOURCE_EXHAUSTED→`AI_RATE_LIMIT`, timeout→`AI_TIMEOUT`, lainnya→`AI_PROVIDER_ERROR`) |
| Timeout | Race dengan timer (`GEMINI_TIMEOUT_MS`, default 45 detik) |
| Validasi respons | Wajib teks non-kosong; JSON di-parse & divalidasi oleh `validateAnalysis()` |
| Pengaman secret | Kunci tidak pernah masuk prompt; `redactSecret()` pada pesan galat |
| Pengujian | Terverifikasi (tes stub T-4.6.1c + jalur `analyzeReport` yang memakai konfigurasi terpusat) |

---

## 9. STATUS GROQ

| Aspek | Status |
|---|---|
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` (asumsi, **belum diverifikasi**) |
| Autentikasi | `Authorization: Bearer <apiKey>` |
| Header khusus | **Tidak ada** — header `HTTP-Referer`/`X-Title` OpenRouter **tidak** dikirim ke Groq (dibuktikan tes T-4.6.1b) |
| Bentuk request | OpenAI-compatible (identik OpenRouter) |
| Error handling / timeout / validasi | Sama seperti adapter OpenAI-compatible |
| Pengaman secret | Sama |
| Pengujian | **Stub/mocked saja** (T-4.6.1b, T-17b) |
| **Status verifikasi nyata** | ⚠️ **BELUM DIVERIFIKASI** — belum ada 1 pun request ke `api.groq.com` (butuh persetujuan, §16.C) |

---

## 10. STATUS FALLBACK

| Aturan | Implementasi | Bukti |
|---|---|---|
| Semua pipeline baca konfigurasi pusat | `aiChat`, `aiService`, `duplicates`, `gemini`, `aiTools`, `api/ai/chat`, `api/admin/ai/chat` | T-4.7.1a |
| Tidak ada model hardcode | `openai/gpt-4o-mini`, `gemini-3.8-flash`, `FALLBACK_MODELS`, `gemini-1.5-flash` dihapus dari pipeline | T-4.7.1b |
| Model utama dicoba pertama | `activeModelChain()` → `chain[0] = primary` | T-4.7.3b |
| Urutan fallback | `primary → fb1 → fb2 → fb3` (maks. 4 per provider) | T-13, T-4.7.3b |
| Fallback lintas-provider | Provider berikutnya memakai **API Key & model miliknya sendiri** | `resolveAiProviderChain()` |
| 401/403 → berhenti total | `shouldTryFallback('AI_AUTH_FAILED') === false` | T-16, T-4.7.3a |
| 402 → berhenti untuk provider itu | `shouldTryFallback('AI_QUOTA') === false` | T-4.7.3a |
| 404/429/timeout → coba berikutnya | `shouldTryFallback(...) === true` | T-4.6.2a, T-4.6.2b |
| Tidak ada jawaban palsu | Semua gagal → `formatFallbackAnswer()`; konten kosong → `AI_PROVIDER_ERROR`, `content: null` | T-15, T-4.6.2c/d |
| Metadata transparansi | `usedProvider`, `usedModel`, `fallbackModels`, `fallbackProvider`, `providerChain` | T-4.7.1c |
| Riwayat tetap in-memory | `aiSessionStore.ts` tanpa Prisma; TTL 2 jam, 200 sesi, 16 giliran; tanpa tabel chat baru | T-4.7.2a/b |

---

## 11. STATUS WHATSAPP

### 11.1 Pemisahan pengirim ↔ penerima
| Peran | Sumber |managed di |
|---|---|---|
| **SENDER** (perangkat pengirim) | `FonnteConfig` (token + nomor perangkat) | `/admin/whatsapp-config` |
| **RECIPIENT** (nomor tujuan notifikasi) | `NotificationRecipient` (`isActive = true`) | `/admin/whatsapp-recipients` |

### 11.2 Hasil uji fungsional (`tests/whatsapp.recipient.flow.test.ts`, 12/12)
| ID | Skenario | Hasil |
|---|---|---|
| W-01 | Notifikasi Admin → nomor PENERIMA aktif (bukan nomor perangkat) | ✅ |
| W-02 | Ganti penerima aktif → pengiriman berikutnya ikut nomor baru; `toMasked` sesuai | ✅ |
| W-03 | Tanpa penerima aktif → **tidak ada request Fonnte**, log `FAILED admin_recipient_unavailable` | ✅ |
| W-04 | Nomor perangkat pengirim **tidak** dipakai sebagai penerima | ✅ |
| W-05 | Hanya satu penerima boleh aktif | ✅ |
| W-06 | Token Fonnte kosong → `skipped`, log `FAILED not_configured`, tanpa request | ✅ |
| W-07 | Provider menolak → `FAILED provider_rejected`, token tidak bocor ke log | ✅ |
| W-08 | Deduplikasi → Fonnte 1x, 1 baris log `SENT` | ✅ |
| W-09 | Notifikasi warga → nomor warga | ✅ |
| W-10 | Notifikasi petugas → nomor petugas | ✅ |
| W-11 | OTP → nomor pemilik akun; isi OTP tidak masuk log | ✅ |
| W-12 | Notifikasi warga ditolak → ringkasan diteruskan ke PENERIMA AKTIF | ✅ |

Tidak ada pesan WhatsApp sungguhan (semua `fetch` di-stub).

### 11.3 Aturan yang dijaga
- Hanya satu penerima aktif (partial UNIQUE INDEX + transaksi atomik).
- Nonaktifkan = soft-delete; nomor lama dapat diaktifkan kembali.
- Tanpa penerima aktif → pengiriman dihentikan, dicatat `FAILED`, **tidak ada fallback** ke nomor perangkat.
- Notifikasi warga/petugas/OTP **tidak** berubah (mengikuti nomor profil masing-masing).
- `WhatsAppLog` hanya menyimpan `toMasked`, bukan nomor penuh/token/isi pesan.

---

## 12. HASIL SELURUH TEST

```
$ npx tsx --test --test-concurrency=1 <40 file, tanpa ai.integration & e2e.location>
# tests 705   # pass 703   # fail 2
```

| Kelompok | File | Skor |
|---|---|---|
| Kriptografi | `tests/secret.crypto.test.ts` | 17/17 |
| Konfigurasi AI | `tests/ai.config.test.ts` | 39/39 |
| Adapter provider AI (baru) | `tests/ai.provider.adapter.test.ts` | 19/19 |
| Alur WhatsApp penerima (baru) | `tests/whatsapp.recipient.flow.test.ts` | 12/12 |
| Penjaga markup UI (baru) | `tests/ui.markup.test.ts` | 7/7 |
| Regresi, 34 file lainnya | various | 611/613 |

**Dua kegagalan — `pre-existing`, terbukti bukan regresi Tahap 4:**
| Test | Penyebab | Bukti |
|---|---|---|
| `announcements.broadcast` — "belum dikonfigurasi: tidak ada pengiriman" | `whatsappConfigStatus()` menghitung `configured` dari perangkat aktif di database (token valid). Test mengosongkan `process.env.FONNTE_TOKEN`, padahal DB sudah punya perangkat aktif. Logika token lama (`sanitizeTokenInput`) dan baru (`readDeviceToken`) menghasilkan nilai identik. | Probe sebelum perubahan Tahap 3: `configured = true`, `tokenValid = true`, `source = database` |
| `reports.analysis.duplicates` — "laporan dengan aiResult selalu berstatus SUCCESS/NEEDS_REVIEW" | Pemeriksaan **konsistensi data murni** pada 48 baris `Report` lama: `aiResult` terisi tetapi `aiStatus` `PENDING`/`FAILED`. Kode Tahap 3 & 4 tidak pernah menulis `Report.aiStatus`/`aiResult`. | Sebaran `aiStatus`: PENDING 64, FAILED 3, NEEDS_REVIEW 1 |

Kedua kegagalan **tidak** diperbaiki — keduanya data/lingkungan lama di luar lingkup Tahap 4.
**Sistem tidak dinyatakan bebas bug.**

---

## 13. HASIL RBAC

| Pemeriksaan | Hasil |
|---|---|
| 11 handler API Admin tanpa sesi | **11/11 → 401 "Tidak terautentikasi"** |
| Halaman `/admin/ai-config` & `/admin/whatsapp-recipients` non-Admin | `getSession()` + `session.role !== 'ADMIN'` → `redirect('/login')` (server-side) |
| Middleware `/admin/*` | Role ADMIN; role lain → dashboard masing-masing |
| Layout `/admin` | Pengecekan role kedua (server-side) |
| Uji browser dengan sesi Admin aktif | Halaman ter-render penuh, **0 console error** |

---

## 14. HASIL BUILD

| Pemeriksaan | Hasil |
|---|---|
| `tsc --noEmit` | **0 error di `src/`**; total 46 error — identik baseline (semua di `tests/` lama) |
| `next lint` | **0 error**, 20 warning (semua `<img>` pre-existing; **0 warning** di file baru) |
| `next build` (`.next` bersih) | **exit 0**; 9 route baru terdaftar |
| Route baru di build | `/admin/ai-config`, `/admin/whatsapp-recipients`, `/api/admin/ai-config` (+ `[id]`, `[id]/activate`, `[id]/test`, `catalog`), `/api/admin/whatsapp-recipients` (+ `[id]`) |

---

## 15. DAFTAR FILE BARU DAN BERUBAH

### 15.1 File BARU (3)
```
tests/whatsapp.recipient.flow.test.ts   12 skenario alur WhatsApp (mock, DB salinan TEMP)
tests/ai.provider.adapter.test.ts      19 skenario adapter provider + integrasi pipeline
tests/ui.markup.test.ts                  7 skenario penjaga struktur markup UI
```

### 15.2 File DIUBAH (10)
```
src/lib/aiProviderConfig.ts                        → + setProviderLabel()
src/lib/notificationRecipients.ts                  → + listRecipientHistory()
src/lib/aiService.ts                               → getAIProviderName() async & terpusat
src/lib/gemini.ts                                  → bootstrap .env hanya bila tabel kosong
src/lib/whatsappMonitoring.ts                      → + status penerima notifikasi
src/app/api/admin/ai-config/route.ts               → + array `slots` (3 provider)
src/app/api/admin/ai-config/[id]/route.ts          → label via setProviderLabel()
src/app/api/admin/whatsapp-recipients/route.ts      → + ?history=1
src/components/ui/admin/AiConfigManager.tsx        → ditulis ulang: 2 panel, 3+1 model, status
src/components/ui/admin/WhatsAppRecipientsManager.tsx → + banner SENDER/RECIPIENT + riwayat
src/components/ui/admin/admin-config.css           → + ~230 baris gaya baru
```
Ditambah: `src/app/(dashboard)/admin/whatsapp-config/page.tsx` (panel SENDER/RECIPIENT),
`docs/TAHAP-4-IMPLEMENTASI.md` (dokumen ini).

### 15.3 File TIDAK disentuh
`prisma/schema.prisma`, semua migrasi, `src/lib/secretCrypto.ts`, `src/lib/aiProviders.ts`,
`src/lib/aiChat.ts`, `src/lib/duplicates.ts`, `src/lib/aiTools.ts`, `src/lib/aiIntent.ts`,
`src/lib/aiSessionStore.ts`, `src/lib/aiContext.ts`, `src/lib/aiValidation.ts`,
`src/lib/aiAudit.ts`, `src/lib/auth.ts`, `src/lib/adminApi.ts`, `src/middleware.ts`,
`src/lib/chatbot.ts`, `.env`.

---

## 16. DAFTAR PEKERJAAN YANG MASIH BLOCKED

| # | Pekerjaan | Status | Alasan | Tindakan Admin yang diperlukan |
|---|---|---|---|---|
| **A** | Penetapan `APP_ENCRYPTION_KEY` | ⛔ **BLOCKED** | Belum ada di `.env` (hanya pemeriksaan keberadaan; nilai tidak dicetak). Sistem **tidak** pernah membuat kunci otomatis dan `.env` **tidak** diubah otomatis. | Buat kunci 32 byte acak, simpan di password manager, tambahkan `APP_ENCRYPTION_KEY=<nilai>` ke `.env` server, restart. Panduan lengkap tampil di banner `/admin/ai-config`. |
| **B** | Backfill `FonnteConfig.token` → `tokenCipher` | ⛔ **BLOCKED** | Memerlukan (1) backup, (2) kunci tersedia, (3) persetujuan eksplisit. Kunci belum ada → belum dilakukan. Kolom `tokenCipher` masih `NULL` pada kedua baris (jalur transisi tetap aktif). | Setelah A selesai: backup + verifikasi → jalankan backfill idempoten → verifikasi dekripsi tanpa mencetak secret. |
| **C** | Request nyata ke Groq | ⛔ **BLOCKED** | Belum ada persetujuan request berbayar; belum ada 1 pun request ke `api.groq.com`. Klaim "Groq terverifikasi" **belum dapat dibuat**. | Berikan persetujuan + API Key Groq asli → 1 request uji → catat status/endpoint/body. |
| **D** | Arsip `src/lib/chatbot.ts` | ⛔ **BLOCKED** | File **tidak** diarsipkan/dihapus. Analisa: `chatbot.ts` **tidak diimpor siapa pun** (dijaga tes `ai.drift.test.ts`), tetapi memuat `@deprecated`. **Memindahkan file akan membuat `tests/ai.drift.test.ts:270` gagal** (tes membaca file tersebut). | **Rekomendasi: TIDAK diarsipkan sekarang.** Bila nanti dihapus, hapus juga assertion `read('src/lib/chatbot.ts')` pada tes drift dalam satu perubahan teratomic yang disetujui. |

> Tahap 4 **tidak berhenti** karena keempat hal ini — seluruh pekerjaan aman lainnya selesai dan diverifikasi.

---

## 17. PROSEDUR OPERASIONAL ADMIN

### 17.1 Menjalankan & membangun
```bash
npm run dev                 # pengembangan
npm run build && npm start  # produksi
```

### 17.2 Mengatur provider AI (setelah `APP_ENCRYPTION_KEY` tersedia)
1. Buka `/admin/ai-config`.
2. Pilih provider di panel **kiri**.
3. Tempel API Key (tombol 👁️ untuk menampilkan/menyembunyikan).
4. Pilih **model utama** (dropdown katalog atau ketik manual).
5. Isi **model cadangan 1/2/3** bila perlu (urutan = prioritas).
6. **Simpan Konfigurasi**.
7. **Uji Koneksi** → periksa hasilnya.
8. **Jadikan Provider Aktif** (konfirmasi). Provider lain tetap menyimpan kunci & modelnya.

### 17.3 Mengatur penerima notifikasi WhatsApp
1. Buka `/admin/whatsapp-recipients`.
2. **+ Tambah Nomor** (label + nomor 08xx/62xx).
3. Klik **Aktifkan** pada nomor yang mau dipakai — nomor lain otomatis nonaktif.
4. **Ubah** untuk mengganti label/nomor; **Nonaktifkan (soft)** untuk menonaktifkan tanpa menghapus.
5. Riwayat perubahan tercatat otomatis di **Riwayat Perubahan** + `AdminAuditLog`.

### 17.4 Menjalankan pengujian (aman — memakai salinan DB di TEMP)
```powershell
$files = Get-ChildItem "tests\*.test.ts" | Where-Object { $_.Name -notin @('ai.integration.test.ts','e2e.location.test.ts') } | ForEach-Object { $_.FullName }
npx tsx --test --test-concurrency=1 $files

# hanya tes Tahap 3–4
npx tsx --test --test-concurrency=1 tests/ai.config.test.ts tests/ai.provider.adapter.test.ts `
  tests/whatsapp.recipient.flow.test.ts tests/ui.markup.test.ts tests/secret.crypto.test.ts
```

---

## 18. PROSEDUR BACKUP DAN ROLLBACK

### 18.1 Backup
```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item prisma\dev.db "prisma\dev.db.backup-$stamp"
Get-FileHash "prisma\dev.db.backup-$stamp" -Algorithm SHA256   # simpan hashnya
```
Backup yang sudah ada:
| Berkas | Keterangan |
|---|---|
| `prisma/dev.db.backup-before-config-20261112-093132` | Pra-migrasi Tahap 3 (sha256 `8800a2a6aa5a1eadf0ca38b618922a56`) |
| `prisma/dev.db.backup-before-recipient-seed-20261112-152239` | Pra-seed penerima |

### 18.2 Rollback
| Skenario | Tindakan |
|---|---|
| Konfigurasi AI tidakdesired | Kosongkan baris `AiProvider` → sistem kembali memakai bootstrap `.env` |
| Penerima salah | Nonaktifkan semua `NotificationRecipient` → notifikasi Admin **terhenti** (tidak kembali diam-diam ke nomor perangkat) |
| Fonnte token gagal dekripsi | Isi `tokenCipher = null` → jalur transisi memakai kolom `token` kembali |
| Total | Pulihkan `prisma/dev.db` dari backup, lalu `npx prisma migrate deploy` |

> `prisma migrate reset` **dilarang**. Migrasi hanya lewat `migrate deploy` dengan SQL manual + backup.

---

## 19. REKOMENDASI TAHAP BERIKUTNYA

| Prioritas | Rekomendasi | Alasan |
|---|---|---|
| **P0** | Tetapkan `APP_ENCRYPTION_KEY` (A) lalu jalankan backfill token Fonnte (B) | Tanpa ini, penyimpanan API Key terenkripsi dan token Fonnte terenkripsi belum dapat dipakai. Prosedurnya sudah siap & diuji. |
| **P0** | Tambahkan 1 request uji Groq setelah ada kunci (C) | Mengubah status Groq dari "asumsi" menjadi "terverifikasi" |
| **P1** | Tambahkan provider AI nyata lewat `/admin/ai-config` (OpenRouter → cadangan Gemini/Groq) | Saat ini sistem masih memakai bootstrap `.env`; konfigurasi terpusat belum terisi |
| **P1** | Hapus 2 kegagalan `pre-existing` (§12) | Bukan regresi, tapi tetap perlu dirawat: `announcements.broadcast` perlu isolasi lingkungan yang lebih baik, `reports.analysis.duplicates` perlu konsistensi data 48 baris lama |
| **P2** | Arsip `chatbot.ts` **hanya** bersama perbaikan tes drift (D) | Menghindari file mati tanpa merusak penjaga regresi |
| **P2** | Pantau `meta.usedProvider`/`usedModel` dari `AdminAuditLog` | Audit provider/model yang benar-benar dipakai — dasar untuk keputusan kuota |
| **P3** | Tambahkan rotasi `APP_ENCRYPTION_KEY` terjadwal | Prosedur rotasi sudah didokumentasikan (§13 TAHAP-3), belum pernah dijalankan |

---

## 20. CATATAN TEMUAN AUDIT (TAHAP 4.1)

| # | Temuan | Status |
|---|---|---|
| F-01 | Karakter asing (CJK) menyelinap di komentar `aiProviderConfig.ts` | ✅ Diperbaiki |
| F-02 | Karakter asing (CJK) di `docs/TAHAP-3-IMPLEMENTASI.md` | ✅ Diperbaiki |
| F-03 | `aiService.getAIProviderName()` membaca `.env` langsung | ✅ Diperbaiki (async, terpusat) |
| F-04 | `gemini.ts` bisa jatuh ke `.env` meski Admin sudah mengonfigurasi provider lain | ✅ Diperbaiki |
| F-05 | Ubah label provider memakai `upsertProvider()` (rapuh) | ✅ Diperbaiki (`setProviderLabel`) |
| F-06 | UI `/admin/ai-config` belum sesuai pola daftar + detail | ✅ Diperbaiki (Tahap 4.2) |
| F-07 | Tidak ada histori perubahan penerima | ✅ Diperbaiki (Tahap 4.3) |
| F-08 | **Komentar JSX menutupnya sendiri → blok UI hilang diam-diam** | ✅ Diperbaiki + diawasi tes regresi |
| F-09 | `chatbot.ts` mengimpor `.env` | ⚠️ BLOCKED (D) — analisis di §16.D |
| F-10 | `tests/ai.partial.failure.test.ts` & `tests/whatsapp.diagnostics.test.ts` memuat karakter asing di komentar | ℹ️ Pre-existing, tidak diubah (di luar lingkup) |
| F-11 | `docs/TAHAP-2-SPESIFIKASI-TEKNIS.md` memuat karakter asing di beberapa baris | ℹ️ Dokumen acuan, tidak diubah |

---

**Status akhir Tahap 4: SELESAI DENGAN CATATAN.**
Seluruh kode, UI, dan pengujian terverifikasi; 4 pekerjaan yang membutuhkan persetujuan Admin
ditandai BLOCKED dengan prosedur yang jelas dan aman untuk dilanjutkan.

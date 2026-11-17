# PERBAIKAN KONFIGURASI AI PROVIDER

**Sistem:** Sistem Pelaporan Fasilitas Umum Desa Ciperna
**Ruang lingkup:** konfigurasi provider AI (OpenRouter / Google Gemini / Groq), kebijakan model gratis
terverifikasi, aktivasi provider tunggal, fallback otomatis, dan status runtime chatbot.
**Tanggal:** 12 November 2026
**Status akhir:** **SELESAI DENGAN CATATAN** — seluruh kode terverifikasi; 4 item masih membutuhkan
keputusan/kredensial Admin (§12).

---

## 1. TEMUAN AUDIT AWAL

Audit terhadap implementasi Tahap 3–6 menemukan hal berikut.

| # | Temuan | Bukti | Status |
|---|---|---|---|
| A-1 | **Tidak ada mekanisme verifikasi status gratis sama sekali.** Fallback memakai model apa pun yang tersimpan. | `resolveAiProviderChain()` memakai `primaryModel + fallbackModels` mentah; tidak ada filter status gratis. | ✅ Diperbaiki |
| A-2 | **Provider nonaktif TIDAK otomatis menjadi fallback** bila modelnya tidakPolicy-compliant — dan tidak ada filter apa pun. | `aiProviderConfig.ts` sebelum perubahan | ✅ Diperbaiki |
| A-3 | **Kode "model gratis" hanya ada di `docs/TAHAP-2` sebagai anjuran**, bukan implementasi. | `Q-3`/`Q-4`/`Q-5` di spesifikasi | ✅ Diperbaiki |
| A-4 | **UI tidak membedakan "aktif" vs "siap sebagai cadangan"** dengan jelas. | Slot hanya punya 1 badge status. | ✅ Diperbaiki |
| A-5 | **"Model yang benar-benar dipakai" tidak pernah ditampilkan.** | `aiChat` hanya menaruh `usedModel` di respons HTTP; tidak dipersistensi, tidak tampil di UI. | ✅ Diperbaiki |
| A-6 | **Jawaban deterministik (canned) berpotensi disamarkan sebagai jawaban LLM.** | `meta.fallback` ada, tetapi tidak ada penanda sumber jawaban di UI. | ✅ Diperbaiki |
| A-7 | **Endpoint "Uji Koneksi" bisa menguji model berbayar.** | `POST /[id]/test` hanya memeriksa kunci & model. | ✅ Diperbaiki |
| A-8 | **Katalog tidak mengambil data harga**, sehingga status gratis tidak bisa dibuktikan. | `catalog/route.ts` hanya memetakan `id`, `name`, `context_length`. | ✅ Diperbaiki |
| A-9 | **Tidak ada endpoint re-verifikasi** dari katalog resmi. | — | ✅ Diperbaiki |
| A-10 | Status koneksi (`connected`) dihitung dari provider **aktif** saja, bukan dari rantai yang benar-benar dipakai. | `api/ai/chat` & `api/admin/ai/chat` | ✅ Diperbaiki |
| A-11 | Deteksi duplikat model **hanya** berbasis `label` + `provider`; status model tidak disimpan sama sekali. | Tidak ada tabel `AiModelPolicy`. | ✅ Diperbaiki (tabel baru, additive) |
| A-12 | Premis awal "OpenRouter masih dipakai lewat `.env`" **tidak true** — Admin sudah mengonfigurasi 2 provider di DB dan `gemini` aktif. | `source=database`, `provider=gemini` | ✅ Terverifikasi |

### Kondisi sebelum perubahan (terverifikasi, read-only)
```
AiProvider:
  gemini      AKTIF   primary=gemini-2.5-flash              lastError=AI_MODEL_GONE   (404 model hilang)
  openrouter  NONAKTIF primary=google/gemma-4-31b-it:free lastError=AI_RATE_LIMIT (429 shared-pool)
resolveAiProviderChain() → attempts: [gemini, openrouter]  (keduanya gagal berurutan)
→ AI sedang TERDEGRADASI: jatuh ke jawaban deterministik.
```
Tidak ada perubahan konfigurasi provider yang dilakukan oleh implementasi ini.

---

## 2. FILE YANG DIUBAH

### 2.1 File BARU (6)
| File | Isi |
|---|---|
| `src/lib/aiModelPolicy.ts` | Layanan kebijakan model gratis: klasifikasi status dari bukti resmi, registry DB, filter, verifikasi dari katalog resmi |
| `src/app/api/admin/ai-config/recommend/route.ts` | GET rekomendasi model gratis (hanya `VERIFIED_FREE`) |
| `src/app/api/admin/ai-config/verify-models/route.ts` | POST verifikasi ulang dari katalog resmi (GET metadata) |
| `prisma/migrations/20261112153000_add_ai_model_policy/migration.sql` | Migrasi **additive**: `CREATE TABLE "AiModelPolicy"` + 3 index |
| `tests/ai.policy.test.ts` | 17 skenario (15 wajib + 2 pembuktian klasifikasi) |
| `docs/PERBAIKAN-KONFIGURASI-AI-PROVIDER.md` | Dokumen ini |

### 2.2 File DIUBAH (14)
| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | + model `AiModelPolicy` (hanya tabel baru) |
| `src/lib/aiProviderConfig.ts` | Rantai model difilter kebijakan gratis; `primaryModelStatus`, `allowedFallbackModels`, `blockedFallbackModels` |
| `src/lib/aiChat.ts` | Memakai rantai terfilter; `meta.isFallback`, `fallbackReason`, `answerSource`; pesan jelas saat tidak ada model terverifikasi |
| `src/lib/aiService.ts` | (tanpa perubahan kode — memakai rantai yang sudah difilter) |
| `src/app/api/admin/ai-config/route.ts` | Status policy per slot, `runtime` (rantai nyata + model yang ditolak) |
| `src/app/api/admin/ai-config/[id]/route.ts` | Tolak model utama/cadangan `UNVERIFIED`/`PAID` |
| `src/app/api/admin/ai-config/[id]/activate/route.ts` | Validasi policy sebelum aktivasi |
| `src/app/api/admin/ai-config/[id]/test/route.ts` | Tolak model `PAID`; `UNVERIFIED` butuh `allowUnverified:true` |
| `src/app/api/ai/chat/route.ts` | `connected` mengikuti rantai nyata; segarkan policy sebelum pipeline |
| `src/app/api/admin/ai/chat/route.ts` | Sama |
| `src/components/ui/admin/AiConfigManager.tsx` | **Ditulis ulang**: panel status, kartu provider, model + urutan, rekomendasi |
| `src/components/ui/admin/admin-config.css` | + gaya panel status, kartu fallback, badge status gratis, modal rekomendasi |
| `src/components/ui/AdminAiAssistant.tsx` | Tampilkan "AI: provider — model" / "(Fallback)" / "Jawaban lokal (bukan dari model AI)" |
| `src/components/ui/AdminAiFloatingChatbot.tsx` | Sama |

### 2.3 File DIUBAH (tes)
`tests/ai.config.test.ts` (T-13: fixture policy), `tests/ai.config.security.test.ts` (S-04: fixture policy),
`tests/ai.context.test.ts` (stub policy agar tes fokus pada isi prompt), `tests/ui.markup.test.ts` (M-02: blok UI baru).

### 2.4 File TIDAK disentuh
`src/lib/secretCrypto.ts`, `src/lib/aiIntent.ts`, `src/lib/aiSessionStore.ts`, `src/lib/aiContext.ts`,
`src/lib/aiValidation.ts`, `src/lib/aiToolRegistry.ts`, `src/lib/auth.ts`, `src/lib/adminApi.ts`,
`src/middleware.ts`, `src/lib/chatbot.ts`, seluruh kode WhatsApp/OTP/notifikasi, `.env`,
struktur laporan & akun pengguna.

---

## 3. PERUBAHAN UI

### 3.1 Panel "Status Asisten AI"
| Baris | Isi |
|---|---|
| AI AKTIF / TIDAK AKTIF | Badge hijau/merah |
| Sumber konfigurasi | `DATABASE` atau `.ENV (bootstrap)` |
| Provider utama | Nama provider |
| Model utama | Id model + badge status gratis |
| Model cadangan | Daftar model cadangan yang terverifikasi |
| Model yang dipakai pipeline | Rantai nyata dari `runtime.usableModels` |
| Urutan percobaan provider | `a → b → c` |
| Model yang DITOLAK | Daftar model + alasan (`UNVERIFIED`/`PAID`) |
| Masalah | `problems` dari server |

### 3.2 Kartu provider
Nama · **AKTIF / NONAKTIF** · API Key (Tersimpan / Belum Tersimpan) · Model utama + badge status gratis ·
"Fallback: N model terverifikasi" · status koneksi terakhir + waktunya · tombol aksi:

| Kondisi | Tombol |
|---|---|
| Provider aktif | `Provider Sedang Aktif` (nonaktif) + `Nonaktifkan` |
| Nonaktif & lengkap & terverifikasi | `Jadikan Provider Aktif` + `Atur Model` |
| Nonaktif & belum lengkap | `Konfigurasi` + `Atur Model` |

Konfirmasi aktivasi: **"Aktifkan provider ini sebagai provider utama chatbot?"**

### 3.3 Bagian model
`Model utama` + daftar `Model cadangan` (urutan = prioritas) dengan tombol **↑** / **↓** (ubah urutan),
**Uji model**, **Hapus**, serta **+ Tambah model cadangan**. Tiap baris punya badge status gratis.
Jumlah cadangan **menyesuaikan ketersediaan** — tidak dipaksa menjadi tiga.

### 3.4 Rekomendasi
Tombol **`Rekomendasikan Model Gratis`** → modal berisi provider utama + cadangan (hanya terverifikasi),
sumber bukti (URL resmi), tanggal verifikasi, dukungan bahasa/multi-turn/gambar, dan alasan pemilihan.
Tombol **`Terapkan Rekomendasi`** → konfirmasi kedua → baru menulis. **`Batal`** tanpa efek.

---

## 4. CARA MENGAKTIFKAN PROVIDER

```
1. Admin → /admin/ai-config
2. Klik "Verifikasi Ulang dari Katalog Resmi"  (status gratis diperbarui dari katalog resmi)
3. Pilih provider di daftar kartu
4. Tempel API Key (disimpan terenkripsi) → pilih Model utama → isi Model cadangan
5. Klik "Simpan Konfigurasi"          → PATCH /api/admin/ai-config/{id}
6. Klik "Uji Koneksi" (opsional)       → POST /api/admin/ai-config/{id}/test
7. Klik "Jadikan Provider Aktif" → konfirmasi → POST /api/admin/ai-config/{id}/activate
```
Yang terjadi di server saat aktivasi (`activateProvider`, sudah ada sejak Tahap 3):
```sql
UPDATE AiProvider SET isActive=0 WHERE isActive=1 AND id<≠>;
UPDATE AiProvider SET isActive=1 WHERE id=<>;
```
dalam **satu transaksi** + partial UNIQUE INDEX `AiProvider_one_active` sebagai jaring pengaman
lapis database. Provider lama **tetap tersimpan** (kunci & model tidak dihapus) dan otomatis
menjadi **fallback**.

Validasi aktivasi (baru):
- API Key harus ada → 400 bila kosong.
- Model utama harus ada → 400 bila kosong.
- Model utama harus `VERIFIED_FREE` → 400 bila belum terverifikasi.

---

## 5. CARA KERJA FALLBACK

Urutan percobaan (P1 `aiChat`, P2 `aiService`, P3 `duplicates` memakai rantai yang sama):

```
1. Model utama dari provider AKTIF          (hanya VERIFIED_FREE)
2. Model cadangan provider aktif, berurutan  (hanya VERIFIED_FREE)
3. Provider cadangan lain yang punya API Key + model terverifikasi
4. Model cadangan provider cadangan, berurutan
5. Semua gagal → jawaban deterministik + pesan jujur
```

Aturan yang dipatuhi:
| Aturan | Implementasi |
|---|---|
| Maksimal percobaan | `MAX_CHAIN_LENGTH = 4` model per provider; jumlah provider dibatasi daftar DB |
| Tanpa API Key | Provider tanpa kunci **tidak pernah** masuk rantai |
| UNVERIFIED / PAID | **Dilarang** (difilter di `resolveAiProviderChain`, fail-closed) |
| Retry tanpa batas | Tidak ada; tiap model dicoba **sekali** per permintaan |
| Timeout | Dipertahankan (25 detik chat / 20 detik tes / 45 detik Gemini) |
| Klasifikasi error | Dipertahankan (`AI_AUTH_FAILED`, `AI_QUOTA`, `AI_RATE_LIMIT`, `AI_MODEL_GONE`, `AI_TIMEOUT`) |
| 401/403 | **Berhenti total** — tidak mencoba provider lain dengan kunci yang sama |
| 402 (kuota) | Berhenti untuk provider itu, boleh lanjut provider lain yang memenuhi kebijakan |
| 404 (model hilang) | Lanjut model berikutnya; model ditandai mati 30 menit |
| Model hilang/berubah | Tidak ada jawaban mengarang; fallback deterministik + pesan jelas |

Cache model mati (404) tetap 30 menit seperti sebelumnya.

---

## 6. DAFTAR MODEL `VERIFIED_FREE` BESERTA SUMBER RESMI

**Penting:** daftar di bawah adalah **mekanisme + sumber bukti**, bukan hasil verifikasi yang
sudah saya lakukan. Saya **tidak** mengirim request ke katalog provider, sehingga **tidak ada
model yang saya klaim sudah terverifikasi**. Status `VERIFIED_FREE` hanya akan muncul setelah
sistem membaca katalog resmi (tombol "Verifikasi Ulang dari Katalog Resmi" atau otomatis saat
halaman/chat dibuka).

| Provider | Cara pembuktian | Sumber bukti resmi (URL) | Status saat ini |
|---|---|---|---|
| **OpenRouter** | id model pada katalog resmi berakhiran `:free` **dan/atau** `pricing.prompt = "0"` serta `pricing.completion = "0"` | `https://openrouter.ai/api/v1/models` (katalog resmi, GET publik tanpa key) · dokumentasi `https://openrouter.ai/models` | **BELUM TERVERIFIKASI** — registry kosong (`AiModelPolicy` = 0 baris) |
| **Google Gemini** | Katalog resmi `models` **tidak mencantumkan harga**; tier gratis mengikuti status akun (AI Studio free / billed) | katalog `https://generativelanguage.googleapis.com/v1beta/models` · harga resmi `https://ai.google.dev/pricing` | **BELUM TERVERIFIKASI** (kebijakan tidak bisa dibuktikan otomatis) |
| **Groq** | Katalog resmi `models` **tidak mencantumkan harga**; free tier = batas rpm + key tanpa billing | katalog `https://api.groq.com/openai/v1/models` · harga resmi `https://groq.com/pricing` | **BELUM TERVERIFIKASI** |

MetADATA yang tersimpan per model (`AiModelPolicy`):
`provider` · `modelId` · `freeStatus` (`VERIFIED_FREE` | `UNVERIFIED` | `PAID`) · `evidenceUrl` ·
`verifiedAt` · `notes` — tanpa secret.

---

## 7. MODEL YANG DITOLAK DAN ALASANNYA

| Model / pola | Alasan ditolak |
|---|---|
| `gemini-2.5-flash` (model utama provider aktif) | Katalog Gemini tidak menyatakan harga → `UNVERIFIED` → **tidak dipakai otomatis**. Provider ini sebelumnya gagal dengan `AI_MODEL_GONE`. |
| `gemini-2.5-flash-lite`, `gemini-flash-latest` (cadangan Gemini) | Sama — `UNVERIFIED`. |
| `google/gemma-4-31b-it:free` (OpenRouter) | Suffiks `:free` **sangat mungkin** terbukti gratis begitu katalog dibaca, tetapi **belum diverifikasi** → saat ini `UNVERIFIED` → belum dipakai otomatis. |
| `liquid/lfm-3-1.7b:free` (OpenRouter) | Sama. |
| Model tanpa sufiks `:free` dan tanpa `pricing` | Tidak ada bukti → `UNVERIFIED`. |
| Model dengan `pricing` > 0 | `PAID` → **dilarang** dipakai, termasuk saat "Uji Koneksi". |
| Nama model berisi "Flash"/"free" tanpa bukti katalog | **Tidak pernah** dijadikan bukti (nama bukan bukti). |

> Konsekuensi yang harus disadari: **sampai verifikasi dijalankan, pipeline tidak memakai model
> apa pun** dan chatbot menjawab dengan jawaban deterministik + pesan jujur. Ini adalah pilihan
> fail-closed sesuai aturan "hanya model gratis terverifikasi".

---

## 8. HASIL TES

| Kelompok | File | Hasil |
|---|---|---|
| Kebijakan, aktivasi, fallback, keamanan (baru) | `tests/ai.policy.test.ts` | **17/17** |
| Konfigurasi AI | `tests/ai.config.test.ts` | 43/43 |
| Keamanan konfigurasi AI | `tests/ai.config.security.test.ts` | 8/8 |
| Adapter provider | `tests/ai.provider.adapter.test.ts` | 19/19 |
| Konteks prompt | `tests/ai.context.test.ts` | 5/5 |
| Penjaga markup UI | `tests/ui.markup.test.ts` | 13/13 |
| **Suite penuh (42 file; 2 terlarang dikecualikan)** | | **735 tes → 733 lulus, 2 gagal pre-existing** |

Dua kegagalan **pre-existing** (bukan regresi; sudah terdokumentasi sejak Tahap 4):
`announcements.broadcast` ("belum dikonfigurasi") dan `reports.analysis.duplicates`
(konsistensi data 48 baris `Report` lama).

15 skenario wajib (§12 prompt) dipetakan:
| # | Skenario | Lokasi |
|---|---|---|
| 1 | Hanya satu provider aktif | `ai.policy.test.ts` — "1." (index unik parsial menolak yang kedua) |
| 2 | Aktivasi baru menonaktifkan sebelumnya | "2." |
| 3 | Aktivasi atomik | "3 & 4." |
| 4 | API Key lama tidak terhapus | "3 & 4." |
| 5 | UI menampilkan status DB | "5." |
| 6 | Tanpa API Key tidak bisa diaktifkan | "6." |
| 7 | UNVERIFIED tidak jadi utama/cadangan | "7 & 8." |
| 8 | PAID tidak dipakai | "7 & 8." |
| 9 | Fallback hanya VERIFIED_FREE | "9." |
| 10 | Fallback pindah provider | "10." |
| 11 | Semua model gagal → pesan jelas | "11." |
| 12 | Metadata runtime akurat | "12." |
| 13 | Key/ciphertext tidak bocor | "13." |
| 14 | Endpoint menolak Petugas & Warga | "14." (401/403 nyata) |
| 15 | Canned ≠ jawaban LLM | "15." |

---

## 9. HASIL ESLINT, TYPESCRIPT, DAN BUILD

| Pemeriksaan | Hasil |
|---|---|
| ESLint | **0 error**, 20 warning (semua `<img>` pre-existing) |
| TypeScript | **0 error di `src/`**; total 46 error = **identik baseline** (semua di `tests/` lama) |
| `next build` (`.next` bersih) | **exit 0** |
| Route baru di build | `/api/admin/ai-config/recommend`, `/api/admin/ai-config/verify-models` |
| RBAC runtime (13 handler tanpa sesi) | **13/13 → 401** |

---

## 10. STATUS DATABASE SEBELUM / SESUDAH

```
SEBELUM                              SESUDAH
NotificationRecipient : 2             2   (tidak berubah)
AiProvider            : 2             2   (tidak berubah — konfigurasi Admin utuh)
AiModelPolicy         : 0             0   (tabel baru; verifikasi belum dijalankan)
fonnteConfig          : 1             1   (tidak berubah)
user/report/...       : tidak berubah  tidak berubah
Tabel lama yang berkurang : —            0
PRAGMA integrity_check : ok            ok
```
Migrasi `20261112153000_add_ai_model_policy` **hanya** `CREATE TABLE` + index (tidak ada ALTER/DROP
pada tabel lama). Backup pra-migrasi:
`prisma/dev.db.backup-before-policy-20261112-215035` (1.204.224 byte,
sha256 `157AD3E29C8A50CD1CF3906C9B858375E136D0FE11F02B83D523B04E5AD3B7F1`).

---

## 11. STATUS KEAMANAN API KEY

| Aspek | Status |
|---|---|
| Penyimpanan | `apiKeyCipher` (AES-256-GCM), `APP_ENCRYPTION_KEY` di server |
| API Key ke browser | **Tidak pernah** — hanya flag `hasApiKey: boolean` (terbukti tes 13) |
| Ciphertext ke browser | **Tidak pernah** (terbukti tes 13) |
| API Key kosong saat edit | Kunci lama **dipertahankan** |
| Ganti provider aktif | Kunci provider lain **tidak** terhapus (terbukti tes 3 & 4) |
| Audit log | `AI_CONFIG_*` — **tanpa** nilai kunci/ciphertext |
| `APP_ENCRYPTION_KEY` ke browser | **Tidak pernah** |
| Kunci pada katalog Gemini/Groq | Dipakai hanya pada endpoint katalog resmi sesuai konvensi provider; tidak dicetak/disimpan |
| RBAC | Semua endpoint konfigurasi `requireAdmin()` (401/403 terbukti) |

---

## 12. HAL YANG MASIH MEMBUTUHKAN KEPUTUSAN ADMIN

| # | Item | Yang dibutuhkan | Dampak bila belum dikerjakan |
|---|---|---|---|
| **1** | Jalankan **"Verifikasi Ulang dari Katalog Resmi"** (atau buka `/admin/ai-config` / kirim chat → otomatis refresh) | Izin network ke katalog resmi (GET metadata, tanpa biaya token) | Registry `AiModelPolicy` tetap kosong → **semua model `UNVERIFIED`** → pipeline tidak memakai model apa pun → chatbot menjawab deterministik dengan pesan jujur |
| **2** | Putuskan model utama provider aktif | Saat ini `gemini-2.5-flash` **404 (`AI_MODEL_GONE`)** dan `google/gemma-4-31b-it:free` **429 (`AI_RATE_LIMIT`)** → AI degrade | Pilih model dari hasil rekomendasi (hanya yang `VERIFIED_FREE`) |
| **3** | Gemini & Groq tetap `UNVERIFIED` | Keputusan manusia: status tier akun diverifikasi manual (halaman harga resmi) | Keduanya tidak boleh jadi utama maupun cadangan |
| **4** | Backfill token Fonnte & `APP_ENCRYPTION_KEY` (BLOCKED sejak Tahap 3) | Kunci + backup + persetujuan | Token Fonnte masih plaintext di DB (tetap terbaca) |
| **5** | Verifikasi Groq terhadap API nyata (BLOCKED sejak Tahap 3) | Izin request + API Key | `verified: false` pada spec Groq; adapter belum diuji ke API nyata |
| **6** | Arsip `src/lib/chatbot.ts` (BLOCKED sejak Tahap 3) | Persetujuan | File tetap ada; dijaga tes `ai.drift.test.ts` agar tidak diimpor siapa pun |

### Rekomendasi urutan tindakan
1. Klik **"Verifikasi Ulang dari Katalog Resmi"** → lihat daftar model gratis yang benar-benar terbukti.
2. Klik **"Rekomendasikan Model Gratis"** → periksa → **Terapkan** (hanya menyimpan model, tidak
   mengaktifkan provider secara otomatis).
3. **"Uji Koneksi"** model utama → jika gagal, coba model cadangan berikutnya.
4. **"Jadikan Provider Aktif"** provider yangdesired.
5. Verifikasi di chatbot: label **"AI: <provider> — <model>"** (atau "Jawaban lokal (bukan dari
   model AI)" bila semua model gagal).

---

## 13. CATATAN PENTING

- **Tidak ada provider atau model yang status gratisnya belum terbukti** yang ditambahkan ke
  konfigurasi, ke daftar cadangan, atau ke rekomendasi. Semua yang Ditambahkan hanya bila
  `VERIFIED_FREE`.
- **Tidak ada permintaan berbayar** yang dikirim selama implementasi (katalog resmi hanya dibaca
  sebagai metadata, dan itu pun dilakukan oleh aplikasi saat Admin menekan tombolnya).
- **Tidak ada WhatsApp** yang dikirim; tidak ada perubahan pada notifikasi/OTP.
- **`prisma migrate dev`/`reset`/`push` tidak pernah dijalankan** — hanya `migrate deploy` dengan
  SQL additive.
- Sistem tidak mengklaim bebas bug. Dua kegagalan `pre-existing` masih ada dan tercatat.

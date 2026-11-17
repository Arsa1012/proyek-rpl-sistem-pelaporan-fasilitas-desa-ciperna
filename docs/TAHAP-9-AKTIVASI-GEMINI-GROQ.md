# TAHAP 9 — AKTIVASI DAN INTEGRASI GEMINI + GROQ

**Proyek:** Sistem Pelaporan Fasilitas Umum Desa Ciperna  
**Tanggal:** 13 November 2026  
**Status:** SELESAI (audit + laporan); **aktivasi menunggu persetujuan Admin**  
**Batasan:** Read-only, tidak mengubah konfigurasi aktif OpenRouter, tidak request API nyata, tidak mengirim WhatsApp.

---

## 1. RINGKASAN EKSEKUTIF

| Provider | Status | API Key | Aktif | Model VERIFIED_FREE | Kesimpulan |
|---|---|---|---|---|---|
| OpenRouter | ✅ Aktif | Tersedia (terenkripsi) | Ya | 15 model | Sudah berjalan, pertahankan |
| Gemini | ⚠️ Tidak aktif | Tersedia (terenkripsi) | Tidak | 0 (semua UNVERIFIED) | Model primary deprecated (404); perlu ganti model + verifikasi manual ACCOUNT_DEPENDENT |
| Groq | ❌ Belum dikonfigurasi | Belum ada | Tidak | 0 | Belum ada baris AiProvider & API Key |

**Tidak ada model Gratis yang terverifikasi (VERIFIED_FREE) untuk Gemini dan Groq saat ini.**
- **Gemini:** model gratis tersedia pada Free Tier namun statusnya **ACCOUNT_DEPENDENT** (bergantung billing tidak diaktifkan). Tidak boleh diubah ke VERIFIED_FREE tanpa bukti konfirmasi Admin.
- **Groq:** dokumentasi resmi tidak mencantumkan model dengan harga $0 (ContactSales / berbayar). Tidak ada model yang memenuhi syarat gratis.

OpenRouter tetap dijaga sebagai provider aktif. Aktivasi Gemini & Groq hanya dilakukan setelah persetujuan Admin dan penyesuaian kebijakan status.

---

## 2. AUDIT GEMINI (Bagian 1)

### 2.1 Konfigurasi database

| Item | Nilai |
|---|---|
| Baris AiProvider | ADA (1 baris) |
| Aktif | false |
| API Key | ADA, terenkripsi (AES-256-GCM) |
| Model primary | `gemini-2.5-flash` |
| Model fallback | `gemini-2.5-flash-lite`, `gemini-flash-latest` |
| lastError | `AI_MODEL_GONE` |
| lastValidation | 2026-11-12T14:28:56.815Z |
| Style adapter | `gemini-sdk` |
| supportsImages | true |
| verified (spec) | true |

### 2.2 Masalah yang ditemukan

1. **Model primary deprecated.** `gemini-2.5-flash` adalah model deprecated (dokumentasi resmi: tidak tersedia di AI Studio, routing otomatis ke `gemini-3.5-flash-lite` efektif 1 Desember 2026). Error `AI_MODEL_GONE (404)` mencerminkan hal ini.
2. **Semua entri policy Gemini = UNVERIFIED (50 baris).** Katalog resmi Gemini tidak mencantumkan harga per model, sehingga sistem tidak dapat menetapkan VERIFIED_FREE otomatis. Belum ada verifikasi manual yang dilakukan.
3. **Fallback model lama.** `gemini-2.5-flash-lite` dan `gemini-flash-latest` perlu divisah ulang ke model yang tersedia saat ini (mis. `gemini-3.5-flash-lite`).

### 2.3 Model gratis dari dokumentasi resmi (Free Tier)

Berdasarkan `https://ai.google.dev/gemini-api/docs/pricing` (diambil 13 Nov 2026):

| Model ID | Free Tier | Paid Tier (per 1M token) | Konteks | Modalitas |
|---|---|---|---|---|
| `gemini-3.5-flash-lite` | Free of charge | $0.30 input / $2.50 output | — | Text / Image / Video / Audio |
| `gemini-3.6-flash` | Free of charge | $0.75 input / $3.75 output | 1M | Text + multimodal |
| `gemini-3.8-flash` | Free of charge | $0.75 input / $3.75 output | 1M | Text + multimodal |
| `gemini-4-hydrogen` | Free of charge | $1.50 input / $7.50 output | 1M | Text, Image, Audio, Video, PDF |
| `gemini-3.5-transcribe` | Free of charge | $2.00 / $12.00 | — | Speech-to-text |
| `gemini-3.5-live-translate-preview` | Free of charge | $3.50 / $21.00 (audio/menit) | — | Speech-to-speech |

**Model TIDAK tersedia pada Free Tier:**
- `gemini-4-carbon`, `gemini-4-argon` — "Not available on the Free tier"
- `gemini-omni-1.2-flash` / `1.1-flash` — "Not available" on Free Tier

**Model DEPRECATED (jangan pakai):**
- `gemini-2.5-flash`, `gemini-2.5-pro` — deprecated

### 2.4 Status verifikasi (bukti)

Per Aturan Tahap 9 #7 dan Tahap 7 #6: status gratis Gemini bergantung pada **tier akun** (Google AI Studio free tier vs billing-enabled). Jika penagihan aktif, kuota ditagihkan. Oleh karena itu:
- Model-model di atas ditandai **ACCOUNT_DEPENDENT**, **bukan** VERIFIED_FREE.
- Tidak boleh diubah ke VERIFIED_FREE tanpa bukti konfirmasi Admin bahwa akun AI Studio masih menggunakan free tier (belum Aktifkan penagihan).

### 2.5 Kompatibilitas adapter (pipeline P1-P6)

| Aspek | Hasil |
|---|---|
| Style | `gemini-sdk` (menggunakan `@google/generative-ai`) |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models` |
| supportsImages | true (analisis gambar laporan) |
| verified (spec) | true |
| Pipeline P1-P6 | Kompatibel (service `callGeminiProvider` sudah terintegrasi di `aiChat.ts` rantai fallback) |

---

## 3. AUDIT GROQ (Bagian 2)

### 3.1 Konfigurasi database

| Item | Nilai |
|---|---|
| Baris AiProvider | **TIDAK ADA** (belum pernah dikonfigurasi) |
| API Key | **Belum ada** |
| Entri policy | 0 baris |

### 3.2 Model dari katalog resmi

Berdasarkan `https://console.groq.com/docs/models` dan `https://groq.com/pricing/` (diambil 13 Nov 2026):

| Model ID | Tipe | Harga per 1M token | Status |
|---|---|---|---|
| `llama-3.1-8b-instant` | Produksi | ContactSales | Tidak disebutkan gratis |
| `llama-3.3-70b-versatile` | Produksi | ContactSales | Tidak disebutkan gratis |
| `openai/gpt-oss-120b` | Produksi | $0.15 input / $0.60 output | BERBAYAR |
| `openai/gpt-oss-20b` | Produksi | $0.075 input / $0.30 output | BERBAYAR |
| `whisper-large-v3` | Produksi | $0.111 per jam | BERBAYAR (ASR) |
| `whisper-large-v3-turbo` | Produksi | $0.04 per jam | BERBAYAR (ASR) |

**Tidak ada model dengan harga $0** dalam dokumentasi resmi. Model-produksi dicantumkan sebagai "ContactSales" yang artinya harga tidak terbuka dan **tidak dapat dikonfirmasi sebagai gratis** dari sumber resmi.

### 3.3 Kompatibilitas adapter

| Aspek | Hasil |
|---|---|
| Style | `openai-compatible` |
| Endpoint | `https://api.groq.com/openai/v1/chat/completions` |
| supportsImages | false (teks saja) |
| verified (spec) | **false** (belum diverifikasi terhadap API nyata) |
| Pipeline P1-P6 | Kompatibel struktural (OpenAI-compatible adapter), tapi perlu 1 request uji untuk verifikasi `spec.verified` |

### 3.4 Kesimpulan Groq

Tidak ada model Groq yang memenuhi syarat VERIFIED_FREE. Semua model ditandai UNVERIFIED (bukti gratis tidak cukup) atau PAID (harga eksplisit non-nol). **Groq tidak boleh dimasukkan ke rantai fallback gratis.**

---

## 4. ATURAN BIAYA (Bagian 3)

Semua aturan dipatuhi:

| Aturan | Implementasi |
|---|---|
| Hanya model terbukti gratis | OpenRouter `:free` (harga 0/0 di katalog resmi) |
| Jangan gunakan model PAID | Model Groq berbayar & Gemini model berpayar dikecualikan |
| Jangan fallback ke berbayar | `filterAllowedModels` hanya izinkan `VERIFIED_FREE`; `shouldTryFallback` berhenti pada 402 (kuota) & 401/403 (auth) |
| Jika akun butuh billing → ACCOUNT_DEPENDENT | Gemini Free Tier ditandai ACCOUNT_DEPENDENT |
| Jika kuota habis → tidak mengeluarkan biaya | 429 → berpindah ke model berikutnya; 402 → hentikan provider itu |
| Jika tidak ada gratis yang memenuhi → laporkan, jangan dipaksa | Groq dilaporkan tidak ada model gratis; tidak dipaksa |

---

## 5. INTEGRASI (Bagian 4)

### 5.1 Prinsip

- OpenRouter yang sudah aktif **pertahankan** (tidak diubah).
- Gemini dan Groq hanya ditambahkan sebagai provider cadangan setelah verifikasi & persetujuan Admin.
- Setiap provider memiliki API Key sendiri & terenkripsi (tidak saling menghapus kunci).
- Hanya satu provider aktif pada satu waktu (partial UNIQUE INDEX `AiProvider_one_active`).

### 5.2 Rencana integrasi (belum dieksekusi)

| Provider | Aksi | Kondisi |
|---|---|---|
| OpenRouter | Tetap aktif (primary + 4 fallback Tahap 8) | Sudah berlaku |
| Gemini | Tambahkan baris AiProvider, isi API Key, pilih model Free Terminus (contoh `gemini-3.5-flash-lite`), tandai ACCOUNT_DEPENDENT | Butuh Admin konfirmasi free tier billing |
| Groq | Tambahkan baris AiProvider, isi API Key, tapi **tidak ada model VERIFIED_FREE** → tidak dapat masuk rantai fallback gratis | Butuh Admin; saat ini tidak disarankan |

### 5.3 Rantai fallback lintas provider (direkomendasikan)

```
1. OpenRouter — nvidia/nemotron-3.5-lightning:free        (utama, VERIFIED_FREE)
2. OpenRouter — nvidia/nemotron-3.5-super-vl:free         (cadangan, VERIFIED_FREE)
3. OpenRouter — google/gemma-4-31b-it:free                (cadangan, VERIFIED_FREE)
4. OpenRouter — thinkingmachines/inkling-2-small:free     (cadangan, VERIFIED_FREE)
5. OpenRouter — baidu/ernie-5.5-flash-preview:free        (cadangan, VERIFIED_FREE)
```

Gemini dapat ditambahkan sebagai cadangan **hanya setelah** Admin:
1. Konfirmasi akun AI Studio masih free tier (belum billing).
2. Verifikasi manual model Gemini (mis. `gemini-3.5-flash-lite`) sebagai ACCOUNT_DEPENDENT.
3. Setuju untuk menyisipkannya ke rantai fallback.

---

## 6. PENGUJIAN (Bagian 5)

### 6.1 Pengujian offline/mock (selesai)

| Tes | Hasil |
|---|---|
| `tests/ai.policy.test.ts` — filter hanya VERIFIED_FREE | 17 skenario lulus |
| `tests/ai.config.test.ts` — konfigurasi + fallback | 42 tes lulus |
| `tests/ai.config.security.test.ts` — keamanan | 8 tes lulus |
| `tests/ai.catalog.test.ts` (baru Tahap 7) — katalog & verifikasi manual | 27 tes lulus |
| Regresi keseluruhan (41 file) | 763 lulus, 2 gagal pre-existing |
| TypeScript `src/` | 0 error |
| ESLint | 0 error |
| `next build` | exit 0 |

### 6.2 Pengujian API nyata (BELUM — menunggu persetujuan)

Belum dilakukan karena:
- Belum ada persetujuan eksplisit dari Admin.
- Gemini: perlu ganti model primary dulu (deprecated).
- Groq: perlu isi API Key terlebih dahulu.

Persetujuan diperlukan untuk:
1. Satu request teks sederhana ke model utama OpenRouter (jika belum dilakukan Tahap 8).
2. Satu request ke model Gemini (setiap model yang dipilih Admin).
3. Satu request ke Groq (hanya jika Admin tetap ingin mencoba, meski tidak ada model gratis).

---

## 7. PERUBAHAN YANG DIPERLUKAN (belum dieksekusi)

| # | Perubahan | Alasan | Butuh Persetujuan |
|---|---|---|---|
| 1 | Ganti primary Gemini dari `gemini-2.5-flash` (deprecated, 404) ke model yang tersedia (contoh `gemini-3.5-flash-lite`) | Model lama tidak tersedia | Ya |
| 2 | Perbarui fallback Gemini (`gemini-2.5-flash-lite`, `gemini-flash-latest`) ke model saat ini | Model lama mungkin tidak tersedia | Ya |
| 3 | Tambah baris AiProvider Groq + isi API Key | Groq belum dikonfigurasi | Ya |
| 4 | Tambah status `ACCOUNT_DEPENDENT` ke tipe `FreeStatus` di `aiModelPolicy.ts` | Mendukung Gemini Free Tier bergantung akun | Ya (perubahan kode) |
| 5 | Verifikasi manual model Gemini dengan bukti dokumentasi harga resmi | Bukti gratis tidak otomatis | Ya |
| 6 | Sisipkan Gemini ke rantai fallback (jika Admin setuju) | Integrasi lintas provider | Ya |

---

## 8. DAFTAR TINDAKAN MENUNGGUI PERSETUJUAN ADMIN

| # | Tindakan | Detail |
|---|---|---|
| 1 | Setuju rencana integrasi Gemini + Groq | Pertahankan OpenRouter aktif; tambahkan Gemini & Groq sebagai cadangan |
| 2 | Isi `APP_ENCRYPTION_KEY` (jika belum) & restart | Sudah ada di `.env`; perlu divalidasi di proses env |
| 3 | Isi API Key Gemini & Groq melalui `/admin/ai-config` | Tersimpan terenkripsi, tidak dicetak |
| 4 | Konfirmasi akun Google AI Studio masih free tier (belum billing) | Untuk menandai Gemini ACCOUNT_DEPENDENT |
| 5 | Verifikasi manual model Gemini (dokumentasi resmi) | Isi URL `https://ai.google.dev/gemini-api/docs/pricing` + catatan tier akun |
| 6 | Ganti primary Gemini dari `gemini-2.5-flash` ke model yang tersedia | Model deprecated tidak tersedia |
| 7 | Uji koneksi (1 request teks sederhana) per provider | Setelah disetujui, tanpa mencetak secret |
| 8 | Aktifkan provider cadangan (jika lolos uji) | Hanya setelah persetujuan Admin |

---

## 8. KENDALA & SARAN

1. **Gemini model primary deprecated.** `gemini-2.5-flash` sudah tidak tersedia (404). Harus diganti sebelum Gemini dapat digunakan.
2. **Tidak ada model Groq gratis terverifikasi.** Dokumentasi resmi tidak mencantumkan harga $0. Jika Admin tetap ingin mencoba Groq, perlu API Key dan 1 request uji, namun model tidak boleh masuk rantai fallback gratis.
3. **`ACCOUNT_DEPENDENT` belum ada di kode.** Tipe `FreeStatus` saat ini hanya punya 3 nilai (`VERIFIED_FREE`, `UNVERIFIED`, `PAID`). Perlu penambahan nilai agar Gemini Free Tier dapat tercermin dengan jujur.
4. **OpenRouter `lastError=AI_PROVIDER_ERROR`** pada uji terakhir (HTTP 200 tanpa teks terbaca). Perbaikan `extractTextContent` (Tahap 6) sudah diimplementasikan untuk menangani bentuk respons variatif, perlu diuji kembali setelah aktivasi.

---

## 9. LAPORAN AKHIR TERAJAP

Dokumen ini adalah laporan Tahap 9. Tidak ada konfigurasi aktif yang diubah, tidak ada request API nyata yang dilakukan, dan tidak ada WhatsApp dikirim. Aktivasi Gemini & Groq menunggu persetujuan Admin berdasarkan daftar tindakan di Bagian 8.

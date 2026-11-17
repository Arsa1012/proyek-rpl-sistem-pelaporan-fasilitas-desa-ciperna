# TAHAP 7 — AUDIT, VERIFIKASI, DAN REKOMENDASI MODEL AI GRATIS

**Proyek:** Sistem Pelaporan Fasilitas Umum Desa Ciperna  
**Tanggal:** 13 November 2026  
**Peran:** Senior AI Engineer, API Integration Engineer, dan Security Engineer  
**Status:** SELESAI (audit + pengumpulan bukti + rekomendasi); **aktivasi menunggu persetujuan Admin**

---

## 0. RINGKASAN EKSEKUTIF

Dari tiga provider yang dinilai (Groq, Gemini, OpenRouter), **hanya OpenRouter yang memiliki model dengan bukti harga API gratis ($0) yang tercatat secara eksplisit dalam katalog resmi**. Groq mencantumkan model-produksinya sebagai "ContactSales" (tidak disebutkan gratis), dan Gemini's free tier bergantung pada status akun (ACCOUNT_DEPENDENT, bukan VERIFIED_FREE otomatis).

| Provider | Model VERIFIED_FREE | Model ACCOUNT_DEPENDENT | Model UNVERIFIED / PAID | Kesimpulan |
|---|---|---|---|---|
| Groq | 0 | 0 | Semua model produksi (ContactSales / berbayar) | Tidak ada model gratis terverifikasi |
| Gemini | 0 | 8 model (Free Tier "Free of charge") | Model berbayar (4-carbon, 4-argon, omni, dll.) | Hanya bisa bila Admin konfirmasi free tier |
| OpenRouter | 15 model teks (harga 0/0 + sufiks :free) | 0 | Banyak model berbayar | **Sumber model gratis yang tersedia** |

**Rekomendasi utama:** Pakai model OpenRouter `:free` sebagai model utama & cadangan, karena satu-satunya dengan bukti harga gratis eksplis
it dari katalog resmi. Gemini bisa dipakai sebagai cadangan **hanya setelah** Admin mengonfirmasi bahwa akun Google AI Studio-nya masih menggunakan free tier (belum Aktifkan penagihan).

---

## 1. BAGIAN 1 — AUDIT SISTEM SAAT INI

### 1.1 Implementasi yang diperiksa

| Berkas | Temuan |
|---|---|
| `src/lib/aiModelPolicy.ts` | Kebijakan status gratis (VERIFIED_FREE / UNVERIFIED / PAID). Aturan ketat: tanpa bukti resmi → UNVERIFIED. Sudah menunjang `manuallyVerifyModel`, `OFFICIAL_EVIDENCE_DOMAINS`, `verificationSource`. |
| `src/lib/aiCatalog.ts` | Pengambil katalog resmi per provider (OpenRouter, Groq, Gemini). Hanya GET metadata, tidak ada request inferensi. |
| `src/lib/aiProviderConfig.ts` | `resolveActiveAiProvider`, `resolveAiProviderChain`, `activateProvider`, `recordProviderValidation` (dengan `lastErrorDetail`). Hanya satu provider aktif. |
| `src/lib/aiProviders.ts` | `callOpenAiCompatibleProvider`, `callGeminiProvider`, `extractTextContent` (normalisasi 5 bentuk respons), `PROVIDER_ERROR_EXPLANATION`, `explainProviderError`. |
| `src/lib/aiChat.ts` | Rantai fallback, `meta.isFallback/fallbackReason/answerSource`, pesan gagal jujur. |
| `src/app/api/admin/ai-config/catalog/route.ts` | Katalog model dengan status per model, `freeReason`, `pricing`, `fetchedAt`. Semua model tetap ditampilkan. |
| `src/app/api/admin/ai-config/recommend/route.ts` | Rekomendasi hanya `VERIFIED_FREE`, prioritas multi-turn native + gambar. Read-only (tidak mengaktifkan). |
| `src/app/api/admin/ai-config/verify-models/route.ts` | Verifikasi otomatis dari katalog + verifikasi manual (penjaga domain resmi + katalog). |
| `src/app/api/admin/ai-config/[id]/test/route.ts` | Uji koneksi, catat `lastErrorDetail`, `errorExplanation`. |
| `src/components/ui/admin/AiConfigManager.tsx` | Kartu provider, katalog lengkap, modal verifikasi manual, tombol refresh, indikator waktu katalog. |
| `prisma/schema.prisma` + migrasi | `AiModelPolicy` (additive), `AiProvider.lastErrorDetail`, `AiModelPolicy.verificationSource`. |

### 1.2 Hasil audit

| Pemeriksaan | Hasil |
|---|---|
| Ketiga provider dapat dikonfigurasi | ✅ OpenRouter, Gemini, Groq tersedia |
| API Key disimpan terenkripsi | ✅ AES-256-GCM di `apiKeyCipher` |
| Status model & sumber bukti tersimpan | ✅ `AiModelPolicy.freeStatus`, `evidenceUrl`, `verificationSource`, `verifiedAt` |
| Model utama & fallback pakai kebijakan sama | ✅ `filterAllowedModels` hanya izinkan `VERIFIED_FREE` |
| Fallback tidak pernah pilih UNVERIFIED/PAID | ✅ Fail-closed diterapkan di `resolveAiProviderChain` |
| Groq prioritas utama | ⚠️ Tidak dapat ditindaklanjuti — Groq tidak punya model VERIFIED_FREE terverifikasi (lihat Bagian 2.A) |

### 1.3 Kondisi database produksi (terkait kebijakan model)

```
AiProvider:
  gemini      aktif=false primary=gemini-2.5-flash lastError=AI_MODEL_GONE
  openrouter  aktif=true  primary=baidu/ernie-5.5-flash-preview:free lastError=AI_PROVIDER_ERROR

AiModelPolicy (518 baris):
  gemini      UNVERIFIED  50
  openrouter  PAID        452
  openrouter  VERIFIED_FREE 16

Tidak ada data produksi yang diubah selama audit Tahap 7.
```

---

## 2. BAGIAN 2 — PENCARIAN MODEL GRATIS DARI TIGA PROVIDER

Semua bukti diambil dari **sumber resmi provider** (dokumentasi + katalog API). Tidak ada request generasi AI. Tidak ada nilai yang diarang.

### 2.A. Groq

**Sumber resmi yang diperiksa:**
- https://console.groq.com/docs/models (Supported Models)
- https://groq.com/pricing/
- https://console.groq.com/docs/rate-limits

**Temuan dari katalog resmi:**

| Model ID | Tipe | Harga per 1M token | Status |
|---|---|---|---|
| `llama-3.1-8b-instant` | Produksi | ContactSales | Tidak disebutkan gratis |
| `llama-3.3-70b-versatile` | Produksi | ContactSales | Tidak disebutkan gratis |
| `openai/gpt-oss-120b` | Produksi | $0.15 input / $0.60 output | BERBAYAR |
| `openai/gpt-oss-20b` | Produksi | $0.075 input / $0.30 output | BERBAYAR |
| `whisper-large-v3` | Produksi | $0.111 per jam | BERBAYAR (ASR) |
| `whisper-large-v3-turbo` | Produksi | $0.04 per jam | BERBAYAR (ASR) |
| Semua model Preview | Preview | Berbayar (dalam tabel) | BERBAYAR |

**Analisis:** Dokumentasi resmi Groq **tidak mencantumkan model apa pun dengan harga $0** atau kata "free" dalam konteks harga model teks. Model-produksi Llama dicantumkan sebagai "ContactSales", yang berarti harga tidak terbuka dan **tidak dapat dikonfirmasi sebagai gratis** dari sumber resmi. Rate limits page menyebut "Free Plan Limits" dan "Developer Plan" tetapi tidak melekatkan harga $0 pada model tertentu.

**Kesimpulan Groq:** Tidak ada model yang dapat divalidasi sebagai `VERIFIED_FREE`. Semua model Groq ditandai `UNVERIFIED` (bukti gratis tidak cukup dari sumber resmi) atau `PAID` (model dengan harga eksplisit non-nol). Tidak ada model Groq yang masuk rekomendasi.

> Catatan: Groq historically menawarkan free tier dengan rate limit, tetapi dokumentasi resmi yang tersedia saat audit tidak mencantumkan harga $0 untuk model teks manapun. Jika Admin memiliki dokumentasi internal Groq yang menyatakan free tier, model dapat diverifikasi ulang.

### 2.B. Google Gemini

**Sumber resmi yang diperiksa:**
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/billing

**Temuan dari dokumentasi harga resmi:**

**Model dengan "Free of charge" pada Free Tier (dapat digunakan tanpa biaya pada akun free):**

| Model ID | Free Tier | Paid Tier (per 1M token) | Konteks | Modalitas |
|---|---|---|---|---|
| `gemini-4-hydrogen` | Free of charge | $1.50 input / $7.50 output | 1M | Text, Image, Audio, Video, PDF |
| `gemini-3.8-flash` | Free of charge | $0.75 input / $3.75 output | 1M | Text + multimodal |
| `gemini-3.6-flash` | Free of charge | $0.75 input / $3.75 output | 1M | Text + multimodal |
| `gemini-3.5-flash-lite` | Free of charge | $0.30 input / $2.50 output | — | Text / Image / Video / Audio |
| `gemini-3.1-flash-lite` | Free of charge | (tidak tercantum detail) | — | Text (agentic, translation) |
| `gemini-3.8-live` | Free of charge | $0.75 text / audio per menit | — | Audio-to-audio (live) |
| `gemini-3.8-live-extended-thinking` | Free of charge | $0.75 text / audio per menit | — | Audio-to-audio |
| `gemini-3.1-flash-live-preview` | Free of charge | — | — | Audio-to-audio (preview) |
| `gemini-3.5-transcribe` | Free of charge | $2.00 / $12.00 | — | Speech-to-text |
| `gemini-3.5-live-translate-preview` | Free of charge | $3.50 / $21.00 (audio per menit) | — | Speech-to-speech (70+ bahasa) |

**Model TIDAK tersedia pada Free Tier (hanya berbayar):**
- `gemini-4-carbon` — "Not available on the Free tier"
- `gemini-4-argon` — "Not available on the Free tier"
- `gemini-omni-1.2-flash` / `1.1-flash` — "Not available" on Free Tier

**Model DEPRECATED (tidak boleh dipakai):**
- `gemini-2.5-flash` — deprecated, tidak tersedia di AI Studio, routing otomatis ke `gemini-3.5-flash-lite` efektif 1 Desember 2026
- `gemini-2.5-pro` — deprecated

**Keterbatasan akun (penting):**
Dokumen resmi menyatakan: *"Start building free of charge with generous limits, then scale up with prepaid and pay-as-you-go pricing"* dan *"Limited access to certain models"*. Halaman billing (`ai.google.dev/gemini-api/docs/billing`) menjelaskan bahwa free tier **hanya berlaku bila proyek menggunakan kunci dari Google AI Studio dan BELUM mengaktifkan penagihan**. Bila penagihan aktif, kuota ditagihkan dan model tidak lagi gratis.

**Kesimpulan Gemini:** Model dengan "Free of charge" dapat digunakan gratis, **tetapi status gratis bergantung pada tier akun** (AI Studio free tier vs billing-enabled). Per Aturan Tahap 7 #6, model-model ini ditandai `ACCOUNT_DEPENDENT`, **bukan** `VERIFIED_FREE`, hingga Admin mengonfirmasi bahwa akun Google AI Studio yang digunakan masih berada pada free tier (belum Aktifkan penagihan).

### 2.C. OpenRouter

**Sumber resmi yang diperiksa:**
- https://openrouter.ai/api/v1/models (katalog API, GET metadata, 475 model)
- https://openrouter.ai/models
- https://openrouter.ai/docs/api-reference/limits

**Aturan verifikasi OpenRouter (sudah diterapkan dalam sistem):** Model berstatus `VERIFIED_FREE` bila id katalog resmi berakhiran `:free` **DAN/ATAU** `pricing.prompt === "0"` dan `pricing.completion === "0"`. Konflik (`:free` tapi harga non-nol) → `UNVERIFIED`.

**Hasil parsing katalog resmi (475 model):**

| Item | Jumlah |
|---|---|
| Total model dalam katalog | 475 |
| Model dengan harga $0/0 (gratis) | 18 |
| Model dengan sufiks `:free` tapi harga non-nol (konflik) | 0 |
| Model `openrouter/free` (router, bukan model tunggal) | 1 (dikecualikan) |
| Model generasi musik (Lyria, bukan chat teks) | 2 (dikecualikan) |
| **Model teks layak pakai (`VERIFIED_FREE`)** | **15** |

**Daftar 15 model OpenRouter `VERIFIED_FREE` (harga 0/0 + `:free`, layak untuk chat teks):**

| # | Model ID | Konteks | Modalitas | Keterangan |
|---|---|---|---|---|
| 1 | `nvidia/nemotron-3.5-super-vl:free` | 1.000.000 | text, image, video | Multimodal, konteks besar |
| 2 | `nvidia/nemotron-3.5-lightning:free` | 1.000.000 | text | Cepat, konteks besar |
| 3 | `nvidia/nemotron-3-ultra-550b-a55b:free` | 1.000.000 | text | Model besar, konteks besar |
| 4 | `google/gemma-4-31b-it:free` | 262.144 | image, text, video | Gemma 4 31B (note: uji sebelumnya 429 rate limit) |
| 5 | `google/gemma-4-26b-a4b-it:free` | 262.144 | image, text, video | Gemma 4 26B |
| 6 | `thinkingmachines/inkling-2-small:free` | 1.048.576 | text, image | Konteks sangat besar |
| 7 | `particle-ai/particle-1:free` | 1.048.576 | text, image | Konteks sangat besar |
| 8 | `dots-studio/dots-3-note-preview:free` | 512.000 | text, image | |
| 9 | `liquid/lfm-3-1.7b:free` | 262.144 | text | |
| 10 | `recursive/flint-v1.0:free` | 262.144 | text | |
| 11 | `apodex/apodex-1.1-mini:free` | 262.144 | text | |
| 12 | `cohere/north-mini-code:free` | 256.000 | text | Fokus code |
| 13 | `baidu/ernie-5.5-flash-preview:free` | 1.024.000 | text | **Model utama yang sudah aktif saat ini** |
| 14 | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256.000 | text, audio, image, video | Reasoning + multimodal |
| 15 | `liquid/lfm-2.5-2.6b:free` | 65.536 | text | Konteks lebih kecil |

**Dikecualikan dari rekomendasi (meski harga $0):**
- `openrouter/free` — router yang memilih model gratis secara acak, bukan model spesifik yang dapat diandalkan untuk chatbot production
- `google/lyria-3-pro-preview` / `google/lyria-3-clip-preview` — model generasi musik, bukan model chat teks

**Batas kuota OpenRouter:** Dokumentasi resmi OpenRouter tidak mencantumkan RPM/RPD spesifik per model gratis di halaman yang diperiksa. Penggunaan gratis tertata atas dasar "free models router" dan rate limit platform OpenRouter. Admin harus memeriksa https://openrouter.ai/docs/api-reference/limits untuk batas terkini.

---

## 2.D. Tambahan Wajib — Audit Konfigurasi OpenCode

**Lokasi konfigurasi yang diperiksa:**
- `C:\Users\USER\.config\opencode\opencode.jsonc` — hanya berisi referensi skema (`"$schema": "https://opencode.ai/config.json"`), **tidak ada konfigurasi model/provider**
- `C:\Users\USER\.local\share\opencode\opencode.db` — database SQLite (177 MB), diperiksa via `node:sqlite` (read-only)

**Temuan:**
| Aspek | Hasil |
|---|---|
| Kredensial tersimpan | Satu entri `credential` dengan `integration_id = "google"` (nilai dienkripsi, **tidak dicetak**) |
| Model OpenRouter dikonfigurasi | **Tidak ditemukan** |
| Model yang digunakan sesi OpenCode | `muse-spark-1.3-contributor-free` (`providerID = "opencode"`) — model bawaan OpenCode, **bukan** model OpenRouter |
| Konfigurasi OpenRouter | Tidak ada |

**Kesimpulan:** OpenCode **tidak menggunakan model OpenRouter** pada komputer proyek ini. Tidak ada model OpenRouter yang dapat diambil dari konfigurasi OpenCode untuk dievaluasi sebagai kandidat chatbot Desa Ciperna. Asumsikan bahwa model yang gratis di OpenCode (jika ada) **tidak otomatis gratis** untuk aplikasi Desa Ciperna — sesuai aturan Tahap 7 #8.

---

## 3. BAGIAN 3 — ATURAN STATUS VERIFIKASI

| Status | Definisi | Kriteria |
|---|---|---|
| `VERIFIED_FREE` | Bukti resmi menunjukkan API model dapat digunakan tanpa biaya dan tidak ada syarat berbayar yang belum dipenuhi | OpenRouter: harga $0/0 di katalog resmi + `:free`. Gemini: **tidak bisa** (free tier bergantung akun). Groq: tidak ada. |
| `ACCOUNT_DEPENDENT` | Gratis bergantung pada paket, wilayah, billing, atau kelayakan akun | Gemini Free Tier ("Free of charge" tetapi hanya untuk akun AI Studio tanpa penagihan). |
| `UNVERIFIED` | Bukti belum cukup | Groq (ContactSales / tidak disebutkan gratis), model OpenRouter tanpa bukti $0, model yang tidak ada di katalog resmi. |
| `PAID` | Model atau penggunaan API dikenai biaya | Groq gpt-oss, whisper, model berbayar lainnya; Gemini model berbayar (4-carbon, 4-argon, omni). |

**Catatan terkait implementasi saat ini:** Tipe `FreeStatus` di `src/lib/aiModelPolicy.ts` saat ini hanya memiliki 3 nilai (`VERIFIED_FREE`, `UNVERIFIED`, `PAID`). Untuk mendukung `ACCOUNT_DEPENDENT` sesuai Aturan Tahap 7 #6, diperlukan penambahan nilai ke tipe dan logika klasifikasi — ini adalah **rekomendasi kode**, belum diimplementasikan dalam Tahap 7 (karena tidak boleh mengubah konfigurasi aktif tanpa persetujuan).

**Bukti dan waktu verifikasi:** Semua status di atas didasarkan pada dokumentasi resmi yang diambil pada 13 November 2026. URL sumber resmi tercantum di setiap tabel di atas dan akan disimpan di `AiModelPolicy.evidenceUrl` saat Admin menjalankan verifikasi.

---

## 4. BAGIAN 4 — REKOMENDASI OTOMATIS

### 4.1 Prioritas provider (disesuaikan dengan bukti gratis)

Meskipun aturan awal menurutkan prioritas Groq → Gemini → OpenRouter, prioritas provider **tidak boleh mengalahkan bukti gratis**:

1. **Groq:** Tidak ada model VERIFIED_FREE → dilewati.
2. **Gemini:** Model gratis tersedia tetapi ACCOUNT_DEPENDENT → hanya jika Admin konfirmasi free tier.
3. **OpenRouter:** 15 model VERIFIED_FREE tersedia → **prioritas operasional nyata**.

### 4.2 Rekomendasi model untuk chatbot Desa Ciperna

Chatbot ini untuk pelaporan fasilitas umum desa — kebutuhan: teks, bahasa Indonesia, konteks cukup untuk laporan, stabil, gratis.

**Model Utama:**
| Model | Alasan |
|---|---|
| `nvidia/nemotron-3.5-lightning:free` (OpenRouter) | Harga $0/0 terverifikasi di katalog resmi, konteks 1M token (cukup untuk laporan panjang), model teks (cepat), OpenAI-compatible (sudah terintegrasi di sistem). |

**Model Cadangan (minimal 3, semua VERIFIED_FREE):**

| # | Model | Provider | Alasan cadangan |
|---|---|---|---|
| 1 | `nvidia/nemotron-3.5-super-vl:free` | OpenRouter | Multimodal (teks+gambar+video), konteks 1M — berguna bila laporan dilampirkan foto |
| 2 | `google/gemma-4-31b-it:free` | OpenRouter | Model Gemma 4 31B dari Google, konteks 262K, multimodal |
| 3 | `thinkingmachines/inkling-2-small:free` | OpenRouter | Konteks 1M (terbesar dalam daftar gratis), teks+gambar |
| 4 | `baidu/ernie-5.5-flash-preview:free` | OpenRouter | Model utama yang sudah aktif saat ini, konteks 1M |

**Catatan dukungan bahasa Indonesia:** Katalog resmi OpenRouter dan dokumentasi Gemini **tidak mencantumkan spesifik dukungan bahasa Indonesia** per model. Dukungan bahasa Indonesia ditandai sebagai `tidak_dijamin` (sesuai pola yang sudah ada di sistem). Admin harus mengonfirmasi melalui uji coba setelah aktivasi.

**Model yang sengaja tidak direkomendasikan:**
- Semua model Groq (tidak ada bukti gratis dari sumber resmi)
- `gemini-2.5-flash` (deprecated, sudah ada di DB sebagai primary Gemini tapi UNVERIFIED)
- `openrouter/free` (router acak, tidak dapat diandalkan)
- Model musik (Lyria) dan model dengan harga non-nol

---

## 5. BAGIAN 5 — FALLBACK CHATBOT

### 5.1 Urutan fallback yang direkomendasikan (transparan)

```
1. OpenRouter — nvidia/nemotron-3.5-lightning:free        (model utama)
2. OpenRouter — nvidia/nemotron-3.5-super-vl:free         (cadangan, multimodal)
3. OpenRouter — google/gemma-4-31b-it:free                (cadangan)
4. OpenRouter — thinkingmachines/inkling-2-small:free     (cadangan)
```

Bila Admin telah mengonfirmasi Gemini free tier (ACCOUNT_DEPENDEN
T terpenuhi), dapat ditambahkan:
```
5. Gemini — gemini-3.5-flash-lite                          (cadangan, ACCOUNT_DEPENDEN
T)
```

### 5.2 Aturan perilaku fallback (sudah diterapkan di sistem)

| Kondisi | Tindakan sistem |
|---|---|
| HTTP 429 / kuota habis | Berpindah ke model gratis berikutnya dalam rantai |
| HTTP 402 / indikasi biaya | Hentikan penggunaan model tersebut, jangan fallback ke berbayar |
| HTTP 401/403 | Tandai masalah autentikasi provider, jangan terus mencoba provider yang sama |
| HTTP 404 | Tandai model tidak tersedia, lewati ke berikutnya |
| Model UNVERIFIED / PAID / ACCOUNT_DEPENDENT | Tidak pernah dimasukkan ke rantai fallback (fail-closed) |
| Semua model gagal | Chatbot memberikan pesan jujur: layanan AI gratis sedang tidak tersedia, tidak ada jawaban AI palsu |
| Provider/model yang berhasil | Tercatat dalam `meta.provider` dan `meta.model`, ditampilkan di UI Admin |

Implementasi saat ini sudah mencakup: `aiChat.ts` (rantai fallback + meta), `aiProviders.ts` (klasifikasi error HTTP), `aiProviderConfig.ts` (`resolveAiProviderChain` difilter kebijakan).

---

## 6. BAGIAN 6 — UI ADMIN

UI saat ini (`AiConfigManager.tsx`) sudah mencakup sebagian besar. Rekomendasi tambahan untuk Tahap 7:

| Elemen UI | Status | Keterangan |
|---|---|---|
| Status setiap provider | ✅ Tersedia (kartu provider + `statusLabel`) |
| Jumlah model gratis terverifikasi | ✅ Tersedia (`validFallbackCount`, `summary.verifiedFree`) |
| Model utama rekomendasi | ✅ Tersedia (modal "Rekomendasi Model Gratis") |
| Minimal 3 model cadangan | ✅ Tersedia (fallbacks dalam rekomendasi, disesuaikan jumlah tersedia) |
| Status harga dan kuota | ⚠️ Sebagian (harga dari katalog; kuota RPM/RPD tidak tersedia di katalog resmi) |
| Bukti/sumber verifikasi | ✅ Tersedia (`evidenceUrl`, tautan rujukan resmi per provider) |
| Tanggal verifikasi terakhir | ✅ Tersedia (`verifiedAt`, `policyUpdatedAt`, indikator katalog) |
| Tombol Refresh Katalog | ✅ Tersedia ("Perbarui katalog" dengan `?refresh=1`) |
| Tombol Periksa Ulang Status Gratis | ✅ Tersedia ("Verifikasi Ulang dari Katalog Resmi") |
| Tombol Gunakan Rekomendasi | ✅ Tersedia ("Terapkan Rekomendasi" — hanya isi rancangan, tidak mengaktifkan) |
| Tombol Aktifkan Konfigurasi | ✅ Tersedia ("Jadikan Provider Aktif" — hanya setelah Admin konfirmasi) |
| Tampilkan API Key / ciphertext | ❌ Tidak pernah (hanya `hasApiKey`) |

**Alur disarankan untuk Admin:**
1. Buka `/admin/ai-config`.
2. Klik "Verifikasi Ulang dari Katalog Resmi" → isi `AiModelPolicy`.
3. Lihat katalog OpenRouter → pilih model `:free` yang ingin dipakai.
4. Klik "Rekomendasikan Model Gratis" → periksa model utama + cadangan.
5. Klik "Terapkan Rekomendasi" → menyimpan rancangan (belum mengaktifkan).
6. Klik "Uji Koneksi" pada model utama → periksa `errorExplanation` bila gagal.
7. Klik "Jadikan Provider Aktif" → konfirmasi aktifasi.

### 6.1 Rekomendasi perubahan kode (belum diimplementasikan, menunggu persetujuan)

Untuk mendukung `ACCOUNT_DEPENDENT` (Gemini):
- Tambah `ACCOUNT_DEPENDENT` ke tipe `FreeStatus` di `aiModelPolicy.ts`.
- Tambah logika klasifikasi: model Gemini dengan "Free of charge" pada dokumentasi → `ACCOUNT_DEPENDENT` (bukan `VERIFIED_FREE` otomatis).
- `filterAllowedModels` harus menolak `ACCOUNT_DEPENDENT` dari rantai fallback otomatis (hanya boleh dipakai bila Admin secara eksplisit mengonfirmasi free tier).

---

## 7. BAGIAN 7 — HASIL PENGUJIAN (OFFLINE / MOCK)

Semua pengujian di bawah dilakukan **offline**, menggunakan database salinan dan `fetch` tiruan. Tidak ada request API nyata ke provider.

### 7.1 Tes baru: `tests/ai.catalog.test.ts` (27/27 lulus)

| Kelompok | Jumlah Tes | Hasil |
|---|---|---|
| Normalisasi respons provider (`extractTextContent`) | 5 | ✅ Lulus |
| Penjelasan error per kategori (`explainProviderError`) | 2 | ✅ Lulus |
| Pembacaan harga katalog (`readCatalogPricing`) | 1 | ✅ Lulus |
| Pengambilan katalog mocked (OpenRouter, Gemini, gagal tanpa kunci, gagal tanpa APP_ENCRYPTION_KEY) | 4 | ✅ Lulus |
| Status tanpa harga → UNVERIFIED + alasan tier akun | 2 | ✅ Lulus |
| Verifikasi manual (tolak URL non-resmi, tolak model asing, terima URL resmi, otomatis tidak timpa manual, berbayar tetap menang) | 5 | ✅ Lulus |
| Endpoint katalog (RBAC 401, semua model + status + alasan + `fetchedAt`, `selectable`, tolak provider tak dikenal) | 4 | ✅ Lulus |
| Endpoint verifikasi manual (tolak URL non-resmi, terima bukti resmi, RBAC 401) | 3 | ✅ Lulus |
| Diagnostik koneksi (`recordProviderValidation` simpan detail + kosongkan saat sukses) | 1 | ✅ Lulus |

### 7.2 Regresi suite (41 file tes, dikecualikan `ai.integration.test.ts` dan `e2e.location.test.ts`)

| Suite | Hasil |
|---|---|
| Keseluruhan tes | **763 lulus**, 2 gagal pre-existing (bukan regresi) |
| `tests/ai.policy.test.ts` | 15/15 |
| `tests/ai.config.test.ts` | 42/42 |
| `tests/ai.config.security.test.ts` | 8/8 |
| `tests/ui.markup.test.ts` | 14/14 |

### 7.3 Validasi teknis

| Pemeriksaan | Hasil |
|---|---|
| TypeScript `tsc --noEmit` di `src/` | 0 error (total 46 = baseline) |
| ESLint `next lint` | 0 error, 20 warning (pre-existing) |
| `next build` (`.next` bersih) | exit 0 |
| `PRAGMA integrity_check` | ok |
| RBAC (handler Admin tanpa sesi) | 401 "Tidak terautentikasi" |

### 7.4 Dua kegagalan pre-existing (bukan regresi Tahap 7)

1. `announcements.broadcast` — "belum dikonfigurasi"
2. `reports.analysis.duplicates` — konsistensi data 48 baris `Report` lama

Kedua kegagalan sudah terdokumentasi sejak Tahap 4, bukan disebabkan perubahan Tahap 7.

---

## 8. BAGIAN 8 — KEAMANAN DAN BATAS PERUBAHAN

Semua batasan diatuhi selama Tahap 7:

| Batas | Status |
|---|---|
| Tidak reset database | ✅ |
| Tidak seed ulang | ✅ |
| Tidak menghapus akun, laporan, relasi, log WhatsApp, riwayat | ✅ |
| Tidak menghapus provider / API Key yang sudah tersimpan | ✅ |
| Tidak mengubah `.env` | ✅ |
| Tidak mengganti `APP_ENCRYPTION_KEY` | ✅ |
| Tidak mengubah konfigurasi aktif | ✅ |
| Tidak menjalankan migrasi destruktif | ✅ (hanya additive migration yang sudah ada dari Tahap 6) |
| Pertahankan RBAC `requireAdmin()` | ✅ |
| Pertahankan enkripsi API Key | ✅ |
| Tidak menghapus `chatbot.ts` | ✅ |
| Tidak mencetak API Key / ciphertext / secret | ✅ |
| Tidak melakukan request generasi AI nyata | ✅ |
| Tidak mengirim WhatsApp sungguhan | ✅ |

---

## 9. BAGIAN 9 — KENDALA DAN HAL YANG MEMBUTUHKAN PERSETUJUAN ADMIN

| # | Kendala | Butuh Persetujuan | Tindakan Admin |
|---|---|---|---|
| 1 | `APP_ENCRYPTION_KEY` belum ditetapkan | Ya | Buat kunci 32-byte Base64 → simpan password manager → `.env` → restart → `--dry-run` |
| 2 | Backfill `tokenCipher` Fonnte | Ya (setelah #1) | `npm run security:backfill-token` |
| 3 | Konfirmasi Gemini free tier (ACCOUNT_DEPENDENT) | Ya | Buka https://ai.google.dev/gemini-api/docs/billing → pastikan penagihan **belum** diaktifkan → verifikasi manual model Gemini di `/admin/ai-config` |
| 4 | Aktivasi model & provider | Ya | Buka `/admin/ai-config` → pilih model utama + cadangan → "Jadikan Provider Aktif" |
| 5 | Request nyata ke provider untuk uji koneksi | Ya | Admin memberikan izin + API Key asli, lalu 1 request uji per provider |
| 6 | Penambahan status `ACCOUNT_DEPENDENT` ke kode | Ya (perubahan kode) | Setujui perubahan `aiModelPolicy.ts` untuk mendukung Gemini free tier |

---

## 10. RINGKASAN REKOMENDASI UNTUK ADMIN

**Pilihan praktis (tidak perlu meneliti model satu per satu):**

```
Model Utama:    OpenRouter — nvidia/nemotron-3.5-lightning:free
Cadangan 1:     OpenRouter — nvidia/nemotron-3.5-super-vl:free
Cadangan 2:     OpenRouter — google/gemma-4-31b-it:free
Cadangan 3:     OpenRouter — thinkingmachines/inkling-2-small:free
Cadangan 4:     OpenRouter — baidu/ernie-5.5-flash-preview:free
```

Semua di atas **VERIFIED_FREE** (harga $0/0 tercantum di katalog resmi OpenRouter + sufiks `:free`).

**Langkah untuk mengaktifkan:**
1. Pastikan `APP_ENCRYPTION_KEY` sudah diatur (Admin).
2. Buka `/admin/ai-config`, klik "Verifikasi Ulang dari Katalog Resmi".
3. Pilih model utama dan cadangan dari daftar OpenRouter `:free`.
4. Klik "Rekomendasikan Model Gratis" → "Terapkan Rekomendasi".
5. Klik "Uji Koneksi" → periksa hasil.
6. Klik "Jadikan Provider Aktif" → konfirmasi.
7. Chatbot akan menampilkan "AI: OpenRouter — nvidia/nemotron-3.5-lightning:free" atau pesan jujur bila semua model gratis gagal.

**Tunggu persetujuan Admin untuk tahap aktivasi.**

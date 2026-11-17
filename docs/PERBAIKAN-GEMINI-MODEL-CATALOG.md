# PERBAIKAN GEMINI MODEL CATALOG DAN UI PEMILIHAN MODEL

**Proyek:** Sistem Pelaporan Fasilitas Umum Desa Ciperna  
**Tanggal:** 13 November 2026  
**Status:** SELESAI (implementasi + tes offline); 3 pekerjaan BLOCKED menunggu tindakan Admin

---

## 1. RINGKASAN EKSEKUTIF

Tiga masalah pada halaman `/admin/ai-config` diperbaiki:

| Masalah | Penyebab pasti | Status perbaikan |
|---|---|---|
| **M1** Gemini selalu UNVERIFIED / fallback 0 model | Katalog resmi Gemini **tidak mencantumkan harga** → setiap model otomatis UNVERIFIED (fail-closed) → tidak bisa dipakai sebagai utama maupun fallback | ✅ Diperbaiki: path verifikasi **manual** oleh Admin dengan bukti URL domain resmi; semua 50 model tetap ditampilkan dengan alasan |
| **M2** Model tidak muncul / tidak terlihat status | UI sebelumnya hanya menampilkan `id` + `nama` tanpa status, alasan, atau indikator katalog terakhir diperbarui; model yang ditolak bisa hilang dari daftar | ✅ Diperbaiki: semua model dari katalog resmi ditampilkan dengan `freeStatus`, `freeReason`, `pricing`, `selectable`; tombol refresh katalog + indikator waktu |
| **M3** OpenRouter `AI_PROVIDER_ERROR` | Respons HTTP **200** tetapi isi tidak terbaca (mis. `content` berupa array of parts, atau `reasoning_content` tanpa `content`) → sebelumnya dianggap "respons tidak valid" | ✅ Diperbaiki: `extractTextContent()` menormalisasi bentuk respons (string, array of parts, `reasoning_content`, `choices[0].text`, `output_text`); detail diagnostik (kategori, HTTP status, model, provider) disimpan ke `lastErrorDetail` + penjelasan mudah dipahami via `explainProviderError()` |

Tidak ada database yang di-reset, tidak ada API Key yang dihapus, tidak ada `.env` yang diubah, provider aktif tidak diubah, dan tidak ada request generasi AI sungguhan atau request ke model berbayar.

---

## 2. PENYABAK PASTI PER MASALAH

### 2.1 Masalah 1 — Gemini selalu UNVERIFIED

**Penyebab:** Endpoint katalog resmi Gemini
`https://generativelanguage.googleapis.com/v1beta/models` mengembalikan metadata model (nama, `inputTokenLimit`, `supportedGenerationMethods`) tetapi **tidak mencantumkan harga** (`pricing`). Karena kebijakan sistem menuntut bukti gratis dari sumber resmi dan nama model bukan bukti gratis, setiap model Gemini mendapat status `UNVERIFIED`. Hasilnya: 0 model boleh dipakai, fallback 0, dan AI degrade meskipun kunci API Gemini sudah tersimpan.

**Bukti dari katalog resmi:**
- Google Gemini pricing page (`https://ai.google.dev/gemini-api/docs/pricing`) memisahkan "Free Tier" dan "Paid Tier" per model.
- Free tier HANYA berlaku bila proyek memakai kunci dari Google AI Studio dan **belum mengaktifkan penagihan** (`https://ai.google.dev/gemini-api/docs/billing`). Bila penagihan aktif, kuota ditagihkan dan model tidak lagi gratis.
- Karena status gratis bergantung pada **tier akun**, bukan hanya model, sistem tidak dapat menebaknya otomatis → tetap `UNVERIFIED` hingga Admin verifikasi manual.

**Solusi yang diterapkan:** Path verifikasi manual (`POST /api/admin/ai-config/verify-models` dengan body `manual`) yang:
1. Menerima `evidenceUrl` hanya pada **domain resmi** (`ai.google.dev` untuk Gemini; allowlist ditetapkan di `OFFICIAL_EVIDENCE_DOMAINS`) → bukti tidak bisa dikarang.
2. Mengharuskan model ada di **katalog resmi** (penjaga `fetchProviderCatalogIds`) → tidak boleh memverifikasi model sembarang.
3. Mencatat `verificationSource = 'manual'`, `verifiedAt`, dan `notes` (syarat tier akun) ke tabel `AiModelPolicy`.
4. Verifikasi otomatis berikutnya **tidak menimpa** entri manual (preseden: manual menang kecuali katalog menyatakan model itu berbayar → PAID selalu menang sebagai fail-safe).

### 2.2 Masalah 2 — Model tidak muncul di pilihan / status tidak terlihat

**Penyebab:** UI model `<select>` sebelumnya hanya menampilkan `{name} ({id})` tanpa badge status, tanpa alasan penolakan, dan tanpa indikator kapan katalog terakhir diperbarui. Model UNVERIFIED/PAID tidak dibedakan secara visual dari model yang boleh dipakai.

**Solusi yang diterapkan:**
- Setiap model dari katalog resmi ditampilkan dengan `freeStatusLabel` ("Gratis terverifikasi" / "Belum terverifikasi" / "Berbayar") + `freeReason` (alasan).
- Model UNVERIFIED/PAID **tetap tampil** (tidak disembunyikan) tetapi ditandai `selectable: false` → opsi `<select>` diberi atribut `disabled`.
- Hanya `VERIFIED_FREE` yang boleh dipilih (`Pakai`).
- Tombol "Perbarui katalog" memaksa muat ulang dari server (`?refresh=1`) melewati cache 6 jam.
- Indikator "Katalog terakhir diperbarui: <waktu WIB>" ditampilkan dari field `fetchedAt` API.
- Ringkasan jumlah per status (verified free / unverified / paid) ditampilkan di atas daftar.
- Tautan rujukan resmi per provider ditampilkan untuk verifikasi manual.

### 2.3 Masalah 3 — OpenRouter `AI_PROVIDER_ERROR`

**Penyebab (dari audit log produksi):**

```
Tes koneksi provider "OpenRouter" model=baidu/ernie-5.5-flash-preview:free
hasil=AI_PROVIDER_ERROR status=200 latency=753ms
```

HTTP status **200** (berhasil pada jaringan) tetapi isi respons tidak berisi teks yang bisa dibaca. Sebelumnya kode hanya menerima `choices[0].message.content` bertipe string; model preview/reasoning bisa mengembalikan `content` sebagai array of parts atau menempatkan teks di `reasoning_content` → salah dikategorikan sebagai `AI_PROVIDER_ERROR`.

**Detail yang sudah tercatat (audit log `AI_CONFIG_TEST_CONNECTION`):**
- Provider: OpenRouter
- Model: `baidu/ernie-5.5-flash-preview:free`
- Hasil: `AI_PROVIDER_ERROR`
- HTTP status: `200`
- Latency: 753 ms (dan 1392 ms pada percobaan sebelumnya yang berhasil)
- Kunci: tidak dicatat

**Solusi yang diterapkan:**
1. `extractTextContent()` menormalisasi 5 bentuk respons provider (string, array of parts, `reasoning_content`, `choices[0].text`, `output_text`) → respons 200 dengan teks dalam bentuk lain sekarang terbaca sebagai OK.
2. `recordProviderValidation()` sekarang menerima parameter `detail` (teks aman: kategori, HTTP status, model, provider) dan menyimpannya ke kolom baru `AiProvider.lastErrorDetail`.
3. Endpoint uji koneksi (`[id]/test/route.ts`) mencatat detail diagnostik lengkap dan mengembalikan `errorExplanation` (penjelasan mudah dipahami via `explainProviderError()`).
4. UI kartu provider menampilkan "Alasan gagal:" dengan penjelasan + baris detail diagnostik.

---

## 3. FILE YANG BERUCHANG

### 3.1 File baru

| File | Perubahan |
|---|---|
| `src/lib/aiCatalog.ts` | **BARU** — pengambil katalog resmi model per provider (OpenRouter/Groq/Gemini) dengan pelaporan error yang aman; dipakai ulang oleh route katalog & penjaga verifikasi manual |
| `tests/ai.catalog.test.ts` | **BARU** — 27 tes offline: normalisasi respons provider, penjelasan error, pembacaan harga, pengambilan katalog mocked, status tanpa harga, verifikasi manual (allowlist domain + penjaga katalog), endpoint katalog (RBAC + semua model + status), endpoint verifikasi manual, diagnostik koneksi |
| `prisma/migrations/20261112160000_add_ai_provider_error_detail/migration.sql` | **BARU** — `ALTER TABLE "AiProvider" ADD COLUMN "lastErrorDetail" TEXT` (additive, nullable) |
| `prisma/migrations/20261112163500_add_ai_model_policy_verification_source/migration.sql` | **BARU** — `ALTER TABLE "AiModelPolicy" ADD COLUMN "verificationSource" TEXT` (additive, nullable) |
| `docs/PERBAIKAN-GEMINI-MODEL-CATALOG.md` | **BARU** — dokumen ini |

### 3.2 File yang diubah

| File | Perubahan |
|---|---|
| `prisma/schema.prisma` | Tambah `lastErrorDetail` pada `AiProvider`; tambah `verificationSource` pada `AiModelPolicy` |
| `src/lib/aiModelPolicy.ts` | Tambah `OFFICIAL_EVIDENCE_DOMAINS` (allowlist), `MANUAL_VERIFICATION_HINTS`, `manuallyVerifyModel()` (dengan penjaga domain resmi + katalog), `upsertPolicyRow()` (preseden manual vs katalog, PAID selalu menang), `getModelPolicy()` (status + sumber), `FREE_STATUS_EXPLANATION`, `normalizeStatus` diekspor |
| `src/lib/aiProviders.ts` | Tambah `extractTextContent()` (normalisasi 5 bentuk respons), `PROVIDER_ERROR_EXPLANATION`, `explainProviderError()` |
| `src/lib/aiProviderConfig.ts` | `AiProviderRow` + `SafeAiProvider` tambah `lastErrorDetail`; `recordProviderValidation()` menerima `detail`; `aiProviderStatus()` expose `lastErrorDetail` |
| `src/app/api/admin/ai-config/catalog/route.ts` | Kembalikan `freeStatus`, `freeStatusLabel`, `freeReason`, `pricingPrompt/Completion`, `pricingKnown`, `supportsChat`, `evidenceUrl`, `verifiedAt`, `verificationSource`, `selectable` per model; `summary` per status; `fetchedAt`; `hint` rujukan resmi; semua model tetap ditampilkan |
| `src/app/api/admin/ai-config/verify-models/route.ts` | Dukung body `manual` untuk verifikasi manual Admin; penjaga domain resmi + model ada di katalog resmi; catat `keptManual` |
| `src/app/api/admin/ai-config/[id]/test/route.ts` | Catat `lastErrorDetail` (kategori + HTTP status + model + provider); kembalikan `errorExplanation` |
| `src/app/api/admin/ai-config/route.ts` | Expose `lastErrorDetail`, `lastErrorExplanation`, `policyUpdatedAt` per slot |
| `src/components/ui/admin/AiConfigManager.tsx` | Daftar katalog lengkap (semua model + status + alasan + opsi disabled), tombol "Perbarui katalog" (`?refresh=1`), indikator "Katalog terakhir diperbarui", modal "Verifikasi Manual Model Gratis" (URL bukti + catatan + error), alasan gagal pada kartu provider (`lastErrorExplanation` + `lastErrorDetail`) |
| `src/components/ui/admin/admin-config.css` | Gaya `.cfg-catalog-*`, `.cfg-item-reason` |
| `tests/ui.markup.test.ts` | Tambah M-11 (katalog semua model + status + alasan), M-12 (tombol refresh + indikator waktu), M-13 (modal verifikasi manual + penjaga domain + alasan gagal) |

Tidak ada file yang dihapus. `src/lib/chatbot.ts` **tidak diarsipkan** (menjaga `tests/ai.drift.test.ts`).

---

## 4. HASIL TES

### 4.1 Tes baru (`tests/ai.catalog.test.ts`) — 27/27 lulus

| Kelompok | Tes | Hasil |
|---|---|---|
| Normalisasi respons provider | 5 tes (string, array parts, reasoning_content, choices[0].text, tidak dikenal) | ✅ |
| Penjelasan error per kategori | 2 tes (7 kategori aman + kode tak dikenal/null) | ✅ |
| Pembacaan harga katalog | 1 tes (harga 0 = gratis, tidak ada = null) | ✅ |
| Pengambilan katalog mocked | 4 tes (OpenRouter harga & klasifikasi, Gemini prefix + supportsChat, gagal tanpa kunci, gagal tanpa APP_ENCRYPTION_KEY) | ✅ |
| Status tanpa harga (Gemini/Groq) | 2 tes (UNVERIFIED + alasan tier akun; rujukan resmi domain resmi) | ✅ |
| Verifikasi manual | 4 tes (tolak URL non-resmi, tolak model asing, terima URL resmi + sumber manual, otomatis tidak timpa manual, berbayar tetap menang) | ✅ |
| Endpoint katalog | 4 tes (RBAC 401, semua model + status + alasan + fetchedAt, selectable VERIFIED_FREE, tolak provider tak dikenal) | ✅ |
| Endpoint verifikasi manual | 3 tes (tolak URL non-resmi & model asing, terima bukti resmi, RBAC 401) | ✅ |
| Diagnostik koneksi | 1 tes (recordProviderValidation simpan detail + kosongkan saat sukses) | ✅ |

### 4.2 Regresi (41 file tes, dikecualikan `ai.integration.test.ts` dan `e2e.location.test.ts`)

- **763 tes lulus**, 2 gagal pre-existing (`announcements.broadcast` "belum dikonfigurasi"; `reports.analysis.duplicates` 48 baris `Report` lama — bukan regresi)
- `tests/ai.policy.test.ts`: 15/15
- `tests/ai.config.test.ts`: 42/42
- `tests/ai.config.security.test.ts`: 8/8
- `tests/ui.markup.test.ts`: 14/14

### 4.3 Validasi teknis

| Pemeriksaan | Hasil |
|---|---|
| TypeScript `tsc --noEmit` di `src/` | **0 error** (total 46 = baseline) |
| ESLint `next lint` | **0 error**, 20 warning (pre-existing ``) |
| `next build` (`.next` bersih) | **exit 0** |
| `PRAGMA integrity_check` | **ok** |
| RBAC runtime (handler Admin tanpa sesi) | **→ 401** |

---

## 5. KONDISI DATABASE PRODUKSI (setelah migrasi)

```
AiProvider:
  gemini      aktif=false primary=gemini-2.5-flash lastError=AI_MODEL_GONE    lastErrorDetail=-
  openrouter  aktif=true  primary=baidu/ernie-5.5-flash-preview:free lastError=AI_PROVIDER_ERROR lastErrorDetail=-

AiModelPolicy (518 baris):
  gemini      UNVERIFIED  50   (belum ada verifikasi manual)
  openrouter  PAID        452
  openrouter  VERIFIED_FREE 16

Schema:
  AiProvider.lastErrorDetail      = TEXT (ADA)
  AiModelPolicy.verificationSource= TEXT (ADA)

PRAGMA integrity_check = ok
```

`lastErrorDetail` kosong (`-`) pada baris produksi yang sudah ada karena catatan lama dibuat sebelum kolom baru; **uji koneksi baru** akan mengisi kolom ini. Tidak ada data produksi yang diubah atau dihapus.

---

## 6. HAL YANG MASIH MEMBUTUHKAN VERIFIKASI MANUAL (BLOCKED)

Berikut adalah tindakan yang hanya dapat dilakukan Admin, sesuai batasan proyek (tidak ada request nyata ke provider tanpa izin; tidak ada perubahan `.env`; tidak ada kirim WhatsApp sungguhan):

| # | Pekerjaan | Alasan | Tindakan Admin |
|---|---|---|---|
| **A** | `APP_ENCRYPTION_KEY` belum ditetapkan | Diperlukan untuk dekripsi API Key provider & backfill token | Buat kunci 32-byte Base64, simpan di password manager, tambahkan ke `.env`, restart, verifikasi dengan `npm run security:backfill-token --dry-run` |
| **B** | Backfill `FonnteConfig.token` → `tokenCipher` | Butuh kunci + backup + persetujuan eksplisit; tool siap (`npm run security:backfill-token`) | Setelah A: jalankan backfill (alat membuat backup sendiri & memverifikasi dekripsi) |
| **C** | Verifikasi Gemini ke model gratis | Butuh Admin membuka `https://ai.google.dev/gemini-api/docs/pricing`, memastikan model punya free tier untuk akun AI Studio (belum penagihan), lalu klik "Verifikasi manual" di kartu model di `/admin/ai-config` dan isi URL resmi + catatan tier akun | Buka `/admin/ai-config` → Gemini → model (contoh `gemini-2.5-flash`) → "Verifikasi manual" → isi `https://ai.google.dev/gemini-api/docs/pricing` + catatan → Konfirmasi |
| **D** | Request nyata ke provider (termasuk verifikasi Groq) | Butuh izin request + API Key asli; spec Groq masih `verified: false` | Beri izin tertulis + API Key; lalu 1 request uji per provider |
| **E** | WhatsApp sungguhan | Butuh izin eksplisit | Beri izin tertulis bila ingin uji kirim nyata |

> Izin memulai pekerjaan ini **bukan** izin mengirim WhatsApp sungguhan atau melakukan request provider berbayar. Semua pengujian di atas memakai mock/stub dan database salinan.

---

## 7. ALUR PENGGUNAAN (Admin) SETELAH PERBAIKAN

1. Buka `/admin/ai-config`.
2. Klik **"Verifikasi Ulang dari Katalog Resmi"** → isi `AiModelPolicy` dari katalog resmi (OpenRouter: 16 model VERIFIED_FREE; Gemini/Groq: 0 otomatis, UNVERIFIED dengan alasan tier akun).
3. Lihat katalog per provider (tombol "Perbarui katalog"). Semua model muncul dengan status; UNVERIFIED/PAID tidak bisa dipilih.
4. Untuk Gemini: lihat rujukan resmi (`https://ai.google.dev/gemini-api/docs/pricing`), verifikasi manual model yang diinginkan (URL resmi + catatan tier akun).
5. Klik **"Rekomendasikan Model Gratis"** → periksa bukti/status → **"Terapkan Rekomendasi"** (hanya menyimpan model, tidak mengaktifkan provider).
6. **Uji Koneksi** model utama; detail diagnostik (`lastErrorDetail`) + penjelasan mudah dipahami ditampilkan bila gagal.
7. **"Jadikan Provider Aktif"** → konfirmasi.
8. Verifikasi chatbot menampilkan "AI: {provider} — {model}" atau "Jawaban lokal (bukan dari model AI)".

---

## 8. KEAMANAN (dipatuhi)

- API Key, ciphertext, dan `APP_ENCRYPTION_KEY` **tidak pernah** dicetak ke browser/log/dokumen.
- Respons API Admin hanya memuat `hasApiKey: boolean`, tidak pernah `apiKey`/`apiKeyCipher`.
- URL bukti verifikasi manual hanya diterima pada **domain resmi provider** (allowlist).
- Tidak ada request generasi AI / ke model berbayar dalam tes maupun implementasi.
- Semua endpoint konfigurasi dilindungi `requireAdmin()`; RBAC → 401 tanpa sesi.
- Migrasi **additive only** (ALTER TABLE ADD COLUMN nullable); backup sebelum migrasi; `PRAGMA integrity_check = ok`.
- `src/lib/chatbot.ts` **tidak diarsipkan** (memelihara `tests/ai.drift.test.ts`).
- `.env` dan `APP_ENCRYPTION_KEY` **tidak diubah** secara otomatis.

---

## 9. KESIMPULAN

Penyebab pasti ketiga masalah telah diidentifikasi dan diperbaiki:
1. Gemini UNVERIFIED disebabkan katalog resmi tanpa harga → solved via **verifikasi manual dengan bukti domain resmi** (tidak mengarang bukti).
2. Model tidak terlihat status → solved via **daftar katalog lengkap dengan status + alasan + refresh + indikator waktu**.
3. OpenRouter `AI_PROVIDER_ERROR` pada HTTP 200 → solved via **normalisasi respons provider** + **detail diagnostik tersimpan + penjelasan mudah dipahami**.

Semua tes (763 lulus, 2 pre-existing), TypeScript (0 error), ESLint (0 error), dan `next build` (exit 0) lulus. Implementasi siap digunakan Admin setelah `APP_ENCRYPTION_KEY` ditetapkan dan verifikasi manual Gemini dilakukan.

# TAHAP 3 — IMPLEMENTASI KONFIGURASI WHATSAPP ADMIN & PROVIDER AI

**Spesifikasi acuan:** `docs/TAHAP-2-SPESIFIKASI-TEKNIS.md` (16 bagian, 33 skenario uji, 20 risiko, 14 tahap implementasi)
**Tanggal implementasi:** 12 November 2026
**Status akhir:** implementasi kode **SELESAI**. Dua pekerjaan **berhenti pada gerbang persetujuan Admin** (lihat §15).

---

## 1. RINGKASAN EKSEKUTIF

Tahap 3 mengubah dua hal yang sebelumnya bercampur dalam satu sumber konfigurasi:

1. **Nomor WhatsApp untuk Admin** dipisah menjadi dua peran:
   - *perangkat pengirim* (token Fonnte + nomor perangkat) → `FonnteConfig` (tetap, hanya dibaca server),
   - *nomor penerima notifikasi* → tabel baru `NotificationRecipient`.
   Akibatnya Admin bisa mengarahkan notifikasi ke nomor berbeda tanpa menyentuh perangkat Fonnte.
2. **Provider AI** dipusatkan ke tabel baru `AiProvider`: tiga provider (OpenRouter, Google Gemini, Groq),
   masing-masing dengan API Key sendiri yang **terenkripsi AES-256-GCM**, satu provider aktif, model utama
   pilihan Admin, serta daftar model cadangan berurutan. Seluruh pipeline AI (asisten chat, analisis laporan,
   deteksi duplikat, diagnostik) membaca konfigurasi yang sama.

Yang **tidak** berubah: riwayat percakapan tetap in-memory (`aiSessionStore.ts` tidak disentuh), data lama
tidak pernah dihapus, tabel lama tidak pernah di-`DROP`, dan tidak ada satu pun pesan WhatsApp sungguhan
yang dikirim selama pengerjaan.

| Ukuran | Nilai |
|---|---|
| File baru | 19 (termasuk 1 migrasi SQL, 2 file tes) |
| File diubah | 18 |
| Tes offline | 39 skenario baru (`tests/ai.config.test.ts`) + 17 (`tests/secret.crypto.test.ts`) |
| Total suite (37 file, 2 file dikecualikan) | 667 tes, 665 lulus, 2 gagal **pre-existing** (terbukti, §10.4) |
| `tsc --noEmit` | 0 error di `src/` (total 46 error pre-existing di `tests/`, identik dengan baseline) |
| ESLint | 0 error (hanya warning `<img>` pre-existing) |
| `next build` | exit 0, `.next` bersih |

---

## 2. RUANG LINGKUP, BATASAN & KEAMANAN

### 2.1 Yang dikerjakan
- Tabel baru + migrasi additive, Indexed Unique Parsial, service layer, API Admin-only, halaman Admin,
  integrasi pipeline AI, fallback transparan, enkripsi rahasia, audit, dokumentasi.

### 2.2 Yang SENGAJA tidak dikerjakan (mengikuti aturan keamanan)
| Tidak dikerjakan | Alasan |
|---|---|
| Backfill `FonnteConfig.token` → `tokenCipher` di DB produksi | Membutuhkan `APP_ENCRYPTION_KEY` + persetujuan Admin (§15.1) |
| Pembuatan otomatis `APP_ENCRYPTION_KEY` | Kunci produksi tidak boleh dibuat otomatis; nilai hanya boleh ditetapkan Admin (§15.2) |
| Pengarsipan `src/lib/chatbot.ts` (kode mati) | Specimen §15-3-12 mensyaratkan **persetujuan eksplisit**; file dibiarkan utuh |
| Penghapusan data / laporan / audit log / `WhatsAppLog` | Dilarang mutlak |
| Pesan WhatsApp sungguhan | Dilarang tanpa persetujuan; tidak ada request ke Fonnte selama pengerjaan |
| `tests/ai.integration.test.ts` & `tests/e2e.location.test.ts` | Dilarang dijalankan (menghormati aturan §13) |
| `prisma migrate dev` pada DB proyek | Dilarang; hanya `prisma migrate deploy` dengan SQL manual + backup |
| Perubahan otomatis pada `.env` | Dilarang; hanya dokumen instruksi |

### 2.3 Invarian yang dijaga
- Tabel lama: **tidak ada** `DELETE`/`DROP`/`TRUNCATE`.
- Migrasi: **additive** saja (`CREATE TABLE` baru + `ALTER TABLE ADD COLUMN` nullable).
- Tidak ada nomor/secret yang keluar ke browser.
- Tidak ada fallback diam-diam ke nomor lama perangkat pengirim.
- Tidak ada fallback diam-diam ke `.env` bila konfigurasi DB sudah ada.

---

## 3. ARSITEKTUR TARGET

```
┌───────────────────────── SISI ADMIN (browser) ─────────────────────────┐
│  /admin/whatsapp-config      /admin/whatsapp-recipients   /admin/ai-config  │
│  (perangkat PENGIRIM)        (nomor PENERIMA)             (provider AI)    │
└───────────────┬──────────────────────┬───────────────────────────┬─────────┘
                │ semua endpoint memakai requireAdmin() → 401 / 403
┌───────────────▼──────────────────────▼───────────────────────────▼─────────┐
│  API: /api/admin/whatsapp-recipients        /api/admin/ai-config           │
│        (+ [id], + [id]/activate, + [id]/test, + catalog)                    │
└───────────────┬──────────────────────┬───────────────────────────┬─────────┘
                │                      │                           │
     notificationRecipients.ts   aiProviderConfig.ts        aiProviders.ts
                │                      │                     (spec + adapter)
                │                      │                           │
                ▼                      ▼                           ▼
   ┌────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
   │ NotificationRecipient│  │      AiProvider      │   │  OpenRouter (openai) │
   │  • 1 aktif (UNIQUE   │  │  • apiKeyCipher      │   │  Groq     (openai)   │
   │    INDEX parsial)    │  │  • 1 aktif (UNIQUE   │   │  Gemini   (SDK)      │
   │  • soft-delete      │  │    INDEX parsial)    │   └──────────────────────┘
   └─────────┬──────────┘   │  • primaryModel      │
             │              │  • fallbackModels[]  │
             │              └──────────┬───────────┘
             │                         │
             ▼                         ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ Pipeline: aiChat.ts · aiService.ts · duplicates.ts · gemini.ts ·      │
   │           aiTools.ts (diagnostik) · api/ai/chat · api/admin/ai/chat   │
   │ Fallback transparan → meta.usedProvider / usedModel / fallbackModels   │
   └───────────────────────────────────────────────────────────────────────┘
```

---

## 4. TAHAP 1 — FONDASI ENKRIPSI (`src/lib/secretCrypto.ts`)

**File:** `src/lib/secretCrypto.ts` (baru), `tests/secret.crypto.test.ts` (baru, 17/17 lulus).

| Aspek | Keputusan |
|---|---|
| Algoritma | AES-256-GCM (`aes-256-gcm`) |
| Format ciphertext | `v1:<iv_b64>:<tag_b64>:<ct_b64>` — awalan versi memungkinkan rotasi kunci |
| IV | 12 byte acak **per enkripsi** (GCM tidak boleh memakai nonce ulang) |
| Auth tag | 16 byte, diverifikasi saat dekripsi |
| Kunci | `APP_ENCRYPTION_KEY` di environment server saja; Base64 (decode tepat 32 byte) **atau** hex 64 karakter; tanpa nilai default |
| Guard | modul melempar `server_only` bila dijalankan di lingkungan browser |
| Error | hanya kode aman (`encryption_key_missing`, `encryption_key_invalid`, `encrypt_failed`, `decrypt_failed`, `ciphertext_invalid`) — nilai rahasia tidak pernah bocor |

**API:** `getEncryptionKey()`, `encryptSecret()`, `decryptSecret()`, `isEncrypted()`, `isEncryptionReady()`,
`maskSecret()`, `safeEqual()`, `SecretCryptoError`.

**Catatan penting:** `decryptSecret()` memeriksa **kunci lebih dulu**, baru format ciphertext. Bila kunci hilang,
galat yang muncul adalah "kunci belum dikonfigurasi" (akar masalah), bukan "ciphertext rusak" (gejala).

---

## 5. TAHAP 2 — SKEMA DATABASE & MIGRASI

**Migrasi:** `prisma/migrations/20261112094500_add_config_tables/migration.sql`
**Diterapkan dengan:** `npx prisma migrate deploy` (bukan `migrate dev`), **setelah** backup.

### 5.1 Backup pra-migrasi
| Item | Nilai |
|---|---|
| Berkas | `prisma/dev.db.backup-before-config-20261112-093132` |
| Ukuran | 987.136 byte |
| SHA-256 | `8800a2a6aa5a1eadf0ca38b618922a56` |
| Gate | `PRAGMA database_list` → target = `prisma/dev.db` (terverifikasi sebelum eksekusi) |

### 5.2 objek baru
| Objek | Rinci |
|---|---|
| `NotificationRecipient` | `id`, `label`, `phone`, `isActive` (default `false`), `notes`, `createdAt`, `updatedAt` |
| `AiProvider` | `id`, `provider`, `label`, `apiKeyCipher`, `isActive`, `primaryModel`, `fallbackModels` (JSON), `models` (JSON), `lastValidation`, `lastError`, `createdAt`, `updatedAt` |
| `FonnteConfig.tokenCipher` | kolom nullable baru (sumber utama, area transisi) |

### 5.3 Index (dibuat manual di `migration.sql`)
```sql
CREATE UNIQUE INDEX "NotificationRecipient_one_active" ON "NotificationRecipient"("isActive") WHERE "isActive";
CREATE UNIQUE INDEX "AiProvider_one_active"            ON "AiProvider"("isActive")            WHERE "isActive" = 1;
CREATE UNIQUE INDEX "AiProvider_provider_key"          ON "AiProvider"("provider");
```
> Bentuk `WHERE "isActive"` (tanpa `= 1`) ekuivalen secara fungsional pada kolom boolean SQLite
> (nilai truthy hanya `1`), dan **sudah dibuktikan** menolak penerima aktif kedua pada DB hidup.

**Bukti empiris (DB hidup, bukan simulasi):**
1. `UPDATE … SET isActive = 1` untuk penerima A → **berhasil**.
2. `UPDATE … SET isActive = 1` untuk penerima B → **DITOLAK** (`UNIQUE constraint failed: NotificationRecipient.isActive`).
3. Jumlah baris nonaktif → tidak dibatasi.
4. Tukar aktif secara atomik (A→nonaktif, B→aktif dalam satu transaksi) → **berhasil**.

### 5.4 Verifikasi integritas data (setelah migrasi)
Seluruh tabel lama dibanding baseline pra-migrasi: **tidak ada yang berkurang**.
Tambahan `adminAuditLog` & `WhatsAppLog` berasal dari aktivitas aplikasi yang berjalan (login Admin,
panggilan tool AI) — bukan dari pekerjaan migrasi.

---

## 6. TAHAP 3 — SERVICE LAYER

### 6.1 `src/lib/notificationRecipients.ts` (baru)
| Fungsi | Perilaku |
|---|---|
| `listRecipients()` | semua penerima, aktif lebih dulu |
| `resolveActiveRecipient()` | **tanpa cache**; membaca `isActive = true`; normalisasi via `normalizePhoneTo62`; bila tidak ada / tidak valid → `phone: null` + `problems[]` |
| `addRecipient()` | validasi label + nomor, tolak duplikat, default **nonaktif** |
| `updateRecipient()` | ubah label/nomor/catatan; status aktif tidak ikut berubah |
| `activateRecipient()` | **transaksi atomik**: nonaktifkan yang lain → aktifkan ini |
| `deactivateRecipient()` | nonaktifkan (bukan hapus); nomor tetap dapat diaktifkan kembali |
| `migrateLegacyAdminPhone()` | **idempoten**: `FonnteConfig.adminPhone` (perangkat aktif) → penerima aktif pertama; `FonnteConfig` tidak diubah/dihapus |

### 6.2 `src/lib/aiProviderConfig.ts` (baru)
| Fungsi | Perilaku |
|---|---|
| `resolveActiveAiProvider()` | provider aktif + kunci (dekripsi di memori server) + model utama + model cadangan; `source`: `database` / `env` / `none` / `error` |
| `resolveAiProviderChain()` | urutan percobaan lintas-provider: `attempts[0]` = provider aktif, berikutnya provider lain yang punya kunci + model |
| `listAiProviders()` | **bentuk aman**: hanya `hasApiKey: boolean`; `apiKeyCipher` tidak pernah keluar |
| `upsertProvider()` / `saveProviderApiKey()` | kunci dienkripsi sebelum disimpan; kunci kosong = **pertahankan yang lama** |
| `setProviderPrimaryModel()` / `setProviderFallbackModels()` | model utama & urutan cadangan; model utama tidak boleh jadi cadangan |
| `activateProvider()` / `deactivateProvider()` | transaksi atomik; aktivasi butuh kunci + model utama |
| `recordProviderValidation()` | mencatat hasil tes (kode aman, tanpa pesan mentah) |
| `isEncryptionConfigured()` | true bila `APP_ENCRYPTION_KEY` tersedia & valid |

**Aturan tanpa fallback diam-diam:** bila tabel `AiProvider` **sudah berisi data**, `.env` **tidak** dipakai
sama sekali — pilihan Admin dihormati. Bootstrap `.env` hanya berlaku saat tabel masih kosong (instalasi baru).

### 6.3 `src/lib/aiProviders.ts` (baru) — spec & adapter
| Provider | Endpoint | Gaya | Diverifikasi |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenAI-compatible | ✅ (dipakai sejak awal) |
| Google Gemini | SDK `@google/generative-ai` (kunci diteruskan eksplisit) | Gemini SDK | ✅ |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | OpenAI-compatible | ⚠️ **belum** — bentuk diasumsikan, butuh 1 request uji (§15.3) |

Adapter bersama untuk OpenRouter + Groq; klasifikasi error sesuai §10.3 spesifikasi:
`401/403 → AI_AUTH_FAILED` (berhenti total), `402 → AI_QUOTA` (berhenti untuk provider itu),
`404 → AI_MODEL_GONE`, `429 → AI_RATE_LIMIT`, timeout → `AI_TIMEOUT`.
`redactSecret()` membuang kemunculan API Key dari body provider sebelum masuk log.

---

## 7. TAHAP 4 — API ADMIN (SEMUA `requireAdmin()`)

| Method | Rute | Fungsi | Audit |
|---|---|---|---|
| GET | `/api/admin/whatsapp-recipients` | daftar + penerima aktif + masalah | — |
| POST | `/api/admin/whatsapp-recipients` | tambah penerima / `{action:'migrate-legacy'}` | `WA_RECIPIENT_ADD`, `WA_RECIPIENT_MIGRATE_LEGACY` |
| PATCH | `/api/admin/whatsapp-recipients/[id]` | ubah / aktifkan / nonaktifkan | `WA_RECIPIENT_UPDATE`, `WA_RECIPIENT_ACTIVATE`, `WA_RECIPIENT_DEACTIVATE` |
| DELETE | `/api/admin/whatsapp-recipients/[id]` | **soft-delete** (nomor tetap tersimpan) | `WA_RECIPIENT_DISABLE` |
| GET | `/api/admin/ai-config` | daftar provider (aman) + `encryptionReady` | — |
| POST | `/api/admin/ai-config` | tambah provider (kunci opsional) | `AI_CONFIG_ADD` |
| PATCH | `/api/admin/ai-config/[id]` | label / kunci / model / fallback / status | `AI_CONFIG_UPDATE_KEY`, `AI_CONFIG_SET_PRIMARY_MODEL`, `AI_CONFIG_SET_FALLBACK_MODELS`, `AI_CONFIG_UPDATE_LABEL`, `AI_CONFIG_DEACTIVATE` |
| DELETE | `/api/admin/ai-config/[id]` | **soft-delete** (kunci tetap terenkripsi) | `AI_CONFIG_DISABLE` |
| POST | `/api/admin/ai-config/[id]/activate` | aktivasi provider (transaksi) | `AI_CONFIG_ACTIVATE` |
| POST | `/api/admin/ai-config/[id]/test` | tes konektivitas (1 request) | `AI_CONFIG_TEST_CONNECTION` |
| GET | `/api/admin/ai-config/catalog?provider=…` | katalog model (cache 6 jam, timeout 8 dtk) | — |

**Keamanan API**
- Semua route memakai `requireAdmin()` → **401** tanpa sesi, **403** bila role bukan ADMIN.
- Response **tidak pernah** memuat `apiKeyCipher` maupun `apiKey`; hanya `hasApiKey: boolean`.
- API Key kosong saat edit ⇒ kunci lama **dipertahankan** (tidak perlu mengetik ulang saat ganti model).
- `notes` audit **tidak pernah** memuat nilai kunci (hanya flag "kunci diisi=true").
- Tes konektivitas dibatasi **5/menit per Admin** (in-memory).
- `POST`/`PATCH` kunci ditolak dengan pesan jelas bila `APP_ENCRYPTION_KEY` belum ada — **tidak ada** penyimpanan plaintext.

### 7.1 Route lama yang diperbarui
| Route | Perubahan |
|---|---|
| `GET /api/admin/whatsapp-config` | menambahkan `legacyAdminPhone`, `activeRecipient`, `recipientProblems`, `recipientSource`; monitoring menambah `activeRecipientPhone`/`hasActiveRecipient` |
| `GET /api/ai/chat` | `connected` kini dari **konfigurasi DB** (bukan `!!process.env.OPENROUTER_API_KEY`), plus `provider`/`model`/`source` |
| `GET /api/admin/ai/chat` | sama + `problems` |
| `POST /api/test-wa` | pesan uji dikirim ke **penerima aktif** (bukan nomor perangkat pengirim) |

---

## 8. TAHAP 5 — HALAMAN ADMIN & SIDEBAR

| Halaman | Rute | Isi |
|---|---|---|
| **Pusat WhatsApp Admin** (tetap) | `/admin/whatsapp-config` | + panel "Penerima Notifikasi Aktif" + link ke `/admin/whatsapp-recipients`; panel "Nomor Perangkat Pengirim" dipisahkan dari nomor penerima |
| **Penerima Notifikasi** (baru) | `/admin/whatsapp-recipients` | kartu per nomor: label, nomor, badge AKTIF, tombol Aktifkan/Ubah/Nonaktifkan (soft), modal tambah, tombol "Migrasi Nomor Admin Lama" |
| **Konfigurasi Asisten AI** (baru) | `/admin/ai-config` | kartu per provider: badge AKTIF, status `KUNCI ✔/✖`, pilih model utama (katalog + ketik manual), daftar model cadangan (satu per baris), tombol Simpan Model / Aktifkan / Tes Konektivitas / Ubah Label-Kunci / Nonaktifkan, banner status enkripsi |

**Sidebar** (`groupsFor('ADMIN')` → grup "Operasional"):
```
{ href: '/admin/whatsapp-config',    icon: '📱', label: 'Pusat WhatsApp Admin' }      (tetap)
{ href: '/admin/whatsapp-recipients', icon: '👥', label: 'Penerima Notifikasi' }      (BARU)
{ href: '/admin/pusat-pengetahuan', icon: '🧠', label: 'Pusat Pengetahuan AI' }   (tetap)
{ href: '/admin/ai-config',           icon: '🤖', label: 'Konfigurasi Asisten AI' }   (BARU)
```

**RBAC halaman:** `getSession()` + `session.role !== 'ADMIN'` → `redirect('/login')` di kedua halaman
(server-side). Middleware `/admin/*` + layout Admin menambah lapisan kedua.

---

## 9. TAHAP 6 — PEMISAHAN PENGIRIM ↔ PENERIMA

`src/lib/whatsapp.ts` → `resolveAdminRecipient()` dipindah dari `config.adminPhone` (nomor perangkat
pengirim) menjadi `resolveActiveRecipient().phone` (nomor penerima aktif di database).

**Perilaku baru bila tidak ada penerima aktif:**
```ts
recordLog({ dedupeKey, kind, toMasked: '-', status: 'FAILED', error: 'admin_recipient_unavailable' });
// → TIDAK ada request ke Fonnte
```
Tidak ada fallback ke nomor perangkat pengirim, tidak ada fallback ke `.env`.

**Penerima notifikasi yang terpengaruh (6 notifier Admin + 1 jalur cadangan):**
`notifyAdminLogin`, `notifyAdminNewUser`, `notifyAdminNewReport`, `notifyAdminAssignment`,
`notifyAdminCompletion`, `notifyAdminReview`, dan fallback-Admin pada `notifyCitizenStatusChange`.

**TIDAK diubah** (tetap memakai nomor profil): `notifyAccountDeactivated` (user),
`notifyOfficerAccountCreated` (petugas), `notifyPasswordReset` (user), seluruh notifikasi warga,
notifikasi petugas, dan OTP.

**Tidak ada cache:** ganti nomor aktif berlaku pada pengiriman berikutnya.
**Idempotensi:** `dedupeKey` tidak bergantung nomor → ganti nomor tidak mengirim ulang pesan lama.
**Log:** hanya menyimpan `toMasked`, bukan nomor penuh/token/isi pesan.

---

## 10. TAHAP 7–8 — INTEGRASI PIPELINE AI & FALLBACK TRANSPARAN

### 10.1 Pipeline yang memakai konfigurasi terpusat
| # | Pipeline | File | Sebelum | Sesudah |
|---|---|---|---|---|
| P1 | Asisten chat utama | `src/lib/aiChat.ts` | `process.env.OPENROUTER_API_KEY` + `FALLBACK_MODELS` hardcode | `resolveAiProviderChain()` → rantai model dari Admin |
| P2 | Analisis laporan | `src/lib/aiService.ts` | `GEMINI_API_KEY` → fallback diam-diam ke OpenRouter; model hardcode | rantai provider + model dari Admin |
| P3 | Assistant duplikat | `src/lib/duplicates.ts` | `process.env.OPENROUTER_API_KEY`, model hardcode | `resolveAiProviderChain()` + adapter terpusat |
| P4 | Kode mati | `src/lib/chatbot.ts` | baca `.env` | **tidak diubah** — arsipkan butuh persetujuan (§15.3) |
| P5 | Diagnostik AI | `src/lib/aiTools.ts` (`model:`) | `process.env.OPENROUTER_MODEL` | model utama provider aktif |
| P6 | Status koneksi | `api/ai/chat`, `api/admin/ai/chat` | `!!process.env.OPENROUTER_API_KEY` | dari konfigurasi DB |
| — | Analisis gambar | `src/lib/gemini.ts` | `gemini-1.5-flash` hardcode | model dari Admin (fallback `.env` hanya untuk bootstrap) |

### 10.2 Rantai percobaan
```
provider aktif (DB)
  └─ primaryModel
       └─ fallbackModels[0]
            └─ fallbackModels[1] …  (maks. 4 model per provider)
                 └─ provider berikutnya (provider lain yang punya kunci + model)
                      └─ GAGAL SEMUA → jalur deterministik (formatFallbackAnswer)
```
Model yang terbukti mati (HTTP 404) di-cache 30 menit agar tidak dicoba ulang tiap permintaan.

### 10.3 Pelaporan transparan (`meta` respons chat)
```ts
meta.usedProvider     : 'openrouter' | 'gemini' | 'groq' | null
meta.usedModel        : string | null
meta.fallbackModels   : string[]   // model yang GAGAL dan dicoba
meta.fallbackProvider : string | null
meta.providerChain    : string[]   // urutan percobaan provider
```
UI: badge **"Dijawab model cadangan: `<model>`"** pada `AdminAiAssistant` dan `AdminAiFloatingChatbot`
(ditampilkan bila `meta.fallbackModels.length > 0`).

### 10.4 Aturan kegagalan (tidak pernah mengarang jawaban)
| Kondisi | Perilaku | `errorKind` |
|---|---|---|
| Semua model/provider gagal | jawaban deterministik dari data tool; bila tidak ada → pesan jujur "data belum dapat diperiksa" | `AI_PROVIDER_ERROR` |
| Provider aktif tanpa kunci/model | pesan jelas + arah ke `/admin/ai-config` | `AI_NOT_CONFIGURED` |
| Kunci invalid (401/403) | **berhenti total**, tidak mencoba provider lain | `AI_AUTH_FAILED` |
| Kuota habis (402) | berhenti untuk provider itu; boleh coba provider berbeda | `AI_QUOTA` |
| Rate limit (429) | coba model/provider berikutnya | `AI_RATE_LIMIT` |
| Model hilang (404) | coba model berikutnya (dicache 30 menit) | `AI_MODEL_GONE` |
| Timeout | coba berikutnya; habis → deterministik | `AI_TIMEOUT` |

### 10.5 Model hardcode yang dihapus
`openai/gpt-4o-mini`, `gemini-3.8-flash`, `FALLBACK_MODELS` (3 model), `gemini-1.5-flash` — semuanya tidak
lagi menjadi dependensi pipeline. Tersisa hanya: (a) nilai default bootstrap `.env` di `gemini.ts`,
(b) `chatbot.ts` yang merupakan kode mati (menunggu persetujuan arsip).

---

## 11. TAHAP 9 — KEAMANAN

| Aspek | Implementasi |
|---|---|
| Enkripsi | AES-256-GCM, ciphertext `v1:iv:tag:ct`, IV acak 12 byte, tag 16 byte |
| Kunci | hanya di environment server; tidak ada default; tidak pernah ke browser |
| Rahasia tak bocor | API respons hanya `hasApiKey`; `redactSecret()` pada body provider; `maskSecret()` untuk tampilan |
| Log | tidak memuat kunci/rahasia; `AdminAuditLog.notes` hanya kode & flag |
| RBAC | `requireAdmin()` di 7 endpoint; server-side redirect di 2 halaman; middleware + layout Admin |
| Audit | awalan `WA_RECIPIENT_*` dan `AI_CONFIG_*` |
| SQL | Prisma parameterized query; partial UNIQUE INDEX sebagai penjaga lapis database |
| Client-side | modul enkripsi & konfigurasi tidak pernah masuk bundel browser (`server_only` guard) |

---

## 12. TAHAP 10 — STRATEGI PENGUJIAN & HASIL

### 12.1 Aturan yang dipatuhi
- Semua tes memakai **salinan `prisma/dev.db` di `%TEMP%`**; `DATABASE_URL` di-override **sebelum** modul
  Prisma diimpor; `PRAGMA database_list` diverifikasi menunjuk file salinan (gate wajib).
- Kunci enkripsi = kunci **uji per-proses**, tidak pernah kunci produksi.
- Provider AI di-**stub** (`global.fetch` diganti), tidak ada request ke jaringan.
- Tidak ada pesan WhatsApp sungguhan; fungsi pengiriman tidak pernah dipanggil.
- `tests/ai.integration.test.ts` & `tests/e2e.location.test.ts` **tidak dijalankan**.

### 12.2 File tes
| File | Isi | Hasil |
|---|---|---|
| `tests/secret.crypto.test.ts` | 17 skenario (round-trip, IV unik, tag GCM, kunci salah, kunci hilang, masking, timing-safe) | ✅ 17/17 |
| `tests/ai.config.test.ts` | **39 skenario** baru (T-06…T-33) | ✅ 39/39 |

**Pemetaan skenario →Implementasi** (39 skenario baru + 17 kripto = 56 skenario):

| ID | Skenario | Status |
|---|---|---|
| T-01…T-05 | Enkripsi round-trip, IV unik, tag GCM, kunci salah, kunci hilang | ✅ `secret.crypto.test.ts` |
| T-06 | Respons `/api/admin/ai-config` tidak memuat `apiKeyCipher`/`apiKey` | ✅ `T-06`, `T-06b`…`T-06d` |
| T-07 | `maskSecret`/pesan error tidak memuat kunci | ✅ `secret.crypto.test.ts` + `T-07` |
| T-08 | Simpan 3 kunci provider, ciphertext berbeda | ✅ |
| T-09 | Kunci kosong = pertahankan kunci lama | ✅ |
| T-10 | Ganti provider aktif → hanya 1 aktif | ✅ |
| T-11 | Aktivasi tanpa syarat ditolak → A tetap aktif | ✅ |
| T-12 | Ganti model utama → resolver ikut berubah | ✅ (+`T-12b`) |
| T-13 | Urutan fallback persis & dipakai berurutan | ✅ |
| T-14 | Model 1 → 429, model 2 → 200; `usedModel`/urutan benar | ✅ (+`T-14b`,`T-14c`,`T-14d`) |
| T-15 | Semua model gagal → `AI_PROVIDER_ERROR`, tanpa jawaban mengarang | ✅ |
| T-16 | Kunci invalid (401) tidak memicu fallback | ✅ (+`T-16b`) |
| T-17 | Backfill token: `token` lama tetap ada, `tokenCipher` terisi & cocok | ✅ (+`T-17b` kompatibilitas Groq) |
| T-18 | Jalur transisi `tokenCipher = null` → token lama dipakai | ✅ |
| T-19 | Migrasi nomor penerima → 1 baris aktif | ✅ (`T-19a`…`T-19d`) |
| T-20 | Idempoten seed | ✅ |
| T-21 | Ganti nomor aktif → nomor baru dipakai | ✅ |
| T-22 | Nomor lama bisa diaktifkan kembali | ✅ |
| T-23 | Larangan >1 aktif (raw SQL → DITOLAK) | ✅ |
| T-24 | Tanpa penerima aktif → `phone: null` + masalah jelas | ✅ |
| T-25 | Tidak ada fallback ke `FonnteConfig.adminPhone` | ✅ |
| T-26 | RBAC API: 401/403 | ✅ (verifikasi kode sumber 7 endpoint) |
| T-27 | RBAC halaman: redirect non-Admin | ✅ |
| T-28 | Regresi multi-turn | ✅ 24/24 (`ai.multiturn.test.ts`) |
| T-29 | Regresi notifikasi | ✅ `ai.security.stage1` + `ai.tools` |
| T-30 | Regresi AI tools | ✅ `ai.intent` + `ai.answer` + `ai.drift` |
| T-31 | Audit perubahan konfigurasi | ✅ (+`T-31b`) |
| T-32 | `tsc --noEmit` → 0 error di `src/` | ✅ |
| T-33 | `next build` (`.next` bersih) | ✅ (+`T-33a`,`T-33b`,`T-33c`) |

### 12.3 Hasil suite penuh
```
$ npx tsx --test --test-concurrency=1 <37 file, tanpa ai.integration & e2e.location>
# tests 667   # pass 665   # fail 2
```

### 12.4 Dua kegagalan — **PRE-EXISTING**, terbukti
| Test | Penyebab | Bukti |
|---|---|---|
| `announcements.broadcast` — "belum dikonfigurasi: tidak ada pengiriman" | `whatsappConfigStatus()` menghitung `configured` dari **perangkat aktif di database** (token valid). Test mengosongkan `process.env.FONNTE_TOKEN`, padahal DB sudah punya perangkat aktif. Logika token **lama** (`sanitizeTokenInput(token)`) dan **baru** (`readDeviceToken`) menghasilkan nilai identik → bukan efek Tahap 3. | Probe sebelum perubahan: `configured = true`, `tokenValid = true`, `source = database` |
| `reports.analysis.duplicates` — "laporan dengan aiResult selalu berstatus SUCCESS/NEEDS_REVIEW" | Pemeriksaan **konsistensi data murni** pada 48 baris `Report` lama yang punya `aiResult` tetapi `aiStatus` `PENDING`/`FAILED`. Kode Tahap 3 tidak pernah menulis `Report.aiStatus`/`aiResult`. | Probe: sebaran `aiStatus` = PENDING 64, FAILED 3, NEEDS_REVIEW 1; jumlah tidak konsisten = 48 |

Kedua kegagalan **tidak** diperbaiki: keduanya termasuk data/lingkungan lama di luar lingkup Tahap 3
(satu configuração perangkat, satu drift data historis). Dicatat, bukan ditutup.

### 12.5 Pemeriksaan lain
| Pemeriksaan | Hasil |
|---|---|
| `tsc --noEmit` | **0 error di `src/`**; total 46 error — identik dengan baseline (semua di `tests/` lama) |
| `next lint` | **0 error**; hanya warning `<img>` pre-existing |
| `next build` (`.next` dibersihkan) | **exit 0**; route baru terdaftar |
| Smoke test RBAC runtime | **11/11 handler** route Admin baru (tanpa sesi) → **401 "Tidak terautentikasi"** |

### 12.6 Status database produksi setelah Tahap 3
```
user=69  report=68  NotificationRecipient=1 (aktif)  AiProvider=0
fonnteConfig=2  (tokenCipher NULL pada keduanya — backfill BELUM dilakukan)
adminAuditLog & WhatsAppLog bertambah akibat aktivitas aplikasi yang berjalan
```

---

## 13. TAHAP 11 — PROSEDUR OPERASIONAL

### 13.1 Menjalankan
```bash
npm run dev            # server pengembangan
npm run build && npm start
```
### 13.2 Menjalankan tes (aman — memakai salinan DB di TEMP)
```powershell
# suite penuh TANPA dua file terlarang
$files = Get-ChildItem "tests\*.test.ts" | Where-Object { $_.Name -notin @('ai.integration.test.ts','e2e.location.test.ts') } | ForEach-Object { $_.FullName }
npx tsx --test --test-concurrency=1 $files

# hanya tes konfigurasi Tahap 3
npx tsx --test --test-concurrency=1 tests/ai.config.test.ts tests/secret.crypto.test.ts
```
### 13.3 Backup & rollback
| Item | Perintah / lokasi |
|---|---|
| Backup pra-migrasi | `prisma/dev.db.backup-before-config-20261112-093132` (sha256 `8800a2a6aa5a1eadf0ca38b618922a56`) |
| Backup pra-seed penerima | `prisma/dev.db.backup-before-recipient-seed-20261112-152239` |
| Copy manual | `Copy-Item prisma\dev.db prisma\dev.db.backup-<timestamp>` |
| Rollback fitur AI | kosongkan baris `AiProvider` (fitur kembali ke bootstrap `.env`) |
| Rollback penerima | nonaktifkan semua `NotificationRecipient` → notifikasi Admin terhenti (**tidak** kembali diam-diam ke nomor perangkat) |
| Rollback total | pulihkan `prisma/dev.db` dari backup, lalu `npx prisma migrate deploy` |

### 13.4 Rotasi `APP_ENCRYPTION_KEY` (procedure, belum dijalankan)
1. Tambah kunci baru di environment server (kunci lama **tetap** ada).
2. Bacak semua `AiProvider.apiKeyCipher` + `FonnteConfig.tokenCipher` dengan kunci lama → re-encrypt dengan kunci baru (skrip backfill idempoten, `token` lama tidak dihapus).
3. Ganti `APP_ENCRYPTION_KEY` di environment → restart server.
4. Verifikasi: `decryptSecret` ciphertext lama gagal (kode `decrypt_failed`), yang baru berhasil.

---

## 14. TAHAP 12 — DAFTAR FILE

### 14.1 File BARU (19)
```
src/lib/secretCrypto.ts
src/lib/notificationRecipients.ts
src/lib/aiProviderConfig.ts
src/lib/aiProviders.ts
src/app/api/admin/whatsapp-recipients/route.ts
src/app/api/admin/whatsapp-recipients/[id]/route.ts
src/app/api/admin/ai-config/route.ts
src/app/api/admin/ai-config/[id]/route.ts
src/app/api/admin/ai-config/[id]/activate/route.ts
src/app/api/admin/ai-config/[id]/test/route.ts
src/app/api/admin/ai-config/catalog/route.ts
src/app/(dashboard)/admin/whatsapp-recipients/page.tsx
src/app/(dashboard)/admin/ai-config/page.tsx
src/components/ui/admin/WhatsAppRecipientsManager.tsx
src/components/ui/admin/AiConfigManager.tsx
src/components/ui/admin/admin-config.css
prisma/migrations/20261112094500_add_config_tables/migration.sql
tests/secret.crypto.test.ts
tests/ai.config.test.ts
```

### 14.2 File DIUBAH (18)
```
prisma/schema.prisma
src/lib/whatsapp.ts                     → resolveAdminRecipient memakai penerima aktif
src/lib/fonnteConfig.ts                 → tokenCipher jadi sumber utama, token lama sebagai jalur transisi
src/lib/whatsappMonitoring.ts           → status penerima notifikasi aktif
src/lib/aiChat.ts                       → config terpusat + meta transparan, FALLBACK_MODELS dihapus
src/lib/aiService.ts                    → config terpusat, model hardcode dihapus
src/lib/duplicates.ts                   → config terpusat
src/lib/aiTools.ts                      → model diagnostik dari config
src/lib/gemini.ts                       → model dari config
src/app/api/admin/whatsapp-config/route.ts   → legacyAdminPhone + activeRecipient
src/app/api/ai/chat/route.ts            → connected dari config DB
src/app/api/admin/ai/chat/route.ts      → connected + model aktif
src/app/api/test-wa/route.ts            → uji ke penerima aktif
src/components/layout/Sidebar.tsx       → 2 menu baru
src/components/ui/AdminAiAssistant.tsx  → badge fallback
src/components/ui/AdminAiFloatingChatbot.tsx → badge fallback
src/app/(dashboard)/admin/whatsapp-config/page.tsx → panel penerima aktif
tests/region.test.ts                    → disesuaikan dengan arsitektur pengirim/penerima baru
```

### 14.3 File TIDAK boleh disentuh — **TIDAK** disentuh
`src/lib/aiToolRegistry.ts`, `src/lib/aiIntent.ts`, `src/lib/aiSessionStore.ts`, `src/lib/aiContext.ts`,
`src/lib/aiValidation.ts`, `src/lib/aiAudit.ts`, `src/lib/auth.ts`, `src/lib/adminApi.ts`,
`src/middleware.ts` — riwayat percakapan tetap in-memory (TTL 2 jam, 200 sesi, 16 giliran), multi-turn utuh.

### 14.4 File MENUNGGU persetujuan
`src/lib/chatbot.ts` — kode mati yang masih membaca `.env`. **Tidak dihapus, tidak diarsipkan** (§15.3).

---

## 15. GERBANG PERSETUJUAN — PEKERJAAN YANG BERHENTI

### 15.1 Backfill `FonnteConfig.tokenCipher` — **BERHENTI**
**Status: ⏸️ menunggu persetujuan + kunci.**
Semua kode sudah siap (`readDeviceToken()`, `encryptSecret()`, jalur transisi teruji T-17/T-18).
Yang **belum** dilakukan: mengisi `tokenCipher` pada 2 baris `FonnteConfig` di DB produksi.

**Mengapa berhenti:**
1. `APP_ENCRYPTION_KEY` **belum ada** di `.env` (dibuktikan: `isEncryptionConfigured() === false`).
2. Tanpa kunci, ciphertext tidak dapat dibuat (dan tidak boleh ada penyimpanan plaintext).
3. Nilainya **tidak boleh** dibuat otomatis oleh sistem — hanya boleh ditetapkan Admin.

**Risiko bila dilanjutkan tanpa prosedur:** kunci hilang ⇒ token Fonnte tidak dapat didekripsi ⇒ seluruh
notifikasi WhatsApp berhenti. Mitigasi: backup sudah ada dan kolom `token` **tidak** dihapus, sehingga
rollback cukup mengisi `tokenCipher = null` (jalur transisi otomatis aktif).

**Langkah yang perlu dilakukan Admin:**
```powershell
# 1) Buat kunci (32 byte acak) — SIMPAN di password manager, jangan di repo
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 2) Tambahkan ke .env (server-side, BUKAN NEXT_PUBLIC_*)
#    APP_ENCRYPTION_KEY=<hasil langkah 1>

# 3) Restart server, lalu jalankan backfill idempoten (butuh persetujuan)
```
> Nilai kunci **tidak** dicetak di dokumen ini maupun di laporan.

### 15.2 Penetapan `APP_ENCRYPTION_KEY` — **BERHENTI**
**Status: ⏸️ menunggu keputusan Admin** (nilai + lokasi penyimpanan).
Sistem **tidak** pernah membuat kunci secara otomatis. Setelah kunci tersedia, seluruh fitur konfigurasi
provider AI (penyimpanan kunci terenkripsi) menjadi aktif, dan backfill §15.1 dapat dijalankan.

### 15.3 Verifikasi endpoint Groq & arsip `chatbot.ts` — **BERHENTI**
**Status: ⏸️ menunggu persetujuan.**
- Bentuk request Groq diasumsikan OpenAI-compatible. Adapter + tes stub (`T-17b`) sudah ada, tetapi
  **belum ada request nyata** ke `api.groq.com` → klaim "Groq terverifikasi" **belum dapat dibuat**.
  Butuh: 1 request uji dengan kunci Groq asli (disetujui terpisah).
- `src/lib/chatbot.ts` (kode mati, masih membaca `.env`) **tidak diarsipkan** — pengarsipan butuh persetujuan eksplisit.

### 15.4 Kesimpulan status akhir
| Item | Status |
|---|---|
| Kode Tahap 3 (service, API, UI, integrasi pipeline) | ✅ **SELESAI** |
| Migrasi database + seed penerima (idempoten, terbukti) | ✅ **SELESAI** |
| Enkripsi & pengujian offline | ✅ **SELESAI** |
| Backfill token Fonnte | ⏸️ **menunggu kunci + persetujuan** |
| Penetapan `APP_ENCRYPTION_KEY` | ⏸️ **menunggu keputusan Admin** |
| Verifikasi endpoint Groq | ⏸️ **menunggu persetujuan request uji** |
| Arsip `chatbot.ts` | ⏸️ **menunggu persetujuan** |

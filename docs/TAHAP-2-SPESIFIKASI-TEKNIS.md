# TAHAP 2 — SPESIFIKASI TEKNIS FINAL
## Konfigurasi WhatsApp (Penerima Notifikasi) & Konfigurasi Asisten AI
### Sistem Pelaporan Fasilitas Umum Desa Ciperna

**Status dokumen:** spesifikasi (analisis & dokumentasi) — **tidak ada perubahan source code, database, schema, `.env`, konfigurasi, maupun data.**
**Tanggal:** 12 November 2026
**Basis:** Audit Tahap 1 (arsitektur WhatsApp + AI), temuan recovery `aiTools.ts`, hasil Stage 1–3 (multi-turn), audit website.

---

## 1. Ringkasan keputusan produk

### 1.A Konfigurasi WhatsApp

| # | Keputusan | Konsekuensi teknis |
|---|---|---|
| A1 | Fonnte tetap provider pengiriman | `fonnteConfig.ts` tetap SSOT perangkat **pengirim** |
| A2 | Pisahkan perangkat pengirim dari daftar penerima Admin | Tabel baru `NotificationRecipient`; `FonnteConfig.adminPhone` **tetap ada** (tidak dihapus) |
| A3 | Nomor `adminPhone` lama jadi penerima aktif pertama | Migrasi seed: salin `adminPhone` perangkat aktif → `NotificationRecipient(isActive=true)` |
| A4 | Migrasi aman, data asal tidak dihapus | Tambah tabel + baris baru; `FonnteConfig` **tidak diubah nilainya** |
| A5 | Admin menyimpan beberapa nomor penerima | CRUD `NotificationRecipient` |
| A6 | Hanya satu nomor aktif | Partial UNIQUE INDEX (SQLite 3.45 **terbukti mendukung**) + transaksi atomik |
| A7 | Ganti nomor aktif → notifikasi berikutnya pakai yang baru | Resolusi penerima **dibaca tiap pengiriman**, tanpa cache |
| A8 | Nomor lama tetap tersimpan & dapat diaktifkan lagi | Tidak ada hard-delete; `isActive` hanya flag |
| A9 | Tanpa penerima aktif → hentikan, catat gagal, tanpa fallback diam-diam | `resolveAdminRecipient()` sudah punya pola ini → di adapting |
| A10 | Nomor pengirim ≠ nomor penerima | Dua entitas berbeda, tidak ada foreign key silang |

### 1.B Konfigurasi AI

Provider wajib: **OpenRouter**, **Google Gemini**, **Groq**.

| # | Keputusan | Konsekuensi teknis |
|---|---|---|
| B1–B2 | Tiap provider punya key sendiri; semua key dapat tersimpan bersamaan | Tabel `AiProvider` (1 baris per provider) |
| B3 | Key persisten & **terenkripsi** di DB | Kolom `apiKeyCipher` (AES-256-GCM), bukan plaintext |
| B4 | Ganti provider aktif tanpa mengetik ulang key | `PATCH` tanpa `apiKey` → key lama dipertahankan (pola `buildFonnteConfigPatch`) |
| B5 | Admin memilih model utama | Kolom `primaryModel` per provider |
| B6 | Admin mengatur urutan model cadangan | Kolom `fallbackModels` (JSON array) per provider |
| B7 | Fallback transparan | `meta.fallbackModels[]` + `meta.usedProvider`/`usedModel`; badge di UI |
| B8 | Catat provider & model yang benar-benar dipakai | `meta` pada respons + `AdminAuditLog` (`AI_TOOL_*`) |
| B9 | Semua model gagal → kegagalan jelas, tanpa jawaban palsu | Fallback deterministik yang sudah ada (`formatFallbackAnswer`) + `errorKind` |
| B10 | Semua pipeline pakai konfigurasi terpusat, tanpa key/model hardcode | `aiProviderConfig.ts` sebagai SSOT; hapus 4 model ID hardcode |

### 1.C Riwayat percakapan AI
In-memory **dipertahankan** (`aiSessionStore.ts`): TTL 2 jam, ≤200 sesi, ≤16 giliran, kunci `userId:sessionId`, isolasi per-role (Stage 3). **Tidak ada penyimpanan permanen ke DB pada tahap ini.** Multi-turn (24/24 tes) **tidak boleh rusak**.

### 1.D Keamanan
`APP_ENCRYPTION_KEY` di `.env` server; AES-256-GCM; kunci tidak pernah ke browser; token Fonnte **existing** ikut dienkripsi (rencana migrasi); rahasia tidak pernah di API/UI/log; halaman & API konfigurasi **Admin-only** dengan `requireAdmin()`; RBAC/auth/RBAC existing **tidak boleh dikurangi**.

### 1.E Struktur menu
| Menu | Isi |
|---|---|
| **Pusat WhatsApp Admin** (`/admin/whatsapp-config`) | Konfigurasi perangkat **pengirim** Fonnte (tetap) |
| **Penerima Notifikasi** (`/admin/whatsapp-recipients`) | Kelola nomor penerima Admin |
| **Konfigurasi Asisten AI** (`/admin/ai-config`) | API Key provider, model utama, urutan fallback |
| **Diagnostik** (`/admin/ai-config/diagnostics` atau tab) | Pemeriksaan konektivitas & status konfigurasi |

---

## 2. Arsitektur sistem yang direkomendasikan

```
┌────────────────────────── ADMIN UI (RBAC: middleware + requireAdmin) ─────────────────────────┐
│ /admin/whatsapp-config      /admin/whatsapp-recipients     /admin/ai-config (+diagnostik)  │
│ (perangkat pengirim Fonnte)  (penerima notifikasi Admin)   (provider AI: key, model, fallback)│
└───────────────┬──────────────────────┬──────────────────────────────┬──────────────────────────┘
                │                      │                              │
      api/admin/whatsapp-config  api/admin/whatsapp-recipients   api/admin/ai-config
                │                      │                              │
                ▼                      ▼                              ▼
    ┌───────────────────┐   ┌────────────────────────┐   ┌──────────────────────────────┐
    │ fonnteConfig.ts   │   │ notificationRecipients │   │ aiProviderConfig.ts          │
    │ (SSOT pengirim)   │   │ .ts (SSOT penerima)    │   │ (SSOT provider AI)          │
    └─────────┬─────────┘   └───────────┬────────────┘   └──────────────┬───────────────┘
              │                          │                               │
              │      secretCrypto.ts (AES-256-GCM, APP_ENCRYPTION_KEY)  │
              ▼                          ▼                               ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │ Prisma: FonnteConfig(tokenCipher) | NotificationRecipient | AiProvider │
        └──────────────────────────────────────────────────────────────────────┘
              │                          │                               │
              ▼                          ▼                               ▼
    ┌───────────────────┐   ┌────────────────────────┐   ┌──────────────────────────────┐
    │ whatsapp.ts       │   │ 9 notify* admin        │   │ aiChat.ts  (asisten utama)  │
    │ deliverMessage()  │◄──┤ resolveAdminRecipient() │   │ aiService.ts (analisis)     │
    │ recordLog()       │   │ (penerima AKTIF)       │   │ duplicates.ts (duplikat)    │
    └───────────────────┘   └────────────────────────┘   └──────────────────────────────┘
```

**Prinsip arsitekturnal**

1. **Satu SSOT per domain** — `fonnteConfig.ts` (pengirim), `notificationRecipients.ts` (penerima), `aiProviderConfig.ts` (AI).
2. **Pemisahan pengirim/penerima** tanpa coupling silang.
3. **Secret hanya di server** — ciphertext di DB, plaintext hanya di memori server saat dipakai.
4. **Konfigurasi dibaca per pemakaian** (tanpa cache) → perubahan berlaku di pengiriman berikutnya.
5. **Fallback eksplisit** — tidak ada model/penyedia cadangan yang dipakai diam-diam; pemakaian dilaporkan.
6. **Idempotensi dipertahankan** — `WhatsAppLog.dedupeKey` unik; tidak bergantung nomor.

---

## 3. Rancangan tabel Prisma

### 3.1 `NotificationRecipient` — penerima notifikasi Admin

```prisma
// PENERIMA NOTIFIKASI ADMIN (terpisah dari perangkat pengirim Fonnte).
//
// Prinsip:
//  - Satu nomor boleh berstatus AKTIF dalam satu waktu. Dijamin partial
//    UNIQUE INDEX (SQLite 3.45 mendukung) + transaksi atomik.
//  - Nomor TIDAK pernah dihapus permanen; tidak aktif = isActive=false
//    sehingga dapat diaktifkan kembali.
//  - Tidak menyimpan kredensial apa pun.
model NotificationRecipient {
  id        String   @id @default(uuid())
  label     String              // "Admin Utama", "Admin Backup"
  phone     String              // 62xxxxxxxxxx (dinormalisasi)
  isActive  Boolean  @default(false)
  notes     String?             // catatan internal (mis. alasan penggantian)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([isActive])
  @@index([phone])
}
```

**Partial unique index** (di luar deklarasi Prisma, dibuat di migrasi SQL):
```sql
CREATE UNIQUE INDEX "NotificationRecipient_one_active" ON "NotificationRecipient"("isActive") WHERE "isActive" = 1;
```
> **TERBUKTI** (probe pada file sementara di `%TEMP%`, SQLite 3.45.0): index parsial **dapat dibuat**, insert active kedua **DITOLAK**, insert non-active **berhasil** (tanpa batas), dan swap atomik via `prisma.$transaction([...])` **berhasil**. Ini menjamin "hanya satu aktif" di level DB, bukan hanya konvensi aplikasi.

### 3.2 `AiProvider` — konfigurasi provider AI

```prisma
// KONFIGURASI PROVIDER AI (satu baris per provider).
//
// Prinsip:
//  - API Key disimpan TERENKRIKSI (AES-256-GCM). Ciphertext tidak pernah
//    dikirim ke browser; UI hanya melihat flag hasApiKey.
//  - Chain model: primaryModel -> fallbackModels[0] -> fallbackModels[1] ...
//    Fallback bersifat EKSPLISIT (diatur Admin) dan dilaporkan di meta.
//  - Satu provider boleh berstatus AKTIF pada satu waktu.
model AiProvider {
  id              String   @id @default(uuid())
  provider        String              // "openrouter" | "gemini" | "groq"
  label           String              // "OpenRouter Utama"
  apiKeyCipher    String?             // ciphertext AES-256-GCM; null = belum diisi
  isActive        Boolean  @default(false)
  primaryModel    String?             // mis. "google/gemma-4-31b-it:free"
  fallbackModels  String?             // JSON array ["model-a","model-b"]
  models          String?             // JSON array kandidat (hasil fetch katalog)
  lastValidation  DateTime?
  lastError       String?             // kode aman (bukan pesanMentah)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([provider])
  @@index([isActive])
}
```
Partial unique index:
```sql
CREATE UNIQUE INDEX "AiProvider_one_active" ON "AiProvider"("isActive") WHERE "isActive" = 1;
```

### 3.3 Perubahan pada `FonnteConfig` (menghormati A4 & D5)

```prisma
model FonnteConfig {
  id        String   @id @default(uuid())
  token     String   // SEMENTARA: plaintext (eksisting). Rencana: -> tokenCipher
  tokenCipher String? // cipher AES-256-GCM; jadi SSOT bila token legacy sudah dienkripsi
  adminPhone String   // DIJAGA (tidak dihapus) - sumber migrasi penerima
  deviceName String?
  lastValidation DateTime?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```
> `adminPhone` **tidak dihapus** — dipakai sebagai sumber migrasi (A3) dan tetap sebagai fallback bootstrap. `token` **tidak dihapus** (A4/D5: "rencanakan", bukan hapus paksa) → `tokenCipher` menjadi SSOT bila ada; `token` dipakai hanya bila `tokenCipher` null (jalur transisi).

### 3.4 Constraint & index (ringkasan)

| Constraint | Mekanisme | Status |
|---|---|---|
| 1 penerima aktif | Partial UNIQUE INDEX + `prisma.$transaction` | **TERBUKTI jalan** |
| 1 provider AI aktif | Partial UNIQUE INDEX + transaksi | Pola sama, **TERBUKTI** |
| Nomor penerima unik | `@@index([phone])` (bukan UNIQUE — nomor boleh didaftarkan ulang) | — |
| 1 provider per jenis | `@@unique([provider])` | — |
| FK antar tabel | **TIDAK ADA** ( disengaja) | Pengirim & penerima independen (A10) |
| Log pengiriman | `WhatsAppLog.dedupeKey` @unique | Dipertahankan |

---

## 4. Relasi dan constraint database

```
FonnteConfig (pengirim)          NotificationRecipient (penerima)      AiProvider (AI)
  id, token/tokenCipher            id, label, phone, isActive          id, provider, apiKeyCipher,
  adminPhone (legacy, dijaga)      createdAt, updatedAt                 isActive, primaryModel,
  deviceName, isActive                                                 fallbackModels, models
        │                                    │                                │
        │ (TIDAK ada relasi)                 │ (TIDAK ada relasi)             │
        └──────────────┬─────────────────────┴────────────────────────────────┘
                       ▼
             (tidak ada FK silang; kedua domain berdiri sendiri)
```

**Alasan tidak memakai FK:**
- Nomor pengirim Fonnte **tidak boleh** otomatis menjadi penerima (A10).
- Migrasi A3 butuh memindahkan `adminPhone` → `NotificationRecipient` **tanpa** mengikat device ke recipient (jika recipient di-nonaktifkan, device tetap jalan).
- Menghapus device tidak boleh menghapus nomor penerima.
- independence = rollback aman.

**Relasi implisit (di level service, bukan DB):**
- `resolveAdminRecipient()` → `NotificationRecipient(isActive=true)` + `resolveActiveFonnteConfig()` (untuk token pengirim).
- Keduanya independen: token dari device, nomor tujuan dari recipient.

---

## 5. Strategi enkripsi

### 5.1 Prim: AES-256-GCM (Node `crypto`, tanpa dependency baru)

**Alasan teknis:**
- `node:crypto` sudah tersedia (Node 18+), tanpa menambah dependensi (prinsip "jangan tambah dependency").
- GCM = AEAD →同時 detection integritas (tag), bukan hanya confidentiality.
- Kunci enkripsi **tidak** disimpan di DB (kalau iya, attacker DB bisa dekripsi).

**Format ciphertext (tersimpan di 1 kolom String):**
```
v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
```
- `v1` = versi format → memungkinkan rotasi kunci di masa depan.
- IV 12 byte random per enkripsi (GCM nonce **tidak boleh** diulang).
- Auth tag 16 byte.

**API baru (`src/lib/secretCrypto.ts`):**
| Fungsi | Tanda tangan | Perilaku |
|---|---|---|
| `getEncryptionKey()` | `() => Buffer` | Baca `APP_ENCRYPTION_KEY` dari env. **32 byte** (base64 44 char) atau 64 hex char. Kalau absen → `throw` dengan pesan aman (tanpa nilai). |
| `encryptSecret(plain)` | `(string) => string` | `v1:iv:tag:ct`. Input kosong → `''`. |
| `decryptSecret(cipher)` | `(string) => string` | Salah format / tag invalid → `throw` kode aman (`decrypt_failed`), **tanpa** bocor nilai. |
| `isEncrypted(v)` | `(string) => boolean` | Deteksi prefix `v1:` → untuk jalur transisi `FonnteConfig`. |
| `maskSecret(v)` | `(string) => string` | Untuk log: tampilkan `•••1234` (4 char terakhir). |

### 5.2 Strategi `APP_ENCRYPTION_KEY`

| Aspek | Rekomendasi | Alasan |
|---|---|---|
| Nama | `APP_ENCRYPTION_KEY` | Sesuai keputusan produk D3; pola `APP_*` sudah dipakai `APP_URL`. |
| Format | 32 byte acak, di-encode **base64** (44 char) | Tidak ambigu & tidak perlu tool khusus. Hex 64 char juga diterima. |
| Dibuat | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | 1 perintah, tanpa dependensi. |
| Lokasi | `.env` **server** | Tidak pernah `NEXT_PUBLIC_*` → tidak masuk bundel klien. |
| Rotasi | `v1:` version prefix | Mendukung `APP_ENCRYPTION_KEY_V2` di masa depan tanpa mengubah format kolom. |
| Kehilangan kunci | **Fatal**: data terenkripsi tidak bisa didekripsi | Wajib dicadangkan di tempat aman (password manager) & didokumentasikan. **Butuh keputusan Admin.** |
| Ganti kunci | Butuh re-encrypt semua baris | Harus punya skrip migrasi; **di luar cakupan tahap ini** → cukup_error message aman. |

**Fallback bila `APP_ENCRYPTION_KEY` belum ada:**
- `secretCrypto.encryptSecret()` → **throw** `encryption_key_missing` (bukan diam-diam plaintext).
- Halaman konfigurasi menampilkan banner "Enkripsi belum aktif" + tombol disabled untuk simpan key.
- **Tidak** ada mode plaintext tersembunyi (melanggar D2).

### 5.3 Enkripsi token Fonnte yang sudah ada (D5)

Rencana 2 tahap (agar data lama tidak rusak):
| Tahap | Aksi | Reversibel |
|---|---|---|
| E-1 | Tambah kolom `tokenCipher` (nullable). Token lama tetap plaintext & tetap dipakai. | Ya |
| E-2 | Script migrasi **backfill**: untuk setiap `FonnteConfig` dengan `token` terisi & `tokenCipher` null → `tokenCipher = encrypt(token)`. **Token lama TIDAK dihapus** (A4/D5 "rencanakan"). | Ya (data lama utuh) |
| E-3 | Kode baca: `tokenCipher ?? token` (jalur transisi). | Ya |
| E-4 | (Opsional, perlu persetujuan) Kolom `token` di-namespace-kan/dikosongkan setelah verifikasi. **Tidak dilakukan pada tahap ini.** | — |

**Penting:** jangan pernah menjalankan backfill tanpa backup `prisma/dev.db` ( lihat §14).

---

## 6. Strategi migrasi data lama

### 6.1 Migrasi nomor `adminPhone` → `NotificationRecipient` (A3, A4)

**Sumber:** `FonnteConfig` dengan `isActive = true` (hanya 1 devices yang aktif saat ini) → `adminPhone`.

**Algoritma (idempoten, aman diulang):**
```
1. Baca FonnteConfig WHERE isActive = true (ambil yang terbaru bila >1).
2. Bila tidak ada device aktif → tidak ada migrasi; tabel tetap kosong.
3. Bila NotificationRecipient sudah punya baris dengan phone yang sama → skip (idempoten).
4. Insert baris:
     label    = "Admin Utama (migrasi dari perangkat Fonnte)"
     phone    = normalizePhoneTo62(adminPhone)
     isActive = true
     notes    = "Dibuat otomatis saat migrasi dari FonnteConfig.adminPhone"
5. JANGAN sentuh FonnteConfig (token, adminPhone, isActive tidak berubah).
```

**Hasil terverifikasi (audit Tahap 1, read-only):** 2 perangkat, 1 aktif (`isActive=true`) dengan `adminPhone` valid (format 62…). 1 baris-awal akan terbentuk.

**Kapan dijalankan:** sebagai **bagian dari migrasi schema** (tabel dibuat + seed) atau sebagai **script aplikasi sekali jalan** (idempoten, berbasis `INSERT ... WHERE NOT EXISTS`).

> **Keputusan yang dibutuhkan:** seed via migrasi SQL ( deterministik, tapi menyalin nomor ke dalam file migrasi — **rahasia-ish, jangan**) **atau** via script aplikasi (nomor dibaca server saat runtime, tidak masuk file migrasi).
> **Rekomendasi: script aplikasi idempoten** — alasan: nomor pribadi tidak pernah tertulis di file migrasi yang bisa ter-commit.

### 6.2 Migrasi token Fonnte (E-2, lihat §5.3)

### 6.3 Yang TIDAK boleh disentuh
`User` (akun, password hash, role, RT), `Report`, `Assignment`, `ReportStatusHistory`, `Notification`, `AnnouncementDelivery`, `WhatsAppLog`, `AdminAuditLog`, `AiKnowledgeEntry`, `VillageProfile/Official/Service/Announcement`, `RegistrationOtp`, `AccountToken`, `VillageRw/Rt`. **Tidak ada** `DELETE`/`TRUNCATE`/`DROP` pada tabel lama. Migrasi **additive** (CREATE TABLE baru, ALTER TABLE ADD COLUMN nullable).

---

## 7. Rancangan API

### 7.1 `NotificationRecipient` — `/api/admin/whatsapp-recipients`

| Method | Rute | Guard | Deskripsi |
|---|---|---|---|
| GET | `/api/admin/whatsapp-recipients` | `requireAdmin()` | Daftar penerima. **Tidak** mengirim nomor tersembunyi — nomor memang ditampilkan (bukan rahasia) tapi ditampilkan masked sebagian? **Rekomendasi: tampilkan penuh** (Admin butuh mengoreksi nomor) — namun `phone` dikirim sebagai `masked` + `phone` penuh hanya bila Admin.UTHAMA. simpler: kirim penuh; ini data milik Admin sendiri. |
| POST | `/api/admin/whatsapp-recipients` | `requireAdmin()` | Tambah penerima. Body: `{label, phone, isActive?}`. Validasi `normalizePhoneTo62` (08xx/62xx). Duplikat nomor → 400. |
| PATCH | `/api/admin/whatsapp-recipients/[id]` | `requireAdmin()` | Ubah `label`/`phone`/`isActive`. `isActive: true` → **transaksi**: nonaktifkan yang lain, aktifkan ini (dijamin partial UNIQUE INDEX). |
| DELETE | `/api/admin/whatsapp-recipients/[id]` | `requireAdmin()` | Soft-delete: `isActive=false` + `notes` alasan. **Tidak ada hard delete** (A8). |

**Respons konvensi** (mengikuti `adminApi.ts`):
```ts
const auth = await requireAdmin();
if (!auth.ok) return auth.response;
```

### 7.2 `AiProvider` — `/api/admin/ai-config`

| Method | Rute | Guard | Deskripsi |
|---|---|---|---|
| GET | `/api/admin/ai-config` | `requireAdmin()` | Daftar provider. **Response TIDAK pernah memuat `apiKeyCipher`**. Mengembalikan `{provider, label, isActive, primaryModel, fallbackModels, models, hasApiKey: boolean, lastValidation, lastError}`. |
| POST | `/api/admin/ai-config` | `requireAdmin()` | Tambah provider (`provider` unik). `apiKey` opsional (kosong → belum diisi). |
| PATCH | `/api/admin/ai-config/[id]` | `requireAdmin()` | Ubah label/key/model/fallback/aktif. **Token kosong = pertahankan key lama** (pola `buildFonnteConfigPatch`). |
| DELETE | `/api/admin/ai-config/[id]` | `requireAdmin()` | Soft-delete (`isActive=false` + `notes`). Key **tidak** dihapus dari DB (tetap terenkripsi) → dapat diaktifkan kembali. |
| POST | `/api/admin/ai-config/[id]/test` | `requireAdmin()` | **Tes konektivitas**: 1 request ke provider dengan key terdekripsi. Body: `{model?}`. Response: `{ok, provider, model, status, latencyMs, error?}`. **Tidak** mengirim key ke klien. Wajib rate-limit (mis. 5/menit per Admin). |
| POST | `/api/admin/ai-config/[id]/activate` | `requireAdmin()` | Aktifkan provider (transaksi: nonaktifkan yang lain). |
| GET | `/api/admin/ai-config/catalog?provider=openrouter` | `requireAdmin()` | Daftar model kandidat (fetch katalog, **hanya** model id + nama + ctx). Cache 6 jam. |

### 7.3 Perubahan route yang ada

| Route | Perubahan |
|---|---|
| `GET /api/admin/whatsapp-config` | Kembalikan `adminPhone` perangkat sebagai `legacyAdminPhone` (informasi migrasi) **dan** `activeRecipient` (nomor penerima aktif saat ini) — supaya UI bisa menampilkan二者. |
| `GET /api/ai/chat`, `GET /api/admin/ai/chat` | `connected` sekarang dari config DB (bukan `!!process.env.OPENROUTER_API_KEY`), plus `provider`/`model` aktif. |
| `POST /api/admin/whatsapp-config` | Tetap; **tidak** menyimpan `adminPhone` sebagai penerima aktif lagi (penerima pindah ke tabel baru). `adminPhone` tetap diisi sebagai referensi perangkat. |

### 7.4 Bentuk respons konfigurasi AI (tanpa rahasia)

```jsonc
{
  "providers": [
    {
      "id": "...",
      "provider": "openrouter",
      "label": "OpenRouter Utama",
      "isActive": true,
      "primaryModel": "google/gemma-4-31b-it:free",
      "fallbackModels": ["liquid/lfm-3-1.7b:free"],
      "hasApiKey": true,          // hanya flag, bukan nilai
      "lastValidation": "2026-11-12T02:00:00.000Z",
      "lastError": null
    }
  ],
  "active": { "provider": "openrouter", "model": "google/gemma-4-31b-it:free" },
  "encryptionReady": true        // APP_ENCRYPTION_KEY tersedia?
}
```

---

## 8. Rancangan halaman Admin

| Halaman | Rute | Komponen | Pola dasar |
|---|---|---|---|
| **Pusat WhatsApp Admin** (tetap) | `/admin/whatsapp-config` | 897 baris, sudah ada | Tidak diubah, hanya ditambah panel kecil "Penerima aktif saat ini: 08xx (Admin Utama)" + link ke `/admin/whatsapp-recipients` |
| **Penerima Notifikasi** (baru) | `/admin/whatsapp-recipients` | Server component + client form (mirip pola `whatsapp-config`) | Daftar kartu: label, nomor (masked sebagian), badge AKTIF, tombol "Aktifkan", modal tambah/edit/hapus |
| **Konfigurasi Asisten AI** (baru) | `/admin/ai-config` | Server component + client form | Kartu per provider: nama, badge AKTIF, `hasApiKey` ✔/✖, model utama (select), daftar fallback (reorder), tombol "Tes Konektivitas", "Aktifkan" |
| **Diagnostik** | tab di `/admin/ai-config` (atau `/admin/ai-config/diagnostics`) | Reuse `runAiDiagnostics()` (15 domain) + status per provider | Diagnostik AI yang ada sudah thorough |

**Komponen reusable:** `AdminAiFloatingChatbot` (badge fallback), `AdminAiAssistant` (menampilkan `meta.fallbackModels`), `clientFeedback.describeFailure` (pesan error).

**Sidebar** (`Sidebar.tsx`, grup "Operasional"):
```
{ href: '/admin/whatsapp-config',   icon: '📱', label: 'Pusat WhatsApp Admin' }   (tetap)
{ href: '/admin/whatsapp-recipients', icon: '👥', label: 'Penerima Notifikasi' }   (BARU)
{ href: '/admin/pusat-pengetahuan', icon: '🧠', label: 'Pusat Pengetahuan AI' } (tetap)
{ href: '/admin/ai-config',          icon: '🤖', label: 'Konfigurasi Asisten AI' }    (BARU)
```
Semua di bawah `groupsFor('ADMIN')` → otomatis Admin-only.

**Pola pembatasan role:** `Sidebar` menampilkan menu per role + `middleware`Protect + `requireAdmin()` di API. **Menyembunyikan menu BUKAN proteksi** → API wajib `requireAdmin()`.

---

## 9. Alur konfigurasi provider AI

### 9.1 Resolusi konfigurasi aktif (SSOT baru)

`src/lib/aiProviderConfig.ts`:
```ts
export interface ResolvedAiConfig {
  source: 'database' | 'env' | 'none' | 'error';
  provider: 'openrouter' | 'gemini' | 'groq' | null;
  apiKey: string;               // plaintext, HANYA di memori server
  primaryModel: string | null;
  fallbackModels: string[];     // urutan Admin
  problems: string[];           // aman untuk UI/log
  lastValidation: Date | null;
  totalProviders: number;
}
export async function resolveActiveAiProvider(): Promise<ResolvedAiConfig>
```
**Aturan (paralel `resolveActiveFonnteConfig`):**
1. Tabel `AiProvider` kosong → **bootstrap dari `.env`**: `OPENROUTER_API_KEY`+`OPENROUTER_MODEL`, lalu `GEMINI_API_KEY`+`GEMINI_MODEL`. Source `'env'`.
2. Ada provider aktif di DB → **tidak** fallback ke `.env` (A9/B10: tanpa diam-diam mengabaikan pilihan Admin). Source `'database'`.
3. Gagal baca DB → `source:'error'`, `problems` jelas, **hentikan** (jangan pakai `.env` diam-diam).
4. Provider aktif tanpa key / tanpa model → `problems` diisi, `apiKeyValid:false`, pipeline memakai jalur fallback deterministik.

### 9.2 Kontrak provider

```ts
export interface AiProviderSpec {
  id: 'openrouter' | 'gemini' | 'groq';
  label: string;
  endpoint: string;
  style: 'openai-compatible' | 'gemini-sdk';
  envFallbackKey?: string;
  envFallbackModel?: string;
}
```
| Provider | Endpoint | Gaya | Catatan |
|---|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | OpenAI-compatible | Sudah dipakai; header `HTTP-Referer`+`X-Title` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` | OpenAI-compatible | **BARU** — header `Authorization: Bearer <key>`; body identik OpenRouter → cukup adapter tipis. *Endpoint wajib divalidasi saat implementasi (belum diverifikasi di audit — lihat §14)* |
| Gemini | `@google/generative-ai` SDK (`gemini-1.5-flash`/`gemini-3.8-flash` hardcode saat ini) | Gemini SDK | Butuh `apiKey` dari config DB → SDK menerima key eksplisit (`new GoogleGenerativeAI(apiKey)`), bukan hanya `process.env` → **sudah mendukung key dari DB tanpa ubah** |

> Groq & OpenRouter berbagi bentuk "OpenAI-compatible" → **satu adapter** untuk keduanya. Gemini beda → adapter sendiri. Ini menjaga `aiChat.ts` tetap satu jalur.

### 9.3 Alurkonfigurasi (Admin)

```
1. Buka /admin/ai-config
   → GET /api/admin/ai-config → daftar provider (hasApiKey, model, fallback), encryptionReady
2. Admin pilih provider (OpenRouter / Gemini / Groq) → "Tambah"
   → POST {provider, label, apiKey?, primaryModel?, fallbackModels?}
   → apiKey dienkripsi SEBELUM disimpan (jika encryptionReady)
   → dikembalikan: {id, provider, hasApiKey:true}   ← nilai key TIDAK dikembalikan
3. Admin isi model utama → dropdown kandidat (GET .../catalog) atau ketik manual
4. Admin atur urutan fallback → array (drag/↑↓/textarea satu per baris)
5. Admin "Tes Konektivitas" → POST .../[id]/test → 1 request ke provider
   → {ok, status, latencyMs, error?}; key tidak keluar dari server
6. Admin "Aktifkan" → POST .../[id]/activate → transaksi (nonaktifkan yang lain)
   → provider aktif dipakai SEMUA pipeline pada request BERIKUTNYA
7. Semua perubahan → logAdminAction({action:'AI_CONFIG_*'}) → AdminAuditLog
```

**API key kosong saat edit = pertahankan key lama** (pola `buildFonnteConfigPatch` yang sudah ada & teruji).

---

## 10. Alur fallback AI

### 10.1 Rantai percobaan (transparan)

```
provider aktif (dari DB)
  └─ primaryModel
       └─ fallbackModels[0]
            └─ fallbackModels[1]
                 └─ ... (bounded, mis. maks 4 total)
                      └─ GAGAL SEMUA → jalur deterministik (formatFallbackAnswer)
```

### 10.2 Pelaporan transparan

`meta` respons `handleChatRequest` getsumbertambahan:
```ts
meta.usedProvider: 'openrouter' | 'gemini' | 'groq' | null;
meta.usedModel: string | null;
meta.fallbackModels: string[];      // model yang GAGAL dan dicoba
meta.fallbackProvider: string | null; // bila pindah ke provider lain
meta.providerChain: string[];       // urutan percobaan
```
UI (`AdminAiAssistant`, `AdminAiFloatingChatbot`): badge kecil
*"Dijawab model cadangan: `<model>`"* bila `meta.fallbackModels.length > 0`.

### 10.3 Aturan kegagalan (B9)

| Kondisi | Perilaku | `errorKind` |
|---|---|---|
| Semua model/provider gagal | **JANGAN** jawaban palsu. Pakai `formatFallbackAnswer()` dari data tool yang berhasil; bila tak ada data → pesan jujur "data belum dapat diperiksa" | `AI_PROVIDER_ERROR` |
| Provider aktif tanpa key | Pesan jelas + tombol arah ke `/admin/ai-config` | `AI_NOT_CONFIGURED` (kode baru) |
| Key invalid (401/403) | **Berhenti**, jangan coba provider lain untuk key yang sama | `AI_AUTH_FAILED` |
| Kuota habis (402) | Berhenti untuk provider itu; coba provider **berbeda** bila ada | `AI_QUOTA` |
| Rate limit (429) | Coba model/provider berikutnya | `AI_RATE_LIMIT` |
| Model tidak ada (404) | Coba model berikutnya | `AI_MODEL_GONE` |
| Timeout | Coba berikutnya; habis → deterministik | `AI_TIMEOUT` |

### 10.4 Pipeline yang wajib pakai konfigurasi terpusat (B10)

| # | Pipeline | File | Aksi |
|---|---|---|---|
| P1 | Asisten chat utama | `src/lib/aiChat.ts` | `callWithFallback()` → ganti model chain dari config; hapus `FALLBACK_MODELS` hardcode; tambah meta transparan |
| P2 | Analisis laporan | `src/lib/aiService.ts` | `analyzeReport()` → pilih provider dari config (bukan `GEMINI_API_KEY?`); hapus `DEFAULT_MODEL='gemini-3.8-flash'` hardcode & fallback diam-diam Gemini→OpenRouter |
| P3 | Assistant duplikat | `src/lib/duplicates.ts` | Ambil key+model dari config (bukan `.env` langsung) |
| P4 | **Kode mati** | `src/lib/chatbot.ts` | **Tidak** dipakai route mana pun (`api/chat` → `handleChatRequest`). Rekomendasi: **arsipkan** (perlu persetujuan; Dilarang hapus pada tahap ini) |
| P5 | Diagnostik AI | `src/lib/aiTools.ts:2452` | `model:` → dari config aktif |
| P6 | Status koneksi | `api/ai/chat`, `api/admin/ai/chat` | `connected` → dari config DB |

> **Catatan:** P2 & P3 saat ini **tidak punya** rantai fallback → harus gained agar konsisten dengan B6/B7.

### 10.5 Penghapusan model hardcode (B10)

| Lokasi | Hardcode | remplacer |
|---|---|---|
| `aiService.ts:357` | `openai/gpt-4o-mini` | `config.primaryModel` |
| `aiService.ts:225` | `gemini-3.8-flash` | `config.primaryModel` (atau `models[0]`) |
| `aiTools.ts:2452` | `openai/gpt-4o-mini` | `config.primaryModel` |
| `chatbot.ts:65` | `openai/gpt-4o-mini` | `config.primaryModel` (arsip) |
| `duplicates.ts:596` | `openai/gpt-4o-mini` | `config.primaryModel` |
| `aiChat.ts` `FALLBACK_MODELS` | 3 model | `config.fallbackModels` |
| `gemini.ts:60,123` | `gemini-1.5-flash` | `config.primaryModel` / `models[]` |

---

## 11. Alur notifikasi WhatsApp

### 11.1 Pemisahan pengirim ↔ penerima

```
resolveActiveFonnteConfig()   → token PENGIRIM  (+ deviceName, deviceId)
resolveAdminRecipient()       → nomor PENERIMA (NotificationRecipient.isActive=true)
```

### 11.2 Alur Admin (9 notifier)

**Terverifikasi (audit Tahap 1):** 6 dari 9 notifier memakai `resolveAdminRecipient(dedupeKey)` — helper internal di `whatsapp.ts` yang **sudah** mengimplementasikan aturan A9 (tanpa nomor → catat FAILED `admin_phone_unavailable`, **tanpa fallback**).

| Notifier | Penerima saat ini | Tujuan |
|---|---|---|
`notifyAdminLogin` | `resolveAdminRecipient` | Admin |
`notifyAdminNewUser` | `resolveAdminRecipient` | Admin |
`notifyAdminNewReport` | `resolveAdminRecipient` | Admin |
`notifyAdminAssignment` | `resolveAdminRecipient` | Admin |
`notifyAdminCompletion` | `resolveAdminRecipient` | Admin |
`notifyAdminReview` | `resolveAdminRecipient` | Admin |
`notifyAccountDeactivated` | `input.phone` (user) | **User** — bukan Admin |
`notifyOfficerAccountCreated` | `user.phone` | **Petugas** — bukan Admin |
`notifyPasswordReset` | `user.phone` | **User** — bukan Admin |

> **Koreksi hasil audit Tahap 1:** 3 notifier terakhir **bukan** ke Admin — mereka ke user/petugas. Jadi **hanya 6** yang perlu diarahkan ke penerima aktif.

### 11.3 Implementasi (A7, A9)

```ts
// src/lib/notificationRecipients.ts
export async function resolveAdminRecipient(): Promise<{
  phone: string | null; source: 'database'|'none'|'error'; problems: string[];
}> {
  // 1. baca NotificationRecipient isActive=true (TANPA cache)
  // 2. tidak ada / tidak valid → { phone:null, source:'none', problems:[...] }
  //    JANGAN fallback ke FonnteConfig.adminPhone (A9)
  // 3. normalisasi via normalizePhoneTo62()
}
```
`resolveAdminRecipient()` di `whatsapp.ts` **diubah 1 baris**: `config.adminPhone` → `activeRecipient.phone`. Mekanisme A9 (catat FAILED + hentikan) **sudah ada** → pertahankan.

### 11.4 Alur lengkap satu pengiriman

```
notifyAdminNewReport(...)
  → resolveAdminRecipient(dedupeKey)   → nomor penerima AKTIF (DB)
  → fonnteConfig()                      → token perangkat PENGIRIM aktif (DB)
  → deliverMessage(to, msg, {config})
      → tokenValid? tidak → recordLog(FAILED,'not_configured') → return skipped
      → alreadySent(dedupeKey)? ya → return deduped
      → POST api.fonnte.com/... → recordLog(SENT|FAILED)
```

### 11.5 Sifat penting (terbukti)

- **Tanpa cache** → ganti nomor aktif berlaku di pengiriman berikutnya (A7).
- **Idempotensi** `dedupeKey` unik, **tidak** bergantung nomor → ganti nomor tidak mengirim ulang pesan lama.
- **Log** hanya menyimpan `toMasked` (nomor tersamar), **tidak** menyimpan nomor penuh/token/isi pesan.

### 11.6 Kotak error bila tidak ada penerima aktif (A9)

```
recordLog({dedupeKey, kind, toMasked:'-', status:'FAILED', error:'admin_recipient_unavailable'})
→ tidak ada request ke Fonnte
→ UI diagnostik: "Belum ada nomor penerima notifikasi aktif"
```

---

## 12. Daftar file yang akan terdampak

### 12.1 File BARU

| File | Tanggung jawab |
|---|---|
`src/lib/secretCrypto.ts` | AES-256-GCM encrypt/decrypt/mask; `getEncryptionKey()` |
`src/lib/notificationRecipients.ts` | CRUD penerima; `resolveAdminRecipient()`; `setActiveRecipient()` (transaksi) |
`src/lib/aiProviderConfig.ts` | CRUD provider; `resolveActiveAiProvider()`; `setActiveAiProvider()`; `buildAiProviderPatch()`; `decryptProviderKey()` |
`src/lib/aiProviders.ts` | Spec provider (endpoint/gaya/env fallback) + adapter OpenAI-compatible (OpenRouter & Groq) |
`src/app/api/admin/whatsapp-recipients/route.ts` | GET/POST |
`src/app/api/admin/whatsapp-recipients/[id]/route.ts` | PATCH/DELETE |
`src/app/api/admin/ai-config/route.ts` | GET/POST |
`src/app/api/admin/ai-config/[id]/route.ts` | PATCH/DELETE |
`src/app/api/admin/ai-config/[id]/activate/route.ts` | POST aktivasi |
`src/app/api/admin/ai-config/[id]/test/route.ts` | POST tes koneksi |
`src/app/api/admin/ai-config/catalog/route.ts` | GET katalog model |
`src/app/(dashboard)/admin/whatsapp-recipients/page.tsx` | Halaman penerima |
`src/app/(dashboard)/admin/ai-config/page.tsx` | Halaman konfigurasi AI |
`src/app/(dashboard)/admin/ai-config/diagnostics/page.tsx` | Halaman diagnostik (opsional, tab) |
`tests/ai.config.test.ts` | Tes offline konfigurasi |
`tests/secret.crypto.test.ts` | Tes offline enkripsi |
`prisma/migrations/<ts>_add_config_tables/migration.sql` | CREATE TABLE baru + ADD COLUMN + partial index |

### 12.2 File DIUBAH

| File | Perubahan | Risiko |
|---|---|---|
`prisma/schema.prisma` | Tambah 2 model + `tokenCipher` | **Perlu migrasi** |
`src/lib/whatsapp.ts` | `resolveAdminRecipient()` → nomor dari `NotificationRecipient` | Sedang — 6 notifier |
`src/lib/fonnteConfig.ts` | Baca `tokenCipher` (jatuh ke `token` bila null); helper enkripsi | Sedang — jalur pengiriman |
`src/lib/aiChat.ts` | Model chain dari config; meta fallback transparan; hapus `FALLBACK_MODELS` hardcode | Sedang — jalur utama |
`src/lib/aiService.ts` | Provider dari config; hapus 2 model hardcode; fallback eksplisit | Sedang — analisis laporan |
`src/lib/duplicates.ts` | Key+model dari config | Sedang |
`src/lib/gemini.ts` | Model dari config | Sedang |
`src/lib/aiTools.ts` | `model:` pada diagnostics dari config | Rendah |
`src/lib/aiTypes.ts` | Tipe `AiProviderSpec`, `ResolvedAiConfig` | Rendah |
`src/components/layout/Sidebar.tsx` | 2 menu baru (grup Operasional) | Rendah |
`src/components/ui/AdminAiAssistant.tsx` | Badge fallback | Rendah |
`src/components/ui/AdminAiFloatingChatbot.tsx` | Badge fallback | Rendah |
`src/app/api/ai/chat/route.ts` | `connected` dari config | Rendah |
`src/app/api/admin/ai/chat/route.ts` | `connected` + model aktif | Rendah |
`src/app/api/admin/whatsapp-config/route.ts` | Kembalikan `activeRecipient` | Rendah |
`.env` | Tambah `APP_ENCRYPTION_KEY` | **Perlu persetujuan** |
`src/lib/chatbot.ts` | Kode mati → arsipkan (opsional) | Rendah |

### 12.3 File TIDAK boleh disentuh
`src/lib/aiToolRegistry.ts`, `src/lib/aiIntent.ts`, `src/lib/aiSessionStore.ts`, `src/lib/aiContext.ts`, `src/lib/aiValidation.ts`, `src/lib/aiAudit.ts`, `src/lib/auth.ts`, `src/lib/adminApi.ts`, `src/middleware.ts`, `src/lib/aiTools.ts` (hanya baris `model:`).

> Pengecualian: `aiSessionStore.ts` **tidak diubah** (C: pertahankan multi-turn & TTL).

---

## 13. Strategi pengujian

**Aturan wajib:** semua tes memakai **salinan `prisma/dev.db` di `%TEMP%`** + `DATABASE_URL` override per-proses; verifikasi `PRAGMA database_list` sebelum tes yang menulis. **Tidak ada** WhatsApp sungguhan, **tidak ada** completion provider berbayar (kecuali tes koneksi yang disetujui eksplisit).

### 13.1 Test plan

| ID | Skenario | Metode | Assertion | DB |
|---|---|---|---|---|
T-01 | Enkripsi round-trip | `encryptSecret`→`decryptSecret` | ciphertext ≠ plaintext, prefix `v1:`, hasil identik | — |
T-02 | IV unik | encrypt 2× nilai sama | ciphertext berbeda | — |
T-03 | Tag GCM | ciphertext dimodifikasi 1 byte | `decryptSecret` throw `decrypt_failed` | — |
T-04 | Kunci salah | decrypt dengan kunci berbeda | throw, pesan tanpa nilai | — |
T-05 | Kunci hilang | `getEncryptionKey()` tanpa env | throw `encryption_key_missing` | — |
T-06 | Rahasia tak bocor | `GET /api/admin/ai-config` | respons **tidak** memuat `apiKeyCipher`/`apiKey`; hanya `hasApiKey:boolean` | salinan |
T-07 | Log tak bocor | `maskSecret`, pesan error | tak ada substring key | — |
T-08 | Simpan banyak key | POST 3 provider (openrouter/gemini/groq) | 3 baris; cipher berbeda; `hasApiKey` true | salinan |
T-09 | Key kosong = pertahankan | PATCH tanpa `apiKey` | `apiKeyCipher` tak berubah | salinan |
T-10 | Ganti provider aktif | aktifkan provider B | A `isActive=false`, B `true`; **hanya 1 aktif** | salinan |
T-11 | Aktivasi ganda ditolak | aktifkan A lalu B | exception/rollback → A tetap aktif | salinan |
T-12 | Ganti model utama | PATCH `primaryModel` | tersimpan; `resolveActiveAiProvider().primaryModel` ikut berubah | salinan |
T-13 | Urutan fallback | PATCH `fallbackModels` array | urutan persis; dipakai berurutan | salinan |
T-14 | Laporan model terpakai | stub fetch: model1 429, model2 200 | `meta.usedModel`=model2, `meta.fallbackModels`=[model1] | — |
T-15 | Semua model gagal | stub fetch selalu gagal | `errorKind='AI_PROVIDER_ERROR'`, **tanpa** jawaban mengarang | — |
T-16 | Key invalid tak fallback | stub 401 | berhenti di provider itu | — |
T-17 | Migrasi token Fonnte | backfill `tokenCipher` dari `token` | `token` lama **tetap ada**; `tokenCipher` terisi; `decrypt` cocok | salinan |
T-18 | Jalur transisi | `tokenCipher=null`, `token` ada | sistem tetap pakai `token` | salinan |
T-19 | Migrasi nomor penerima | jalankan seed idempoten | 1 baris recipient `isActive=true`, phone = `adminPhone` lama | salinan |
T-20 | Idempoten seed | jalankan 2× | jumlah baris tetap 1 | salinan |
T-21 | Ganti nomor aktif | aktifkan recipient lain | notifikasi berikutnya → nomor baru; `WhatsAppLog.toMasked` mencerminkan nomor baru | salinan |
T-22 | Nomor lama bisa diaktifkan | aktifkan kembali | berhasil; nomor lama tak hilang | salinan |
T-23 | Larangan >1 aktif | insert manual 2 aktif via raw SQL | **DITOLAK** partial unique index | salinan |
T-24 | Tanpa penerima aktif | nonaktifkan semua; panggil notify | **tidak ada** request Fonnte; log `FAILED` `admin_recipient_unavailable` | salinan |
T-25 | Tidak ada fallback diam-diam | seperti T-24 | nomor `FonnteConfig.adminPhone` **tidak** dipakai | salinan |
T-26 | RBAC API | panggil 4 route tanpa login / sbg CITIZEN | 401 / 403 | salinan |
T-27 | RBAC halaman | akses `/admin/ai-config` sbg non-Admin | redirect (middleware) | — |
T-28 | Regresi multi-turn | `tests/ai.multiturn.test.ts` | 24/24 PASS | — |
T-29 | Regresi notifikasi | `tests/ai.security.stage1.test.ts` + `ai.tools.test.ts` | PASS | salinan |
T-30 | Regresi AI tools | `tests/ai.intent.test.ts`, `ai.answer.test.ts`, `ai.drift.test.ts` | PASS | — |
T-31 | Audit perubahan config | ubah config → cek `AdminAuditLog` | ada baris `AI_CONFIG_*` / `WA_RECIPIENT_*` | salinan |
T-32 | TSanDB | `tsc --noEmit` | 0 error di `src/` | — |
T-33 | Build | `next build` (`.next` bersih) | exit 0 | — |

### 13.2 Pemisahan test (wajib)

| Kategori | Cara | Izinkan DB produksi? |
|---|---|---|
| Murni (crypto, logika) | tanpa DB | ❌ |
| Integrasi DB | `DATABASE_URL` → salinan `%TEMP%` + gate `PRAGMA database_list` | ❌ |
| WhatsApp nyata | **tidak dijalankan** tanpa persetujuan | ❌ |
| Provider AI | hanya stub fetch lokal | ❌ |

**Gate wajib sebelum tes menulis:**
```bash
cp prisma/dev.db "$TEMP/ai_test.db"
DATABASE_URL="file:$TEMP/ai_test.db" npx tsx --test tests/ai.config.test.ts
# + verifikasi PRAGMA database_list → harus menunjuk file salinan
```

---

## 14. Risiko teknis dan mitigasi

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
R-1 | Kunci `APP_ENCRYPTION_KEY` hilang | Data terenkripsi tak bisa didekripsi | Cadangkan di password manager; **wajib didokumentasikan**; `decryptSecret` throw pesan jelas |
R-2 | Salah simpan `APP_ENCRYPTION_KEY` di repo | Kunci bocor | `.env` saja (bukan `NEXT_PUBLIC_*`); `.gitignore` sudah ada (`.env` tercantum? — **perlu diverifikasi**) |
R-3 | Ganti provider aktif saat pipeline berjalan | Requestengah jalan memakai model lama | Resolusi **per request** (bukan cache) → request berikutnya langsung baru |
R-4 | Migrasi recipient membaca device yang salah | Nomor penerima salah | Seed: ambil device `isActive=true` **terbaru**; log nama device ke `notes` |
R-5 | Partial UNIQUE index & Prisma `migrate` | Index hilang saat `migrate dev` | Index dibuat di `migration.sql` **manual**; `prisma migrate dev` berikutnya bisa menghapusnya → **wajib verifikasi** tiap migrasi; alternatif: guard di service layer (transaction) |
R-6 | `migrate dev` pada DB produksi | **`prisma migrate dev` bisa reset data** | **DILARANG** di produksi. Pakai `prisma migrate deploy` (SQL yang sudah ditulis manual) atau `db push` non-destructif. Backup `prisma/dev.db` wajib |
R-7 | `db push` dropping kolom | Kehilangan data | **Dilarang**. Tambah kolom nullable saja |
R-8 | Ganti AI config merusak analisis laporan | Alur upload Complaint gagal | `aiService` fallback ke provider lain bila model utama mati; `errorKind` jelas |
R-9 | `chatbot.ts` (kode mati) tetap baca `.env` | Konfigurasi terduplikasi | Arsipkan **dengan persetujuan**; jangan hapus diam-diam |
R-10 | Semua provider kehabisan kuota | Narasi AI mati saat demo | Jalur deterministik tetap jalan; pesan jujur; badge "provider bermasalah" di UI Diagnostik |
R-11 | Recipient aktif ter-accidental 0 | Notifikasi admin mati | Partial UNIQUE index + `enforceSingleActiveRecipient()` (pola `enforceSingleActiveDevice` yang sudah ada) → auto-normalisasi |
R-12 | Nomor penerima tidak valid | Pesan tak sampai | Validasi `normalizePhoneTo62()` saat simpan (sudah ada di `buildFonnteConfigPatch`) |
R-13 | Backfill token gagal sebagian | Sebagian device pakai `token` lama | Backfill idempoten + verifikasi jumlah; **jangan** hapus `token` |
R-14 | Secret bocor via `meta`/log | Kebocoran | `aiValidation.ts` sudah punya detektor; `maskSecret` di log |
R-15 | `.next` rusak (build gagal) | Build/deploy gagal | Build dengan `.next` bersih; **dilarang** `rm -rf .next` pada tahap spesifikasi; di implementasi boleh (cache, bukan source) |
R-16 | Endpoint katalog model bermuatan | Timeout saat buka UI | Cache 6 jam + timeout pendek + fallback ke daftar manual |
R-17 | **Endpoint Groq belum diverifikasi** | Koneksi gagal | Validasi endpoint & body saat implementasi (1 request uji, perlu persetujuan). Bentuk OpenAI-compatible sangat mungkin, tapi **belum dibuktikan** |
R-18 | Timeout basis data saat `prisma.$transaction` + partial index | Konflik | Transaction pendek; retry 1×; partial index sebagai jaring pengaman |
R-19 | `AdminAuditLog` membengkak | DB | `action` ringkas; notes tanpa rahasia |
R-20 | Multi-turn rusak oleh refactor `aiChat` | Fitur Stage 3 rusak | `tests/ai.multiturn.test.ts` (24 tes) wajib hijau tiap commit; **jangan sentuh** `aiSessionStore.ts`/`aiIntent.ts` |

---

## 15. Urutan implementasi Tahap 3 dan seterusnya

| Tahap | Cakupan | Skema | `.env` | Gate keluar |
|---|---|---|---|---|
**3-0** | Fix cache `.next` → build bersih | — | — | `next build` exit 0 |
**3-1** | `secretCrypto.ts` + `APP_ENCRYPTION_KEY` | — | **ya** | T-01…T-05 hijau |
**3-2** | Model `NotificationRecipient` + migrasi (tabel saja, **kosong**) | ya | — | Migrasi sukses; tabel kosong; data lama utuh |
**3-3** | `notificationRecipients.ts` + route + halaman | — | — | T-19…T-22 hijau |
**3-4** | Seed idempoten `adminPhone` → recipient | — | — | T-19/T-20 hijau |
**3-5** | Arahkan `resolveAdminRecipient` ke recipient aktif | — | — | T-24/T-25 hijau; notifikasi existing tak berubah |
**3-6** | Model `AiProvider` + `tokenCipher` + migrasi | ya | — | Migrasi sukses; data lama utuh |
**3-7** | `aiProviderConfig.ts` + `secretCrypto` + route + halaman | — | — | T-06…T-13 hijau |
**3-8** | Backfill `tokenCipher` Fonnte (idempoten) | — | — | T-17/T-18 hijau; `token` lama **tak dihapus** |
**3-9** | Integrasikan `aiChat` ke config (P1) + meta transparan | — | — | T-14/T-15/T-28/T-30/T-32/T-33 hijau |
**3-10** | Integrasikan `aiService`, `duplicates`, `gemini`, `aiTools` (P2/P3/P5/P6) | — | — | Alur analisis laporan & duplikat tetap jalan |
**3-11** | Halaman Diagnostik + badge fallback UI | — | — | Manual test 3 role |
**3-12** | Arsip `chatbot.ts` | — | — | **Perlu persetujuan eksplisit** |
**3-13** | Dokumentasi (README/`docs/`), prosedur backup & rotasi kunci | — | — | Dokumen final |

**Aturan tiap tahap:** migrasi **additive**; **tidak ada** `DELETE`/`DROP`/`TRUNCATE` pada tabel lama; `prisma migrate dev` **dilarang** di DB produksi (pakai `migrate deploy` dengan SQL manual + backup); **backup `prisma/dev.db` sebelum migrasi pertama**; setiap tahap **rollback-able** (fitur dimatikan lewat flag, data lama utuh).

---

## 16. Checklist kesiapan implementasi

| # | Item | Status | Catatan |
|---|---|---|---|
1 | Audit arsitektur WhatsApp & AI | ✅ | Tahap 1 |
2 | Keputusan produk ditetapkan | ✅ | Section 1 |
3 | Parametrik model Prisma | ✅ | Section 3 (partial index **terbukti** jalan) |
4 | Relasi & constraint | ✅ | Section 4 (tanpa FK, disengaja) |
5 | Strategi enkripsi | ✅ | Section 5 (AES-256-GCM, `v1:`) |
6 | Strategi `APP_ENCRYPTION_KEY` | ✅ | Section 5.2 — butuh persetujuan **nilai & lokasi** |
7 | Strategi migrasi data lama | ✅ | Section 6 (idempoten, `FonnteConfig` tak diubah) |
8 | Rancangan API | ✅ | Section 7 |
9 | Rancangan halaman Admin | ✅ | Section 8 |
10 | Alur konfigurasi AI | ✅ | Section 9 |
11 | Alur fallback AI | ✅ | Section 10 (termasuk daftar pipeline P1–P6) |
12 | Alur notifikasi WhatsApp | ✅ | Section 11 (6 dari 9 notifier → Admin) |
13 | Daftar file terdampak | ✅ | Section 12 |
14 | Strategi pengujian | ✅ | Section 13 (33 skenario, semua offline/salinan) |
15 | Risiko & mitigasi | ✅ | Section 14 (20 risiko) |
16 | Urutan implementasi | ✅ | Section 15 (14 tahap) |
17 | **Nilai `APP_ENCRYPTION_KEY`** | ⛔ | **Perlu keputusan Admin** (§17) |
18 | **Model AI utama & urutan fallback default** | ⛔ | **Perlu keputusan Admin** (§17) |
19 | **Perilaku Groq (endpoint, model, kuota)** | ⚠️ | **Belum diverifikasi** — butuh 1 request uji |
20 | **Backup `prisma/dev.db`** | ⛔ | Wajib sebelum migrasi pertama |
21 | **Persetujuan arsip `chatbot.ts`** | ⛔ | Kode mati; Dilarang hapus diam-diam |
22 | **Persetujuan `prisma migrate deploy` + SQL manual** | ⛔ | `migrate dev` dilarang di produksi |

---

## 17. Pertanyaan teknis terbuka (untuk keputusan Admin)

| # | Pertanyaan | Rekomendasi teknis | Dampak bila dijawab lain |
|---|---|---|---|
Q-1 | Berapa byte/format `APP_ENCRYPTION_KEY`? | base64 32 byte (44 char), dibuat `crypto.randomBytes(32).toString('base64')` | Format lain → `secretCrypto` harus menyesuaikan |
Q-2 | Di mana kunci dicadangkan? | Password manager + dokumen `docs/` (**tanpa nilai**) | Kehilangan kunci = data tak bisa didekripsi |
Q-3 | Model utama default provider OpenRouter? | `google/gemma-4-31b-it:free` (status saat ini 429 — `upstream_provider_shared_pool`) | Model berbayar lebih stabil |
Q-4 | Urutan fallback default? | 2 model cadangan per provider + `openrouter/free` sbg router cadangan | Rantai panjang = latency & biaya |
Q-5 | Model Groq default? | `llama-3.3-70b-versatile` (perlu verifikasi katalog & kuota) | — |
Q-6 | Apakah Gemini tetap jadi provider analisis gambar? | Ya — multimodal (gambar) hanya Gemini/Gemma-VL; OpenRouter & Groq teks saja | Kehilangan analisis gambar |
Q-7 | Label penerima default? | `"Admin Utama (migrasi dari perangkat Fonnte)"` | — |
Q-8 | Halaman Penerima Notifikasi: hapus nomor atau soft-delete? | Soft-delete (`isActive=false` + `notes`) — A8 | Hard delete melanggar A8 |
Q-9 | `adminPhone` di `FonnteConfig` diisi lagi oleh form perangkat? | Ya, tetap ada sebagai referensi perangkat (A10) | Kosongkan → sumber migrasi hilang |
Q-10 | Batas jumlah penerima/provider? | 20 penerima, 10 provider | — |
Q-11 | Kapan provider AI fallback boleh BERPINDAH ke provider lain? | Selalu, tapi **dilaporkan** di `meta` + badge UI (B7) | Diam-diam = melanggar B7 |
Q-12 | Apakah `AiKnowledgeEntry` perlu model metadata? | Tidak pada tahap ini (C3) | — |

---

## Status

# SIAP DENGAN CATATAN

**Alasan:** seluruh requisite teknis sudah diverifikasi dan她的 reckoning adalah:
- Semua fakta implementasi **terverifikasi** dari kode & DB aktual (bukan asumsi): lokasi pembacaan token/key, 4 fungsi kirim, 9 `notify*` (6 ke Admin), 6 pipeline AI, 19 model Prisma, pola `requireAdmin()`, komponen `secretCrypto` yang akan dipakai, dan **kelayakan partial UNIQUE INDEX + transaksi atomik** (diuji empiris pada SQLite 3.45.0 di file sementara).
- **Catatan (tidak menghalangi):**
  1. **Endpoint & body Groq belum diverifikasi** — asumsi "OpenAI-compatible" sangat kuat tetapi **belum dibuktikan**; butuh 1 request uji (R-17) dengan persetujuan terpisah.
  2. **Perilaku `prisma migrate` terhadap partial UNIQUE INDEX** belum diuji pada proyek ini — R-5 menuntut verifikasi tiap migrasi; alternatif aman = guard di service layer (pola `enforceSingleActiveDevice` yang sudah ada dan terbukti).
  3. **Rencana backfill token Fonnte** (E-2) belum dijalankan — disengaja (butuh backup + persetujuan).
  4. **`APP_ENCRYPTION_KEY` belum ada** di `.env` → seluruh fitur konfigurasi baru **terkunci** sampairive dibuat (R-1, R-2).
  5. **`chatbot.ts` (kode mati)** recomendação arsip, **tidak** dihapus (Dilarang; perlu persetujuan eksplisit).

**Verifikasi efek samping Tahap 2:** tidak ada source code, database, schema Prisma, `.env`, konfigurasi, maupun data yang diubah. Satu-satunya artefak dibuat: **dokumen ini** (`docs/TAHAP-2-SPESIFIKASI-TEKNIS.md`), sesuai Section 6 Output. Pemeriksaan DB hanya READ (`findMany`/`count`/`groupBy`) terhadap `prisma/dev.db`; probe partial-index berjalan pada **file sementara di `%TEMP%`** yang sudah dihapus; tidak ada WhatsApp sungguhan, tidak ada panggilan provider AI, tidak ada secret yang dicetak, tidak ada migrasi/seed/reset, dan `tests/ai.integration.test.ts` / `e2e.location.test.ts` tidak dijalankan.

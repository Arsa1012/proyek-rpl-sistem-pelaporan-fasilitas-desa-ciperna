# TAHAP 6 — AKTIVASI KEAMANAN & UJI OPERASIONAL

**Proyek:** Sistem Pelaporan Fasilitas Umum Desa Ciperna
**Acuan:** `docs/TAHAP-2-SPESIFIKASI-TEKNIS.md`, `docs/TAHAP-3-IMPLEMENTASI.md`, `docs/TAHAP-5-IMPLEMENTASI.md`
**Tanggal:** 12 November 2026
**Status akhir:** **SELESAI DENGAN CATATAN** — seluruh fase aman selesai & terverifikasi; 4 pekerjaan **BLOCKED** menunggu tindakan Admin (kunci enkripsi, persetujuan backfill, kredensial provider, izin request nyata).

---

## 1. RINGKASAN PER FASE

| Fase | Status | Hasil |
|---|---|---|
| 6.1 Audit kesiapan | ✅ Selesai | APP_ENCRYPTION_KEY **belum ada**; 1 FonnteConfig (`tokenCipher` null); 2 penerima (1 aktif); 0 AiProvider; 7 backup |
| 6.2 Persiapan kunci | ⛔ **BLOCKED** | Perintah pembuatan kunci diberikan; menunggu Admin menambahkan ke `.env` + restart |
| 6.3 Backup | ✅ Selesai | Backup baru terverifikasi byte-identik + `PRAGMA integrity_check = ok` |
| 6.4 Backfill Fonnte | ⛔ **BLOCKED** (tool siap & terbukti) | `scripts/backfill-fonnte-token.ts` terbukti idempoten & terverifikasi pada salinan DB |
| 6.5 Konfigurasi AI | ✅ Terverifikasi (offline) | 8 tes keamanan: kunci terenkripsi, tidak pernah ke browser, 3 provider berdiri sendiri |
| 6.6 Uji provider & fallback | ✅ Selesai (mock) | 61 tes lulus; request nyata **BLOCKED** (belum ada persetujuan/kunci) |
| 6.7 Uji WhatsApp | ✅ Selesai (mock) | 42 tes lulus; routing warga/petugas/OTP tidak berubah |
| 6.8 Regresi final | ✅ Selesai | 720 tes (718 lulus, 2 pre-existing), ESLint 0 error, TS 0 error `src/`, build exit 0, RBAC 11/11 → 401 |

---

## 2. FASE 6.1 — AUDIT KESIAPAN

```
APP_ENCRYPTION_KEY di .env : BELUM ADA (panjang 0)
isEncryptionConfigured()   : false
process.env aktif          : TIDAK

FonnteConfig   : 1 perangkat ("wa ADMIN 1", aktif)
                 token lama (plaintext) : ADA (len 20)
                 tokenCipher            : NULL  (belum di-backfill)
                 readDeviceToken()      : OK (jalur transisi berfungsi)

NotificationRecipient : 2 baris, 1 aktif
                 "Admin Utama (migrasi dari perangkat Fonnte) ·5991"  AKTIF
                 "Admin Utama (migrasi dari perangkat Fonnte) ·7522"  NONAKTIF

AiProvider      : 0 baris → sistem memakai bootstrap .env (openrouter,
                  model google/gemma-4-31b-it:free), usedEnvFallback = true

Backup         : 7 berkas, terbaru 2026-11-12T08:20 (pra-seed penerima)
```
Tidak ada nilai rahasia yang ditampilkan.

---

## 3. FASE 6.2 — PERSIAPAN KUNCI (BLOCKED)

**Perintah pembuatan kunci (Windows PowerShell)** — dijalankan oleh Admin:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Output: 44 karakter Base64 (32 byte). **Tidak boleh** dicatat di dokumen, log, screenshot, atau chat.

**Langkah Admin:**
1. Jalankan perintah di atas.
2. Simpan hasilnya di **password manager** (cadangan).
3. Tambahkan ke file `.env` server (server-side, **bukan** `NEXT_PUBLIC_*`):
   ```
   APP_ENCRYPTION_KEY=<hasil langkah 1>
   ```
4. Restart server.
5. Verifikasi (hanya status & panjang, tanpa mencetak nilai):
   ```powershell
   npx tsx scripts/backfill-fonnte-token.ts --dry-run
   ```
   Keluaran yang diharapkan: `APP_ENCRYPTION_KEY : tersedia & valid (nilai tidak dicetak)`.

> **Penting:** jangan pernah menempelkan nilainya ke chat/dokumen. Kunci yang hilang berarti
> `tokenCipher` dan `apiKeyCipher` tidak dapat didekripsi.

---

## 4. FASE 6.3 — BACKUP (SELESAI)

| Item | Nilai |
|---|---|
| Lokasi | `prisma/dev.db.backup-before-token-cipher-20261112-175156` |
| Ukuran | 1.187.840 byte (identik dengan sumber) |
| SHA-256 | `2b974af699f12053371e26c445ccc75c6687e7f0d21bb8e179b707735397339c` |
| Hash sumber vs backup | **identik** (copy byte-per-byte) |
| `PRAGMA integrity_check` | **ok** |
| Jumlah tabel | 23 |
| Isi | user 69 · report 68 · assignment 32 · notification 478 · reportStatusHistory 206 · adminAuditLog 957 · WhatsAppLog 409 · fonnteConfig 1 · NotificationRecipient 2 · AiProvider 0 · reportEvidence 23 |
| Total backup di `prisma/` | 6 |

---

## 5. FASE 6.4 — ALAT BACKFILL TOKEN (BLOCKED, TOOL SIAP)

**File baru:** `scripts/backfill-fonnte-token.ts`
**Perintah:** `npm run security:backfill-token` (opsi: `--dry-run`, `--skip-backup`)

**Jaminan alat:**
1. Tanpa `APP_ENCRYPTION_KEY` valid → **berhenti, exit 2, tidak menulis apa pun**.
2. Backup otomatis + SHA-256 + `PRAGMA integrity_check` → backfill **dibatalkan** bila backup tidak terverifikasi.
3. Menulis **hanya** kolom `tokenCipher` (SQL mentah) → `id`, `phone`, `isActive`, `createdAt`, `updatedAt`, `notes` tidak tersentuh.
4. Kolom `token` plaintext **tidak pernah dihapus** (jalur transisi tetap hidup).
5. Setiap ciphertext yang ditulis **didekripsi & dibandingkan** dengan nilai lama sebelum dilaporkan sukses.
6. **Idempoten**: baris yang ciphertext-nya sudah valid didekripsi-ulang lalu dilewati.
7. Tidak pernah mencetak token, ciphertext, maupun kunci.

**Bukti offline (salinan DB + kunci uji):**

| Uji | Hasil |
|---|---|
| Eksekusi 1 (backup + backfill) | backup OK (integritas ok) → `tokenCipher ditulis & terverifikasi` → `ditulis=1` |
| Isi salinan setelahnya | token lama **tetap ada** (len 20), tokenCipher **TERISI** (len 73), dekripsi **cocok** |
| Eksekusi 2 (idempoten) | `ditulis=0 dilewati=1` |
| Eksekusi 3 (tanpa kunci) | **exit 2**, pesan "APP_ENCRYPTION_KEY belum tersedia", tidak ada tulisan |
| Nilai rahasia tercetak? | **tidak ada** |

**Yang MASIH perlu dilakukan Admin:** setelah kunci tersedia → `npm run security:backfill-token`
(perlu **persetujuan eksplisit**; alat akan membuat backup baru sendiri sebelum menulis).

---

## 6. FASE 6.5 — KONFIGURASI AI (TERVERIFIKASI OFFLINE)

**File tes baru:** `tests/ai.config.security.test.ts` (8/8 lulus, DB salinan + kunci uji).

| # | Verifikasi | Hasil |
|---|---|---|
| S-01 | API Key disimpan **terenkripsi**; tidak ada plaintext di baris DB | ✅ |
| S-02 | Respons `GET /api/admin/ai-config` **tidak** memuat `apiKey`/`apiKeyCipher`; hanya `hasApiKey: boolean` | ✅ |
| S-03 | OpenRouter, Gemini, dan Groq dapat dikonfigurasi **berdiri sendiri** (tiap punya ciphertext sendiri) | ✅ |
| S-04 | Mengganti provider aktif **tidak menghapus** kunci/model provider lain; tetap 1 aktif | ✅ |
| S-05 | API Key kosong saat edit → **kunci lama dipertahankan** | ✅ |
| S-06 | Endpoint katalog model tidak memuat rahasia | ✅ |
| S-07 | Tanpa `APP_ENCRYPTION_KEY` → penyimpanan kunci **ditolak** (400) & **tidak ada** plaintext tersimpan | ✅ |
| S-08 | Hanya satu provider boleh aktif | ✅ |

> API Key **asli** tidak dimasukkan oleh saya (sesuai aturan: jangan memasukkan API Key palsu).
> Admin perlu menambahkannya sendiri melalui `/admin/ai-config` setelah kunci tersedia.

---

## 7. FASE 6.6 — UJI PROVIDER & FALLBACK

| Kelompok | Tes | Hasil |
|---|---|---|
| Adapter provider (mock fetch) | `tests/ai.provider.adapter.test.ts` | **19/19** |
| Konfigurasi AI + fallback | `tests/ai.config.test.ts` | **42/42** |
| **Total** | | **61/61** |

Cakupan: bentuk request tiap provider (OpenRouter/Groq OpenAI-compatible, Gemini SDK), autentikasi, klasifikasi error (401/403/402/404/429/timeout), validasi respons, anti-bocor secret, rantai model utama→cadangan→provider berikut, dan aturan "tidak ada jawaban mengarang".

**Request nyata ke provider = BLOCKED** (butuh persetujuan + API Key asli).

---

## 8. FASE 6.7 — UJI WHATSAPP (MOCK)

| Kelompok | Tes | Hasil |
|---|---|---|
| Alur penerima notifikasi | `tests/whatsapp.recipient.flow.test.ts` | **12/12** |
| Diagnostik & perangkat | `tests/whatsapp.diagnostics.test.ts`, `tests/whatsapp.device.test.ts` | **30/30** |

Terverifikasi: notifikasi **Admin** memakai penerima aktif; **warga** memakai nomor warga;
**petugas** memakai nomor petugas; **OTP** memakai nomor pemilik akun. Tidak ada pesan WhatsApp
sungguhan (semua `fetch` di-stub). Tidak ada perubahan pada kode pengiriman/OTP/notifikasi personal.

---

## 9. FASE 6.8 — REGRESI FINAL

| Pemeriksaan | Hasil |
|---|---|
| Suite penuh (41 file; `ai.integration` & `e2e.location` dikecualikan) | **720 tes → 718 lulus, 2 gagal pre-existing** |
| `tests/ai.config.security.test.ts` (baru) | 8/8 |
| ESLint | **0 error**, 20 warning (pre-existing `<img>`) |
| TypeScript | **0 error di `src/`**; total 46 = baseline |
| `next build` (`.next` bersih) | **exit 0** |
| RBAC runtime (11 handler Admin tanpa sesi) | **11/11 → 401 "Tidak terautentikasi"** |
| `PRAGMA integrity_check` | **ok** |

**Dua kegagalan pre-existing** (bukan regresi Tahap 6, sudah terdokumentasi sejak Tahap 4):
`announcements.broadcast` ("belum dikonfigurasi") dan `reports.analysis.duplicates`
(konsistensi data 48 baris `Report` lama).

---

## 10. KONDISI DATABASE

```
user 69 · report 68 · assignment 32 · notification 478 · reportStatusHistory 206
adminAuditLog 1004 · WhatsAppLog 413 · fonnteConfig 1 · reportEvidence 23
villageAnnouncement 3 · reportAnalysis 4 · aiKnowledgeEntry 0 · announcementDelivery 123
NotificationRecipient 2 (1 aktif) · AiProvider 0
PRAGMA integrity_check: ok
```
`fonnteConfig` 2 → 1 terjadi **sebelum** Tahap 6 (Admin menghapus perangkat cadangan lewat
`/admin/whatsapp-config`); tidak ada data yang dihapus oleh Tahap 6.

---

## 11. PEKERJAAN YANG TERBLOKIR & TINDAKAN ADMIN

| # | Pekerjaan | Status | Tindakan Admin yang diperlukan |
|---|---|---|---|
| **A** | `APP_ENCRYPTION_KEY` | ⛔ BLOCKED | Buat kunci (perintah di §3), simpan di password manager, tambahkan ke `.env`, restart, verifikasi dengan `--dry-run` |
| **B** | Backfill `tokenCipher` Fonnte | ⛔ BLOCKED (menunggu A + persetujuan) | Setelah A berhasil: `npm run security:backfill-token` (membuat backup sendiri & memverifikasi) |
| **C** | Konfigurasi provider AI nyata | ⛔ BLOCKED (menunggu A + kredensial) | Buka `/admin/ai-config`, tempel API Key asli tiap provider, simpan, uji koneksi, aktifkan |
| **D** | Request nyata ke provider (termasuk verifikasi Groq) | ⛔ BLOCKED (perlu izin eksplisit) | Beri izin tertulis + API Key; lalu jalankan 1 request uji per provider dan catat provider/model yang terpakai |
| **E** | WhatsApp sungguhan | ⛔ BLOCKED (perlu izin eksplisit) | Beri izin tertulis bila ingin uji kirim nyata |

> Izin memulai Tahap 6 **bukan** izin mengirim WhatsApp sungguhan atau melakukan request provider berbayar.
> Semua pengujian di atas memakai mock/stub dan database salinan.

---

## 12. FILE YANG BERUBAH

| File | Perubahan |
|---|---|
| `scripts/backfill-fonnte-token.ts` | **BARU** — alat backup + backfill token (aman, idempoten, tanpa mencetak rahasia) |
| `tests/ai.config.security.test.ts` | **BARU** — 8 tes keamanan konfigurasi provider AI |
| `package.json` | +1 skrip: `security:backfill-token` |
| `prisma/dev.db.backup-before-token-cipher-20261112-175156` | **BARU** — backup terverifikasi pra-backfill |
| `docs/TAHAP-6-IMPLEMENTASI.md` | **BARU** — dokumen ini |

Tidak ada perubahan pada kode pengiriman WhatsApp, OTP, notifikasi personal, endpoint konfigurasi,
skema database, maupun `.env`.

# TAHAP 5 — PERBAIKAN UX WHATSAPP RECIPIENT

**Dasar:** laporan audit `POST /api/admin/whatsapp-recipients` 400 (Tahap 4).
**Tanggal:** 12 November 2026
**Status akhir:** **SELESAI** — 4 perbaikan diterapkan, diverifikasi di UI sungguhan + tes otomatis.

---

## 1. RINGKASAN

| # | Perbaikan | Status |
|---|---|---|
| 1 | Pesan error tampil **DI DALAM modal** (tidak tertutup overlay/topbar/sidebar) | ✅ Selesai |
| 2 | Pesan duplikat menyebut **label** penerima yang memakai nomor tersebut | ✅ Selesai |
| 3 | **Label hasil migrasi dapat dibedakan** (penanda 4 digit terakhir) | ✅ Selesai |
| 4 | **Petunjuk SENDER vs RECIPIENT** di halaman & modal | ✅ Selesai |

---

## 2. PERUBAHAN UI

### 2.1 Pesan error di dalam modal (`WhatsAppRecipientsManager.tsx`)
- State baru `modalError` — terpisah dari `errorMsg` (pesan halaman), sehingga
  **pesan yang sama tidak pernah tampil dua kali**.
- Pesan dirender **di dalam `.modal-card`**, pada bagian bawah formulir, dengan
  `position: sticky; bottom: 0` → tetap terlihat saat kartu digulir, pada desktop,
  mobile, maupun viewport pendek.
- Overlay modal pada halaman ini diberi kelas `cfg-modal-overlay`
  (`padding-left: var(--sidebar-width)` di ≥769px) sehingga kartu modal berada
  di area konten dan tidak tertutup sidebar.
- **Modal tetap terbuka** saat API menolak; isian input **tidak hilang**.
- **Berhasil** → modal ditutup, `modalError` dikosongkan, `resetForm()` dipanggil.

### 2.2 Petunjuk SENDER vs RECIPIENT
- Banner halaman: diperjelas (nomor perangkat Fonnte **tidak otomatis** disalin
  menjadi penerima; nomor yang sudah terdaftar → gunakan tombol **Aktifkan**).
- Modal tambah: blok `.cfg-role-hint` memuat penjelasan SENDER vs RECIPIENT +
  saran memakai tombol Aktifkan.

---

## 3. PERUBAHAN SERVICE (`notificationRecipients.ts`)

| Fungsi | Perubahan |
|---|---|
| `duplicateErrorMessage()` (baru) | Pesan: `Nomor ini sudah terdaftar pada penerima "<label>". Gunakan penerima yang sudah ada.` — **tanpa nomor lengkap**. |
| `addRecipient()` | Memakai pesan di atas (aturan duplikasi **tidak berubah**). |
| `updateRecipient()` | Memakai pesan di atas; `NOT: { id }` tetap mengecualikan baris yang sedang diedit. |
| `buildMigrationLabel()` (baru) | `Admin Utama (migrasi dari perangkat Fonnte) ·<4 digit terakhir>`. |
| `ensureMigrationLabels()` (baru) | Pelabelan **hanya kolom `label`** (SQL mentah) → `id`, `phone`, `isActive`, `createdAt`, `updatedAt`, `notes` **tidak tersentuh**. Idempoten. Baris manual tidak pernah diberi label migrasi. |
| `migrateLegacyAdminPhone()` | Memanggil `ensureMigrationLabels()`; baris baru memakai label berpenanda. Tidak membuat ulang/menghapus baris yang ada. |

---

## 4. STATUS DATABASE (sebelum → sesudah)

```
NotificationRecipient : 2 baris  →  2 baris
  "Admin Utama (migrasi dari perangkat Fonnte)"      6283****91  AKTIF
  → "Admin Utama (migrasi dari perangkat Fonnte) ·5991"  6283****91  AKTIF
  "Admin Utama (migrasi dari perangkat Fonnte)"      6282****22  NONAKTIF
  → "Admin Utama (migrasi dari perangkat Fonnte) ·7522"  6282****22  NONAKTIF
jumlah penerima AKTIF : 1  →  1  (aturan satu aktif tetap)
Tabel lain            : tidak ada yang berubah (user 69, report 68, fonnteConfig 1, dst.)
```
Pelabelan diverifikasi: hanya `label` yang berubah; `updatedAt` **tidak** tersentuh
(dibuktikan pada salinan DB: `updatedAt SEBELUM == SESUDAH`).

---

## 5. HASIL PENGUJIAN

| Pemeriksaan | Hasil |
|---|---|
| Suite penuh (40 file, 2 dikecualikan) | **712 tes, 710 lulus, 2 gagal pre-existing** (identik baseline Tahap 4) |
| `tests/ai.config.test.ts` | **42/42** (bertambah 3: T-19e, T-19f, T-19g) |
| `tests/ui.markup.test.ts` | **11/11** (bertambah 4: M-07…M-10) |
| TypeScript | **0 error di `src/`** (total 46 = baseline) |
| ESLint | **0 error**, 20 warning (pre-existing `<img>`) |
| `next build` | **exit 0** |

### Uji di UI sungguhan (server dev → **salinan DB di TEMP**)
| Skenario | Hasil |
|---|---|
| POST nomor duplikat | **400** `{"error":"Nomor ini sudah terdaftar pada penerima \"…\". Gunakan penerima yang sudah ada."}` |
| Modal tetap terbuka | ✅ |
| Isian input tetap ada | ✅ |
| Pesan berada di dalam kartu modal | ✅ (`card.contains(alert) === true`) |
| Pesan terlihat (5 titik diuji) | ✅ **5/5** |
| Pesan di luar halaman (duplikat) | **0** |
| Overflow horizontal | **tidak ada** |
| POST nomor baru | **201** → modal tertutup, pesan hilang, baris baru muncul (3 → 4) |

Bukti visual: `docs/TAHAP-5-modal-error.png`.

---

## 6. PERMASALAH YANG MASIH TERSISA

1. **Dua kegagalan tes pre-existing** (bukan regresi Tahap 5):
   - `announcements.broadcast` — "belum dikonfigurasi: tidak ada pengiriman".
   - `reports.analysis.duplicates` — konsistensi data 48 baris `Report` lama.
2. **Topbar sticky dapat menutupi bagian ATAS kartu modal** pada viewport yang
   sangat pendek (< ~300px tinggi). Ini perilaku layout dashboard yang berlaku
   untuk SEMUA modal, di luar lingkup Tahap 5. Area pesan error sudah aman
   (di bagian bawah kartu).
3. `APP_ENCRYPTION_KEY` masih belum ditetapkan (BLOCKED sejak Tahap 3) —
   penyimpanan API Key provider AI tetap ditolak sampai kunci tersedia.
4. Groq belum diverifikasi terhadap API nyata (BLOCKED sejak Tahap 3).

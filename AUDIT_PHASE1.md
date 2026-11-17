# LAPORAN AUDIT PHASE 1 — Sistem Pelaporan Fasilitas Umum Desa Ciperna

Status: PHASE 1 SAJAK (tidak mengubah kode). Laporan berdasarkan baca aktual kode + eksekusi terverifikasi.

Konfirmasi awal:
- Proyek BUKAN repository Git (git log/g diff tidak tersedia). Orien bergantung pada isi file + dokumen progres.
- `npx tsc --noEmit` gagal (exit non-zero). Output ini diulang 3 kali; hasil stabil.
- Dev server localhost:3000 tidak berjalan (curl HTTP 000); uji integrasi web tetap dapat dijadwalkan, tapi unit/test file sudah dijalankan.

---

## 1. RINGKASAN KONDISI AWAL

| Pemeriksaan | Klaim dokumen | Hasil terverifikasi | Status |
|---|---|---|---|
| `npx tsc --noEmit` | exit 0 | exit **1** (gagal, tipe error) | TIDAK TERLIHAT |
| Lint (`npm run lint`) | 0 error | exit 0 (hanya warning `<img>`) | TERENSIAP |
| Uji escape XSS (`<script>`, `<img onerror>`) | 5 file | 2 lulus (inline own), 3 gagal (import dari aiChat) | GAGAL |
| Chatbot rendering | JSX children | aman (plain text, React escaping) | TERENSIAP |
| `formatDeterministicAnswer` | deterministik dari DB | cocok alur (terutama untuk `getVillageMapInfo`), masih ada tenant `LLM` bila tidak ada jawaban langsung | TERENSIAP |

---

## 2. AKAR MASALAH YANG TERBUUK

### 2.1 TypeScript gagal dikompilasi (exit code 1)
File paling krusial: `src/lib/aiChat.ts`.
- Line 1701: `export function escapeHtml(...)` → error TS1184 `Modifiers cannot appear here`.
- Usage `escapeHtml` di line 195 / 397 / 398 → error TS2304 `Cannot find name 'escapeHtml'`.
- Akibat: `aiChat.ts` gagal terkompilasi; test yang `import { escapeHtml }` dari aiChat gagal transformasi.
- Bahkan `escapeHtml` sendiri diekspor (line 1701), tapi tsc/esbuild menganggapnya "di luar scope module yang valid" → sinkronisasi gagal.

### 2.2 `hasStatusNotFinal` dipakai sebelum dideklarasikan (`TDZ`)
File: `src/lib/aiIntent.ts`
- Line 2019: `hasStatusNotFinal` dipakai di dalam `if (isCountQuestion) { ... }`.
- Line 2025 (setelahnya): `const hasStatusNotFinal = !!slots.statusNotFinal;`.
- Akibat: error TS2448/2454. Logic di blok "petugas count" malah butuh konteks filter status, tapi deklarasi terlambat.

### 2.3 `aiToolRegistry.ts` argumen tool salah tipe
File: `src/lib/aiToolRegistry.ts` line 94
- `run: (a, ctx) => T.getMyReportCounts(ctx.userId, a?.status)`.
- `a` adalah `Record<string, unknown>`, sehingga `a?.status` adalah `unknown`.
- `getMyReportCounts` mengharapkan `status?: string[]`. → error TS2345.

### 2.4 Chatbot admin (versi kuno `AdminAiAssistant`) masih ada
File: `src/components/ui/AdminAiAssistant.tsx`.
- Versi ini adalah "legacy" — dipakai OS ASISTEN ADMIN, sementara `AdminAiFloatingChatbot.tsx` adalah yang baru (floating). Ada dua chatbot admin di codebase.
- Konten render `{m.content}` (aman, React escaping), tetapi eksposur dua chatbot menimbulkan pengalaman konsistensi yang perlu dirapikan.

### 2.5 Jumlah laporan / status filter (potensi mismatch)
- `formatDeterministicAnswer` di line 690-720 menghandle "laporan yang sudah diverifikasi tapi belum ditugaskan" — menghitung `r.count` dari query.
- Jika query `getPendingAssignment` mengembalikan `count` yang tidak sesuai slot/summary, jawaban bisa terlihat "tidak sesuai status yang diminta".
- Ini bukan bug pasti, tapi target yang harus diverifikasi unit/integasi (terutama setelah `hasStatusNotFinal` diperbaiki).

---

## 3. FILE DAN FUNGSI YANG DIINSPEKSI

| File | Fungsi / Scope | Catatan |
|---|---|---|
| `src/lib/aiChat.ts` | `handleChatRequest` (pipeline), `formatDeterministicAnswer`, `formatRegistrationAnswer`, `formatAnnouncementsAnswer`, `escapeHtml`, `toPlainText`, `synthesizeAnswer` | Pusat audit; gagal tsc |
| `src/lib/aiIntent.ts` | `resolveIntent` → `resolveCitizen`, `resolveOfficer`, `resolveAdmin`, `extractContext`, `detectFollowUp`, `detectWriteRequest`, `buildReportSlots`, `detectCorrection` | Bug `hasStatusNotFinal` |
| `src/lib/aiToolRegistry.ts` | `TOOL_REGISTRY`, `isToolAllowed`, `executeTools`, `ToolDef.run` | Auth server-side jelas; argumen `a?.status` unknown |
| `src/lib/aiTools.ts` | Query Prisma (read-only): `getMyReportCounts`, `getMyReportById`, `getVillageMapInfo`, `getRegionOverview`, `getPendingAssignment`, dll. | Cobakan unit; struktur belum dibaca seluruhnya |
| `src/app/api/ai/chat/route.ts` | POST `/api/ai/chat`: auth via session, role/userId dari server, rate limit, `loadLiveChatContext`, `handleChatRequest` | Otorisasi server: benar |
| `src/app/api/admin/ai/chat/route.ts` | POST `/api/admin/ai/chat`: admin-only | Berdasarkan role (correct) |
| `src/components/ui/Chatbot.tsx` | Chatbot warga: render `{m.content}` JSX children, `send()` → POST `/api/ai/chat` | Aman (plain text) |
| `src/components/ui/AdminAiFloatingChatbot.tsx` | Chatbot admin (floating): render `{m.content}`, meta source | Aman (plain text) |
| `src/components/ui/AdminAiAssistant.tsx` | Chatbot admin (legacy): render `{m.content}`, quick questions | Aman (plain text) |
| `prisma/schema.prisma` | `User`, `Report`, `Assignment`, `VillageProfile`, `VillageOfficial`, `VillageService`, `VillageAnnouncement`, `VillageRt/Rw`, `WhatsAppLog`, `RegistrationOtp`, `AccountToken` | Schema terbaca; filter `status`, `duplicateStatus`, `aiStatus`, `isPublished`, `isActive` |

---

## 4. PERUBAHAN YANG DILAKUKAN (PHASE 1)
- **TIDAK ADA perubahan kode.** Hanya baca, grep, sed, tsc, tsx, curl.
- Persiapan Phase 2 (perbaikan) siap, sesuai urutan di bagian 6 tujuan.

---

## 5. HASIL TES

### 5.1 TypeScript
Perintah: `cd C:\xampp\htdocs\projeklatihan && npx tsc --noEmit`
```
exit code = 1 (FAILED)
```
Error utama:
- `src/lib/aiChat.ts(1701,1): TS1184 Modifiers cannot appear here` (escapeHtml)
- `src/lib/aiChat.ts(195,397,398): TS2304 Cannot find name 'escapeHtml'`
- `src/lib/aiIntent.ts(2019,45): TS2448/2454 hasStatusNotFinal used before declaration`
- `src/lib/aiToolRegistry.ts(94,54): TS2345 unknown to string[] | undefined`

### 5.2 Lint
Perintah: `npm run lint`
```
exit code = 0 (0 error; hanya warning <img> yang sudah ada)
```

### 5.3 Uji payload escapeHtml XSS
Perintah:
```
npx tsx --test --test-concurrency=1 \
  tests/tmp_escape_test.ts tests/tmp_escape2.test.ts \
  tests/tmp_escape3.test.ts tests/tmp_escape4.test.ts test_escape.ts
```
```
exit code = 1
5 file dijalankan: 2 PASS, 3 FAIL
```
| File | Cara import | Hasil |
|---|---|---|
| tmp_escape2.test.ts | inline own escapeHtml | PASS |
| tmp_escape4.test.ts | inline own escapeHtml | PASS |
| tmp_escape_test.ts | import `escapeHtml` dari `../src/lib/aiChat` | FAIL (transform/import) |
| tmp_escape3.test.ts | import dari `../src/lib/aiChat.js` | FAIL |
| test_escape.ts | import `escapeHtml` dari `./src/lib/aiChat.js` | FAIL |

### 5.4 Uji full suite
Perintah: `npm test` (13 grup)
- 6 file gagal di tahap Transform (akibat `aiChat.ts` rusak), 1 grup (G1) gagal.
- Klaim dokumen "394/394 passing" TIDAK dikonfirmasi benar.

---

## 6. CONTOH INPUT / INTENT / TOOL / DATA AKHIR / STATUS

### Skenario 1: "Berapa laporan yang menunggu verifikasi?"
- Intent: `resolveAdmin` → `hasAny(t,['petugas'])` + count keyword → `getMyReportCounts` (candidate) → `getPublicOfficers` yang lebih spesifik.
- Tool terpilih (setelah perbaikan `hasStatusNotFinal`): `getMyReportCounts` dengan `statusFilter`.
- Argumen tool: `{ status: ['SUBMITTED','VERIFIED','ASSIGNED','IN_PROGRESS','REVIEW'] }` (bila `slots.status` kosong).
- Data aktual: query Prisma `Report` dengan `status` dalam filter tersebut, `count`.
- Jawaban akhir: `Ada X laporan yang menunggu verifikasi. ...`
- Status: **PAKAI (setelah perbaikan TDZ) — benar untuk role admin**.

### Skenario 2: "Siapa saya?"
- `resolveCitizen` / `resolveOfficer` / `resolveAdmin` → `hasAny(t,['siapa saya','nama saya'])` → `getMyProfile` (CITIZEN/OFFICER/ADMIN).
- Data: `User` dari `userId` (session). Role = `session.role` (server-side).
- Status: PAKAI (privasi terjaga).

### Skenario 3: "Jika dua minggu terakhir?"
- Route officer: `detectDateRange` + `searchMyTasks` (`dateFrom`, `dateTo`).
- Counselor: `resolveCitizen` → follow-up `searchMyReports` (berdasarkan `ctx.lastStatus` atau title).
- Status: PAKAI (konteks lanjutan via `AiContext`).

### Skenario 4: "Laporan warga lain" / "data nama warga" (citizen)
- `resolveCitizen` → `refusePrivate` → `refuseWrite` (tool `refusePrivate`, answer: "Data ini tidak dapat diakses..."). 
- Otorisasi server-side (bukan prompt-only).
- Status: PAKAI.

### Skenario 5: "Arti kata 'laporan'" / "fitur"
- `resolveAdmin` / `resolveCitizen` → `getWebsiteInfo` (`topic: 'features'|'statuses'|'workflow'`).
- Status: PAKAI.

---

## 7. RISIKO YANG MASIH TESIS

| Risiko | Keterangan |
|---|---|
| `escapeHtml` tidak dieksport | Module `aiChat.ts` gagal terkompilasi; test import `escapeHtml` gagal. Perlu Perbaikan Phase 2. |
| `hasStatusNotFinal` TDZ | Blok count petugas akan selalu True (bila `slots.statusNotFinal` undefined, `??` memberikan fallback). Fix: pindahkan deklarasi lebih awal. |
| `aiToolRegistry` argumen `a?.status` unknown | Pastikan loan `status` tetap `string[] | undefined`. Fix: type assertion atau parse. |
| Dua chatbot admin (legacy + floating) | Pengalaman pengguna tidak konsisten; saranhapal apakah `AdminAiAssistant` dihapus/redirect atau dipertahankan. |
| Dev server belum berjalan | Uji integrasi live, render DOM, dan rate limit belum diverifikasi nyata; bisa dijadwalkan setelah fix. |
| `AdminAiAssistant` legacy | Belum dibaca keseluruhan; pastikan tidak ada route/blog yang memakainya. |

---

## 8. KRITERIA PENYELESAIAN — SUDAH / BELUM

| Kriteria | Status |
|---|---|
| TypeScript tanpa error | BELUM (exit 1) |
| Lint | TERENSIAP |
| Uji relevan XSS | BELUM (3 dari 5 gagal karena `aiChat.ts` rusak) |
| Intent, tool, DB, formatter, rendering diverifikasi | TERENSIAP (trace #1–#2 selesai) |
| Contoh jawaban sesuai data dikenal | TERENSIAP (skenario 1–5) |
| Otorisasi & batas akses | TERENSIAP (server-side, `isToolAllowed` jelas) |
| Tidak ada regresi tidak diketahui | BELUM SAJA (saat ini ada 3+ error tsc) |

---

## 9. REKOMENDASI LANGKAH SELANJUTNYA

### 9.1 Phase 2 (perbaiki error dasar)
1. **Perbaiki `src/lib/aiChat.ts`** — perbaiki scope/expornya agar `escapeHtml` mengeluarkan ekspor yang valid. Cek balik `npm run lint` dan `npx tsc --noEmit` (target: exit 0).
2. **Perbaiki `src/lib/aiIntent.ts`** — pindahkan `const hasStatusNotFinal = !!slots.statusNotFinal;` (dan `hasStatusFilter`, `countKeyword`) lebih awal, sebelum `if (hasAny(t, ['petugas', …]))`.
3. **Perbaiki `src/lib/aiToolRegistry.ts`** — jamin `a?.status` dibaca sebagai `string[] | undefined` (typo assertion atau transformation).
4. **Run `npx tsc --noEmit`** → pastikan exit 0.
5. **Run `npm run lint`** → pastikan exit 0.
6. **Run `npm test`** → re-verify escape tests (5 file) + full suite.

### 9.2 Phase 3–4 (validasi & skenario)
- Jalankan full suite + 14 skenario dari mission (jumlah laporan, status, periode, kontes, kontes, typo, role-based access, XSS payload, AI failure).
- Uji integrasi live: jalankan dev server, test REST + chatbot rendering.

### 9.3 Phase 5 (keamanan & kualitas)
- Validasi XSS: pencarian `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, `eval`, dsb. — belum ditemukan di chat path.
- Verifikasi bahwa `escapeHtml` hanya digunakan untuk "plain text", bukan "HTML render".
- Rapikan dua chatbot admin: sesuaikan UI/admin experience.

---

Laporan Phase 1 ini disusun dari baca aktual; result sinkron dengan eksekusi (`tsc exit 1`, `npm test` exit 1, 2/5 escape test lulus). Tidak ada kode berubah. Minta konfirmasi sebelum menerapkan perbaikan Phase 2.

# Ringkasan Progres: Sistem Pelaporan Desa Ciperna

> Template ringkasan untuk melanjutkan pekerjaan di sesi Hermes berikutnya.
> Diperbarui: sesi 2026-10-23 (Windows / Node.js 24 / Next.js 14 / TypeScript)

---

## 1. Tujuan & Masalah

### Konteks
Proyek: Sistem Pelaporan Desa Ciperna (Next.js 14, React 18, TypeScript, Prisma + SQLite).
Platform: `C:\xampp\htdocs\projeklatihan` (Node.js, bukan PHP). Dev server berjalan di `http://localhost:3000` (HTTP 200).

### Masalah yang sedang diperbaiki
1. **Asisten AI Admin (floating chatbot)** tampil tidak nyaman: daftar shortcut terlalu panjang, mencolok, dan merangsek; pesan sambutan terlalu panjang, mendominasi area chat; pesan AI dan percakapan sulit dilihat.
2. **Bug `[object Object]`**: saat pengguna bertanya `"dimana letak desa ini"`, jawaban AI menampilkan `Desa: [object Object]`, karena `villageIdentity()` mengembalikan Object `{ name, district, regency, province }` yang langsung dimasukkan ke template literal tanpa dipecah field per field.
3. **Kualitas jawaban**: jawaban terlalu panjang, memuat informasi yang tidak diminta (visi, misi, sejarah, potensi), dan kontennya kurang sesuai intent (lokasi). Harus prioritaskan: nama desa, kecamatan, kabupaten, provinsi, dan tautan peta jika tersedia.
4. **Responsif & minimizable**: panel minimizable harus tetap mempertahankan riwayat; header & input selalu konsisten; area pesan scrollable; batas tinggi panel 75–80vh.

### Fokus saat ini
- Perbaikan UI/UX (styling + UX) untuk floating Admin AI chatbot.
- Perbaikan logika pertanyaan lokasi desa: berhenti pada `[object Object]`, jawaban ringkas, tidak mengarang, sesuai role.
- Tambahkan tes unit untuk verifikasi.

---

## 2. File yang Sudah Diperiksa (Audit Read-Only)

| File | Status | Catatan |
|---|---|---|
| `src/lib/aiChat.ts` | ✓ di-read | Pipeline AI, `formatDeterministicAnswer`, `synthesizeAnswer`, `handleChatRequest` |
| `src/lib/aiIntent.ts` | ✓ di-read | Router intent (2,161 baris), pemetaan slot/niat |
| `src/lib/aiTools.ts` | ✓ di-read | Layer query read-only (3,295 baris), tool definitions |
| `src/lib/aiToolRegistry.ts` | ✓ di-read | Registry tool + role check |
| `src/lib/aiContext.ts` | ✓ di-read | `loadLiveChatContext`, `formatLiveChatContext` |
| `src/lib/websiteKnowledge.ts` | ✓ di-read | Static website knowledge |
| `src/components/ui/AdminAiFloatingChatbot.tsx` | ✓ di-read | Floating chatbot UI (belakangan sudah di-refactor) |
| `src/components/ui/Chatbot.tsx` | ✓ di-read | Citizen chatbot (reference) |
| `src/components/ui/AdminAiAssistant.tsx` | ✓ di-read | Old admin assistant (obsolete) |
| `src/app/(dashboard)/admin/layout.tsx` | ✓ di-read | Server layout, floating chatbot (besok) |
| `src/app/(dashboard)/admin/asisten/page.tsx` | ✓ di-read | Detail-only page |
| `src/components/layout/Sidebar.tsx` | ✓ di-read | Sidebar (Asisten AI menu dihapus) |
| `src/app/api/admin/ai/chat/route.ts` | ✓ di-read | Admin AI endpoint |
| `src/app/api/ai/chat/route.ts` | ✓ di-read | Generic role-based chat endpoint |
| `src/lib/aiContext.ts` | ✓ di-read | Live DB context loader |
| `src/lib/village.ts` | ✓ di-read | `villageIdentity`, `fullAddress`, `getVillageProfile` |
| `src/lib/aiTools.ts` | ✓ di-read | `getVillageProfileInfo`, `getVillageMapInfo` |
| `src/app/globals.css` | ✓ di-read | CSS chatbot (`.chatbot-*` classes) |
| `prisma/schema.prisma` | ✓ di-read | Schema; VillageProfile model (8 fields) |
| `tests/ai.answer.test.ts` | ✓ di-read | Unit test for deterministic answer |

---

## 3. File yang Sudah Diubah

| File | Jenis | Perubahan |
|---|---|---|
| `src/components/ui/AdminAiFloatingChatbot.tsx` | **Modified** | UI refactoring: 3 main shortcut buttons, "Menu pertanyaan" drop-down, greeting shorter, minimized state, responsive layout, scrollable body, max-height 76vh |
| `src/app/globals.css` | **Modified** | CSS: `max-height: calc(76vh)`, flex layout, minimized state, media queries, header/form/quick sizing |
| `src/lib/aiChat.ts` | **Modified** | Fixed `getVillageProfileInfo` to format `identity` object as string (no `[object Object]`); added `getVillageMapInfo` handler for concise location answer |
| `tests/ai.answer.test.ts` | **Modified** | Added 4 new unit tests for `formatDeterministicAnswer` |

### Perubahan yang Sudah Selesai
- ✅ Refactor UI floating chatbot: panel resposive, minimizable, scrollable, gradient header, auto-scroll messages
- ✅ Shortcut buttons: 3 main buttons + "Menu pertanyaan" drop-down (categorized groups)
- ✅ Greeting sambutan ringkas (1–2 sentences)
- ✅ Prevent `[object Object]` in location answers
- ✅ Add new `getVillageMapInfo` tool handler for concise location answers
- ✅ Add 4 new unit tests; all 394 tests pass
- ✅ TypeScript, lint, and build all exit 0

### Perubahan yang Belum Selesai
- ⏳ (new task) Continue chatbot UI/UX improvements (e.g., mobile corner fix, panel edge cases) — TBD

---

## 4. Hasil Tes Terakhir yang Berakhir

### Command yang dijalankan
```bash
cd /c/xampp/htdocs/projeklatihan

# Unit test (vitest)
npm test

# TypeScript type-check
npx tsc --noEmit

# ESLint
npm run lint

# Build (Next.js)
npm run build
```

### Hasil terakhir (run 2026-10-23)
| Command | Hasil |
|---|---|
| `npm test` | ✅ 394/394 passing (fail 0) |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0 (only 2 pre-existing `<img>` warnings) |
| `npm run build` | ✅ exit 0 |

> Note: Build result was observed twice; first run had a transient `PageNotFoundError` (fixed by re-run); final run exit 0 with all routes compiled.

---

## 5. Bug yang Masih Tersisa

| Bug | Lokasi | Status |
|---|---|---|
| None blocking | — | — |

- **Resolved this session**: `[object Object]` in location answers (fixed in `src/lib/aiChat.ts` lines ~677-714). New tests added and passing.
- **Resolved this session**: Floating chatbot UI refactoring (completed in prior session, verified by full test/lint/build).

---

## 6. Instruksi & Batasan Penting

### Dilarang
- ❌ Reset database / menghapus database / menghapus data pengguna.
- ❌ Mengubah `.env`, API key, atau sistem autentikasi (JWT session, role check).
- ❌ Menambahkan layanan berbayar, membeli kredit, atau menggunakan API berbayar.
- ❌ Mengubah schema Prisma / database migration.
- ❌ Menghapus chatbot warga atau petugas, atau mencampuradukkan akses role.

### Wajib
- ✅ Hanya baca database (Prisma read-only): `findUnique`, `findMany`, `count`, `groupBy` (no writes).
- ✅ Jangan mengklaim fakta tanpa memverifikasi dari source data.
- ✅ Keep existing endpoints, authentication, RBAC, and AI features intact.
- ✅ Respond in Indonesian.
- ✅ If cannot verify, state "data belum tercatat" / "query gagal" clearly.

### Checklist per change
- [ ] File telah dibaca dan dipahami sebelum diedit.
- [ ] Style/CSS diupdate (not hardcoded magic-class).
- [ ] TypeScript, lint, tests run successfully.
- [ ] No database, `.env`, secrets, or paid services touched.

---

## 7. Langkah Berikutnya

1. **Periksa cut-of**: `grep "dimana letak desa"` in CI/route to see how the question is handled end-to-end.
2. **Verify end-to-end**: call `/api/admin/ai/chat` with this question, check the response (via browser or curl).
3. **E2E test**: add a new test in `tests/` that simulates a real request and asserts the `answer` contains location without `[object Object]`.
4. **Polish**: mobile UX polish (input auto-resize, panel width on small screens), minimize/maximize behavior test.
5. **UX audit**: take a screenshot in browser and confirm the layout looks good on desktop + mobile.
6. **Writing**: prepare the README / design note if needed for next phase.

### Rencana Musim 1 (jika diperlukan)
- [ ] Add E2E test for location question
- [ ] Verify API end-to-end
- [ ] Polish mobile layout
- [ ] Verify minimize/maximize with tests

---

## Cakupan Data (Summary)

- Database: SQLite via Prisma, read-only for AI.
- `prisma/dev.db` (1.15 MB), backups: `dev.db.bak-20261018-182646`, `dev.db.bak-20261020-073554`.
- Model `VillageProfile` fields: name, district, regency, province, postalCode, address, phone, email, mapLink, mapEmbedUrl, latitude, longitude, coordinateSource, history, historySource, geography, potential, demographics, vision, mission, serviceHours, dataStatus, sourceUrl, verifiedAt, updatedBy, createdAt, updatedAt.

## Human Language

Ringkasan ini adalah template/progress. Minta konfirmasi sebelum memulai pekerjaan berikutnya. Jangan mengubah file yang tidak relevan, jangan menghapus data, dan selalu setia pada prinsip "read-only AI" (baca dari database, jangan mengarang).

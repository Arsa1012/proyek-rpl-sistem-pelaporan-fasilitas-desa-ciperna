# Revisi Diagram UML Desa Ciperna — v1.1

Tanggal: 16 Nov 2026. Dasar: audit kesesuaian diagram v1.0 dengan implementasi aktual
(kode `src/`, `prisma/schema.prisma`, rute API, dan halaman dashboard).

## Hasil audit kesesuaian

Diagram v1.0 **mayoritas sesuai** untuk alur inti (registrasi + OTP, buat laporan +
upload bukti + analisis AI, penanganan laporan oleh petugas, administrasi oleh Admin,
dan verifikasi OTP WhatsApp). Namun ada beberapa perbedaan nyata:

### A. Fitur yang ada di kode tetapi TIDAK ada di diagram v1.0
1. **Asisten AI / chat (lintas peran)** — `api/ai/chat`, `api/chat`, `api/admin/ai/chat`,
   `Chatbot.tsx` (warga), `AdminAiFloatingChatbot.tsx` (semua halaman admin),
   `admin/asisten/page.tsx`.
2. **Lupa/reset password & ubah password paksa** — `lupa-password`, `reset-password`,
   `ubah-password`, `api/auth/forgot-password|reset-password|change-password`,
   `api/profile/password`.
3. **Aktivasi akun petugas via tautan** — `/aktivasi`, `api/auth/activate`,
   `api/admin/officers/[id]/activation-link`, model `AccountToken`.
4. **Login via nomor WhatsApp + "Ingat perangkat ini" (sesi 30 hari)** — `api/auth/login`.
5. **Siklus penugasan lengkap** — assign → mulai kerja → unggah bukti penyelesaian →
   tinjau & setujui/tolak (dengan permintaan perbaikan) → batalkan penugasan.
   (`api/assignments/**`, `api/admin/reports/[id]/notify-completion`).
6. **Notifikasi in-app** — model `Notification`, `NotificationBell` (terpisah dari WhatsApp).
7. **Penonaktifan/aktivasi akun warga** — `api/admin/users/[id]`, `isActive`, `suspendReason`.
8. **Statistik & peta laporan** — `admin/statistik`, `admin/map` (Leaflet).
9. **Manajemen duplikat laporan** — `admin/duplikat`, `api/admin/duplicates/**`,
   `api/admin/duplicate-assistant`.
10. **Penerima notifikasi & diagnostik WhatsApp** — `admin/whatsapp-recipients`,
    `admin/whatsapp-config` (diagnostik DNS/TCP/TLS), `api/admin/whatsapp-diagnostics`.
11. **Kebijakan model gratis AI** — `VERIFIED_FREE` / `ACCOUNT_DEPENDENT` /
    `UNVERIFIED` / `PAID`; verifikasi manual dengan URL resmi; hanya `VERIFIED_FREE`
    yang boleh masuk rantai fallback.

### B. Item di diagram v1.0 yang tidak sepenuhnya terealisasi
- **"Lihat Audit Log"**: model `AdminAuditLog` dan pencatatan (`logAdminAction`) ada,
  tetapi **belum ada halaman global/API khusus**. Baru tampilan tertanam
  (riwayat 25 perubahan penerima WA, riwayat per akun) dan `Log WhatsApp` di dashboard
  admin. Diagram v1.1 mencatat ini sebagai catatan implementasi.

### C. Penamaan peran
Kode memakai `CITIZEN` / `OFFICER` / `ADMIN`; diagram memakai label UI
Warga / Petugas / Admin. v1.1 menampilkan keduanya.

## File hasil revisi
- `use-case-v1.1.svg` / `use-case-v1.1.png` — 5 paket use case + 6 aktor + catatan implementasi.
- `activity-v1.1.svg` / `activity-v1.1.png` — 5 panel aktivitas + catatan perubahan v1.1.
- `generate.mjs` — generator SVG tanpa dependensi (jalankan: `node docs/diagrams/generate.mjs`).

## Catatan
- Tidak ada perubahan pada kode aplikasi, database, `.env`, konfigurasi provider,
  API Key, atau kredensial. Hanya artefak dokumentasi yang dibuat/diperbarui.
- Tidak ada request API nyata, WhatsApp, atau aktivasi provider yang dilakukan.

# Skrip Audit UI (viewport & overflow)

Skrip ini dipakai untuk memverifikasi responsivitas lewat Chrome headless + CDP.
Bukan bagian dari aplikasi (tidak di-import oleh kode produksi).

## Prasyarat

1. Dev server hidup di `http://localhost:3000` (`npm run dev`).
2. Chrome terpasang di `C:\Program Files\Google\Chrome\Application\chrome.exe`
   (ubah konstanta `CHROME` di skrip bila lokasinya berbeda).
3. Node.js >= 18 (butuh `fetch` dan `WebSocket` global).
4. Akun seed tersedia:
   - Admin: `admin@ciperna.id` / `Admin123!`
   - Warga: `citizen1@example.com` / `password123`
   - Petugas: `officer1@example.com` / `password123`

## Menjalankan

```powershell
node scripts/ui-audit/ui-check.mjs     # admin: 8 viewport, drawer, tabel, chatbot? + uji live AI
node scripts/ui-audit/ui-citizen.mjs   # warga: chatbot + halaman utama di 320/390/768
node scripts/ui-audit/ui-scan.mjs      # scan elemen keluar viewport di 26 rute (3 lebar)
```

Keluaran (screenshot + `results.json`) ditulis ke folder sementara:

- `%TEMP%\opencode\ui-shots`
- `%TEMP%\opencode\ui-citizen`
- `%TEMP%\opencode\ui-scan`

Folder sementara bisa dibersihkan Windows. Untuk menyimpan bukti permanen,
salin isinya ke tempat lain setelah dijalankan.

## Catatan penting

- **Setiap login admin memicu notifikasi WhatsApp login** (jalur notifikasi
  yang sudah ada) dan memakai kuota Fonnte. Jalankan skrip seperlunya.
- `ui-check.mjs` juga memanggil `/api/ai/chat` secara live (4 pertanyaan
  pendaftaran) sehingga memakai kuota model AI dan rate limit chat.
- Headless tanpa `--enable-unsafe-swiftshader` bisa menampilkan artefak abu-abu
  pada elemen `backdrop-filter`. Itu artefak render headless, bukan bug CSS;
  skrip sudah memakai flag tersebut.
- `ui-scan.mjs` menganggap ancestor `overflow: hidden/clip` sebagai wadah
  (tidak dihitung sebagai pelanggaran), jadi elemen yang terpotong oleh
  `overflow: hidden` tidak terdeteksi. Untuk kasus itu cek manual/ukur
  `scrollWidth` vs `clientWidth` seperti yang dilakukan pada filter
  `/admin/masyarakat` dan `/admin/petugas`.
- Skrip tidak menulis ke database, kecuali notifikasi login di atas.

## Skrip audit lanjutan (drawer & menu)

```powershell
node scripts/ui-audit/ui-mobile-fix.mjs   # 7 viewport: drawer, scroll menu, footer, body lock, Escape/overlay/resize
node scripts/ui-audit/ui-links.mjs        # audit tautan sidebar 3 role + proteksi role + route legacy
node scripts/ui-audit/ui-header.mjs       # topbar vs judul/konten + screenshot terang/gelap 320/400
node scripts/ui-audit/ui-reduced.mjs      # prefers-reduced-motion + tab laporan 320
```

Keluaran: `%TEMP%\opencode\ui-mobile-fix` (screenshot + JSON).
`ui-links.mjs` memakai profil Chrome yang sama; jika sesi kedaluwarsa ia login
ulang. Perhatikan batas login 5/15 menit per IP dan notifikasi WhatsApp login
Admin.

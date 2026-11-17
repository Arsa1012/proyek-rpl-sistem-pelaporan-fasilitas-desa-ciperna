# Panduan Membuat Prototipe Figma — Desa Ciperna

> **Kenapa tetap perlu Figma?** Modul mewajibkan *prototipe interaktif UI/UX Figma* di SDD dan di-video Progres 2. Saya sudah menyiapkan semua gambarnya — Anda tinggal **import + sambungkan panah + publish link**. Tidak perlu menggambar dari nol.

---

## CARA TERCEPAT (disarankan) — import 1 gambar board

1. Buka browser, kunjungi **https://www.figma.com** → **Log in** (Gratis cukup).
2. Klik **+ New → New Design File**.
3. Di kiri atas, ganti nama file menjadi: **`Desa Ciperna — UIUX Prototype`**.
4. Buka folder `docs/figma/` di komputer Anda.
5. **Drag file `FIGMA-BOARD-LENGKAP.png`** ke kanvas Figma.
   - Alternatif: menu **Place** (shortcut `Shift + I`) → pilih file itu.
6. Gambar board (isi 10 layar) sekarang jadi **1 objek gambar**.
7. Sekarang **potong jadi 10 Frame**:
   - Pilih gambar → **Ctrl + C**, lalu **Ctrl + V** sebanyak 10 kali.
   - Tiap salinan → potong sesuai area layar (atau lebih mudah: **hapus board**, lalu import 10 file PNG satu per satu — lihat cara下面).
8. Beri nama tiap frame sesuai `DAFTAR-FRAME-FIGMA.md` (mis. `Landing`, `Login`, `Warga/Dashboard`, dll).

---

## CARA LEBIH RAPI — import 10 file PNG (ini yang paling disarankan)

1. Di file Figma kosong, buat **4 Page** di panel kiri (klik `+` di sebelah "Page 1"):
   - `01 · Public & Auth`
   - `02 · Warga`
   - `03 · Petugas`
   - `04 · Admin`
2. Masuk ke Page `01 · Public & Auth`.
3. Buka `docs/figma/`, **drag** `01-landing.png` ke kanvas → otomatis jadi Frame.
4. Ulangi untuk file lain sesuai daftar:

| Page | File PNG yang di-import |
|------|-------------------------|
| `01 · Public & Auth` | `01-landing.png`, `02-auth-login-register.png`, `10-public-portal.png` |
| `02 · Warga` | `03-warga-dashboard-buat-laporan.png`, `04-warga-laporan-detail-ai.png`, `09-chatbot-asisten-ai.png` |
| `03 · Petugas` | `05-petugas-tugas-detail.png` |
| `04 · Admin` | `06-admin-dashboard-laporan.png`, `07-admin-ai-config.png`, `08-admin-operasional.png` |

5. Beri **nama frame** dengan cara: klik frame → di panel kanan bagian nama (tentang "Frame") → ketik nama baru.
   Contoh: `01 Landing`, `02 Login`, `03 Warga Dashboard`, dst.

---

## Menyambungkan Prototype (panah antar layar)

1. Klik kanan atas, pilih tab **Prototype** (atau shortcut `Ctrl + E` / di Figma terbaru tombol **Prototype** di kanan atas).
2. Klik sebuah **tombol** di frame (mis. tombol "MASUK" di frame Login).
3. Akan muncul **lingkaran kecil** di tepi kanan tombol itu. **Tarik** lingkaran tersebut ke frame tujuan (mis. frame `Warga/Dashboard`).
4. Di panel kanan muncul pengaturan:
   - **Interaction:** `On click` → `Navigate to`
   - Pilih frame tujuan.
   - **Animation:** `Instant` (atau `Smart animate` biar halus).
5. Ulangi untuk alur utama (versi ringkas):

```
Landing → Masuk → Login → Dashboard (sesuai peran)
Landing → Daftar → Register → OTP → Login
Warga Dashboard → Buat Laporan → Daftar Laporan → Detail Laporan
Petugas Dashboard → Detail Tugas → Kirim Bukti
Admin Dashboard → Verifikasi Laporan → Assign → Detail Tugas Petugas
Semua halaman Admin → tombol 🤖 → AI Assistant Admin
```

> Cukup **5–8 panah utama** untuk video. Tidak perlu menyambung semua tombol.

---

## Publish & dapatkan TAUTAN (wajib untuk README)

1. Klik tombol **Present** (▶) di kanan atas → pastikan alur bisa diklik.
2. Tutup presentasi.
3. Klik **Share** (kanan atas).
4. Di bagian **"Who has access"**, ubah menjadi **"Anyone with the link"** → izin **can view**.
5. Klik **Copy link**.
6. Buka file `README.md`, cari bagian **"## 7. Link Prototipe Figma"**, tempel tautan di sana, ganti placeholder.

Contoh:
```
**Link Figma Prototype:** https://www.figma.com/design/abc123/Desa-Ciperna-UIUX-Prototype?node-id=0-1&t=xyz
```

---

## Untuk Video Progres 2 (5–7 menit)
Saat merekam, tunjukkan:
1. Frame **Use Case** (dari PDF) → sebutkan peran Warga/Petugas/Admin.
2. Frame **Activity** → alur laporan & AI.
3. Buka Figma → **klik panah prototype** dari Landing → Login → Dashboard → Buat Laporan (live, bukan foto).
4. Sebutkan design token: primary `#0F766E`, font Inter, kartu glass.

> Ingat ketentuan modul: **webcam aktif**, resolusi min. 720p, durasi 5–7 menit, upload YouTube/Drive, link di README.

# Daftar Frame & Panduan Prototipe Figma — Desa Ciperna

Untuk **Video Progres 2 (UML & UI/UX)**. Mockup PNG di folder ini sudah sesuai warna, badge, layout, dan konten aplikasi aktual (`globals.css` + halaman `src/app`).

## A. Daftar Frame (urutan Recommended di Figma)

Buat satu file Figma `Desa Ciperna — UIUX Prototype`. Buat **1 Page per peran**, lalu taruh frame berikut:

### Page 1 — `01 · Public & Auth`
| # | Nama Frame | File PNG | Ukuran |
|---|-----------|----------|--------|
| 1 | `Landing / Hero` | `01-landing.png` | 1440 × 900 |
| 2 | `Login` | `02-auth-login-register.png` (bagian kiri) | 420 × 720 |
| 3 | `Register — Form` | `02-auth-login-register.png` (tengah) | 420 × 820 |
| 4 | `Register — Verifikasi OTP` | `02-auth-login-register.png` (kanan) | 420 × 640 |
| 5 | `Profil Desa` | `10-public-portal.png` (atas) | 1440 × 900 |
| 6 | `Layanan Desa` | `10-public-portal.png` (tengah) | 1440 × 900 |
| 7 | `Pengumuman` | `10-public-portal.png` (bawah) | 1440 × 900 |

### Page 2 — `02 · Warga (CITIZEN)`
| # | Nama Frame | File PNG |
|---|-----------|----------|
| 8 | `Warga / Dashboard` | `03-warga-dashboard-buat-laporan.png` (atas) |
| 9 | `Warga / Buat Laporan` | `03-warga-dashboard-buat-laporan.png` (bawah) |
| 10 | `Warga / Daftar Laporan` | `04-warga-laporan-detail-ai.png` (atas) |
| 11 | `Warga / Detail Laporan + AI + Timeline` | `04-warga-laporan-detail-ai.png` (bawah) |
| 12 | `Warga / Profil` | (bisa duplikat frame dashboard + ganti konten Profil) |
| 13 | `Chatbot / Asisten Desa` | `09-chatbot-asisten-ai.png` (kiri) |

### Page 3 — `03 · Petugas (OFFICER)`
| # | Nama Frame | File PNG |
|---|-----------|----------|
| 14 | `Petugas / Dashboard` | `05-petugas-tugas-detail.png` (atas) |
| 15 | `Petugas / Detail Tugas + Workflow` | `05-petugas-tugas-detail.png` (bawah) |
| 16 | `Petugas / Riwayat Tugas` | (duplikat frame 15, ganti judul) |

### Page 4 — `04 · Admin (ADMIN)`
| # | Nama Frame | File PNG |
|---|-----------|----------|
| 17 | `Admin / Dashboard (statistik + grafik)` | `06-admin-dashboard-laporan.png` (atas) |
| 18 | `Admin / Daftar & Verifikasi Laporan` | `06-admin-dashboard-laporan.png` (bawah) |
| 19 | `Admin / Konfigurasi Asisten AI` | `07-admin-ai-config.png` (atas) |
| 20 | `Admin / Pusat Pengetahuan AI` | `07-admin-ai-config.png` (bawah) |
| 21 | `Admin / Wilayah RT-RW` | `08-admin-operasional.png` (atas) |
| 22 | `Admin / Pengumuman` | `08-admin-operasional.png` (tengah) |
| 23 | `Admin / Pusat WhatsApp` | `08-admin-operasional.png` (bagian 3) |
| 24 | `Admin / Statistik` | `08-admin-operasional.png` (bawah) |
| 25 | `Admin / Asisten AI` | `09-chatbot-asisten-ai.png` (kanan) |

## B. Cara cepat import ke Figma
1. Buka Figma → **File → New Design File**.
2. Buat Page sesuai daftar di atas.
3. **Drag & drop** file PNG ke canvas Figma (Figma otomatis membuat frame dari gambar).
4. Beri nama frame persis seperti kolom "Nama Frame".
5. (Opsional) Untuk hasil lebih rapi, **Trace** elemen penting: tombol, badge, kartu — tapi untuk keperluan video, PNG yang sudah rapi ini cukup.

## C. Alur Prototipe (interactive prototype links)

Hubungkan frame dengan **Prototype** (panah →) sesuai alur use case:

```
Landing
  ├─ Masuk → Login
  │           ├─ (sukses, peran Warga) → Warga/Dashboard
  │           ├─ (sukses, peran Petugas) → Petugas/Dashboard
  │           └─ (sukses, peran Admin) → Admin/Dashboard
  └─ Daftar → Register/Form → (kirim OTP) → Register/OTP → (valid) → Login

Warga/Dashboard
  ├─ Buat Laporan → Warga/Buat Laporan → (kirim) → Warga/Daftar Laporan
  ├─ Laporan Saya → Warga/Daftar Laporan → (klik baris) → Warga/Detail Laporan
  └─ 💬 FAB → Chatbot/Asisten Desa

Petugas/Dashboard
  └─ Lihat Detail → Petugas/Detail Tugas → (kirim bukti) → status "Menunggu Verifikasi Admin"

Admin/Dashboard
  ├─ Verifikasi Laporan → Admin/Daftar Laporan
  ├─ Assign Petugas → (memunculkan Petugas/Detail Tugas)
  ├─ Konfigurasi AI → Admin/Konfigurasi Asisten AI → Uji Koneksi
  ├─ Pusat Pengetahuan AI → Admin/Pusat Pengetahuan AI
  ├─ Wilayah RT/RW → Admin/Wilayah
  ├─ Pengumuman → Admin/Pengumuman → Broadcast WhatsApp
  ├─ Statistik → Admin/Statistik
  └─ Pusat WhatsApp → Admin/Pusat WhatsApp
```

## D. Catatan warna (design tokens) — pakai di Figma
| Token | Warna |
|-------|-------|
| Primary | `#0F766E` |
| Primary dark | `#064E3B` |
| Success | `#15803D` |
| Warning | `#F59E0B` |
| Danger | `#EF4444` |
| Background | `#F0FDF4` |
| Teks utama | `#1F2937` |
| Sidebar | gradient `#032E28 → #064E3B → #0F766E` |
| AI card | gradient `#1E40AF → #7C3AED` |
| Font | Inter |

## E. Hubungan dengan UML
Frame-frame ini adalah realisasi视觉 dari Use Case & Activity diagram v1.1 di `docs/diagrams/`. Saat menjelaskan Video Progres 2, sebutkan:
- "Use Case Buat Laporan" → frame **Warga/Buat Laporan**
- "Activity Deteksi Duplikat & Analisis AI" → frame **Warga/Detail Laporan (kartu AI)**
- "Use Case Konfigurasi AI Provider" → frame **Admin/Konfigurasi Asisten AI**
- "Activity Alur Penugasan" → frame **Petugas/Detail Tugas**

## F. Status pengumpulan
- ✅ Mockup PNG: **sudah jadi** (10 file, sesuai kode aktual)
- ⏳ Yang masih perlu Anda lakukan: import ke Figma, beri nama frame, sambungkan prototype, lalu **Publish → salin link Figma** ke README.md (Prototype tab → Share → Copy link).

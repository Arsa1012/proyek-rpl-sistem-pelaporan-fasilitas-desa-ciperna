# Panduan GitHub — Format Nama Repositories Sesuai Modul

## Format wajib dari modul
```
username/proyek-rpl-nama-aplikasi
```

Jadi kalau akun GitHub Anda misalnya `yudhistira123`, maka nama repository-nya:

```
https://github.com/yudhistira123/proyek-rpl-sistem-pelaporan-desa-ciperna
```

> **Artinya:** bagian `username` = akun GitHub Anda (yang sudah punya), dan bagian `proyek-rpl-nama-aplikasi` = nama repo yang Anda buat. Nama aplikasi saya sarankan: **`sistem-pelaporan-desa-ciperna`**.
>
> Jadi lengkapnya: **`proyek-rpl-sistem-pelaporan-desa-ciperna`**

---

## LANGKAH 1 — Buat repository di GitHub (lewat website)

1. Buka https://github.com → **Log in**.
2. Klik tombol **+** di kanan atas → **New repository**.
3. Isi:
   - **Repository name:** `proyek-rpl-sistem-pelaporan-desa-ciperna`
   - **Description** (opsional): `Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna berbasis web dengan AI — Tugas Proyek Akhir RPL`
   - Pilih **Public** (modul menulis "Publik Pribadi" → yang dimaksud repository bisa diakses publik).
   - **Jangan** centang "Add a README file" (karena kita sudah punya README.md lokal).
   - **Jangan** centang `.gitignore` / license dulu (biar tidak conflict).
4. Klik **Create repository**.
5. Akan muncul halaman berisi perintah. **Biarkan terbuka** — nanti dipakai di LANGKAH 3.

---

## LANGKAH 2 — Siapkan folder proyek di komputer

Proyek Anda ada di:
```
C:\xampp\htdocs\projeklatihan
```

Pastikan tidak ada file `.git` lama di sana (sebelumnya memang belum ada).

Buka **PowerShell / Git Bash**, lalu:

```bash
cd C:\xampp\htdocs\projeklatihan
git init
git branch -M main
```

---

## LANGKAH 3 — Hubungkan ke GitHub & upload (push)

Masih di folder yang sama, jalankan satu per satu:

```bash
# 1. Tambahkan semua file
git add .

# 2. Buat commit pertama
git commit -m "Initial commit: Sistem Pelaporan Desa Ciperna dengan AI"

# 3. Hubungkan ke repository GitHub Anda
#    Ganti USERNAME dengan akun GitHub Anda!
git remote add origin https://github.com/USERNAME/proyek-rpl-sistem-pelaporan-desa-ciperna.git

# 4. Push ke GitHub
git push -u origin main
```

> Contoh kalau username `yudhistira123`:
> ```bash
> git remote add origin https://github.com/yudhistira123/proyek-rpl-sistem-pelaporan-desa-ciperna.git
> ```

Kalau diminta login GitHub: gunakan **Personal Access Token (PAT)** sebagai password.
Cara dapat PAT: GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token** → centang `repo` → copy token.

---

## LANGKAH 4 — Cek hasil

1. Refresh halaman repository GitHub Anda.
2. Pastikan muncul:
   - ✅ `README.md` (dengan identitas & link video)
   - ✅ folder `src/`, `prisma/`, `tests/`, `docs/`
   - ✅ `.github/workflows/ci.yml`
3. Klik tab **Actions** → pipeline **CI — Desa Ciperna** harus berjalan. Tunggu sampai **hijau ✅**.
   - Kalau merah, lihat log error-nya (biasanya karena `.env` belum sesuai — CI sudah pakai placeholder).

---

## LANGKAH 5 — Isi README.md sebelum push

Buka `README.md`, lengkapi bagian ini (yang masih placeholder):

| Bagian | Isi |
|--------|-----|
| Nama | Nama Anda |
| NIM | NIM Anda |
| Kelompok | Nomor kelompok |
| Tema Topik Kelompok | Sesuai kesepakatan kelompok |
| Video Progres 1 | Link YouTube/Drive |
| Video Progres 2 | Link YouTube/Drive |
| Video Final | Link YouTube/Drive |
| Link Figma Prototype | Dari Figma → Share → Copy link |

---

## Ringkasan alur pengumpulan (BAB V)

| No | Ketentuan | Sudah? |
|----|-----------|--------|
| 1 | Repo GitHub `username/proyek-rpl-nama-aplikasi` + README lengkap + 3 link video | ⏳ Anda buat repo & isi link |
| 2 | 1 PDF gabungan (PRD/SRS + SDD + Pengujian) upload ke LMS | ✅ `docs/Laporan-Proyek-Akhir-Desa-Ciperna.pdf` |
| 3 | Tenggat: minggu pertemuan ke-16 (UAS) | ⏳ Perhatikan jadwal |

---

## Tips kalau git add . terlalu berat
Folder ini punya banyak file sementara (backup, `.tmp-*`, log). Sebaiknya **bersihkan dulu** atau tambahkan ke `.gitignore`. Contoh `.gitignore` yang aman:

```
node_modules/
.next/
.env
*.log
*.tmp*
tmp/
admin-cookies.txt
test*.json
chat*.json
stats*.json
```

File `.env` **wajib** tidak ikut ter-upload (berisi secret API key). README sudah mengingatkan hal ini.

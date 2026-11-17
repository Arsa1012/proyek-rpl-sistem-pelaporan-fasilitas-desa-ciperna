# -*- coding: utf-8 -*-
"""
Generator Laporan Proyek Akhir lengkap (PRD/SRS + SDD + Laporan Pengujian)
Menjadi SATU berkas PDF sesuai BAB V panduan.
Jalankan: python docs/generate-pdf.py
"""
from fpdf import FPDF
from pathlib import Path

OUT = Path("docs/Laporan-Proyek-Akhir-Desa-Ciperna.pdf")
FONT = r"C:\Windows\Fonts\segoeui.ttf"
FONT_B = r"C:\Windows\Fonts\segoeuii.ttf"  # italic (fallback bold)
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"

NAVY = (6, 78, 59)
TEAL = (15, 118, 110)
GREEN = (21, 128, 61)
GRAY = (71, 85, 105)
LIGHT = (240, 253, 244)

class PDF(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("Ciperna", "", 8)
        self.set_text_color(*GRAY)
        self.cell(0, 8, "Laporan Proyek Akhir — Sistem Informasi Pelaporan Desa Ciperna", align="L")
        self.cell(0, 8, f"Hal {self.page_no()}", align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(200, 220, 210)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-12)
        self.set_font("Ciperna", "", 7.5)
        self.set_text_color(*GRAY)
        self.cell(0, 8, "TIKB2503021 · Rekayasa Perangkat Lunak · STMIK IKMI Cirebon · v1.1", align="C")

    # helpers
    def h1(self, text):
        self.set_font("CipernaB", "", 15)
        self.set_text_color(*NAVY)
        self.ln(3)
        self.cell(0, 10, text, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*TEAL)
        self.set_line_width(0.6)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def h2(self, text):
        self.set_font("CipernaB", "", 12)
        self.set_text_color(*TEAL)
        self.ln(2)
        self.cell(0, 8, text, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def h3(self, text):
        self.set_font("CipernaB", "", 10.5)
        self.set_text_color(*NAVY)
        self.ln(1)
        self.cell(0, 7, text, new_x="LMARGIN", new_y="NEXT")

    def para(self, text, size=10):
        self.set_font("Ciperna", "", size)
        self.set_text_color(30, 41, 59)
        self.multi_cell(0, 5.4, text)
        self.ln(1)

    def bullet(self, text, size=10):
        self.set_font("Ciperna", "", size)
        self.set_text_color(30, 41, 59)
        x = self.get_x()
        self.cell(5, 5.2, "-")
        self.multi_cell(0, 5.2, text)
        self.set_x(x)

    def table(self, headers, rows, widths=None, size=9):
        if widths is None:
            widths = [self.w / len(headers)] * len(headers)
        self.set_font("CipernaB", "", size)
        self.set_fill_color(*NAVY)
        self.set_text_color(255, 255, 255)
        for h, wd in zip(headers, widths):
            self.cell(wd, 8, h, border=1, fill=True, align="C")
        self.ln()
        self.set_font("Ciperna", "", size)
        self.set_text_color(30, 41, 59)
        fill = False
        for row in rows:
            self.set_fill_color(*LIGHT) if fill else self.set_fill_color(255, 255, 255)
            for cell, wd in zip(row, widths):
                self.cell(wd, 7, str(cell), border=1, fill=True)
            self.ln()
            fill = not fill
        self.ln(2)

    def cover(self):
        self.add_page()
        self.ln(24)
        self.set_fill_color(*NAVY)
        self.rect(10, 30, self.w - 20, 58, "F")
        self.set_xy(18, 40)
        self.set_font("CipernaB", "", 22)
        self.set_text_color(255, 255, 255)
        self.multi_cell(self.w - 36, 11, "LAPORAN PROYEK AKHIR MANDIRI", align="C")
        self.set_xy(18, 66)
        self.set_font("Ciperna", "", 13)
        self.multi_cell(self.w - 36, 8, "Sistem Informasi Pelayanan & Pelaporan Warga Desa Ciperna\nBerbasis Web dengan Dukungan Kecerdasan Artifisial (AI)", align="C")
        self.ln(26)
        self.set_font("CipernaB", "", 12)
        self.set_text_color(*NAVY)
        self.cell(0, 9, "Mata Kuliah: Rekayasa Perangkat Lunak (TIKB2503021) — 4 SKS", align="C", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Ciperna", "", 11)
        self.set_text_color(*GRAY)
        for line in [
            "Program Studi S1 Teknik Informatika — STMIK IKMI Cirebon",
            "Semester 3 · Dosen Pengampu: Yudhistira Arie Wijaya, M.Kom., CDS.",
            "",
            "Nama Mahasiswa : .............................................................",
            "NIM            : .............................................................",
            "Kelompok       : .............................................................",
            "Tema Kelompok  : .............................................................",
            "",
            "Dokumen gabungan: PRD/SRS · SDD (UML & UI/UX) · Laporan Pengujian & CI/CD",
        ]:
            self.cell(0, 7, line, align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(14)
        self.set_font("Ciperna", "", 9)
        self.cell(0, 7, "Versi 1.1 · November 2026", align="C", new_x="LMARGIN", new_y="NEXT")


pdf = PDF(orientation="P", unit="mm", format="A4")
pdf.add_font("Ciperna", "", FONT)
pdf.add_font("CipernaB", "", FONT_BOLD)
pdf.set_auto_page_break(auto=True, margin=16)
pdf.set_margins(16, 16, 16)
pdf.cover()

# ===================== BAGIAN I: PRD/SRS =====================
pdf.add_page()
pdf.h1("BAGIAN I — PRD / SRS (IEEE 830 / ISO 29148)")
pdf.h2("1.1 Latar Belakang Masalah")
pdf.para("Pengelolaan fasilitas umum di Desa Ciperna masih menghadapi kendala: laporan warga disampaikan secara lisan atau informal, tidak memiliki jejak status yang transparan, serta sulitnya verifikasi dan penugasan petugas lapangan. Di sisi lain, informasi profil desa, layanan, dan pengumuman belum terdigitalisasi dengan baik. Kurangnya pemanfaatan teknologi menyebabkan lambatnya respons pemerintah desa terhadap kerusakan fasilitas dan rendahnya kepercayaan warga terhadap tindak lanjut laporan.")
pdf.para("Untuk menjawab permasalahan tersebut, dibangun sebuah aplikasi web terintegrasi yang memungkinkan warga melaporkan kerusakan fasilitas (dengan foto dan lokasi), memantau status laporan secara real-time, serta berkonsultasi dengan asisten AI. Aplikasi juga melengkapi petugas dan admin dengan alur kerja penugasan, verifikasi bukti, notifikasi WhatsApp, dan analisis AI untuk klasifikasi serta deteksi duplikat laporan.")

pdf.h2("1.2 Tujuan & Ruang Lingkup")
pdf.bullet("Tujuan: menyediakan sistem pelaporan fasilitas umum berbasis web yang transparan, akuntabel, dan responsif dengan dukungan AI.")
pdf.bullet("Ruang lingkup pengguna: Warga/Masyarakat (CITIZEN), Petugas/Perangkat Desa (OFFICER), dan Admin Desa (ADMIN).")
pdf.bullet("Ruang lingkup fungsional: autentikasi & OTP WhatsApp, pelaporan & analisis AI, penanganan laporan, portal desa, administrasi & konfigurasi.")
pdf.bullet("Ruang lingkup AI: chatbot RAG, analisis laporan (teks+gambar), deteksi duplikat, kebijakan model gratis terverifikasi.")
pdf.bullet("Di luar ruang lingkup: pembayaran online, integrasi sistem keuangan desa, dan aplikasi mobile native.")

pdf.h2("1.3 Kebutuhan Fungsional (User Stories & Acceptance Criteria)")
pdf.table(
    ["ID", "User Story", "Acceptance Criteria"],
    [
        ["F-01", "Sebagai Warga, saya dapat mendaftar dengan OTP WhatsApp agar akun saya terverifikasi.", "Sistem mengirim 6 digit OTP via Fonnte; akun dibuat hanya setelah OTP valid; OTP kedaluwarsa 5 menit."],
        ["F-02", "Sebagai Warga, saya dapat membuat laporan dengan judul, deskripsi, kategori, lokasi, dan foto.", "Form valid; foto JPG/PNG/WebP maks 10 MB; clientKey mencegah kirim ganda; status awal SUBMITTED."],
        ["F-03", "Sebagai Warga, saya dapat memantau riwayat & status laporan.", "Timeline 6 tahap ditampilkan; notifikasi in-app & WhatsApp dikirim pada perubahan status."],
        ["F-04", "Sebagai Sistem, saya menganalisis laporan dengan AI otomatis.", "Kategori, severity, confidence, ringkasan, dan rekomendasi tersimpan di ReportAnalysis; AIResultCard tampil di detail."],
        ["F-05", "Sebagai Sistem, saya mendeteksi laporan duplikat.", "Similarity teks (Jaccard) + lokasi (haversine) + penilaian AI; band hasil transparan untuk Admin."],
        ["F-06", "Sebagai Admin, saya memverifikasi laporan dan menetapkan petugas.", "Hanya laporan VERIFIED & bukan duplikat yang dapat ditugaskan; satu penugasan aktif per laporan."],
        ["F-07", "Sebagai Petugas, saya mengerjakan tugas dan mengunggah bukti.", "Status ASSIGNED→IN_PROGRESS; unggah foto bukti → REVIEW; notifikasi WA ke Admin."],
        ["F-08", "Sebagai Admin, saya menyetujui atau meminta perbaikan hasil kerja.", "APPROVE→COMPLETED + audit log + WA selesai ke warga; REJECT→IN_PROGRESS + WA revisi."],
        ["F-09", "Sebagai pengguna, saya dapat berkonsultasi dengan Asisten AI.", "Jawaban berbasis knowledge base terverifikasi & data aktual; fallback transparan; meta provider/model ditampilkan."],
        ["F-10", "Sebagai Admin, saya mengelola profil/layanan/pengumuman desa & broadcast WhatsApp.", "Data resmi wajib verifikasi & sumber; pengumuman terjadwal; batas 15 pengiriman WA per pengumuman."],
        ["F-11", "Sebagai Admin, saya mengonfigurasi AI provider & model gratis.", "Hanya VERIFIED_FREE yang dapat dipilih; uji koneksi; API key terenkripsi AES-256-GCM."],
        ["F-12", "Sebagai Admin, saya melihat audit log & log WhatsApp.", "Aksi administratif tercatat; log WhatsApp menampilkan nomor samaran (toMasked)."],
    ],
    [14, 78, 86], 8.3,
)

pdf.h2("1.4 Kebutuhan Non-Fungsional")
pdf.table(
    ["Kategori", "Ketentuan"],
    [
        ["Keamanan", "Password bcrypt; OTP/token HMAC-SHA256; API key & token Fonnte AES-256-GCM; RBAC; JWT HttpOnly; rate limiting login & test koneksi."],
        ["Kinerja", "Halaman dashboard memuat < 2 detik; respons AI 20–45 detik dengan timeout & fallback."],
        ["Keandalan", "Fail-closed pada model AI; rantai fallback minimal 1 utama + 3 cadangan VERIFIED_FREE; jawaban gagal jujur, bukan palsu."],
        ["Usabilitas", "Antarmuka konsisten (design token), emoji icon, tata letak responsif, bahasa Indonesia."],
        ["Kompatibilitas", "Browser modern; resolusi minimal 720p untuk video presentasi."],
        ["Pemeliharaan", "Clean code & SOLID: pemisahan model (Prisma), service (src/lib), adapter (aiProviders), route (app/api)."],
        ["Auditabilitas", "AdminAuditLog untuk aksi admin; payload respons AI mencatat provider/model aktual & alasan fallback."],
    ],
    [34, 144], 9,
)

pdf.h2("1.5 Spesifikasi Fitur AI Utama")
pdf.bullet("Asisten AI percakapan (RAG): mengambil AiKnowledgeEntry terverifikasi + konteks laporan pengguna, memanggil model utama, fallback ke model cadangan VERIFIED_FREE, mencatat meta (usedProvider, usedModel, fallbackReason, isFallback).")
pdf.bullet("Analisis laporan: kombinasi teks deskripsi + foto (vision) menghasilkan kategori, damageType, severity, confidence, summary, recommendation.")
pdf.bullet("Deteksi duplikat: Jaccard similarity pada teks + haversine pada koordinat + judge AI; band 'Kemungkinan duplikat' / 'Perlu pemeriksaan admin'.")
pdf.bullet("Kebijakan model gratis: status VERIFIED_FREE/ACCOUNT_DEPENDENT/UNVERIFIED/PAID; verifikasi manual dengan allowlist domain resmi; bukti gratis mengalahkan prioritas provider.")
pdf.bullet("Normalisasi respons: mendukung content string, array of parts, choices[0].text, output_text; respons kosong/format tak dikenal = gagal, bukan sukses palsu.")

# ===================== BAGIAN II: SDD =====================
pdf.add_page()
pdf.h1("BAGIAN II — SDD (Software Design Document)")
pdf.h2("2.1 Arsitektur Sistem")
pdf.para("Sistem menggunakan arsitektur berlapis pada Next.js 14 App Router: (1) lapisan presentasi berupa halaman React & komponen UI; (2) lapisan route handler (src/app/api) sebagai API REST yang menerapkan otorisasi berbasis peran; (3) lapisan service (src/lib) yang memuat logika bisnis (aiChat, aiProviders, aiProviderConfig, aiModelPolicy, whatsapp, reportAnalysis, duplicates, dll.); (4) lapisan data berupa Prisma ORM atas SQLite. Integrasi eksternal dilakukan melalui adapter AI (OpenRouter/Gemini/Groq) dan gateway WhatsApp Fonnte.")
pdf.bullet("Prinsip SOLID: tanggung jawab terpisah antara model data, service, adapter provider, dan handler HTTP; dependency inversion pada pemilihan provider AI.")
pdf.bullet("Keamanan lintas lapisan: dekripsi hanya di service, ciphertext tidak pernah dikirim ke browser, sanitasi log (redaction) sebelum pencatatan.")

pdf.h2("2.2 Pemodelan UML (4 Diagram Utama)")
pdf.table(
    ["Diagram", "File", "Penjelasan Singkat"],
    [
        ["Use Case", "use-case-v1.1.png", "5 paket (Autentikasi, Layanan & Pelaporan, Penanganan Laporan, Administrasi, Dukungan AI) + 6 aktor termasuk Fonnte & AI Provider."],
        ["Activity", "activity-v1.1.png", "5 panel: Warga, Petugas, Admin, AI (analisis/duplikat/chat), dan Verifikasi OTP WhatsApp."],
        ["Class", "class-diagram-v1.1.png", "22 class/model dengan atribut, metode, kardinalitas 1:N, serta service layer."],
        ["Sequence", "sequence-diagram-v1.1.png", "4 alur pesan: Registrasi+OTP, Buat Laporan+AI, Penugasan→Verifikasi Admin, Chat AI+RAG+Fallback."],
    ],
    [26, 44, 108], 8.8,
)
pdf.para("File SVG sumber dan generator tanpa dependensi tersedia di folder docs/diagrams/. Seluruh diagram telah diselaraskan dengan implementasi kode aktual (v1.1).", 9.5)

pdf.h2("2.3 ERD (Entity Relationship Diagram)")
pdf.para("ERD (erd-v1.1.png) memuat 22 entitas dari prisma/schema.prisma. Relasi utama: User 1:N Report; Report 1:N Assignment/ReportEvidence/ReportStatusHistory/ReportAnalysis; VillageAnnouncement 1:N AnnouncementDelivery & Notification; VillageRw 1:N VillageRt; AiProvider 1:N AiModelPolicy. Kunci unik diterapkan pada email User, slug pengumuman, dedupeKey log WA, clientKey per user, dan pasangan (provider, modelId) pada kebijakan model.")
pdf.para("Integritas & keamanan data: tidak ada penghapusan permanen untuk wilayah/pengumuman (soft delete via isActive/archivedAt/deletedAt); kata sandi, OTP, token, dan API key tidak pernah disimpan plaintext; nomor WhatsApp pada log hanya berupa samaran.", 9.5)

pdf.h2("2.4 Prototipe UI/UX")
pdf.para("Prototipe disiapkan dalam bentuk 10 mockup PNG pada folder docs/figma/ (Landing, Auth, Dashboard Warga, Buat Laporan, Detail+AI, Petugas, Admin Dashboard, AI Config, Chatbot, Portal Publik). Daftar frame, design token (primary #0F766E), dan alur prototipe Figma dijelaskan pada docs/figma/DAFTAR-FRAME-FIGMA.md. Mockup mengikuti warna, badge, kartu glass, dan komponen aktual aplikasi.")

pdf.h2("2.5 Rancangan Basis Data (Ringkasan Model)")
pdf.table(
    ["Model", "Peran"],
    [
        ["User, Report, ReportAnalysis, ReportEvidence, ReportStatusHistory", "Inti pelaporan & riwayat analisis/status."],
        ["Assignment, Notification, AdminAuditLog", "Penugasan, notifikasi in-app, jejak audit admin."],
        ["VillageProfile, VillageOfficial, VillageService, VillageAnnouncement, AnnouncementDelivery", "Portal desa & broadcast pengumuman."],
        ["VillageRw, VillageRt", "Master data wilayah (RW/RT)."],
        ["RegistrationOtp, AccountToken", "Registrasi OTP & token aktivasi/reset sekali pakai."],
        ["AiProvider, AiModelPolicy, AiKnowledgeEntry", "Konfigurasi AI, kebijakan model gratis, knowledge base RAG."],
        ["FonnteConfig, NotificationRecipient, WhatsAppLog", "Gateway WA (pengirim), penerima notifikasi, log idempoten."],
    ],
    [78, 100], 8.8,
)

# ===================== BAGIAN III: PENGUJIAN =====================
pdf.add_page()
pdf.h1("BAGIAN III — LAPORAN PENGUJIAN & CI/CD")
pdf.h2("3.1 Strategi Pengujian")
pdf.para("Pengujian dilakukan otomatis menggunakan Node test runner melalui tsx dengan menjalankan satu file per proses (--test-concurrency=1). Pengujian bersifat offline: database menggunakan salinan prisma/dev.db di direktori sementara, panggilan jaringan ke provider disubstitusi (stub) sehingga tidak ada request API nyata, tidak ada biaya token, dan tidak ada pengiriman WhatsApp sungguhan.")

pdf.h2("3.2 Lingkup & Hasil Pengujian")
pdf.table(
    ["Area Pengujian", "File Tes (contoh)", "Fokus"],
    [
        ["Kebijakan model", "ai.policy.test.ts", "Status gratis, allowed status (hanya VERIFIED_FREE), presedensi PAID & manual."],
        ["Katalog & normalisasi", "ai.catalog.test.ts", "Fetch katalog resmi, verifikasi manual, extractTextContent (string/array/reasoning/empty/unknown)."],
        ["Konfigurasi provider", "ai.config.test.ts, ai.config.security.test.ts", "Satu provider aktif, API key terenkripsi, RBAC (401 tanpa sesi), tidak ada kebocoran secret."],
        ["Rantai fallback", "ai.config.test.ts", "Fallback hanya model terverifikasi, meta provider/model, pesan gagal jujur."],
        ["Antarmuka", "ui.markup.test.ts", "Keberadaan elemen kunci UI (M-01..M-14), badge status, modal verifikasi, alasan gagal."],
        ["Alur aplikasi", "45 file *.test.ts", "Autentikasi, penugasan, laporan, notifikasi, knowledge base, kebijakan AI."],
    ],
    [34, 60, 84], 8.5,
)
pdf.para("Hasil eksekusi terakhir: 763 tes lulus, 2 tes gagal (pre-existing, tidak terkait perubahan AI): (1) announcements.broadcast mengharapkan konfigurasi WhatsApp belum diatur, dan (2) reports.analysis.duplicates menemukan 48 baris Report lama. Kedua kondisi merupakan data bawaan lingkungan pengujian, bukan regresi.", 9.5)

pdf.h2("3.3 Validasi Kualitas Kode")
pdf.table(
    ["Pemeriksaan", "Perintah", "Hasil"],
    [
        ["TypeScript", "npx tsc --noEmit -p tsconfig.json", "0 error pada src/ (baseline error hanya di tests/)."],
        ["ESLint", "npx next lint --max-warnings=999", "0 error, 20 warning (pre-existing)."],
        ["Build", "npx next build", "Exit code 0."],
        ["Unit test", "npm test", "763 lulus / 2 gagal pre-existing."],
    ],
    [28, 82, 68], 8.8,
)

pdf.h2("3.4 CI/CD Pipeline (GitHub Actions)")
pdf.para("File .github/workflows/ci.yml menjalankan pipeline pada push/pull request ke branch main/master: checkout → setup Node 20 → npm ci → membuat environment CI (APP_ENCRYPTION_KEY placeholder) → prisma generate & migrate deploy → TypeScript check → ESLint → npm test → next build. Status hijau pipeline diverifikasi pada halaman Actions repository GitHub.")
pdf.para("Catatan: nilai rahasia (API key, token Fonnte, APP_ENCRYPTION_KEY produksi) tidak pernah disimpan di repository atau workflow; gunakan GitHub Secrets bila diperlukan untuk pengujian integrasi.", 9.5)

pdf.h2("3.5 Refleksi Pembelajaran Mandiri")
pdf.bullet("Memahami penerapan penuh SDLC: dari PRD, pemodelan UML, implementasi, pengujian otomatis, hingga CI/CD.")
pdf.bullet("Menguasai integrasi AI yang bertanggung jawab: kebijakan model gratis berbasis bukti, fallback transparan, dan penolakan jawaban palsu.")
pdf.bullet("Menerapkan keamanan aplikasi: enkripsi kredensial, RBAC, hash OTP/token, audit log, dan sanitasi data sensitif.")
pdf.bullet("Meningkatkan kemampuan debugging melalui diagnostik error yang aman (kategori, HTTP status, model, provider) tanpa membocorkan rahasia.")

pdf.ln(4)
pdf.set_font("Ciperna", "", 8.5)
pdf.set_text_color(*GRAY)
pdf.multi_cell(0, 5, "Catatan pengumpulan: gabungkan berkas PDF ini dengan README.md (berisi identitas, tautan 3 video, link Figma, dan petunjuk instalasi) serta repository GitHub sesuai BAB V panduan.")

pdf.output(str(OUT))
print("OK:", OUT, OUT.stat().st_size, "bytes")

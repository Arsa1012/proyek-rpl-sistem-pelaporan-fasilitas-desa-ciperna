/**
 * Generator diagram UML Desa Ciperna v1.1 — diselaraskan dengan implementasi.
 * Menulis dua file SVG (use-case & activity). Jalankan: node docs/diagrams/generate.mjs
 * Tidak memakai dependensi eksternal; murni SVG.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('docs/diagrams');
mkdirSync(OUT, { recursive: true });

const C = {
  ink: '#0f172a', muted: '#475569', line: '#334155',
  blue: '#dbeafe', blueB: '#3b82f6',
  green: '#dcfce7', greenB: '#22c55e',
  red: '#fee2e2', redB: '#ef4444',
  yellow: '#fef9c3', yellowB: '#eab308',
  gray: '#e2e8f0', grayB: '#64748b',
  white: '#ffffff',
};
const F = "Inter, 'Segoe UI', Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function wrap(text, max = 22, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [''];
  for (const w of words) {
    const i = lines.length - 1;
    if ((lines[i] + ' ' + w).trim().length <= max) lines[i] = (lines[i] + ' ' + w).trim();
    else if (lines.length < maxLines) lines.push(w);
    else lines[i] = lines[i].slice(0, max - 1) + '…';
  }
  return lines;
}
function text(x, y, s, opt = {}) {
  const { size = 13, weight = 400, anchor = 'middle', fill = C.ink, max = 22, lines = 3 } = opt;
  const ls = wrap(s, max, lines);
  const start = y - ((ls.length - 1) * size * 1.25) / 2 + size * 0.35;
  return `<text x="${x}" y="${start}" font-family="${F}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">` +
    ls.map((l, i) => `<tspan x="${x}" dy="${i ? size * 1.25 : 0}">${esc(l)}</tspan>`).join('') + `</text>`;
}
function arrow(x1, y1, x2, y2, opt = {}) {
  const { dashed = false, label = '', color = C.line, lw = 1.6 } = opt;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = 9;
  const p1 = `${x2 - len * Math.cos(a - 0.45)},${y2 - len * Math.sin(a - 0.45)}`;
  const p2 = `${x2 - len * Math.cos(a + 0.45)},${y2 - len * Math.sin(a + 0.45)}`;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${lw}" ${dashed ? 'stroke-dasharray="6 5"' : ''}/>` +
    `<polygon points="${x2},${y2} ${p1} ${p2}" fill="${color}"/>` +
    (label ? `<text x="${mx}" y="${my - 6}" font-family="${F}" font-size="10.5" fill="${C.muted}" text-anchor="middle">${esc(label)}</text>` : '');
}
function actor(x, y, label, color) {
  const h = 46;
  return `<g stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round">
    <circle cx="${x}" cy="${y - h / 2 + 2}" r="8" fill="${color}" stroke="none"/>
    <line x1="${x}" y1="${y - h / 2 + 11}" x2="${x}" y2="${y + h / 2 - 12}"/>
    <line x1="${x - 13}" y1="${y - h / 2 + 24}" x2="${x + 13}" y2="${y - h / 2 + 24}"/>
    <line x1="${x}" y1="${y + h / 2 - 12}" x2="${x - 11}" y2="${y + h / 2 + 2}"/>
    <line x1="${x}" y1="${y + h / 2 - 12}" x2="${x + 11}" y2="${y + h / 2 + 2}"/>
  </g>` + text(x, y + h / 2 + 18, label, { size: 12, weight: 700, fill: color, max: 20, lines: 3 });
}
function panel(x, y, w, h, title, fill, border) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="${border}" stroke-width="2"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="34" rx="14" fill="${border}"/>` +
    `<rect x="${x}" y="${y + 20}" width="${w}" height="14" fill="${border}"/>` +
    `<text x="${x + w / 2}" y="${y + 23}" font-family="${F}" font-size="14" font-weight="700" fill="${C.white}" text-anchor="middle">${esc(title)}</text>`;
}
function uc(x, y, w, h, label, fill, border, id) {
  return `<ellipse id="${id || ''}" cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" stroke="${border}" stroke-width="1.6"/>` +
    text(x, y, label, { size: 11.5, max: Math.max(12, Math.floor(w / 7.2)), lines: 3 });
}
function box(x, y, w, h, label, fill, border, opt = {}) {
  const { size = 12, dash = false, id = '' } = opt;
  return `<rect id="${id}" x="${x}" y="${y}" width="${w}" height="${h}" rx="11" fill="${fill}" stroke="${border}" stroke-width="1.7" ${dash ? 'stroke-dasharray="6 4"' : ''}/>` +
    text(x + w / 2, y + h / 2, label, { size, max: Math.max(12, Math.floor(w / 7.4)), lines: 3 });
}
function diamond(x, y, w, h, label, fill, border) {
  const p = `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
  return `<polygon points="${p}" fill="${fill}" stroke="${border}" stroke-width="1.7"/>` +
    text(x, y, label, { size: 11.5, max: 12, lines: 2 });
}
function svgHead(w, h, title, sub) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#f8fafc"/>
  <text x="${w / 2}" y="42" font-family="${F}" font-size="30" font-weight="800" fill="${C.ink}" text-anchor="middle">${esc(title)}</text>
  <text x="${w / 2}" y="70" font-family="${F}" font-size="15" fill="${C.muted}" text-anchor="middle">${esc(sub)}</text>`;
}
const legend = (x, y) => `<g>
  <rect x="${x}" y="${y}" width="360" height="116" rx="12" fill="${C.white}" stroke="${C.grayB}"/>
  <text x="${x + 16}" y="${y + 24}" font-family="${F}" font-size="13" font-weight="700" fill="${C.ink}">Legenda</text>
  <circle cx="${x + 26}" cy="${y + 46}" r="7" fill="${C.ink}"/><text x="${x + 44}" y="${y + 50}" font-family="${F}" font-size="12" fill="${C.muted}">Mulai</text>
  <circle cx="${x + 26}" cy="${y + 68}" r="7" fill="${C.white}" stroke="${C.ink}" stroke-width="3"/><text x="${x + 44}" y="${y + 72}" font-family="${F}" font-size="12" fill="${C.muted}">Selesai</text>
  <rect x="${x + 17}" y="${y + 86}" width="18" height="12" rx="3" fill="${C.blue}"/><text x="${x + 44}" y="${y + 96}" font-family="${F}" font-size="12" fill="${C.muted}">Aktivitas</text>
  <polygon points="${x + 200},${y + 44} ${x + 218},${y + 56} ${x + 200},${y + 68} ${x + 182},${y + 56}" fill="${C.yellow}"/><text x="${x + 228}" y="${y + 60}" font-family="${F}" font-size="12" fill="${C.muted}">Keputusan</text>
  <line x1="${x + 184}" y1="${y + 92}" x2="${x + 216}" y2="${y + 92}" stroke="${C.line}" stroke-width="2"/><text x="${x + 228}" y="${y + 96}" font-family="${F}" font-size="12" fill="${C.muted}">Alur proses</text>
  <line x1="${x + 184}" y1="${y + 108}" x2="${x + 216}" y2="${y + 108}" stroke="${C.line}" stroke-width="2" stroke-dasharray="5 4"/><text x="${x + 228}" y="${y + 112}" font-family="${F}" font-size="12" fill="${C.muted}">&lt;&lt;include&gt;&gt;</text>
</g>`;

/* ============================ USE CASE v1.1 ============================ */
function useCase() {
  const W = 1860, H = 1760;
  let s = svgHead(W, H, 'Use Case Diagram — Desa Ciperna',
    'Sistem Informasi Pelayanan & Pelaporan Warga Berbasis Web dengan Dukungan AI · v1.1 (diselaraskan dengan implementasi)');
  // system boundary
  s += `<rect x="250" y="100" width="1360" height="1480" rx="22" fill="#ffffff" stroke="${C.blueB}" stroke-width="2.5"/>`;
  s += `<text x="930" y="130" font-family="${F}" font-size="17" font-weight="800" fill="${C.blueB}" text-anchor="middle">Aplikasi Desa Ciperna (Batas Sistem)</text>`;

  const panels = [
    { id: 'p1', x: 275, y: 150, w: 590, h: 420, title: '1. Autentikasi & Akun', fill: C.blue, border: C.blueB,
      items: [
        ['Registrasi Akun'], ['Kirim & Verifikasi OTP WhatsApp'], ['Login (Email/No. WA)'],
        ['Lupa & Reset Password'], ['Ubah Password (Paksa)'], ['Kelola Profil'],
        ['Aktivasi Akun Petugas'], ['Nonaktifkan/Aktifkan Akun'],
      ]},
    { id: 'p2', x: 885, y: 150, w: 700, h: 420, title: '2. Layanan & Pelaporan Warga', fill: C.green, border: C.greenB,
      items: [
        ['Lihat Profil & Layanan Desa'], ['Lihat Pengumuman'], ['Buat Laporan Aduan'],
        ['Upload Bukti Laporan'], ['Pantau Riwayat & Status Laporan'],
      ]},
    { id: 'p3', x: 275, y: 595, w: 700, h: 480, title: '3. Penanganan Laporan', fill: C.yellow, border: C.yellowB,
      items: [
        ['Lihat Daftar Tugas Laporan'], ['Tinjau Lokasi & Detail'], ['Mulai & Update Progres'],
        ['Unggah Bukti Penyelesaian'], ['Kirim Notifikasi WhatsApp'],
        ['Tetapkan Petugas (Assign)'], ['Setujui / Tolak Hasil Kerja'], ['Batalkan Penugasan'],
      ]},
    { id: 'p4', x: 995, y: 595, w: 590, h: 480, title: '4. Administrasi & Konfigurasi', fill: C.red, border: C.redB,
      items: [
        ['Kelola Data Warga & Wilayah (RW/RT)'], ['Kelola Petugas'], ['Kelola Profil & Layanan Desa'],
        ['Kelola & Broadcast Pengumuman'], ['Kelola Knowledge Base AI'],
        ['Pengaturan AI Provider & Model Gratis'], ['Pengaturan Fonnte & Penerima WA'],
        ['Kelola Duplikat Laporan'], ['Statistik & Peta Laporan'], ['Audit Log & Log WhatsApp'],
      ]},
    { id: 'p5', x: 275, y: 1100, w: 1310, h: 455, title: '5. Dukungan AI & Notifikasi (Lintas Peran)', fill: C.gray, border: C.grayB,
      items: [
        ['Berbicara dengan Asisten AI'], ['Analisis Laporan & Deteksi Duplikat AI'],
        ['Terima Notifikasi In-App'], ['Kebijakan Model Gratis (VERIFIED_FREE)'],
      ]},
  ];
  const centers = {};
  for (const p of panels) {
    s += panel(p.x, p.y, p.w, p.h, p.title, p.fill, p.border);
    const cols = p.items.length > 6 ? 2 : 1;
    const rows = Math.ceil(p.items.length / cols);
    const areaTop = p.y + 50, areaH = p.h - 66;
    p.items.forEach((it, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const cw = p.w / cols - 24;
      const cx = p.x + 12 + col * (p.w / cols) + cw / 2;
      const cy = areaTop + areaH * ((row + 0.5) / rows);
      const w = Math.min(cw - 8, 230), h = 44;
      const id = `${p.id}-${i}`;
      centers[id] = [cx, cy, w, h];
      s += uc(cx, cy, w, h, it[0], C.white, p.border, id);
    });
  }

  // actors
  s += actor(105, 300, 'Warga / Masyarakat\n(CITIZEN)', C.blueB);
  s += actor(105, 820, 'Petugas / Perangkat Desa\n(OFFICER)', C.greenB);
  s += actor(105, 1330, 'Admin Desa\n(ADMIN)', C.redB);
  s += actor(1750, 360, 'WhatsApp Gateway\n(Fonnte API)', C.yellowB);
  s += actor(1750, 900, 'AI Provider\n(OpenRouter / Gemini / Groq)', C.grayB);
  s += actor(1750, 1340, 'Penjadwal (Cron)\nBroadcast Pengumuman', C.blueB);

  // actor associations (to representative use cases)
  const link = (a, b, label) => { const A = centers[a], B = centers[b]; if (A && B) s += arrow(A[0], A[1], B[0], B[1], { label }); };
  link('p1-0', 'p1-1', '<<include>>');
  link('p2-2', 'p2-3', '<<include>>');
  link('p2-2', 'p5-1', '<<include>>');
  link('p3-2', 'p3-4', '<<extend>>');
  // actors → panels (anchor lines)
  s += arrow(150, 300, 275, 230, { color: C.blueB });
  s += arrow(150, 820, 275, 700, { color: C.greenB });
  s += arrow(150, 1330, 275, 1250, { color: C.redB });
  s += arrow(1700, 360, 1585, 230, { color: C.yellowB });
  s += arrow(1700, 900, 1585, 1200, { color: C.grayB });
  s += arrow(1700, 1340, 1585, 820, { color: C.blueB });

  // notes
  s += `<g><rect x="275" y="1580" width="1310" height="72" rx="10" fill="${C.white}" stroke="${C.grayB}"/>
    <text x="293" y="1604" font-family="${F}" font-size="12" font-weight="700" fill="${C.ink}">Catatan implementasi:</text>
    <text x="293" y="1624" font-family="${F}" font-size="11.5" fill="${C.muted}">Peran di kode: CITIZEN/OFFICER/ADMIN (label UI: Warga/Petugas/Admin). Audit Log belum punya halaman global — tersedia tertanam (log penerima WA, riwayat per akun) &amp; Log WhatsApp di dashboard.</text>
    <text x="293" y="1642" font-family="${F}" font-size="11.5" fill="${C.muted}">Asisten AI tersedia untuk semua peran (chat mengambang + halaman /admin/asisten). Model AI hanya VERIFIED_FREE yang boleh dipakai; ACCOUNT_DEPENDENT/UNVERIFIED/PAID ditolak.</text></g>`;
  s += legend(1480, 1450);
  return s + '</svg>';
}

/* ============================ ACTIVITY v1.1 ============================ */
function activity() {
  const W = 2000, H = 2320;
  let s = svgHead(W, H, 'Activity Diagram — Desa Ciperna',
    'Sistem Informasi Pelayanan & Pelaporan Warga Berbasis Web dengan Dukungan AI · v1.1 (diselaraskan dengan implementasi)');

  // ---- Panel A: Warga ----
  const A = { x: 30, y: 100, w: 630, h: 700, fill: C.blue, border: C.blueB };
  s += panel(A.x, A.y, A.w, A.h, 'Aktivitas Warga (Masyarakat)', A.fill, A.border);
  s += text(A.x + 105, A.y + 23, 'Warga', { size: 11.5, weight: 700, fill: C.white });
  s += text(A.x + A.w - 105, A.y + 23, 'Sistem', { size: 11.5, weight: 700, fill: C.white });
  const axW = 250, axL = A.x + 30, axR = A.x + A.w - axW - 30;
  const aSteps = [
    ['L', axL, 150, 'Akses halaman registrasi'],
    ['L', axL, 220, 'Isi data registrasi'],
    ['R', axR, 290, 'Simpan data temporer & generate OTP'],
    ['L', axL, 370, 'Masukkan kode OTP'],
    ['R', axR, 450, 'Validasi OTP'],
    ['D', axL + 95, 525, 'Valid?'],
    ['L', axL, 605, 'Autentikasi & arahkan ke dashboard'],
    ['L', axL, 680, 'Buat Laporan Aduan'],
    ['L', axL, 750, 'Isi detail & upload bukti'],
    ['L', axL, 820, 'Kirim Laporan'],
    ['R', axR, 755, 'Simpan Laporan & jalankan Analisis AI'],
  ];
  for (const [t, x, y, label] of aSteps) {
    if (t === 'D') s += diamond(x, y, 120, 56, label, C.yellow, C.yellowB);
    else s += box(x, y - 24, axW, 48, label, t === 'R' ? C.blue : C.white, A.border);
  }
  s += `<circle cx="${axL + 125}" cy="112" r="8" fill="${C.ink}"/>`;
  for (const [i, j] of [[0,1],[1,2],[2,3],[3,4],[4,5],[6,7],[7,8],[8,9],[9,10]]) {
    const p = aSteps[i], q = aSteps[j];
    s += arrow(p[1] + axW / 2, p[2] + (p[0] === 'D' ? 28 : 24), q[1] + axW / 2, q[2] - (q[0] === 'D' ? 28 : 24) - (q[0] === 'R' ? 0 : 0));
  }
  s += arrow(aSteps[5][1] + 60, aSteps[5][2], aSteps[6][1] + axW / 2, aSteps[6][2] - 24, { label: 'Valid' });
  s += text(axL + 300, 525, 'Tidak → pesan error & ulang OTP', { size: 11, fill: C.redB, anchor: 'start' });
  s += `<circle cx="${axR + axW / 2}" cy="800" r="9" fill="${C.white}" stroke="${C.ink}" stroke-width="4"/>`;

  // ---- Panel B: Petugas ----
  const B = { x: 685, y: 100, w: 630, h: 700, fill: C.green, border: C.greenB };
  s += panel(B.x, B.y, B.w, B.h, 'Aktivitas Petugas / Perangkat Desa', B.fill, B.border);
  s += text(B.x + 105, B.y + 23, 'Petugas', { size: 11.5, weight: 700, fill: C.white });
  s += text(B.x + B.w - 105, B.y + 23, 'Sistem', { size: 11.5, weight: 700, fill: C.white });
  const bxL = B.x + 30, bxR = B.x + B.w - axW - 30;
  const bSteps = [
    ['L', bxL, 150, 'Login'],
    ['R', bxR, 220, 'Validasi akses & tampilkan dashboard'],
    ['L', bxL, 300, 'Lihat daftar tugas laporan'],
    ['R', bxR, 370, 'Tampilkan detail penugasan & lokasi'],
    ['L', bxL, 450, 'Pilih laporan & tinjau lokasi'],
    ['L', bxL, 525, 'Mulai kerja (ASSIGNED → IN_PROGRESS)'],
    ['L', bxL, 600, 'Input progres & update status'],
    ['L', bxL, 675, 'Unggah bukti penyelesaian'],
    ['R', bxR, 750, 'Simpan riwayat, status REVIEW & notifikasi'],
  ];
  for (const [t, x, y, label] of bSteps) s += box(x, y - 24, axW, 48, label, t === 'R' ? C.green : C.white, B.border);
  s += `<circle cx="${bxL + 125}" cy="112" r="8" fill="${C.ink}"/>`;
  for (const [i, j] of [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]]) {
    const p = bSteps[i], q = bSteps[j];
    s += arrow(p[1] + axW / 2, p[2] + 24, q[1] + axW / 2, q[2] - 24);
  }
  s += `<circle cx="${bxR + axW / 2}" cy="800" r="9" fill="${C.white}" stroke="${C.ink}" stroke-width="4"/>`;

  // ---- Panel C: Admin ----
  const CP = { x: 1340, y: 100, w: 630, h: 700, fill: C.red, border: C.redB };
  s += panel(CP.x, CP.y, CP.w, CP.h, 'Aktivitas Admin Desa', CP.fill, CP.border);
  s += text(CP.x + 105, CP.y + 23, 'Admin', { size: 11.5, weight: 700, fill: C.white });
  s += text(CP.x + CP.w - 105, CP.y + 23, 'Sistem', { size: 11.5, weight: 700, fill: C.white });
  const cxL = CP.x + 30, cxR = CP.x + CP.w - axW - 30;
  const cSteps = [
    ['L', cxL, 150, 'Login'],
    ['R', cxR, 220, 'Autentikasi & dashboard admin'],
    ['L', cxL, 300, 'Kelola data warga, wilayah & petugas'],
    ['L', cxL, 375, 'Kelola profil, layanan & pengumuman'],
    ['R', cxR, 450, 'Simpan data & broadcast WhatsApp'],
    ['L', cxL, 525, 'Konfigurasi AI & Fonnte'],
    ['R', cxR, 595, 'Verifikasi model: hanya VERIFIED_FREE; uji koneksi'],
    ['L', cxL, 670, 'Kelola knowledge base & duplikat'],
    ['L', cxL, 745, 'Tinjau bukti → Setujui/Tolak, statistik, audit & log WA'],
  ];
  for (const [t, x, y, label] of cSteps) s += box(x, y - 24, axW, 48, label, t === 'R' ? C.red : C.white, CP.border);
  s += `<circle cx="${cxL + 125}" cy="112" r="8" fill="${C.ink}"/>`;
  for (const [i, j] of [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8]]) {
    const p = cSteps[i], q = cSteps[j];
    s += arrow(p[1] + axW / 2, p[2] + 24, q[1] + axW / 2, q[2] - 24);
  }
  s += `<circle cx="${cxL + axW / 2}" cy="805" r="9" fill="${C.white}" stroke="${C.ink}" stroke-width="4"/>`;

  // ---- Panel D: AI ----
  const D = { x: 30, y: 830, w: 1290, h: 700, fill: C.gray, border: C.grayB };
  s += panel(D.x, D.y, D.w, D.h, 'Aktivitas AI (Analisis Laporan, Duplikat & Asisten Chat)', D.fill, D.border);
  s += text(D.x + 180, D.y + 23, 'Sumber', { size: 11.5, weight: 700, fill: C.white });
  s += text(D.x + D.w / 2, D.y + 23, 'AI Service', { size: 11.5, weight: 700, fill: C.white });
  s += text(D.x + D.w - 180, D.y + 23, 'Sistem & Penyimpanan', { size: 11.5, weight: 700, fill: C.white });
  const dSteps = [
    [D.x + 60, 900, 220, 'Terima teks laporan/bukti atau pertanyaan chat'],
    [D.x + 490, 985, 220, 'Pilih rantai model: utama → cadangan (hanya VERIFIED_FREE)'],
    [D.x + 490, 1070, 220, 'Kirim ke AI Provider (fallback transparan dicatat)'],
    [D.x + 490, 1155, 220, 'Analisis isi & ekstraksi kata kunci'],
    [D.x + 490, 1240, 220, 'Deteksi laporan serupa (duplikat)'],
    [D.x + 490, 1325, 220, 'Klasifikasi kategori & tingkat urgensi'],
    [D.x + 490, 1410, 220, 'Rekomendasi tindakan dari knowledge base'],
    [D.x + 960, 1240, 220, 'Simpan hasil analisis; tampilkan di dashboard/chat'],
    [D.x + 960, 1410, 220, 'Jika semua gagal: jawaban jujur + meta fallback'],
  ];
  for (const [x, y, , label] of dSteps) {
    const w = x > D.x + 800 ? 270 : 330;
    s += box(x - w / 2 + 130, y - 24, w, 48, label, C.white, D.border, { size: 11.5 });
  }
  s += `<circle cx="${D.x + 190}" cy="862" r="8" fill="${C.ink}"/>`;
  s += arrow(D.x + 190, 900, D.x + 620, 961, {});
  for (const [i, j] of [[1,2],[2,3],[3,4],[4,5],[5,6]]) {
    const p = dSteps[i], q = dSteps[j];
    s += arrow(p[0] + 130, p[1] + 24, q[0] + 130, q[1] - 24);
  }
  s += arrow(dSteps[6][0] + 130, dSteps[6][1] + 24, dSteps[7][0] + 130, dSteps[7][1] - 24);
  s += arrow(dSteps[6][0] + 130, dSteps[6][1] + 24, dSteps[8][0] + 130, dSteps[8][1] - 24, { dashed: true, label: 'gagal' });
  s += `<circle cx="${dSteps[7][0] + 130}" cy="1470" r="9" fill="${C.white}" stroke="${C.ink}" stroke-width="4"/>`;
  s += `<text x="${D.x + 40}" y="1510" font-family="${F}" font-size="11.5" fill="${C.muted}">Catatan: model ACCOUNT_DEPENDENT / UNVERIFIED / PAID tidak masuk rantai; jawaban kosong atau format tak dikenal = gagal, bukan sukses palsu.</text>`;

  // ---- Panel E: OTP ----
  const E = { x: 1340, y: 830, w: 630, h: 700, fill: C.yellow, border: C.yellowB };
  s += panel(E.x, E.y, E.w, E.h, 'Aktivitas Verifikasi OTP WhatsApp', E.fill, E.border);
  s += text(E.x + 105, E.y + 23, 'Pengguna', { size: 11.5, weight: 700, fill: C.white });
  s += text(E.x + E.w - 105, E.y + 23, 'Sistem & Fonnte', { size: 11.5, weight: 700, fill: C.white });
  const exL = E.x + 30, exR = E.x + E.w - axW - 30;
  const eSteps = [
    ['L', exL, 900, 'Minta kode OTP'],
    ['R', exR, 970, 'Generate kode OTP'],
    ['R', exR, 1040, 'Kirim OTP via WhatsApp (Fonnte API)'],
    ['L', exL, 1110, 'Input kode OTP yang diterima'],
    ['R', exR, 1180, 'Validasi kode OTP'],
    ['D', exL + 95, 1255, 'Valid?'],
    ['L', exL, 1340, 'Aktifkan akun & redirect'],
    ['R', exR, 1340, 'Tampilkan pesan error'],
  ];
  for (const [t, x, y, label] of eSteps) {
    if (t === 'D') s += diamond(x, y, 120, 56, label, C.white, C.yellowB);
    else s += box(x, y - 24, axW, 48, label, t === 'R' ? C.yellow : C.white, E.border);
  }
  s += `<circle cx="${exL + 125}" cy="862" r="8" fill="${C.ink}"/>`;
  for (const [i, j] of [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]) {
    const p = eSteps[i], q = eSteps[j];
    s += arrow(p[1] + axW / 2, p[2] + (p[0] === 'D' ? 28 : 24), q[1] + axW / 2, q[2] - (q[0] === 'D' ? 28 : 24));
  }
  s += arrow(eSteps[5][1] + 60, eSteps[5][2], eSteps[7][1] + axW / 2, eSteps[7][2] - 24, { label: 'Tidak' });
  s += `<circle cx="${exL + axW / 2}" cy="1420" r="9" fill="${C.white}" stroke="${C.ink}" stroke-width="4"/>`;

  s += legend(30, 1580);
  s += `<g><rect x="430" y="1580" width="1540" height="116" rx="12" fill="${C.white}" stroke="${C.grayB}"/>
    <text x="448" y="1604" font-family="${F}" font-size="13" font-weight="700" fill="${C.ink}">Perubahan v1.1 (sesuai implementasi):</text>
    <text x="448" y="1626" font-family="${F}" font-size="11.5" fill="${C.muted}">• Aktivasi akun petugas via tautan Admin • Lupa/reset &amp; ubah password paksa • Login via No. WhatsApp + “Ingat perangkat” • Penugasan: assign → mulai → unggah bukti → tinjau &amp; setujui/tolak → batal</text>
    <text x="448" y="1646" font-family="${F}" font-size="11.5" fill="${C.muted}">• Asisten AI lintas peran &amp; notifikasi in-app • Kebijakan model gratis VERIFIED_FREE (ACCOUNT_DEPENDENT tidak otomatis masuk fallback) • Statistik, peta, duplikat, penerima &amp; diagnostik WhatsApp • Audit Log baru tertanam (belum ada halaman global)</text>
    <text x="448" y="1666" font-family="${F}" font-size="11.5" fill="${C.muted}">• Rantai AI mencatat provider/model aktual &amp; alasan fallback; kegagalan ditampilkan jujur, bukan jawaban palsu.</text></g>`;
  s += `<text x="${W / 2}" y="${H - 12}" font-family="${F}" font-size="13" fill="${C.muted}" text-anchor="middle">"Mewujudkan Desa Ciperna yang Responsif, Transparan, dan Berkemajuan" · v1.1</text>`;
  return s + '</svg>';
}

writeFileSync(path.join(OUT, 'use-case-v1.1.svg'), useCase(), 'utf8');
writeFileSync(path.join(OUT, 'activity-v1.1.svg'), activity(), 'utf8');
console.log('OK: docs/diagrams/use-case-v1.1.svg, docs/diagrams/activity-v1.1.svg');

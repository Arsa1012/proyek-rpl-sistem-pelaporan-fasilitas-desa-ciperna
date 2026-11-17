/**
 * Generator mockup UI/UX bergaya Figma — Desa Ciperna.
 * Output: satu HTML per grup frame → dirender ke PNG via browser.
 * Desain mengikuti globals.css aktual (warna, badge, kartu glass, emoji icon).
 */
const fs = require('fs');
const path = require('path');
const OUT = path.resolve('docs/figma');
fs.mkdirSync(OUT, { recursive: true });

const P = {
  primary: '#0F766E', primaryDark: '#064E3B', green: '#10B981', mint: '#F0FDF4',
  ink: '#1f2937', sub: '#4b5563', border: '#E5E7EB', white: '#ffffff',
  sidebar: 'linear-gradient(160deg,#032e28,#064e3b 45%,#0f766e 80%,#0b5d3b)',
  ai: 'linear-gradient(135deg,#1e40af,#7c3aed)',
};
const F = "Inter, 'Segoe UI', Arial, sans-serif";

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:${F};background:#eef2f7;color:${P.ink};padding:26px}
.board{display:flex;flex-wrap:wrap;gap:26px;align-items:flex-start}
.frame{background:#fff;border:1.5px solid #cbd5e1;border-radius:14px;overflow:hidden;box-shadow:0 8px 26px rgba(15,23,42,.12);width:1180px}
.fname{background:#1e293b;color:#e2e8f0;font-size:12px;font-weight:700;padding:9px 14px;letter-spacing:.3px}
.fname b{color:#38bdf8}
.canvas{position:relative;background:${P.mint};min-height:720px}
/* public / auth */
.nav{height:56px;background:rgba(255,255,255,.92);backdrop-filter:blur(10px);display:flex;align-items:center;padding:0 26px;gap:12px;border-bottom:1px solid #d1fae5}
.logo{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#0f766e,#22c55e);display:grid;place-items:center;color:#fff;font-size:17px}
.nav .brand{font-weight:800;color:${P.primaryDark};font-size:14px;line-height:1.1}
.nav .brand small{display:block;font-weight:600;color:#64748b;font-size:10px}
.nav .sp{flex:1}
.nav a{font-size:11px;color:#475569;text-decoration:none;font-weight:600}
.btn{background:linear-gradient(135deg,#0f766e,#10b981);color:#fff;border:0;border-radius:9px;padding:9px 16px;font-weight:700;font-size:12px}
.btn.outline{background:#fff;color:${P.primary};border:1.5px solid ${P.primary}}
.btn.sm{padding:6px 11px;font-size:10.5px}
.btn.red{background:#ef4444}
.btn.violet{background:linear-gradient(135deg,#1e40af,#7c3aed)}
.badge{display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700}
.b-teal{background:#ccfbf1;color:#0f766e}.b-green{background:#dcfce7;color:#15803d}.b-amber{background:#fef3c7;color:#b45309}.b-red{background:#fee2e2;color:#b91c1c}.b-blue{background:#dbeafe;color:#1d4ed8}.b-violet{background:#ede9fe;color:#6d28d9}.b-gray{background:#e2e8f0;color:#475569}
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:20px;padding:34px 40px}
.hero h1{font-size:34px;line-height:1.18;color:#065f46;letter-spacing:-.5px}
.hero h1 em{font-style:normal;background:linear-gradient(90deg,#0f766e,#22c55e);-webkit-background-clip:text;color:transparent}
.hero p{color:${P.sub};font-size:13px;line-height:1.7;margin:14px 0}
.hero .pic{height:230px;border-radius:18px;background:linear-gradient(150deg,#a7f3d0,#34d399,#0f766e);position:relative;overflow:hidden}
.hero .pic:after{content:'🏞️';position:absolute;inset:0;display:grid;place-items:center;font-size:72px;opacity:.6}
.pill{display:inline-block;background:#d1fae5;color:#065f46;border-radius:999px;padding:5px 12px;font-size:10px;font-weight:700;margin-bottom:14px}
.section{padding:8px 40px 26px}
.section h2{font-size:19px;color:#065f46;margin-bottom:14px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.glass{background:rgba(255,255,255,.9);border:1px solid #d1fae5;border-radius:14px;padding:16px;box-shadow:0 3px 12px rgba(15,118,110,.06)}
.card{background:#fff;border:1px solid ${P.border};border-radius:12px;padding:15px}
.stat{border-left:4px solid ${P.primary}}
.stat .n{font-size:25px;font-weight:800;color:${P.primaryDark}}
.stat .l{font-size:11px;color:#64748b;margin-top:3px}
h3.t{font-size:13px;color:#065f46;margin-bottom:10px}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th{text-align:left;text-transform:uppercase;font-size:9px;color:#64748b;border-bottom:1px solid ${P.border};padding:8px 6px}
td{padding:9px 6px;border-bottom:1px solid #f1f5f9}
/* dashboard shell */
.dash{display:flex;min-height:720px}
.side{width:212px;background:${P.sidebar};color:#d1fae5;padding:16px 12px;flex-shrink:0}
.side .brand{display:flex;gap:8px;align-items:center;font-weight:800;font-size:12px;color:#fff;margin-bottom:20px}
.side .grp{font-size:9px;color:#6ee7b7;text-transform:uppercase;letter-spacing:.6px;margin:16px 8px 7px;font-weight:700}
.side .it{font-size:10.5px;padding:8px 10px;border-radius:8px;margin:2px 0;color:#d1fae5}
.side .it.on{background:linear-gradient(90deg,#10b981,#0f766e);color:#fff;font-weight:700}
.main{flex:1;min-width:0}
.top{height:52px;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid #d1fae5;display:flex;align-items:center;padding:0 20px;gap:10px}
.avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#0f766e,#22c55e);color:#fff;display:grid;place-items:center;font-weight:800;font-size:11px}
.top .nm{font-size:11px;font-weight:700}.top .rl{font-size:9px;color:#64748b}
.content{padding:22px}
.content h1{font-size:21px;color:#065f46}
.content .sub{font-size:11px;color:#64748b;margin:4px 0 16px}
.chip{background:#d1fae5;color:#065f46;border-radius:999px;padding:4px 10px;font-size:10px;font-weight:700;display:inline-block}
.form label{display:block;font-size:10.5px;font-weight:700;color:#374151;margin:11px 0 5px}
.input{border:1.5px solid #d1d5db;border-radius:9px;padding:9px 11px;font-size:11px;color:#64748b;background:#fff}
.drop{border:2px dashed #6ee7b7;border-radius:12px;padding:22px;text-align:center;color:#0f766e;font-size:11px;background:#f0fdf4}
.aihead{background:${P.ai};color:#fff;border-radius:12px 12px 0 0;padding:11px 14px;font-size:12px;font-weight:800}
.prog{height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden}.prog i{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#22c55e)}
.tl{border-left:2px dotted #a7f3d0;margin-left:8px;padding-left:16px}
.tl .s{position:relative;padding:7px 0;font-size:10.5px}
.tl .s:before{content:'';position:absolute;left:-23px;top:10px;width:12px;height:12px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 0 2px #a7f3d0}
.fab{position:absolute;right:22px;bottom:22px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#0f766e,#22c55e);color:#fff;display:grid;place-items:center;font-size:22px;box-shadow:0 6px 18px rgba(15,118,110,.4)}
.chatpanel{position:absolute;right:22px;bottom:84px;width:330px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.25);border:1px solid #d1fae5}
.chatpanel .h{background:${P.primary};color:#fff;padding:11px 13px;font-size:11.5px;font-weight:800}
.chatpanel .b{padding:12px;font-size:10.5px}
.bub{border-radius:12px;padding:8px 10px;margin:7px 0;max-width:88%;line-height:1.5}
.bub.u{background:linear-gradient(135deg,#0f766e,#10b981);color:#fff;margin-left:auto}
.bub.a{background:#f1f5f9}
.note{font-size:9px;color:#64748b;margin-top:6px}
`;

function frame(name, inner) {
  return `<div class="frame"><div class="fname">🎨 <b>${esc(name)}</b></div><div class="canvas">${inner}</div></div>`;
}
function shell(title, subtitle, role, items, active, body, chat) {
  const side = `<aside class="side"><div class="brand">🏛️ Sistem Pelaporan<br>Desa Ciperna</div>` +
    items.map(g => `<div class="grp">${g[0]}</div>` + g[1].map(i =>
      `<div class="it ${i===active?'on':''}">${i}</div>`).join('')).join('') + `</aside>`;
  const top = `<div class="top"><div class="avatar">${role[0]}</div><div><div class="nm">${role}</div><div class="rl">${role.includes('Admin')?'Admin Desa':role.includes('Petugas')?'Petugas Lapangan':'Masyarakat'}</div></div><div class="sp"></div><span>🌙</span><span>🔔</span><span class="badge b-red">Keluar</span></div>`;
  return `<div class="dash">${side}<div class="main">${top}<div class="content"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${body}</div></div></div>` +
    (chat || '');
}
const CITIZEN=[['MENU UTAMA',['🏠 Dashboard','📝 Buat Laporan','📋 Laporan Saya']],['AKUN',['👤 Profil']]];
const OFFICER=[['MENU UTAMA',['🏠 Dashboard','📋 Tugas Saya','🕐 Riwayat Tugas']],['AKUN',['👤 Profil']]];
const ADMIN=[['MENU UTAMA',['🏠 Dashboard']],['MANAJEMEN LAPORAN',['📄 Daftar Laporan','🔍 Laporan Duplikat']],['MANAJEMEN PENGGUNA',['👥 Data Warga','🗺️ Wilayah RT/RW','👮 Data Petugas']],['PORTAL DESA',['🏘️ Profil Desa','🏛️ Pemerintahan','🧰 Layanan Desa','📣 Pengumuman']],['OPERASIONAL',['📌 Penugasan Petugas','📊 Statistik & Rekap','🧠 Pusat Pengetahuan AI','📲 Pusat WhatsApp Admin','⚙️ Konfigurasi Asisten AI']],['AKUN',['👤 Profil']]];

const boards = [];

/* 01 Landing */
boards.push(['01-landing', frame('01 · Landing Page (/)', `
<div class="nav"><div class="logo">🏛️</div><div class="brand">Sistem Pelaporan<small>Desa Ciperna</small></div><div class="sp"></div>
<a>Home</a><a>Profil Desa</a><a>Pemerintahan</a><a>Layanan</a><a>Pengumuman</a><a class="btn outline sm">Masuk</a><a class="btn sm">Daftar</a></div>
<div class="hero"><div><span class="pill">📍 Pelayanan Digital Desa Ciperna · Kec. Talun, Kab. Cirebon</span>
<h1>Membangun Desa,<br><em>Melayani Masyarakat.</em></h1>
<p>Melalui layanan digital Desa Ciperna, warga dapat melaporkan fasilitas rusak, memantau status laporan, dan berkonsultasi dengan AI — transparan dan real-time.</p>
<button class="btn">📝 Buat Laporan</button> <button class="btn outline">Jelajahi Desa →</button>
<div class="grid4" style="margin-top:24px"><div class="card stat"><div class="n">1.284</div><div class="l">Total Laporan</div></div><div class="card stat"><div class="n">87</div><div class="l">Diproses</div></div><div class="card stat"><div class="n">1.152</div><div class="l">Selesai</div></div><div class="card stat"><div class="n">7</div><div class="l">Kategori</div></div></div></div>
<div class="pic"></div></div>
<div class="section"><h2>🧰 Layanan untuk Masyarakat Desa Ciperna</h2><div class="grid4">
${['📝 Laporkan Fasilitas Rusak','📋 Pantau Status Laporan','🤖 Konsultasi dengan AI','ℹ️ Informasi Fasilitas Umum'].map(x=>`<div class="glass"><b style="font-size:12px">${x}</b><p class="note">Layanan digital desa yang mudah, cepat, dan transparan.</p><span class="badge b-teal">Selengkapnya →</span></div>`).join('')}
</div></div>`)]);

/* 02 Login + Register */
boards.push(['02-auth-login-register', frame('02 · Login & Registrasi + OTP', `
<div class="nav"><div class="logo">🏛️</div><div class="brand">Sistem Pelaporan<small>Desa Ciperna</small></div><div class="sp"></div><a>Home</a><a class="btn sm">Daftar</a></div>
<div style="display:flex;gap:18px;padding:26px 36px;align-items:flex-start">
<div class="glass" style="width:360px"><div style="text-align:center;font-size:30px">🔐</div><h3 style="text-align:center;font-size:17px">Masuk</h3><p class="note" style="text-align:center;margin-bottom:12px">Masuk ke Sistem Pelaporan Fasilitas Umum Desa Ciperna</p>
<label class="form" style="font-size:10px;font-weight:700">Email / No. HP</label><div class="input">nama@email.com</div>
<label style="font-size:10px;font-weight:700">Password</label><div class="input">•••••••• 👁️</div>
<button class="btn" style="width:100%;margin-top:14px">MASUK</button>
<div class="note" style="margin-top:10px;text-align:center">☑ Ingat perangkat ini (30 hari)<br>Lupa kata sandi? · Belum punya akun? Daftar</div></div>
<div class="glass" style="width:360px"><div style="text-align:center;font-size:30px">📝</div><h3 style="text-align:center;font-size:17px">Daftar</h3>
<div class="input" style="margin:10px 0;background:#fef3c7">👤 Daftar sebagai Masyarakat</div>
<label style="font-size:10px;font-weight:700">Nama Lengkap</label><div class="input">Nama Anda</div>
<label style="font-size:10px;font-weight:700">Email · Nomor WhatsApp</label><div class="input">email · 08xxxxxxxxxx</div>
<label style="font-size:10px;font-weight:700">RT / RW</label><div class="input">RW 01 · RT 02 ▾</div>
<label style="font-size:10px;font-weight:700">Password · Konfirmasi</label><div class="input">••••••••</div>
<button class="btn" style="width:100%;margin-top:12px">DAFTAR & KIRIM OTP</button></div>
<div class="glass" style="width:300px"><div style="text-align:center;font-size:30px">💬</div><h3 style="text-align:center;font-size:17px">Verifikasi WhatsApp</h3>
<p class="note" style="text-align:center">Masukkan 6 angka kode OTP yang dikirim ke WhatsApp 08••••••123</p>
<div class="input" style="text-align:center;letter-spacing:8px;font-size:18px;margin:12px 0">_ _ _ _ _ _</div>
<button class="btn" style="width:100%">VERIFIKASI</button><div class="note" style="text-align:center;margin-top:8px">KIRIM ULANG KODE (45 dtk)</div></div>
</div>`)]);

/* 03 Warga dashboard + buat laporan */
boards.push(['03-warga-dashboard-buat-laporan', frame('03 · Dashboard Warga & Buat Laporan',
  shell('Selamat Datang, Warga 👋','Ringkasan laporan dan pengumuman desa Anda.','Warga',CITIZEN,'🏠 Dashboard',`
<span class="chip">Anda login sebagai Masyarakat</span> <button class="btn sm" style="float:right">📝 Buat Laporan</button>
<div class="grid4" style="margin-top:14px">${[['Total Laporan','12'],['Laporan Baru','2'],['Sedang Diproses','3'],['Selesai','7']].map(x=>`<div class="card stat"><div class="n">${x[1]}</div><div class="l">${x[0]}</div></div>`).join('')}</div>
<div class="grid2" style="margin-top:14px"><div class="glass"><h3 class="t">📋 Laporan Terbaru</h3><table><tr><th>Tanggal</th><th>Judul</th><th>Lokasi</th><th>Status</th></tr>
<tr><td>12 Nov</td><td>Jalan berlubang</td><td>RT 02</td><td><span class="badge b-amber">Diproses</span></td></tr>
<tr><td>08 Nov</td><td>Lampu jalan mati</td><td>RT 01</td><td><span class="badge b-green">Selesai</span></td></tr></table></div>
<div class="glass"><h3 class="t">📢 Pengumuman Terbaru</h3>${['Gotong royong desa','Jadwal pelayanan','Program bantuan'].map(x=>`<div style="font-size:10.5px;padding:7px 0;border-bottom:1px solid #f1f5f9">📣 ${x}</div>`).join('')}</div></div>`) +
  shell('Buat Laporan Baru','Laporkan fasilitas umum yang rusak di sekitar Anda.','Warga',CITIZEN,'📝 Buat Laporan',`
<div class="glass" style="max-width:640px"><label>Judul Laporan</label><div class="input">Jalan berlubang di depan sekolah</div>
<label>Deskripsi Kerusakan</label><div class="input" style="height:64px">Jalan rusak parah, berbahaya bagi pejalan kaki…</div>
<label>Kategori Fasilitas</label><div class="input">Jalan ▾</div>
<label>Lokasi</label><div class="input">RT 02 / RW 01, Desa Ciperna</div>
<label>Foto Kerusakan</label><div class="drop">📷 Klik untuk upload atau seret foto ke sini<br><span class="note">JPG, PNG, WebP · Maksimal 10MB</span></div>
<button class="btn" style="margin-top:14px;width:100%">Kirim Laporan</button></div>`)
)]);
/* 04 Laporan + detail + timeline AI */
boards.push(['04-warga-laporan-detail-ai', frame('04 · Daftar Laporan, Detail & Analisis AI',
  shell('Laporan Saya','Semua laporan yang pernah Anda kirimkan.','Warga',CITIZEN,'📋 Laporan Saya',`
<button class="btn sm" style="float:right">＋ Buat Laporan Baru</button>
<div class="glass" style="margin-top:10px"><table><tr><th>Tanggal</th><th>Judul</th><th>Kategori</th><th>Lokasi</th><th>Status</th><th>Aksi</th></tr>
<tr><td>12 Nov</td><td>Jalan berlubang</td><td>Jalan</td><td>RT 02</td><td><span class="badge b-amber">Diproses</span></td><td><span class="badge b-teal">Detail</span></td></tr>
<tr><td>08 Nov</td><td>Lampu jalan mati</td><td>Lampu Jalan</td><td>RT 01</td><td><span class="badge b-green">Selesai</span></td><td><span class="badge b-teal">Detail</span></td></tr></table></div>`) +
  shell('Jalan berlubang di depan sekolah','ID: A1B2C3D4 · Dibuat 12 Nov 2026 · <span class="badge b-amber">Diproses</span>','Warga',CITIZEN,'📋 Laporan Saya',`
<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:14px">
<div><div class="glass"><h3 class="t">ℹ️ Informasi Laporan</h3><div class="note">👤 Pelapor: warga@desa.id · 📅 12 Nov · 📍 RT 02/RW 01</div><p class="note" style="margin-top:8px">Jalan rusak parah di depan sekolah dasar…</p></div>
<div class="glass" style="margin-top:12px"><div class="aihead">🤖 Hasil Analisis AI · Model: OpenRouter free</div><div style="padding:12px">
<span class="badge b-red">🚨 Tinggi</span> <span class="badge b-blue">Kategori: Jalan</span>
<div style="display:flex;gap:10px;margin-top:10px;font-size:10px"><div>Keparahan: <b>Tinggi</b></div><div>Keyakinan: <b>92%</b></div></div>
<div class="prog" style="margin-top:6px"><i style="width:92%"></i></div>
<p class="note" style="margin-top:10px"><b>Ringkasan:</b> Kerusakan jalan berpotensi membahayakan warga.</p>
<p class="note"><b>Rekomendasi:</b> Perbaikan segera oleh petugas lapangan.</p></div></div></div>
<div class="glass"><h3 class="t">🗓️ Timeline Status Laporan</h3><div class="tl">
<div class="s">📋 Diajukan · 12 Nov 08:12</div><div class="s">✅ Diverifikasi · 12 Nov 09:30</div><div class="s">👷 Ditugaskan · 12 Nov 10:05</div>
<div class="s" style="opacity:.45">🔧 Penanganan</div><div class="s" style="opacity:.45">🔍 Verifikasi Bukti</div><div class="s" style="opacity:.45">🎉 Selesai</div></div></div></div>`)
)]);
/* 05 Petugas */
boards.push(['05-petugas-tugas-detail', frame('05 · Dashboard Petugas, Tugas & Workflow',
  shell('Selamat Datang, Petugas 👋','Dashboard Petugas Lapangan Desa Ciperna.','Petugas',OFFICER,'🏠 Dashboard',`
<span class="chip">Petugas</span><div class="grid4" style="margin-top:14px">${[['Total Tugas','8',P.primary],['Tugas Baru','2','#f59e0b'],['Sedang Dikerjakan','3','#06b6d4'],['Selesai','3','#15803d']].map(x=>`<div class="card stat" style="border-left-color:${x[2]}"><div class="n">${x[1]}</div><div class="l">${x[0]}</div></div>`).join('')}</div>
<div class="glass" style="margin-top:14px"><h3 class="t">📋 Daftar Tugas</h3><table><tr><th>Tanggal</th><th>Laporan</th><th>Lokasi</th><th>Severity</th><th>Status</th></tr>
<tr><td>12 Nov</td><td>Jalan berlubang</td><td>RT 02</td><td><span class="badge b-red">Tinggi</span></td><td>🔧 Diproses</td></tr></table></div>`) +
  shell('Detail Tugas Lapangan','Laporan: Jalan berlubang · 📍 RT 02','Petugas',OFFICER,'📋 Tugas Saya',`
<div style="display:grid;grid-template-columns:1.5fr 1fr;gap:14px"><div>
<div class="glass"><h3 class="t">📄 Detail Laporan</h3><div class="note">👤 Pelapor: warga***@desa.id · 📅 12 Nov · 📍 <b>RT 02/RW 01</b> · 🔗 Google Maps</div></div>
<div class="glass" style="margin-top:12px"><h3 class="t">🏷️ Klasifikasi & Analisis AI</h3><div class="grid2">
<div class="card"><span class="note">Kategori</span><br><b>Jalan</b></div><div class="card"><span class="note">Jenis Kerusakan</span><br><b>Lubang</b></div>
<div class="card"><span class="note">Keparahan</span><br><span class="badge b-red">Tinggi</span></div><div class="card"><span class="note">Deteksi AI</span><br><b>92%</b></div></div></div></div>
<div class="glass"><h3 class="t">⚙️ Aksi Petugas Lapangan</h3>
<div class="note">Status: 🔧 Pekerjaan Sedang Berlangsung</div>
<label style="font-size:10px;font-weight:700">📷 Upload Bukti Penyelesaian</label><div class="drop" style="padding:14px">Klik untuk upload foto bukti</div>
<label style="font-size:10px;font-weight:700">📝 Catatan</label><div class="input" style="height:50px">Catatan pekerjaan…</div>
<button class="btn" style="width:100%;margin-top:10px">📤 Kirim Bukti Pengerjaan</button></div></div>`)
)]);
/* 06 Admin dashboard + laporan */
boards.push(['06-admin-dashboard-laporan', frame('06 · Dashboard Admin & Verifikasi Laporan',
  shell('Selamat Datang, Admin 👋','Dashboard Administrator Desa Ciperna.','Admin',ADMIN,'🏠 Dashboard',`
<div class="glass" style="background:#ecfdf5;border-color:#a7f3d0">📲 <b>Notifikasi WhatsApp Admin: Aktif</b><div class="note">Perangkat Fonnte terhubung · Terakhir dikirim 12 Nov</div></div>
<div class="grid4" style="margin-top:12px">${[['Total Laporan','1.284'],['Laporan Baru','24'],['Terverifikasi','180'],['Ditolak','12'],['Ditugaskan','87'],['Dalam Proses','44'],['Selesai','1.152'],['Tingkat Selesai','89%']].map(x=>`<div class="card stat"><div class="n">${x[1]}</div><div class="l">${x[0]}</div></div>`).join('')}</div>
<div class="grid2" style="margin-top:12px"><div class="glass"><h3 class="t">📊 Distribusi Status</h3><div style="display:flex;gap:10px;align-items:center"><div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(#0f766e 0 55%,#10b981 55% 78%,#f59e0b 78% 90%,#ef4444 90% 100%)"></div><div class="note">🟢 Selesai 55%<br>🟢 Terverifikasi 23%<br>🟡 Proses 12%<br>🔴 Baru 10%</div></div></div>
<div class="glass"><h3 class="t">📈 Tren Laporan 6 Bulan</h3><div style="height:110px;display:flex;align-items:flex-end;gap:12px">${[45,60,38,75,52,88].map(h=>`<div style="flex:1;background:linear-gradient(#22c55e,#0f766e);height:${h}%;border-radius:5px 5px 0 0"></div>`).join('')}</div></div></div>
<div class="glass" style="margin-top:12px"><h3 class="t">⚡ Tindakan Cepat</h3>${['📋 Verifikasi Laporan (24)','📌 Assign Petugas (18)','🔍 Tinjau Duplikat (5)','📣 Buat Pengumuman','📊 Lihat Statistik'].map(x=>`<span class="badge b-teal" style="margin:3px">${x}</span>`).join('')}</div>`) +
  shell('Daftar Laporan','Kelola dan verifikasi seluruh laporan warga.','Admin',ADMIN,'📄 Daftar Laporan',`
<div class="glass"><div style="display:flex;gap:8px;margin-bottom:10px"><span class="badge b-teal">Semua Laporan</span><span class="badge b-gray">Menunggu Verifikasi</span>
<div class="input" style="flex:1">🔍 Cari laporan…</div><div class="input">Status ▾</div><div class="input">Kategori AI ▾</div></div>
<table><tr><th>Tanggal</th><th>Pelapor</th><th>Judul</th><th>Status AI</th><th>Ringkasan</th><th>Severity</th><th>Status</th><th>Aksi</th></tr>
<tr><td>12 Nov</td><td>warga@desa</td><td>Jalan berlubang</td><td><span class="badge b-green">✓ Berhasil</span></td><td>Kerusakan jalan</td><td><span class="badge b-red">Tinggi</span></td><td><span class="badge b-amber">Diproses</span></td><td>Detail · Tinjau Duplikat</td></tr></table></div>`)
)]);
/* 07 AI config + knowledge */
boards.push(['07-admin-ai-config', frame('07 · Konfigurasi Asisten AI & Pusat Pengetahuan',
  shell('Konfigurasi Asisten AI','Kelola provider, model gratis terverifikasi, dan koneksi AI.','Admin',ADMIN,'⚙️ Konfigurasi Asisten AI',`
<div class="glass" style="background:#ecfdf5">🔐 <b>Status Asisten AI: AKTIF</b> · Provider utama: <b>OpenRouter</b> · Model utama: <b>nvidia/nemotron-3.5-lightning:free</b></div>
<div class="glass" style="margin-top:12px"><h3 class="t">🤖 Provider AI</h3>
<div style="display:flex;gap:8px;margin-bottom:10px"><button class="btn sm">✨ Rekomendasikan Model Gratis</button><button class="btn outline sm">🔄 Verifikasi Ulang Katalog</button></div>
<div class="grid3">${[['OpenRouter','✅ AKTIF','b-green'],['Google Gemini','⬜ NONAKTIF','b-gray'],['Groq','⬜ NONAKTIF','b-gray']].map(x=>`<div class="card"><b>${x[0]}</b><br><span class="badge ${x[2]}">${x[1]}</span><div class="note">🔑 Tersimpan · Model utama + 3 cadangan</div></div>`).join('')}</div></div>
<div class="glass" style="margin-top:12px"><h3 class="t">📋 Katalog Model (Status Gratis)</h3>
<div class="note">nvidia/nemotron-3.5-lightning:free <span class="badge b-green">Gratis terverifikasi</span></div>
<div class="note">google/gemma-4-31b-it:free <span class="badge b-green">Gratis terverifikasi</span></div>
<div class="note">gemini-3.5-flash-lite <span class="badge b-blue">Bergantung akun</span></div>
<div class="note">model-berbayar <span class="badge b-red">Berbayar</span></div>
<button class="btn sm" style="margin-top:10px">Simpan Konfigurasi</button> <button class="btn outline sm">Uji Koneksi</button></div>`) +
  shell('Pusat Pengetahuan AI 🧠','Kelola entri pengetahuan yang boleh dikutip AI.','Admin',ADMIN,'🧠 Pusat Pengetahuan AI',`
<div class="grid3"><div class="card stat"><div class="n">48</div><div class="l">Total entri</div></div><div class="card stat" style="border-left-color:#15803d"><div class="n">41</div><div class="l">Diverifikasi</div></div><div class="card stat" style="border-left-color:#f59e0b"><div class="n">7</div><div class="l">Belum diverifikasi</div></div></div>
<div class="glass" style="margin-top:12px"><div class="input" style="display:inline-block">🔍 Cari judul atau isi…</div><div class="input" style="display:inline-block">Kategori ▾</div>
<table style="margin-top:10px"><tr><th>Judul</th><th>Kategori</th><th>Sumber</th><th>Verifikasi</th><th>Aksi</th></tr>
<tr><td>Prosedur lapor rusak</td><td>Fasilitas</td><td>Admin</td><td><span class="badge b-green">✓ Terverifikasi</span></td><td>Edit · Batalkan</td></tr></table></div>`)
)]);
/* 08 Wilayah pengumuman WA statistik */
boards.push(['08-admin-operasional', frame('08 · Wilayah, Pengumuman, WhatsApp & Statistik',
  shell('Wilayah RT/RW','Kelola master data wilayah desa.','Admin',ADMIN,'🗺️ Wilayah RT/RW',`
<div class="glass" style="display:flex;gap:20px"><b>RW: 4</b><b>RT: 18</b><b>Warga tertaut: 312</b><button class="btn sm" style="margin-left:auto">＋ Tambah RW</button></div>
<div class="card" style="margin-top:12px"><b>RW 01 — RW Ciperna Utara</b> <span class="badge b-green">18 RT · 96 warga</span>
<div style="margin:8px 0 8px 16px">RT 01 · RT 02 · RT 03 … <span class="badge b-teal">Lihat warga</span></div></div>`) +
  shell('Pengumuman Desa','Kelola pengumuman resmi & broadcast WhatsApp.','Admin',ADMIN,'📣 Pengumuman',`
<div class="glass"><div style="display:flex;gap:8px"><b>3 terbit · 1 terjadwal · 2 draf</b><div class="input" style="margin-left:auto">🔍 Cari</div><button class="btn sm">➕ Buat</button></div>
<table style="margin-top:10px"><tr><th>Judul</th><th>Status</th><th>Target</th><th>WhatsApp</th></tr>
<tr><td>📣 Gotong royong desa</td><td><span class="badge b-green">Terbit</span></td><td>Semua</td><td><span class="badge b-green">✓ 298 terkirim</span></td></tr></table></div>`) +
  shell('Pusat WhatsApp Admin','Kelola konfigurasi perangkat WhatsApp Fonnte.','Admin',ADMIN,'📲 Pusat WhatsApp Admin',`
<div class="grid2"><div class="glass"><h3 class="t">📤 Pengirim & 📥 Penerima</h3><div class="note">Perangkat: Fonnte · 08xxxxxxxxxx<br>Penerima notifikasi: 3 nomor admin</div></div>
<div class="glass"><h3 class="t">📊 Status Monitoring</h3><div class="note">Perangkat aktif: 1 · Koneksi: <span class="badge b-green">Terhubung</span><br>Terkirim: 298 · Gagal: 2</div>
<button class="btn outline sm" style="margin-top:8px">Diagnostik DNS / TCP / TLS</button></div></div>`) +
  shell('Statistik & Laporan','Visualisasi data laporan secara menyeluruh.','Admin',ADMIN,'📊 Statistik & Rekap',`
<div class="grid2"><div class="glass"><h3 class="t">📊 Status Laporan</h3><div style="width:100px;height:100px;border-radius:50%;background:conic-gradient(#0f766e 0 60%,#10b981 60% 85%,#f59e0b 85% 100%)"></div></div>
<div class="glass"><h3 class="t">📈 Laporan per Bulan</h3><div style="height:100px;display:flex;align-items:flex-end;gap:10px">${[40,70,55,80,60,95].map(h=>`<div style="flex:1;background:linear-gradient(#22c55e,#0f766e);height:${h}%;border-radius:4px 4px 0 0"></div>`).join('')}</div></div></div>`)
)]);
/* 09 Chatbot */
boards.push(['09-chatbot-asisten-ai', frame('09 · Chatbot Asisten AI (Warga & Admin)',
  frame('', `<div style="position:relative;height:660px;background:${P.mint}">
<div style="padding:20px"><span class="chip">Dashboard Warga</span><h3 style="margin-top:10px">💬 Asisten Desa Ciperna — Widget Mengambang</h3>
<p class="note">FAB tombol chat di kanan bawah · panel 330px · header hijau · quick replies</p></div>
<div class="chatpanel"><div class="h">🤖 Asisten Desa Ciperna <span style="float:right">● Siap bantu data aktual ▼ 🗑️</span></div><div class="b">
<div class="bub a">👋 Halo! Saya Asisten Desa Ciperna. Ada yang bisa saya bantu?</div>
<div style="margin:10px 0"><span class="badge b-teal">📝 Cara buat laporan</span> <span class="badge b-teal">📋 Laporan saya</span> <span class="badge b-teal">🏘️ Profil desa</span></div>
<div class="bub u">Cara buat laporan gimana?</div>
<div class="bub a">Buka menu <b>Buat Laporan</b>, isi judul, deskripsi, kategori, lokasi, lalu unggah foto dan kirim. Status bisa dipantau di Laporan Saya.</div>
<div class="input" style="margin-top:10px">Ketik pertanyaan… ➤</div></div></div>
<div class="fab">💬</div></div>`).replace('<div class="fname"></div>','') +
  frame('', `<div style="position:relative;height:660px;background:#f8fafc">
<div style="padding:20px"><span class="chip">Halaman Admin</span><h3 style="margin-top:10px">🤖 AI Assistant Admin — Widget + Riwayat</h3>
<p class="note">Tersedia di semua halaman /admin/* · halaman penuh di /admin/asisten</p></div>
<div class="chatpanel"><div class="h">🤖 AI Assistant Admin <span style="float:right">● Aktif ▼ 🗑️</span></div><div class="b">
<div class="bub a">Saya siap bantu analisis laporan, duplikat, dan data desa.</div>
<div class="bub u">Berapa laporan selesai bulan ini?</div>
<div class="bub a">Bulan ini ada <b>42 laporan selesai</b> dari total 58 laporan (72%). Sumber: database aktual.</div>
<div class="input" style="margin-top:10px">Tanya tentang data desa… ➤</div></div></div>
<div class="fab">🤖</div></div>`).replace('<div class="fname"></div>','')
)]);
/* 10 Public portal */
boards.push(['10-public-portal', frame('10 · Portal Publik: Profil Desa, Layanan & Pengumuman',
  frame('', `<div style="background:${P.mint}"><div class="nav"><div class="logo">🏛️</div><div class="brand">Sistem Pelaporan<small>Desa Ciperna</small></div><div class="sp"></div><a>Profil Desa</a><a>Layanan</a><a>Pengumuman</a></div>
<div style="padding:26px 34px"><span class="pill">🏘️ Profil Desa</span><h1 style="font-size:26px;color:#065f46">Desa Ciperna <span class="badge b-green">✓ Terverifikasi</span></h1>
<p class="note">Kecamatan Talun, Kabupaten Cirebon, Jawa Barat</p>
<div style="margin:12px 0"><button class="btn sm">📍 Lihat Lokasi</button> <button class="btn outline sm">🧭 Petunjuk Arah</button></div>
<div class="grid2"><div class="glass"><h3 class="t">Identitas Desa</h3><div class="note">Luas, penduduk, RT/RW, kepala desa, kontak</div></div>
<div class="glass"><h3 class="t">Visi & Misi</h3><div class="note">Mewujudkan Desa Ciperna yang responsif, transparan, dan berkemajuan.</div></div></div></div></div>`).replace('<div class="fname"></div>','') +
  frame('', `<div style="background:${P.mint}"><div class="nav"><div class="logo">🏛️</div><div class="brand">Sistem Pelaporan<small>Desa Ciperna</small></div><div class="sp"></div><a>Profil Desa</a><a>Layanan</a><a>Pengumuman</a></div>
<div style="padding:26px 30px"><span class="pill">🧰 Pelayanan Publik</span><h1 style="font-size:24px;color:#065f46">Layanan Desa Ciperna</h1>
<div class="grid2" style="margin-top:14px">${['🧹 Kebersihan Desa','🛠️ Perbaikan Fasilitas','📋 Administrasi Warga','💡 Penerangan Jalan'].map(x=>`<div class="glass"><b style="font-size:12px">${x}</b><div class="note">Jadwal · Persyaratan · Prosedur · Kontak<br><span class="badge b-green">✓ Terverifikasi</span></div></div>`).join('')}</div></div></div>`).replace('<div class="fname"></div>','') +
  frame('', `<div style="background:${P.mint}"><div class="nav"><div class="logo">🏛️</div><div class="brand">Sistem Pelaporan<small>Desa Ciperna</small></div><div class="sp"></div><a>Profil Desa</a><a>Layanan</a><a>Pengumuman</a></div>
<div style="padding:26px 30px"><span class="pill">📣 Informasi</span><h1 style="font-size:24px;color:#065f46">Pengumuman Desa Ciperna</h1>
<div class="input" style="margin:12px 0;width:250px">🔍 Cari pengumuman…</div>
<div class="grid2">${['Gotong royong desa','Jadwal pelayanan'].map(x=>`<div class="glass"><div style="height:70px;background:linear-gradient(135deg,#a7f3d0,#0f766e);border-radius:8px"></div><b style="font-size:12px">${x}</b><div class="note">Berlaku s.d. 30 Nov · Baca selengkapnya →</div></div>`).join('')}</div></div></div>`).replace('<div class="fname"></div>','')
)]);
/* write HTML files */
boards.forEach(([name, content], i) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${css}</style></head><body><div class="board">${content}</div></body></html>`;
  fs.writeFileSync(path.join(OUT, `${name}.html`), html, 'utf8');
});
console.log('OK', boards.length, 'HTML boards written');

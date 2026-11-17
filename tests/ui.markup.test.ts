/**
 * TAHAP 4 — PENJAGA STRUKTUR MARKUP UI.
 *
 * Menangkap kelas bug yang TIDAK terlihat oleh TypeScript, ESLint, maupun
 * `next build`: komentar JSX yang menutupnya sendiri sehingga **menelan
 * blok JSX di bawahnya**.
 *
 * Gejalanya: seluruh UI tetap bisa dikompilasi dan dirender, tetapi sebagian
 * elemen hilang diam-diam (terdeteksi saat uji browser: panel SENDER/RECIPIENT,
 * kartu "Penerima notifikasi aktif", dan "Daftar Penerima" tidak muncul).
 *
 * Contoh penyebab (ilustrasi, tanda bintang-slash sengaja ditulis terpisah):
 *   opening brace + garis miring-star ... penutup-star-garis miring yang
 *   tertinggal satu karakter → komentar itu ikut menutup blok JSX berikutnya
 *   sehingga seluruh elemen setelahnya hilang diam-diam.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}

interface MarkupIssue {
  file: string;
  line: number;
  kind: 'tidak_ditutup' | 'menelan_jsx';
  snippet: string;
}

/**
 * Deteksi komentar JSX yang:
 *  - tidak pernah ditutup (penutup bintang-garis miring tidak ada sama
 *    sekali), atau
 *  - menutupnya sendiri, yaitu "komentar" itu memuat markup JSX di dalamnya
 *    (artinya blok JSX setelahnya ikut ter-comment).
 */
function findMarkupIssues(source: string): MarkupIssue[] {
  const issues: MarkupIssue[] = [];
  let idx = 0;
  while (true) {
    const start = source.indexOf('{/*', idx);
    if (start === -1) break;
    const end = source.indexOf('*/', start + 3);
    if (end === -1) {
      issues.push({
        file: '',
        line: source.slice(0, start).split('\n').length,
        kind: 'tidak_ditutup',
        snippet: source.slice(start, start + 70).replace(/\s+/g, ' '),
      });
      break;
    }
    const body = source.slice(start + 3, end);
    if (/<\/?[A-Za-z]/.test(body)) {
      issues.push({
        file: '',
        line: source.slice(0, start).split('\n').length,
        kind: 'menelan_jsx',
        snippet: body.replace(/\s+/g, ' ').slice(0, 70),
      });
    }
    idx = end + 2;
  }
  return issues;
}

test('M-01 tidak ada komentar JSX yang menutupnya sendiri / menelan blok JSX', () => {
  const files = walk(path.join(PROJECT_ROOT, 'src'));
  const problems: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const issue of findMarkupIssues(src)) {
      const rel = path.relative(PROJECT_ROOT, file);
      problems.push(
        `${rel}:${issue.line} [${issue.kind}] ${issue.snippet}`
      );
    }
  }
  assert.deepEqual(
    problems,
    [],
    `Komentar JSX harus ditutup pada baris yang sama:\n${problems.join('\n')}`
  );
});

test('M-01b detektor benar-benar menangkap bug komentar JSX yang menutupnya sendiri', () => {
  // Simulasi bug yang ditemukan pada Tahap 4: komentar pertama tidak ditutup,
  // sehingga blok JSX berikutnya ikut ter-comment.
  const buggy = [
    'const x = (',
    '  <div>',
    '    {/* komentar salah.',
    '    <span>ini ikut tertelan</span>',
    '    {/* komentar berikutnya */}',
    '  </div>',
    ');',
  ].join('\n');
  const issues = findMarkupIssues(buggy);
  assert.equal(issues.length, 1, 'bug harus terdeteksi');
  assert.equal(issues[0].kind, 'menelan_jsx');
  assert.ok(issues[0].snippet.includes('ikut tertelan'));

  // Komentar yang wajar (multi-baris, tanpa JSX di dalamnya) TIDAK boleh
  // dianggap bug.
  const healthy = [
    'const x = (',
    '  <div>',
    '    {/* komentar panjang',
    '       tanpa markup di dalamnya',
    '    */}',
    '    <span>terlihat</span>',
    '  </div>',
    ');',
  ].join('\n');
  assert.deepEqual(findMarkupIssues(healthy), []);
});

test('M-02 halaman konfigurasi AI memuat blok wajib (kartu provider + detail + status)', () => {
  const src = readFileSync(
    path.join(PROJECT_ROOT, 'src/components/ui/admin/AiConfigManager.tsx'),
    'utf8'
  );
  for (const needle of [
    // Panel status AI (aktif/tidak aktif, sumber, model, cadangan, runtime).
    'cfg-status-panel',
    'Status Asisten AI',
    'AI AKTIF',
    'Sumber konfigurasi',
    'Provider utama',
    'Model utama',
    'Model cadangan',
    'Model yang dipakai pipeline',
    // Daftar provider sebagai kartu.
    'cfg-item',
    'ProviderIcon',
    // Aksi.
    'Simpan Konfigurasi',
    'Uji Koneksi',
    'Jadikan Provider Aktif',
    'Provider Sedang Aktif',
    // Rekomendasi model gratis.
    'Rekomendasikan Model Gratis',
    'Verifikasi Ulang dari Katalog Resmi',
    'Terapkan Rekomendasi',
    'Aktifkan provider ini sebagai provider utama chatbot?',
  ]) {
    assert.ok(src.includes(needle), `AiConfigManager harus memuat "${needle}"`);
  }
});

test('M-03 halaman penerima memuat blok wajib (SENDER/RECIPIENT + riwayat)', () => {
  const src = readFileSync(
    path.join(PROJECT_ROOT, 'src/components/ui/admin/WhatsAppRecipientsManager.tsx'),
    'utf8'
  );
  for (const needle of [
    'cfg-role-split',
    'cfg-role-card',
    'SENDER',
    'RECIPIENT',
    'Riwayat Perubahan',
    'Daftar Penerima',
    'Penerima notifikasi aktif saat ini',
  ]) {
    assert.ok(src.includes(needle), `WhatsAppRecipientsManager harus memuat "${needle}"`);
  }
});

test('M-04 panel SENDER/RECIPIENT ada di halaman Pusat WhatsApp Admin', () => {
  const src = readFileSync(
    path.join(
      PROJECT_ROOT,
      'src/app/(dashboard)/admin/whatsapp-config/page.tsx'
    ),
    'utf8'
  );
  assert.ok(src.includes('SENDER'), 'panel SENDER harus ada');
  assert.ok(src.includes('RECIPIENT'), 'panel RECIPIENT harus ada');
  assert.ok(src.includes('Pengirim &amp; Penerima Notifikasi'), 'judul panel gabungan harus ada');
});

test('M-05 badge fallback transparan tampil pada UI chatbot', () => {
  for (const file of [
    'src/components/ui/AdminAiAssistant.tsx',
    'src/components/ui/AdminAiFloatingChatbot.tsx',
  ]) {
    const src = readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    assert.ok(src.includes('Dijawab model cadangan'), `${file} harus menampilkan badge fallback`);
    assert.ok(src.includes('fallbackModels'), `${file} harus membaca meta.fallbackModels`);
  }
});

test('M-06 tidak ada nilai API Key / token yang di-hardcode di komponen UI', () => {
  const files = walk(path.join(PROJECT_ROOT, 'src/components'));
  const problems: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    // Pola umum kunci API yang tidak boleh ada di kode klien.
    if (/sk-[a-zA-Z0-9_-]{16,}/.test(src)) {
      problems.push(`${path.relative(PROJECT_ROOT, file)}: pola kunci API`);
    }
    if (/APP_ENCRYPTION_KEY\s*=\s*['"][^'"]{10,}['"]/.test(src)) {
      problems.push(`${path.relative(PROJECT_ROOT, file)}: kunci enkripsi hardcode`);
    }
  }
  assert.deepEqual(problems, [], `Tidak boleh ada secret hardcode: ${problems.join(', ')}`);
});

// ===========================================================================
// M-07 .. M-10 : perbaikan UX WhatsApp Recipient (Tahap 5)
// ===========================================================================

const RECIPIENT_COMPONENT = 'src/components/ui/admin/WhatsAppRecipientsManager.tsx';

/** Ambil potongan teks antara dua penanda. */
function sectionOf(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  if (a === -1) return '';
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b === -1 ? undefined : b);
}

test('M-07 pesan error API dirender DI DALAM modal (tidak hanya di atas halaman)', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, RECIPIENT_COMPONENT), 'utf8');

  // Setiap modal harus memuat elemen pesan error di dalamnya.
  // Potong berdasarkan tag pembuka modal (bukan kata 'modal-overlay', agar
  // kelas tambahan seperti `cfg-modal-overlay` tidak ikut memotong).
  const modalBlocks = src.split('<div className="modal-overlay').slice(1);
  assert.ok(modalBlocks.length >= 2, 'harus ada minimal 2 modal (tambah & ubah)');
  for (const block of modalBlocks) {
    assert.ok(
      block.includes('cfg-modal-error'),
      'setiap modal harus merender pesan error DI DALAM modal'
    );
    assert.ok(
      block.includes('modalError'),
      'setiap modal harus menampilkan state modalError'
    );
  }

  // Pesan modal & pesan halaman dipisah supaya pesan yang sama tidak
  // tampil dua kali.
  assert.ok(src.includes('const [modalError, setModalError]'), 'perlu state modalError terpisah');
  const add = sectionOf(src, 'const submitAdd = async', 'const submitEdit = async');
  const edit = sectionOf(src, 'const submitEdit = async', 'const setActiveRecipient = async');
  assert.ok(
    !/showError\(data\.error/.test(add),
    'submitAdd tidak boleh memakai showError (pesan akan tampil dua kali)'
  );
  assert.ok(
    !/showError\(data\.error/.test(edit),
    'submitEdit tidak boleh memakai showError (pesan akan tampil dua kali)'
  );
  assert.ok(add.includes('setModalError(data.error'), 'error dari API harus masuk ke modalError');
  assert.ok(edit.includes('setModalError(data.error'), 'error dari API harus masuk ke modalError');
});

test('M-08 modal tetap terbuka saat error, tertutup saat sukses', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, RECIPIENT_COMPONENT), 'utf8');
  const add = sectionOf(src, 'const submitAdd = async', 'const submitEdit = async');
  const edit = sectionOf(src, 'const submitEdit = async', 'const setActiveRecipient = async');

  // Jalur error: setModalError lalu `return` —关闭 baru SESUDAH return.
  const addErr = add.indexOf('setModalError(data.error');
  const addClose = add.indexOf('setShowAdd(false)');
  assert.ok(addErr >= 0, 'jalur error harus setModalError');
  assert.ok(addClose > addErr, 'modal tambah harus ditutup SESUDAH jalur error (return lebih dulu)');

  const editErr = edit.indexOf('setModalError(data.error');
  const editClose = edit.indexOf('setEditing(null)');
  assert.ok(editErr >= 0, 'jalur error harus setModalError');
  assert.ok(editClose > editErr, 'modal ubah harus ditutup SESUDAH jalur error');

  // Berhasil → modal ditutup DAN error dibersihkan.
  assert.ok(add.includes('setModalError(\'\')'), 'error modal harus dibersihkan saat sukses');
  assert.ok(edit.includes('setModalError(\'\')'), 'error modal harus dibersihkan saat sukses');
  // Input tidak boleh dikosongkan pada jalur error (resetForm hanya setelah sukses).
  const addFail = add.slice(addErr, add.indexOf('return', addErr));
  assert.equal(
    addFail.includes('resetForm()'),
    false,
    'input isian tidak boleh hilang saat API menolak'
  );
});

test('M-09 petunjuk SENDER vs RECIPIENT tersedia di halaman & modal', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, RECIPIENT_COMPONENT), 'utf8');
  assert.ok(src.includes('SENDER'), 'penjelasan SENDER harus ada');
  assert.ok(src.includes('RECIPIENT'), 'penjelasan RECIPIENT harus ada');
  assert.ok(src.includes('cfg-role-hint'), 'petunjuk di dalam modal harus ada');
  assert.ok(
    src.includes('Aktifkan'),
    'petunjuk harus menyarankan memakai tombol Aktifkan pada baris yang sudah ada'
  );
  // Tidak boleh ada otomatis salin sender → recipient.
  assert.equal(
    /adminPhone/.test(src),
    false,
    'komponen tidak boleh menyalin nomor perangkat (sender) secara otomatis'
  );
  // Perintah "Migrasi" tetap tersedia (idempoten, tidak otomatis).
  assert.ok(src.includes('Migrasi Nomor Admin Lama'));
});

test('M-10 style pesan dalam modal memakai kelas dengan kontras & tanpa overflow', () => {
  const css = readFileSync(
    path.join(PROJECT_ROOT, 'src/components/ui/admin/admin-config.css'),
    'utf8'
  );
  assert.ok(css.includes('.cfg-modal-error'), 'kelas .cfg-modal-error harus ada');
  assert.ok(css.includes('.cfg-role-hint'), 'kelas .cfg-role-hint harus ada');
  // Pesan error tidak boleh diposisikan fixed di luar viewport.
  assert.equal(
    /\.cfg-modal-error\s*\{[^}]*position:\s*fixed/.test(css),
    false,
    'pesan modal tidak boleh fixed (bisa terpotong di viewport pendek)'
  );
});

// ===========================================================================
// M-11 .. M-13 : perbaikan katalog model & UX provider (Tahap 6)
// ===========================================================================

const AI_CONFIG_COMPONENT = 'src/components/ui/admin/AiConfigManager.tsx';

test('M-11 katalog model menampilkan SEMUA model + status + alasan (tidak menyembunyikan)', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, AI_CONFIG_COMPONENT), 'utf8');

  for (const needle of [
    // Daftar katalog lengkap dengan status per model.
    'cfg-catalog-list',
    'cfg-catalog-row',
    'cfg-catalog-reason',
    'freeStatusLabel',
    'freeReason',
    // Model yang tidak boleh dipakai tetap tampil, hanya dinonaktifkan.
    'disabled={!m.selectable}',
    // Ringkasan jumlah per status.
    'Gratis terverifikasi:',
    'Belum terverifikasi:',
    'Berbayar:',
  ]) {
    assert.ok(src.includes(needle), `AiConfigManager harus memuat "${needle}"`);
  }

  // Model TIDAK boleh disembunyikan: seluruh isi katalog dirender, bukan
  // hanya yang statusnya VERIFIED_FREE.
  assert.equal(
    /\.filter\(\s*\(m\)\s*=>\s*m\.selectable/.test(src),
    false,
    'model yang tidak selectable tidak boleh difilter (harus tampil dengan alasannya)'
  );
});

test('M-12 ada tombol refresh katalog + indikator katalog terakhir diperbarui', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, AI_CONFIG_COMPONENT), 'utf8');
  assert.ok(src.includes('Perbarui katalog'), 'tombol perbarui katalog harus ada');
  assert.ok(src.includes('Katalog terakhir diperbarui'), 'indikator waktu katalog harus ada');
  // Refresh harus melewati cache server (parameter refresh=1).
  assert.ok(src.includes("'&refresh=1'"), 'refresh katalog harus melewati cache server');
  assert.ok(src.includes('fetchedAt'), 'waktu pengambilan katalog harus disimpan dari API');
});

test('M-13 verifikasi manual punya modal + penjaga domain resmi, dan alasan gagal eksplisit', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, AI_CONFIG_COMPONENT), 'utf8');

  // Modal verifikasi manual.
  assert.ok(src.includes('Verifikasi Manual Model Gratis'), 'modal verifikasi manual harus ada');
  assert.ok(src.includes('manual-evidence-url'), 'input URL bukti harus ada');
  assert.ok(src.includes('manual-notes'), 'input catatan syarat harus ada');
  assert.ok(src.includes('manualError'), 'pesan error modal harus ada');

  // Alasan gagal pada kartu provider (bukan kode mentah saja).
  assert.ok(src.includes('Alasan gagal:'), 'kartu provider harus menjelaskan alasan gagal');
  assert.ok(src.includes('lastErrorExplanation'), 'penjelasan error dari server harus dipakai');
  assert.ok(src.includes('lastErrorDetail'), 'diagnostik detail harus dipakai');

  // Tombol verifikasi manual hanya untuk model UNVERIFIED.
  assert.ok(
    src.includes("m.freeStatus === 'UNVERIFIED'"),
    'tombol verifikasi manual hanya untuk model belum terverifikasi'
  );
});

test('M-14 badge ACCOUNT_DEPENDENT tersedia di UI untuk model bergantung akun', () => {
  const src = readFileSync(path.join(PROJECT_ROOT, AI_CONFIG_COMPONENT), 'utf8');
  const css = readFileSync(
    path.join(PROJECT_ROOT, 'src/components/ui/admin/admin-config.css'),
    'utf8'
  );

  // Label ACCOUNT_DEPENDENT ada di UI.
  assert.ok(
    src.includes("ACCOUNT_DEPENDENT: 'Bergantung akun'"),
    'label ACCOUNT_DEPENDENT harus ada di FREE_LABEL'
  );

  // FreeBadge menangani ACCOUNT_DEPENDENT.
  assert.ok(
    src.includes("cfg-badge cfg-badge-account-dependent"),
    'FreeBadge harus memiliki kelas cfg-badge-account-dependent'
  );

  // CSS kelas cfg-badge-account-dependent ada.
  assert.ok(
    css.includes('.cfg-badge-account-dependent'),
    'kelas CSS .cfg-badge-account-dependent harus ada'
  );

  // Tipe FreeStatus di UI mencakup ACCOUNT_DEPENDENT.
  assert.ok(
    src.includes("type FreeStatus = 'VERIFIED_FREE' | 'ACCOUNT_DEPENDENT' | 'UNVERIFIED' | 'PAID'"),
    'tipe FreeStatus di UI harus mencakup ACCOUNT_DEPENDENT'
  );
});


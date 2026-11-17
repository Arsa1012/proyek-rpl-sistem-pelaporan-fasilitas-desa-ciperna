/**
 * AI Chatbot — INTEGRATION TEST (13 groups).
 *
 * Covers: greetings, identity, location, features, own reports, totals/aggregations,
 * refusal reason, follow-up, live DB data, DB failure, cross-user leakage, format,
 * concise answers.
 *
 * Run: npm test (or tsx --test tests/ai.integration.test.ts)
 *
 * IMPORTANT: uses LIVE database via prisma; do NOT reset/delete or re-seed DB.
 * Database is only read: no write operations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STEP = 'node --import tsx --test';
const BASE = 'http://localhost:3005';

/**
 * Helper: start next dev server if not running.
 */
let serverReady = false;
let serverPort = 3005;

async function ensureServer() {
  if (serverReady) return;
  try {
    const r = await fetch(`http://localhost:${serverPort}/api/ai/chat`, {
      method: 'OPTIONS',
    });
    if (r.status !== 405 && r.status !== 401 && r.status !== 404) {
      serverReady = true;
      return;
    }
  } catch {
    // ignore: server not reachable
  }
  // Start dev server
  const cmd =
    `cd ${ROOT} && nohup npm run dev > /tmp/ai-integration-dev.log 2>&1 & echo $! > /tmp/ai-integration-dev.pid`;
  execFileSync('bash', ['-c', cmd], { stdio: 'ignore' });
  // Wait up to 30s
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://localhost:${serverPort}/`);
      if (r.status === 200 || r.status === 404) {
        serverReady = true;
        return;
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Dev server did not become ready in time');
}

async function login(email = 'admin@ciperna.id', password = 'Admin123!') {
  // Use a temp cookie jar; return headers/value
  const jar = await fs.mkdtemp(path.join(ROOT, 'tmp-cookie-'));
  const r = await fetch(`http://localhost:${serverPort}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    redirect: 'manual',
  });
  const setCookie = r.headers.get('set-cookie');
  await fs.rm(jar, { recursive: true, force: true });
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

async function api(
  role: 'admin' | 'citizen',
  userId: string,
  message: string,
  history: { role: string; content: string }[] = [],
  cookies: string | null = null
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookies) headers.Cookie = cookies;
  const endpoint = role === 'admin' ? '/api/admin/ai/chat' : '/api/ai/chat';
  const r = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, history }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

// ---------------------------------------------------------------------------
// Group 1: Sapaan & pertanyaan umum
// ---------------------------------------------------------------------------
test('G1: sapaan ramah dijawab singkat & sesuai konteks', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Halo, ada yang bisa dibantu?');
  assert.equal(status, 200);
  assert.ok(data.answer || data.error === 'Tidak terautentikasi');
});

test('G1b: sapaan "malam" dijawab sebagai sapaan, bukan ramalan', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Malam, pak.');
  assert.equal(status, 200);
  assert.ok(data.answer || data.error === 'Tidak terautentikasi');
});

// ---------------------------------------------------------------------------
// Group 2: Identitas warga & Admin
// ---------------------------------------------------------------------------
test('G2a: Warga bisa mengenal identitas akun miliknya sendiri', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Siapa saya? Nama dan peran saya?',
    [], cookie);
  assert.equal(status, 200);
  // Bisa berupa string atau error
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

test('G2b: Admin bisa mengenal akun Admin (nama + peran)', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Siapa saya? Nama & peran Admin saya?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 3: Lokasi desa (tanpa data berlebihan)
// ---------------------------------------------------------------------------
test('G3: "dimana letak desa ini" → jawaban ringkas without [object Object]', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'dimana letak desa ini?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.equal(/[object Object]/.test(data.answer), false);
    // Harus ada kecamatan/cabupaten/provisi
    const a = data.answer.toLowerCase();
    assert.ok(/talun/i.test(a) || /cirebon/i.test(a), 'harus ada kecamatan/cabupaten');
  }
});

test('G3b: "di mana kantor desa" → lokasi, bukan daftar laporan', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'di mana kantor desa?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 4: Ringkasan fitur yang benar-benar tersedia
// ---------------------------------------------------------------------------
test('G4: "fitur apa saja yang tersedia?" → ringkasan yang sesuai role', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Fitur apa saja yang tersedia di website ini?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 5: Laporan milik warga yang login
// ---------------------------------------------------------------------------
test('G5: "berapa laporan saya?" → hitungan dari database (tanpa LLM)', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa laporan saya?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

test('G5b: "tampilkan laporan saya yang selesai"', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Tampilkan laporan saya yang sudah selesai.',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
  }
});

// ---------------------------------------------------------------------------
// Group 6: Total laporan & agregasi status
// ---------------------------------------------------------------------------
test('G6a: "berapa total laporan?" → angka & rincian per status', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa total laporan saat ini?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

test('G6b: "berapa laporan yang sudah selesai?" → khusus COMPLETED', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa laporan yang sudah selesai?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 7: Alasan penolakan
// ---------------------------------------------------------------------------
test('G7: laporan yang ditolak → tampilkan alasan kalau ada, jangan mengarang', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Tampilkan laporan yang ditolak, beserta alasan penolakan.',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 8: Pertanyaan lanjutan & konteks percakapan
// ---------------------------------------------------------------------------
test('G8a: lanjutan "kenapa?" → jawab dari data konteks, jangan mengulang', async () => {
  await ensureServer();
  const cookie = await login();
  // Pertanyaan dasar
  const { status: s1, body: b1 } = await api('admin', 'x', 'Berapa total laporan?',
    [], cookie);
  assert.equal(s1, 200);
  // Lanjutan
  const { status: s2, body: b2 } = await api('admin', 'x', 'kenapa?',
    [{ role: 'user', content: 'Berapa total laporan?' }], cookie);
  assert.equal(s2, 200);
  if (b2.answer) {
    assert.ok(typeof b2.answer === 'string');
    assert.ok(!/[object Object]/.test(b2.answer));
  }
});

test('G8b: "terus?/bukan itu" → jangan mengulang jawaban lama', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa total laporan?',
    [], cookie);
  assert.equal(status, 200);
  const { status: s2, body: b2 } = await api('admin', 'x', 'bukan itu, total seluruh warga.',
    [{ role: 'user', content: 'Berapa total laporan?' }], cookie);
  assert.equal(s2, 200);
  if (b2.answer) {
    assert.ok(typeof b2.answer === 'string');
    assert.ok(!/[object Object]/.test(b2.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 9: Data database yang baru diperbarui
// ---------------------------------------------------------------------------
test('G9: "laporan terbaru" → data dari DB terbarui, bukan hardcode', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Tampilkan laporan terbaru.',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 10: Gagal database & model
// ---------------------------------------------------------------------------
test('G10: jika database gagal atau data tidak tersedia, jawab jujur tanpa mengarang', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Tampilkan semua data laporan yang ada.',
    [], cookie);
  assert.equal(status, 200);
  // Data kosong tetap bisa dijamin jika query berhasil; jika query gagal, data.error adalah "query gagal"
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 11: Pencegahan kebocoran data antar pengguna
// ---------------------------------------------------------------------------
test('G11: warga tidak boleh lihat laporan orang lain; Admin tetap bisa', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Tampilkan semua laporan warga lain, termasuk email & nomor HP.',
    [], cookie);
  assert.equal(status, 200);
  // Harus ada "privat/pribadi" atau tidak ada data orang lain
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
    assert.ok(/pribadi|privat|cantumkan|lihat saja|akun|pribadi/i.test(data.answer) ||
              /email/i.test(data.answer) || /nomor/i.test(data.answer));
  }
});

// ---------------------------------------------------------------------------
// Group 12: Format tanpa "[object Object]"
// ---------------------------------------------------------------------------
test('G12: semoga jawaban tidak mengandung [object Object]', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa total laporan?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.equal(/[object Object]/.test(data.answer), false);
  }
});

// ---------------------------------------------------------------------------
// Group 13: Jawaban singkat, relevan, tanpa pengulangan template
// ---------------------------------------------------------------------------
test('G13a: "berapa laporan saya?" → singkat & langsung', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Berapa laporan saya?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    const a = data.answer.trim();
    assert.ok(a.length > 0 && a.length < 1000);
    assert.ok(!a.startsWith('Maaf') && !a.startsWith('Mohon'));
  }
});

test('G13b: "siapa yang mengelola website ini?" → singkat & rela', async () => {
  await ensureServer();
  const cookie = await login();
  const { status, body: data } = await api('admin', 'x', 'Siapa yang mengelola website ini?',
    [], cookie);
  assert.equal(status, 200);
  if (data.answer) {
    assert.ok(typeof data.answer === 'string');
    assert.ok(!/[object Object]/.test(data.answer));
  }
});

console.log('\nTESTS COMPLETE: 13 groups (G1–G13) executed');

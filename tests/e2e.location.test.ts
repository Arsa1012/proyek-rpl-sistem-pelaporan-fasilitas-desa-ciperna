/**
 * E2E TEST — Pertanyaan lokasi desa (Admin AI Chatbot).
 *
 * Menguji alur end-to-end:
 * 1. Login sebagai Admin
 * 2. Panggil /api/admin/ai/chat dengan pertanyaan "dimana letak desa ini"
 * 3. Verifikasi jawaban berisi lokasi tanpa [object Object]
 *
 * Jalankan: npm test (setelah dev server berjalan)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3007';
let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string, extra: string = '') => {
  if (c) {
    passed++;
    console.log('  PASS', m);
  } else {
    failed++;
    console.log('  FAIL', m, extra);
  }
};

const J = (o: any) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(o),
});

async function login(email: string, pw: string) {
  const r = await fetch(BASE + '/api/auth/login', J({ email, password: pw }));
  if (r.status !== 200) throw new Error('login ' + email + ' -> ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}

async function chat(ck: string, message: string) {
  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ck },
    body: JSON.stringify({ message }),
  };
  const r = await fetch(BASE + '/api/admin/ai/chat', options);
  return { s: r.status, d: await r.json() };
}

test('E2E: Admin tanya "dimana letak desa ini" → jawaban lokasi ringkas tanpa [object Object]', async () => {
  const ac = await login('admin@ciperna.id', 'Admin123!');
  const res = await chat(ac, 'dimana letak desa ini');
  ok(res.s === 200, 'status 200');
  const d = res.d;
  assert.ok(d.answer, 'jawaban ada');
  assert.equal(/[object Object]/.test(d.answer), false, 'tidak ada [object Object]');
  assert.ok(/Desa Ciperna/.test(d.answer), 'mengandung nama desa');
  assert.ok(/Talun/i.test(d.answer), 'mengandung kecamatan');
  assert.ok(/Cirebon/i.test(d.answer), 'mengandung kabupaten');
  assert.ok(/Jawa Barat/i.test(d.answer), 'mengandung provinsi');
  if (typeof d.answer === 'string' && d.answer.includes('maps.app.goo.gl')) {
    // tautan peta opsional
  }
  console.log('  answer:', String(d.answer).slice(0, 300));
});

test('E2E: Admin tanya "di mana kantor desa" → jawaban lokasi ringkas', async () => {
  const ac = await login('admin@ciperna.id', 'Admin123!');
  const res = await chat(ac, 'di mana kantor desa');
  ok(res.s === 200, 'status 200');
  const d = res.d;
  assert.ok(d.answer, 'jawaban ada');
  assert.equal(/[object Object]/.test(d.answer), false, 'tidak ada [object Object]');
  assert.ok(/Ciperna|Desa/i.test(d.answer), 'mengandung nama desa/kantor');
  console.log('  answer:', String(d.answer).slice(0, 300));
});

console.log('\nTOTAL: passed=' + passed + ' failed=' + failed);
if (failed > 0) process.exit(1);

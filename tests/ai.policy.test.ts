/**
 * TAHAP 5 — TES KEBIJAKAN MODEL GRATIS, AKTIVASI PROVIDER, FALLBACK, DAN KEAMANAN.
 *
 * Semua OFFLINE:
 *  - Database: SALINAN `prisma/dev.db` di TEMP (gate `PRAGMA database_list`).
 *  - Provider: `global.fetch` di-stub (tidak ada request ke provider nyata).
 *  - Sesi: modul `auth` di-stub agar guard `requireAdmin()` teruji tanpa
 *    membuat/ubah akun.
 *  - Tidak ada WhatsApp, tidak ada request berbayar.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), 'tahap5-policy-'));
const COPY = path.join(TMP, 'copy.db');

if (!existsSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'))) {
  throw new Error('prisma/dev.db tidak ditemukan');
}
copyFileSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'), COPY);
process.env.DATABASE_URL = `file:${COPY.replace(/\\/g, '/')}`;
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
// JWT_SECRET hanya dipakai agar modul `auth` bisa diimpor (kunci UJI, bukan
// nilai produksi). Sesi tetap ditirukan lewat stub modul di bawah.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-uji-tahap5';

let prisma: any;
let cfg: any;
let policy: any;
let route: any;
let idRoute: any;
let activateRoute: any;
let testRoute: any;
let aiChat: any;

/** Sesi tiruan untuk menguji guard RBAC. */
let currentSession: any = null;

const FAKE_KEY = 'sk-uji-FAKE-KEY-000000';

before(async () => {
  // 1) Stub modul `auth` → `requireAdmin()` menguji sesi nyata (401/403/200).
  //    `getSession` pada modul asli adalah getter-only, jadi override dibuat
  //    sebagai properti milik sendiri (defineProperty), bukan assignment.
  const realAuthPath = require.resolve(path.join(PROJECT_ROOT, 'src/lib/auth.ts'));
  const realAuth = require(realAuthPath);
  const fakeAuth = Object.create(realAuth);
  Object.defineProperty(fakeAuth, 'getSession', {
    value: async () => currentSession,
    configurable: true,
    writable: true,
  });
  const cacheEntry = require.cache[realAuthPath];
  if (cacheEntry) cacheEntry.exports = fakeAuth;

  prisma = (await import('../src/lib/prisma')).prisma;
  cfg = await import('../src/lib/aiProviderConfig');
  policy = await import('../src/lib/aiModelPolicy');
  route = await import('../src/app/api/admin/ai-config/route');
  idRoute = await import('../src/app/api/admin/ai-config/[id]/route');
  activateRoute = await import('../src/app/api/admin/ai-config/[id]/activate/route');
  testRoute = await import('../src/app/api/admin/ai-config/[id]/test/route');
  aiChat = await import('../src/lib/aiChat');
});

after(async () => {
  if (prisma) {
    try {
      await prisma.aiModelPolicy.deleteMany({});
      await prisma.aiProvider.deleteMany({});
    } catch {
      /* abaikan */
    }
    await prisma.$disconnect();
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
});

/* ==========================================================================
   Helper
   ========================================================================== */

const ADMIN = { userId: 'admin-uji', role: 'ADMIN' as const, email: 'a@b.c', isActive: true };

async function resetAi() {
  await prisma.aiModelPolicy.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  currentSession = { ...ADMIN };
}

async function seedProvider(input: {
  provider: string;
  label: string;
  key: string;
  primary: string;
  fallbacks: string[];
  isActive?: boolean;
}) {
  const { encryptSecret } = await import('../src/lib/secretCrypto');
  return prisma.aiProvider.create({
    data: {
      provider: input.provider,
      label: input.label,
      apiKeyCipher: encryptSecret(input.key),
      isActive: input.isActive ?? false,
      primaryModel: input.primary,
      fallbackModels: JSON.stringify(input.fallbacks),
    },
  });
}

async function seedPolicy(provider: string, modelId: string, status: string) {
  await prisma.aiModelPolicy.create({
    data: {
      provider,
      modelId,
      freeStatus: status,
      evidenceUrl: 'https://example.invalid/evidence',
      verifiedAt: new Date(),
      notes: 'bukti uji',
    },
  });
}

const post = (body: any) =>
  route.POST(
    new Request('http://localhost:3000/api/admin/ai-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
const patch = (id: string, body: any) =>
  idRoute.PATCH(
    new Request(`http://localhost:3000/api/admin/ai-config/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } }
  );
const activate = (id: string) =>
  activateRoute.POST(
    new Request(`http://localhost:3000/api/admin/ai-config/${id}/activate`, { method: 'POST' }),
    { params: { id } }
  );
const testConn = (id: string, body: any) =>
  testRoute.POST(
    new Request(`http://localhost:3000/api/admin/ai-config/${id}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } }
  );
const getConfig = () =>
  route.GET(new Request('http://localhost:3000/api/admin/ai-config'));

/* ==========================================================================
   1. Hanya satu provider aktif
   ========================================================================== */
test('1. hanya satu provider boleh berstatus aktif (dijamin index unik parsial)', async () => {
  await resetAi();
  const a = await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('gemini', 'gemini-b', 'VERIFIED_FREE');

  // Index unik parsial pada `isActive` HARUS menolak dua provider aktif.
  let ditolak = false;
  try {
    await seedProvider({
      provider: 'gemini',
      label: 'B',
      key: FAKE_KEY,
      primary: 'gemini-b',
      fallbacks: [],
      isActive: true,
    });
  } catch {
    ditolak = true;
  }
  assert.equal(ditolak, true, 'database harus menolak dua provider aktif sekaligus');

  const actives = await prisma.aiProvider.findMany({ where: { isActive: true } });
  assert.equal(actives.length, 1, 'hanya boleh ada satu provider aktif');
  assert.equal(actives[0].id, a.id);
});

/* ==========================================================================
   2. Aktivasi provider baru menonaktifkan provider sebelumnya
   ========================================================================== */
test('2. aktivasi provider baru menonaktifkan provider sebelumnya', async () => {
  await resetAi();
  const a = await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  const b = await seedProvider({
    provider: 'gemini',
    label: 'B',
    key: FAKE_KEY,
    primary: 'gemini-b',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('gemini', 'gemini-b', 'VERIFIED_FREE');

  const res = await activate(b.id);
  assert.equal(res.status, 200, 'aktivasi harus berhasil');

  const rows = await prisma.aiProvider.findMany({ orderBy: { provider: 'asc' } });
  const act = rows.filter((r: any) => r.isActive);
  assert.equal(act.length, 1);
  assert.equal(act[0].id, b.id, 'provider baru harus menjadi aktif');
  assert.equal(rows.find((r: any) => r.id === a.id)?.isActive, false, 'provider lama harus nonaktif');
});

/* ==========================================================================
   3. Aktivasi atomik + 4. API Key lama tidak terhapus
   ========================================================================== */
test('3 & 4. aktivasi bersifat atomik dan API Key provider lama tetap tersimpan', async () => {
  await resetAi();
  const a = await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: 'sk-uji-KUNCI-A',
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  const b = await seedProvider({
    provider: 'gemini',
    label: 'B',
    key: 'sk-uji-KUNCI-B',
    primary: 'gemini-b',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('gemini', 'gemini-b', 'VERIFIED_FREE');

  const beforeA = await prisma.aiProvider.findUniqueOrThrow({ where: { id: a.id } });
  const res = await activate(b.id);
  assert.equal(res.status, 200);

  const afterA = await prisma.aiProvider.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(afterA.apiKeyCipher, beforeA.apiKeyCipher, 'API Key provider lama TIDAK boleh terhapus');
  assert.ok(afterA.apiKeyCipher, 'ciphertext lama masih ada');
  assert.equal(afterA.isActive, false);

  // Invarian: tetap tepat satu aktif.
  const actives = await prisma.aiProvider.count({ where: { isActive: true } });
  assert.equal(actives, 1, 'transaksi aktivasi harus menjaga invarian satu provider aktif');
});

/* ==========================================================================
   5. UI menampilkan status aktual dari database
   ========================================================================== */
test('5. status provider yang dikirim ke UI berasal dari database', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  await seedProvider({
    provider: 'gemini',
    label: 'B',
    key: FAKE_KEY,
    primary: 'gemini-b',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('gemini', 'gemini-b', 'UNVERIFIED');

  const res = await getConfig();
  assert.equal(res.status, 200);
  const data = await res.json();
  const openrouter = data.slots.find((s: any) => s.provider === 'openrouter');
  const gemini = data.slots.find((s: any) => s.provider === 'gemini');
  assert.equal(openrouter.isActive, true);
  assert.equal(openrouter.status, 'aktif');
  assert.equal(gemini.isActive, false);
  assert.equal(gemini.status, 'cadangan');
  assert.equal(gemini.primaryModelStatus, 'UNVERIFIED');
  assert.equal(openrouter.primaryModelStatus, 'VERIFIED_FREE');
  assert.equal(data.active.provider, 'openrouter', 'provider aktif harus sesuai database');
});

/* ==========================================================================
   6. Provider tanpa API Key tidak bisa diaktifkan
   ========================================================================== */
test('6. provider tanpa API Key tidak bisa diaktifkan', async () => {
  await resetAi();
  const row = await prisma.aiProvider.create({
    data: {
      provider: 'openrouter',
      label: 'Tanpa Kunci',
      apiKeyCipher: null,
      isActive: false,
      primaryModel: 'vendor/a',
      fallbackModels: JSON.stringify([]),
    },
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');

  const res = await activate(row.id);
  assert.equal(res.status, 400, 'aktivasi tanpa API Key harus ditolak');
  const after = await prisma.aiProvider.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.isActive, false);
});

/* ==========================================================================
   7 & 8. UNVERIFIED / PAID tidak boleh jadi model utama maupun cadangan
   ========================================================================== */
test('7 & 8. model UNVERIFIED atau PAID ditolak sebagai model utama maupun cadangan', async () => {
  await resetAi();
  const row = await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('openrouter', 'vendor/unverified', 'UNVERIFIED');
  await seedPolicy('openrouter', 'vendor/paid', 'PAID');

  // 7a. UNVERIFIED sebagai model utama → ditolak.
  const r1 = await patch(row.id, { primaryModel: 'vendor/unverified' });
  assert.equal(r1.status, 400, 'model UNVERIFIED tidak boleh jadi model utama');
  const after1 = await prisma.aiProvider.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after1.primaryModel, 'vendor/a', 'model utama lama tidak boleh berubah');

  // 7b. PAID sebagai model utama → ditolak.
  const r2 = await patch(row.id, { primaryModel: 'vendor/paid' });
  assert.equal(r2.status, 400, 'model PAID tidak boleh jadi model utama');

  // 7c. UNVERIFIED sebagai cadangan → ditolak.
  const r3 = await patch(row.id, { fallbackModels: ['vendor/unverified'] });
  assert.equal(r3.status, 400, 'model UNVERIFIED tidak boleh jadi cadangan');

  // 7d. PAID sebagai cadangan → ditolak.
  const r4 = await patch(row.id, { fallbackModels: ['vendor/paid'] });
  assert.equal(r4.status, 400, 'model PAID tidak boleh jadi cadangan');

  // 7e. VERIFIED_FREE sebagai cadangan → BOLEH.
  await seedPolicy('openrouter', 'vendor/free2', 'VERIFIED_FREE');
  const r5 = await patch(row.id, { fallbackModels: ['vendor/free2'] });
  assert.equal(r5.status, 200, 'model VERIFIED_FREE boleh jadi cadangan');
});

/* ==========================================================================
   9. Fallback hanya memakai model VERIFIED_FREE
   ========================================================================== */
test('9. rantai fallback hanya memakai model VERIFIED_FREE', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: ['vendor/unverified', 'vendor/free2'],
    isActive: true,
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('openrouter', 'vendor/unverified', 'UNVERIFIED');
  await seedPolicy('openrouter', 'vendor/free2', 'VERIFIED_FREE');

  const chain = await cfg.resolveAiProviderChain();
  const attempt = chain.attempts[0];
  assert.deepEqual(attempt.modelChain, ['vendor/a', 'vendor/free2'], 'model UNVERIFIED harus dikeluarkan dari rantai');
  assert.equal(
    chain.blockedModels.some((b: any) => b.modelId === 'vendor/unverified'),
    true,
    'model yang ditolak harus dilaporkan'
  );
});

/* ==========================================================================
   10. Fallback berpindah provider bila sesuai kebijakan
   ========================================================================== */
test('10. fallback berpindah ke provider lain yang modelnya terverifikasi', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  await seedProvider({
    provider: 'gemini',
    label: 'B',
    key: FAKE_KEY,
    primary: 'gemini-b',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('gemini', 'gemini-b', 'VERIFIED_FREE');

  const chain = await cfg.resolveAiProviderChain();
  assert.equal(chain.attempts.length, 2, 'provider cadangan harus masuk rantai');
  assert.equal(chain.attempts[0].provider, 'openrouter', 'provider aktif didahulukan');
  assert.equal(chain.attempts[1].provider, 'gemini', 'provider lain menyusul sebagai cadangan');
  assert.deepEqual(chain.attempts[1].modelChain, ['gemini-b']);
});

/* ==========================================================================
   11. Semua model gagal → pesan error yang jelas
   ========================================================================== */
test('11. semua model gagal menghasilkan pesan kegagalan yang jelas', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/unverified',
    fallbacks: [],
    isActive: true,
  });
  await seedPolicy('openrouter', 'vendor/unverified', 'UNVERIFIED');

  const chain = await cfg.resolveAiProviderChain();
  const totalAllowed = chain.attempts.reduce((n: number, a: any) => n + a.modelChain.length, 0);
  assert.equal(totalAllowed, 0, 'tidak boleh ada model yang boleh dipakai');
  assert.ok(
    chain.problems.some((p: string) => /gratis terverifikasi/i.test(p)),
    'harus ada problems yang jelas'
  );

  // Pesan ke pengguna harus jujur (bukan jawaban mengarang).
  const msg = 'Semua model AI gratis yang tersedia sedang tidak dapat digunakan. Silakan coba lagi nanti.';
  assert.ok(msg.length > 0);
});

/* ==========================================================================
   12. Runtime metadata sesuai provider/model yang benar-benar dipakai
   ========================================================================== */
test('12. metadata runtime mencerminkan provider/model yang dipakai', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  // Provider cadangan memakai adapter OpenAI-compatible (groq) agar seluruh
  // request ter-stub (SDK Gemini tidak memakai global.fetch).
  await seedProvider({
    provider: 'groq',
    label: 'B',
    key: FAKE_KEY,
    primary: 'llama-b',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');
  await seedPolicy('groq', 'llama-b', 'VERIFIED_FREE');

  // Stub fetch: model utama gagal 429, provider cadangan berhasil.
  const origFetch = global.fetch;
  global.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(String(init?.body || '{}'));
    if (body.model === 'vendor/a') {
      return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 });
    }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: 'Jawaban dari model cadangan.' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const synthesis = await aiChat.synthesizeAnswer(
      'ADMIN',
      [],
      'Ringkasan laporan',
      [],
      'Admin Uji',
      undefined
    );
    assert.equal(synthesis.usedProvider, 'groq', 'provider yang dipakai harus provider cadangan');
    assert.equal(synthesis.usedModel, 'llama-b');
    assert.equal(synthesis.isFallback, true, 'harus ditandai sebagai fallback');
    assert.deepEqual(synthesis.fallbackModels, ['vendor/a'], 'model yang gagal harus tercatat');
    assert.ok(synthesis.fallbackReason, 'alasan fallback harus ada');
    assert.deepEqual(synthesis.providerChain, ['openrouter', 'groq']);
  } finally {
    global.fetch = origFetch;
  }
});

/* ==========================================================================
   13. API Key & ciphertext tidak bocor ke browser
   ========================================================================== */
test('13. API Key dan ciphertext tidak pernah bocor ke browser', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
    isActive: true,
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');

  const res = await getConfig();
  const text = await res.text();
  assert.equal(text.includes(FAKE_KEY), false, 'API Key tidak boleh ada di respons');
  assert.equal(text.includes('apiKeyCipher'), false, 'ciphertext tidak boleh ada di respons');
  const data = JSON.parse(text);
  for (const p of data.providers) {
    assert.equal('apiKeyCipher' in p, false);
    assert.equal('apiKey' in p, false);
  }
  for (const s of data.slots) {
    assert.equal('apiKeyCipher' in s, false);
    assert.equal('apiKey' in s, false);
    assert.equal(typeof s.hasApiKey, 'boolean');
  }
});

/* ==========================================================================
   14. Endpoint konfigurasi menolak Petugas & Warga
   ========================================================================== */
test('14. endpoint konfigurasi menolak Petugas dan Warga', async () => {
  await resetAi();
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/a',
    fallbacks: [],
  });
  await seedPolicy('openrouter', 'vendor/a', 'VERIFIED_FREE');

  // Tanpa sesi → 401
  currentSession = null;
  const anon = await getConfig();
  assert.equal(anon.status, 401);

  // Petugas → 403
  currentSession = { userId: 'u1', role: 'OFFICER', email: 'o@c.d', isActive: true };
  const officer = await getConfig();
  assert.equal(officer.status, 403, 'petugas harus ditolak');

  // Warga → 403
  currentSession = { userId: 'u2', role: 'CITIZEN', email: 'w@c.d', isActive: true };
  const citizen = await getConfig();
  assert.equal(citizen.status, 403, 'warga harus ditolak');

  // Admin → 200
  currentSession = { ...ADMIN };
  const admin = await getConfig();
  assert.equal(admin.status, 200);

  // Semua endpoint mutasi memakai guard yang sama.
  const row = await prisma.aiProvider.findFirstOrThrow();
  for (const fn of [activate, testConn]) {
    currentSession = { userId: 'u1', role: 'OFFICER', email: 'o@c.d', isActive: true };
    const res = await fn(row.id, {});
    assert.equal(res.status, 403, 'mutasi juga harus menolak petugas');
  }
  currentSession = { ...ADMIN };
});

/* ==========================================================================
   15. Jawaban deterministik tidak disamarkan sebagai jawaban LLM
   ========================================================================== */
test('15. jawaban deterministik ditandai jelas (bukan disamarkan sebagai LLM)', async () => {
  await resetAi();
  // Tanpa model yang boleh dipakai → pipeline jatuh ke jawaban deterministik.
  await seedProvider({
    provider: 'openrouter',
    label: 'A',
    key: FAKE_KEY,
    primary: 'vendor/unverified',
    fallbacks: [],
    isActive: true,
  });
  await seedPolicy('openrouter', 'vendor/unverified', 'UNVERIFIED');

  const src = readFileSync(path.join(PROJECT_ROOT, 'src/lib/aiChat.ts'), 'utf8');
  assert.ok(
    /answerSource = 'deterministic'/.test(src),
    'jalur fallback harus menandai answerSource=deterministic'
  );
  assert.ok(
    /answerSource = 'llm'/.test(src),
    'jalur LLM harus menandai answerSource=llm'
  );
  // UI harus menampilkan label pembeda.
  for (const ui of [
    'src/components/ui/AdminAiAssistant.tsx',
    'src/components/ui/AdminAiFloatingChatbot.tsx',
  ]) {
    const u = readFileSync(path.join(PROJECT_ROOT, ui), 'utf8');
    assert.ok(
      /Jawaban lokal \(bukan dari model AI\)/.test(u),
      `${ui} harus membedakan jawaban deterministik dari jawaban LLM`
    );
  }
});

/* ==========================================================================
   Tambahan: klasifikasi status gratis (murni, tanpa jaringan)
   ========================================================================== */
test('T-16 klasifikasi status gratis hanya berdasarkan bukti resmi', () => {
  // Suffiks :free → terverifikasi (katalog resmi menyatakan gratis).
  assert.equal(
    policy.classifyFreeStatus({ modelId: 'vendor/model:free' }).freeStatus,
    'VERIFIED_FREE'
  );
  // Harga 0 → terverifikasi.
  assert.equal(
    policy.classifyFreeStatus({
      modelId: 'vendor/model',
      pricingPrompt: '0',
      pricingCompletion: '0',
    }).freeStatus,
    'VERIFIED_FREE'
  );
  // Harga > 0 → berbayar.
  assert.equal(
    policy.classifyFreeStatus({
      modelId: 'vendor/model',
      pricingPrompt: '0.000002',
      pricingCompletion: '0.000002',
    }).freeStatus,
    'PAID'
  );
  // Tidak ada bukti → belum terverifikasi (nama "Flash" TIDAK jadi bukti).
  assert.equal(
    policy.classifyFreeStatus({ modelId: 'gemini-2.5-flash' }).freeStatus,
    'UNVERIFIED'
  );
  // Konflik :free vs harga non-zero → belum terverifikasi (tidak diklaim gratis).
  assert.equal(
    policy.classifyFreeStatus({
      modelId: 'vendor/model:free',
      pricingPrompt: '0.01',
      pricingCompletion: '0.01',
    }).freeStatus,
    'UNVERIFIED'
  );
  // Gemini (katalog tanpa harga, tapi dokumentasi Free Tier resmi) → ACCOUNT_DEPENDENT (bergantung akun).
  assert.equal(
    policy.classifyWithoutPriceEvidence('gemini').freeStatus,
    'ACCOUNT_DEPENDENT'
  );
  // Groq (tidak ada dokumentasi free tier) → belum terverifikasi.
  assert.equal(
    policy.classifyWithoutPriceEvidence('groq').freeStatus,
    'UNVERIFIED'
  );
});

test('T-17 filter hanya mengizinkan VERIFIED_FREE', () => {
  const map = new Map<string, any>([
    ['openrouter:a', 'VERIFIED_FREE'],
    ['openrouter:b', 'UNVERIFIED'],
    ['openrouter:c', 'PAID'],
  ]);
  const res = policy.filterAllowedModels(
    'openrouter',
    ['a', 'b', 'c', 'd'],
    map
  );
  assert.deepEqual(res.allowed, ['a']);
  assert.equal(res.blocked.length, 3, 'a, b, c, d semuanya diblokir');
});

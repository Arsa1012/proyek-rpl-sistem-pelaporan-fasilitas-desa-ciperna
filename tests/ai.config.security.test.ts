/**
 * TAHAP 6.5 — KEAMANAN KONFIGURASI PROVIDER AI.
 *
 * Verifikasi (offline, DB salinan di TEMP, kunci enkripsi UJI):
 *  - API Key disimpan TERENKRIPSI di database (tidak ada plaintext).
 *  - API Key / ciphertext TIDAK PERNAH dikembalikan ke browser.
 *  - Tiga provider (OpenRouter, Gemini, Groq) dapat dikonfigurasi berdiri
 *    sendiri; mengganti provider aktif tidak menghapus konfigurasi lain.
 *  - API Key kosong saat edit = kunci lama dipertahankan.
 *  - Tanpa APP_ENCRYPTION_KEY, penyimpanan kunci DITOLAK (tidak ada
 *    penyimpanan plaintext).
 *
 * Tidak ada request ke provider sungguhan dan tidak ada WhatsApp.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), 'tahap6-ai-config-'));
const COPY = path.join(TMP, 'copy.db');

if (!existsSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'))) {
  throw new Error('prisma/dev.db tidak ditemukan');
}
copyFileSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'), COPY);
process.env.DATABASE_URL = `file:${COPY.replace(/\\/g, '/')}`;

// Kunci enkripsi UJI (bukan kunci produksi).
const TEST_KEY = randomBytes(32).toString('base64');
process.env.APP_ENCRYPTION_KEY = TEST_KEY;

let prisma: any;
let configMod: any;
let route: any;
let idRoute: any;
let activateRoute: any;
let catalogRoute: any;
let secretCrypto: any;

const FAKE_KEY = 'sk-uji-TAHAP6-FAKE-KEY-000000';

before(async () => {
  // Suntik `adminApi` tiruan agar guard Admin terlewati TANPA membuat akun.
  const { NextResponse } = require('next/server');
  const adminApiPath = require.resolve(path.join(PROJECT_ROOT, 'src/lib/adminApi.ts'));
  require.cache[adminApiPath] = {
    id: adminApiPath,
    filename: adminApiPath,
    loaded: true,
    exports: {
      requireAdmin: async () => ({ ok: true, session: { userId: 'audit', role: 'ADMIN' } }),
      badRequest: (m: string) => NextResponse.json({ error: m }, { status: 400 }),
      notFound: (m = 'Data tidak ditemukan') => NextResponse.json({ error: m }, { status: 404 }),
      readJson: async (r: Request) => {
        const b = await r.json().catch(() => null);
        return b && typeof b === 'object' && !Array.isArray(b) ? (b as any) : {};
      },
    },
  } as any;

  prisma = (await import('../src/lib/prisma')).prisma;
  configMod = await import('../src/lib/aiProviderConfig');
  secretCrypto = await import('../src/lib/secretCrypto');
  route = await import('../src/app/api/admin/ai-config/route');
  idRoute = await import('../src/app/api/admin/ai-config/[id]/route');
  activateRoute = await import('../src/app/api/admin/ai-config/[id]/activate/route');
  catalogRoute = await import('../src/app/api/admin/ai-config/catalog/route');
});

after(async () => {
  if (prisma) {
    await prisma.aiProvider.deleteMany({});
    await prisma.$disconnect();
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
});

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
const get = () =>
  route.GET(new Request('http://localhost:3000/api/admin/ai-config'));

test('S-01 API Key disimpan terenkripsi (tidak ada plaintext di baris DB)', async () => {
  const res = await post({
    provider: 'openrouter',
    label: 'Uji OpenRouter',
    apiKey: FAKE_KEY,
    primaryModel: 'vendor/model-uji',
  });
  assert.equal(res.status, 201, 'provider harus tersimpan');

  const row = await prisma.aiProvider.findFirst({ where: { provider: 'openrouter' } });
  assert.ok(row, 'baris provider harus ada');
  assert.ok(row.apiKeyCipher, 'ciphertext harus terisi');
  assert.ok(secretCrypto.isEncrypted(row.apiKeyCipher), 'format ciphertext harus v1:...');
  assert.equal(row.apiKeyCipher.includes(FAKE_KEY), false, 'ciphertext tidak boleh memuat plaintext');
  assert.equal(
    JSON.stringify(row).includes(FAKE_KEY),
    false,
    'seluruh baris tidak boleh memuat plaintext API Key'
  );
  // Nilai asli hanya bisa diperoleh dengan dekripsi.
  assert.equal(secretCrypto.decryptSecret(row.apiKeyCipher), FAKE_KEY, 'dekripsi harus mengembalikan nilai asli');
});

test('S-02 respons GET tidak pernah memuat apiKey / apiKeyCipher', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes('apiKeyCipher'), false, 'field apiKeyCipher tidak boleh ada di respons');
  assert.equal(text.includes(FAKE_KEY), false, 'nilai API Key tidak boleh ada di respons');
  const data = JSON.parse(text);
  for (const p of data.providers) {
    assert.equal('apiKeyCipher' in p, false);
    assert.equal('apiKey' in p, false);
    assert.equal(typeof p.hasApiKey, 'boolean');
  }
  assert.equal(data.encryptionReady, true, 'encryptionReady harus true (kunci uji aktif)');
});

test('S-03 tiga provider dapat dikonfigurasi berdiri sendiri', async () => {
  for (const provider of ['gemini', 'groq'] as const) {
    const res = await post({
      provider,
      label: `Uji ${provider}`,
      apiKey: `${FAKE_KEY}-${provider}`,
      primaryModel: provider === 'gemini' ? 'gemini-uji' : 'llama-uji',
    });
    assert.equal(res.status, 201, `${provider} harus tersimpan`);
  }
  const rows = await prisma.aiProvider.findMany({ orderBy: { provider: 'asc' } });
  assert.equal(rows.length, 3, 'harus ada 3 provider');
  const ciphers = new Set(rows.map((r: any) => r.apiKeyCipher));
  assert.equal(ciphers.size, 3, 'tiap provider punya ciphertext sendiri');
  for (const r of rows) {
    assert.equal(JSON.stringify(r).includes(FAKE_KEY), false, 'tidak ada plaintext');
  }
});

test('S-04 mengganti provider aktif tidak menghapus konfigurasi provider lain', async () => {
  // Fixture: model berstatus gratis TERVERIFIKASI agar provider boleh diaktifkan.
  for (const provider of ['openrouter', 'gemini', 'groq']) {
    const modelId = provider === 'gemini' ? 'gemini-uji' : provider === 'groq' ? 'llama-uji' : 'vendor/model-uji';
    await prisma.aiModelPolicy.upsert({
      where: { provider_modelId: { provider, modelId } },
      create: {
        provider,
        modelId,
        freeStatus: 'VERIFIED_FREE',
        evidenceUrl: 'https://example.invalid/evidence',
        verifiedAt: new Date(),
        notes: 'fixture tes',
      },
      update: { freeStatus: 'VERIFIED_FREE', verifiedAt: new Date() },
    });
  }

  const before = await prisma.aiProvider.findMany({ orderBy: { provider: 'asc' } });
  const target = before.find((r: any) => r.provider === 'groq');

  const res = await activate(target.id);
  assert.equal(res.status, 200, 'aktivasi harus berhasil');

  const after = await prisma.aiProvider.findMany({ orderBy: { provider: 'asc' } });
  assert.equal(after.length, 3, 'jumlah provider tidak berubah');
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].id, before[i].id, 'id tidak berubah');
    assert.equal(after[i].apiKeyCipher, before[i].apiKeyCipher, 'kunci provider lain tidak berubah');
    assert.equal(after[i].primaryModel, before[i].primaryModel, 'model provider lain tidak berubah');
  }
  assert.equal(after.filter((r: any) => r.isActive).length, 1, 'tetap satu provider aktif');
});

test('S-05 API Key kosong saat edit = kunci lama dipertahankan', async () => {
  const row = await prisma.aiProvider.findFirst({ where: { provider: 'openrouter' } });
  const before = row.apiKeyCipher;

  const res = await patch(row.id, { label: 'Uji OpenRouter (label baru)', apiKey: '' });
  assert.equal(res.status, 200, 'edit label harus berhasil');

  const after = await prisma.aiProvider.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(after.apiKeyCipher, before, 'ciphertext lama harus dipertahankan');
  assert.equal(after.label, 'Uji OpenRouter (label baru)');
});

test('S-06 respons katalog tidak memuat rahasia', async () => {
  const res = await catalogRoute.GET(
    new Request('http://localhost:3000/api/admin/ai-config/catalog?provider=openrouter')
  );
  const text = await res.text();
  assert.equal(text.includes(FAKE_KEY), false, 'katalog tidak boleh memuat API Key');
  assert.equal(text.includes('apiKeyCipher'), false);
});

test('S-07 tanpa APP_ENCRYPTION_KEY: penyimpanan kunci DITOLAK (tanpa plaintext)', async () => {
  const keyBackup = process.env.APP_ENCRYPTION_KEY;
  delete process.env.APP_ENCRYPTION_KEY;
  try {
    const res = await post({
      provider: 'openrouter',
      label: 'Uji tanpa kunci',
      apiKey: `${FAKE_KEY}-tanpa-kunci`,
      primaryModel: 'vendor/model-uji',
    });
    assert.equal(res.status, 400, 'harus ditolak tanpa kunci enkripsi');
    const body = await res.json();
    assert.ok(
      /APP_ENCRYPTION_KEY/i.test(String(body.error)),
      'pesan harus menjelaskan bahwa kunci enkripsi belum ada'
    );
    // Tidak boleh ada plaintext yang tersimpan.
    const rows = await prisma.aiProvider.findMany();
    assert.equal(
      JSON.stringify(rows).includes(`${FAKE_KEY}-tanpa-kunci`),
      false,
      'API Key tidak boleh tersimpan tanpa kunci enkripsi'
    );
  } finally {
    process.env.APP_ENCRYPTION_KEY = keyBackup;
  }
});

test('S-08 hanya SATU provider boleh aktif (invarian)', async () => {
  const rows = await prisma.aiProvider.findMany({ where: { isActive: true } });
  assert.equal(rows.length, 1, 'tepat satu provider aktif');
});

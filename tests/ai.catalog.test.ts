/**
 * TAHAP 6 — TES KATALOG MODEL, STATUS GRATIS, NORMALISASI RESPONS PROVIDER,
 *           VERIFIKASI MANUAL, DAN DIAGNONSTIK KONEKSI.
 *
 * Semua OFFLINE:
 *  - Database: SALINAN `prisma/dev.db` di TEMP (gate `PRAGMA database_list`).
 *  - Provider: `global.fetch` di-stub (tidak ada request ke provider nyata).
 *  - Sesi: modul `auth` di-stub agar guard `requireAdmin()` teruji.
 *  - Tidak ada WhatsApp, tidak ada request generasi AI, tidak ada biaya token.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const TMP = mkdtempSync(path.join(tmpdir(), 'tahap6-catalog-'));
const COPY = path.join(TMP, 'copy.db');

if (!existsSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'))) {
  throw new Error('prisma/dev.db tidak ditemukan');
}
copyFileSync(path.join(PROJECT_ROOT, 'prisma', 'dev.db'), COPY);
process.env.DATABASE_URL = `file:${COPY.replace(/\\/g, '/')}`;
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt-secret-uji-tahap6';

let prisma: any;
let providers: any;
let policy: any;
let catalog: any;
let catalogRoute: any;
let verifyRoute: any;

let currentSession: any = null;
let realFetch: any;

const ADMIN = { userId: 'admin-uji', role: 'ADMIN' as const, email: 'a@b.c', isActive: true };

/* ==========================================================================
   Helper
   ========================================================================== */

/** Stub fetch global dengan peta URL → respons tiruan. */
function stubFetch(routes: Record<string, { status?: number; body: any }>) {
  (globalThis as any).fetch = async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      };
    }
    const r = routes[key];
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  };
}

async function seedProvider(provider: string, key: string) {
  const { encryptSecret } = await import('../src/lib/secretCrypto');
  return prisma.aiProvider.create({
    data: {
      provider,
      label: provider,
      apiKeyCipher: key ? encryptSecret(key) : null,
      isActive: false,
      primaryModel: null,
      fallbackModels: JSON.stringify([]),
    },
  });
}

/* ==========================================================================
   Lifecycle
   ========================================================================== */

before(async () => {
  // Stub modul `auth` → `requireAdmin()` menguji sesi (401 tanpa sesi).
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
  providers = await import('../src/lib/aiProviders');
  policy = await import('../src/lib/aiModelPolicy');
  catalog = await import('../src/lib/aiCatalog');
  catalogRoute = await import('../src/app/api/admin/ai-config/catalog/route');
  verifyRoute = await import('../src/app/api/admin/ai-config/verify-models/route');

  realFetch = (globalThis as any).fetch;
});

after(async () => {
  (globalThis as any).fetch = realFetch;
  if (prisma) {
    try {
      await prisma.aiModelPolicy.deleteMany({});
      await prisma.aiProvider.deleteMany({});
      await prisma.$disconnect();
    } catch {
      /* abaikan */
    }
  }
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* abaikan */
  }
});

beforeEach(async () => {
  (globalThis as any).fetch = realFetch;
  await prisma.aiModelPolicy.deleteMany({});
  await prisma.aiProvider.deleteMany({});
  currentSession = { ...ADMIN };
});

/* ==========================================================================
   1. Normalisasi respons provider (penyebab AI_PROVIDER_ERROR saat HTTP 200)
   ========================================================================== */

test('extractTextContent menerima message.content bertipe string', () => {
  const r = providers.extractTextContent({ choices: [{ message: { content: 'Halo' } }] });
  assert.equal(r.text, 'Halo');
  assert.match(r.shape, /string/);
});

test('extractTextContent menerima message.content berupa array of parts', () => {
  const r = providers.extractTextContent({
    choices: [{ message: { content: [{ type: 'text', text: 'Bagian A' }, { type: 'text', text: 'Bagian B' }] } }],
  });
  assert.equal(r.text, 'Bagian A\nBagian B');
  assert.match(r.shape, /array/);
});

test('extractTextContent memakai reasoning_content bila content kosong', () => {
  const r = providers.extractTextContent({
    choices: [{ message: { content: '', reasoning_content: 'Hasil reasoning' } }],
  });
  assert.equal(r.text, 'Hasil reasoning');
  assert.match(r.shape, /reasoning/);
});

test('extractTextContent mendukung bentuk lama choices[0].text', () => {
  const r = providers.extractTextContent({ choices: [{ text: 'Jawaban lama' }] });
  assert.equal(r.text, 'Jawaban lama');
});

test('extractTextContent mengembalikan bentuk tak dikenal bila tidak ada teks', () => {
  const r = providers.extractTextContent({ choices: [{ message: {} }] });
  assert.equal(r.text, '');
  assert.equal(r.shape, 'tidak dikenal');
});

/* ==========================================================================
   2. Penjelasan error yang aman untuk tiap kategori
   ========================================================================== */

test('setiap kategori error punya penjelasan yang mudah dipahami', () => {
  const kinds = [
    'AI_AUTH_FAILED',
    'AI_QUOTA',
    'AI_RATE_LIMIT',
    'AI_MODEL_GONE',
    'AI_TIMEOUT',
    'AI_NOT_CONFIGURED',
    'AI_PROVIDER_ERROR',
  ];
  for (const k of kinds) {
    const text = providers.explainProviderError(k);
    assert.ok(text && text.length > 20, `kategori ${k} belum punya penjelasan`);
    assert.doesNotMatch(text, /sk-|Bearer|cipher/i);
  }
});

test('explainProviderError aman untuk kode tak dikenal & null', () => {
  assert.equal(providers.explainProviderError(null), '');
  const t = providers.explainProviderError('AI_DARI_LANGIT');
  assert.match(t, /AI_DARI_LANGIT/);
});

/* ==========================================================================
   3. Pembacaan harga katalog
   ========================================================================== */

test('readCatalogPricing membaca harga 0 sebagai gratis &-absen sebagai null', () => {
  const gratis = catalog.readCatalogPricing({ pricing: { prompt: '0', completion: '0' } });
  assert.equal(gratis.prompt, '0');
  assert.equal(gratis.known, true);

  const tanpa = catalog.readCatalogPricing({ id: 'x' });
  assert.equal(tanpa.prompt, null);
  assert.equal(tanpa.known, false);
});

/* ==========================================================================
   4. Pengambilan katalog resmi (mocked)
   ========================================================================== */

test('katalog OpenRouter membawa harga & status któlasifikasi', async () => {
  stubFetch({
    'openrouter.ai/api/v1/models': {
      body: {
        data: [
          {
            id: 'vendor/claim:free',
            name: 'Claim Free',
            context_length: 8192,
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'] },
          },
          {
            id: 'vendor/bayar',
            name: 'Bayar',
            pricing: { prompt: '0.000001', completion: '0.000002' },
          },
        ],
      },
    },
  });

  const res = await catalog.fetchProviderCatalog('openrouter');
  assert.equal(res.error, null);
  assert.equal(res.models.length, 2);

  const gratis = res.models.find((m: any) => m.id === 'vendor/claim:free');
  assert.equal(gratis.pricingKnown, true);
  assert.equal(gratis.pricingPrompt, '0');
  assert.equal(gratis.supportsChat, true);

  const bayar = res.models.find((m: any) => m.id === 'vendor/bayar');
  assert.equal(bayar.pricingKnown, true);
  assert.equal(bayar.pricingPrompt, '0.000001');

  // Klasifikasi status gratis memakai harga katalog.
  const cls = policy.classifyFreeStatus({
    modelId: gratis.id,
    pricingPrompt: gratis.pricingPrompt,
    pricingCompletion: gratis.pricingCompletion,
  });
  assert.equal(cls.freeStatus, 'VERIFIED_FREE');

  const clsBayar = policy.classifyFreeStatus({
    modelId: bayar.id,
    pricingPrompt: bayar.pricingPrompt,
    pricingCompletion: bayar.pricingCompletion,
  });
  assert.equal(clsBayar.freeStatus, 'PAID');
});

test('katalog Gemini melepas prefix models/ dan menandai model non-chat', async () => {
  await seedProvider('gemini', 'kunci-uji-gemini');
  stubFetch({
    'generativelanguage.googleapis.com': {
      body: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            inputTokenLimit: 1048576,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Embedding 004',
            supportedGenerationMethods: ['embedContent'],
          },
        ],
      },
    },
  });

  const res = await catalog.fetchProviderCatalog('gemini');
  assert.equal(res.error, null);
  assert.equal(res.models.length, 2);

  const flash = res.models.find((m: any) => m.id === 'gemini-2.5-flash');
  assert.equal(flash.id, 'gemini-2.5-flash');
  assert.equal(flash.supportsChat, true);
  assert.equal(flash.contextLength, 1048576);
  // Katalog Gemini tidak mencantumkan harga.
  assert.equal(flash.pricingKnown, false);
  assert.equal(flash.pricingPrompt, null);

  const embed = res.models.find((m: any) => m.id === 'text-embedding-004');
  assert.equal(embed.supportsChat, false);
});

test('katalog Gemini gagal dengan alasan jelas bila API Key belum tersimpan', async () => {
  const res = await catalog.fetchProviderCatalog('gemini');
  assert.equal(res.models.length, 0);
  assert.match(String(res.error), /API Key/);
});

test('katalog Gemini gagal dengan alasan jelas bila APP_ENCRYPTION_KEY salah', async () => {
  await seedProvider('gemini', 'kunci-uji-gemini');
  const lama = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = 'bukan-kunci-yang-valid';
  try {
    const res = await catalog.fetchProviderCatalog('gemini');
    assert.equal(res.models.length, 0);
    assert.match(String(res.error), /APP_ENCRYPTION_KEY|kunci/i);
  } finally {
    process.env.APP_ENCRYPTION_KEY = lama;
  }
});

/* ==========================================================================
   5. Status gratis tanpa bukti harga (Gemini & Groq)
   ========================================================================== */

test('katalog tanpa harga → Gemini ACCOUNT_DEPENDENT, Groq UNVERIFIED', () => {
  const gemini = policy.classifyWithoutPriceEvidence('gemini');
  assert.equal(gemini.freeStatus, 'ACCOUNT_DEPENDENT');
  assert.match(gemini.notes, /tier akun/i);
  assert.match(gemini.notes, /https:\/\//);

  const groq = policy.classifyWithoutPriceEvidence('groq');
  assert.equal(groq.freeStatus, 'UNVERIFIED');
  assert.match(groq.notes, /tidak dapat dibuktikan otomatis/i);
});

test('halaman rujukan resmi benar-benar domain resmi', () => {
  for (const [provider, domains] of Object.entries(policy.OFFICIAL_EVIDENCE_DOMAINS)) {
    const hint = policy.MANUAL_VERIFICATION_HINTS[provider];
    assert.ok(hint, `hints tidak ada untuk ${provider}`);
    const host = new URL(hint.url).hostname;
    assert.ok(
      domains.some((d) => host === d || host.endsWith(`.${d}`)),
      `URL rujukan ${provider} bukan domain resmi`
    );
  }
});

/* ==========================================================================
   6. Verifikasi manual (dengan penjaga domain resmi + katalog)
   ========================================================================== */

test('verifikasi manual menolak URL non-resmi', async () => {
  const r = await policy.manuallyVerifyModel({
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    evidenceUrl: 'https://blog-seorang-随机.example.com/harga',
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /domain resmi/);
});

test('verifikasi manual menolak model yang tidak ada di katalog resmi', async () => {
  const r = await policy.manuallyVerifyModel({
    provider: 'gemini',
    modelId: 'model-hantu',
    evidenceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    knownModelIds: ['gemini-2.5-flash'],
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /tidak ditemukan pada katalog resmi/);
});

test('verifikasi manual menerima URL resmi & mencatat sumber "manual"', async () => {
  const r = await policy.manuallyVerifyModel({
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    evidenceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Free tier berlaku selama penagihan belum diaktifkan.',
    knownModelIds: ['gemini-2.5-flash'],
    status: 'ACCOUNT_DEPENDENT',
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'ACCOUNT_DEPENDENT');

  const row = await prisma.aiModelPolicy.findUnique({
    where: { provider_modelId: { provider: 'gemini', modelId: 'gemini-2.5-flash' } },
  });
  assert.equal(row.freeStatus, 'ACCOUNT_DEPENDENT');
  assert.equal(row.verificationSource, 'manual');
  assert.equal(row.evidenceUrl, 'https://ai.google.dev/gemini-api/docs/pricing');
  assert.match(row.notes, /penagihan/);

  // Status ACCOUNT_DEPENDENT — tidak boleh dipakai sebagai model utama atau fallback.
  assert.equal(await policy.getModelStatus('gemini', 'gemini-2.5-flash'), 'ACCOUNT_DEPENDENT');
  assert.equal(await policy.isAllowedStatus('ACCOUNT_DEPENDENT'), false);
});

test('verifikasi otomatis TIDAK menimpa verifikasi manual', async () => {
  await policy.manuallyVerifyModel({
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    evidenceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    knownModelIds: ['gemini-2.5-flash'],
    status: 'ACCOUNT_DEPENDENT',
  });

  // Simulasi refresh katalog (Gemini tidak punya harga → ACCOUNT_DEPENDENT).
  const outcome = await policy.upsertPolicyRow({
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    freeStatus: 'ACCOUNT_DEPENDENT',
    evidenceUrl: 'https://ai.google.dev/pricing',
    notes: 'katalog tidak mencantumkan harga',
    verifiedAt: new Date(),
  });
  assert.equal(outcome, 'kept-manual');
  assert.equal(await policy.getModelStatus('gemini', 'gemini-2.5-flash'), 'ACCOUNT_DEPENDENT');
});

test('bukti berbayar dari katalog tetap menang atas verifikasi manual', async () => {
  await policy.manuallyVerifyModel({
    provider: 'openrouter',
    modelId: 'vendor/model',
    evidenceUrl: 'https://openrouter.ai/models',
    knownModelIds: ['vendor/model'],
  });
  const outcome = await policy.upsertPolicyRow({
    provider: 'openrouter',
    modelId: 'vendor/model',
    freeStatus: 'PAID',
    evidenceUrl: 'https://openrouter.ai/models',
    notes: 'harga non-zero',
    verifiedAt: new Date(),
  });
  assert.equal(outcome, 'written');
  assert.equal(await policy.getModelStatus('openrouter', 'vendor/model'), 'PAID');
});

/* ==========================================================================
   7. Endpoint katalog (RBAC + isi respons)
   ========================================================================== */

test('endpoint katalog menolak tanpa sesi Admin (401)', async () => {
  currentSession = null;
  const res = await catalogRoute.GET(
    new Request('http://localhost/api/admin/ai-config/catalog?provider=openrouter')
  );
  assert.equal(res.status, 401);
});

test('endpoint katalog menampilkan SEMUA model + statusnya (tidak menyembunyikan)', async () => {
  await seedProvider('gemini', 'kunci-uji-gemini');
  stubFetch({
    'generativelanguage.googleapis.com': {
      body: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      },
    },
  });

  const res = await catalogRoute.GET(
    new Request('http://localhost/api/admin/ai-config/catalog?provider=gemini')
  );
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.models.length, 2);
  assert.ok(data.fetchedAt, 'harus ada indikator katalog terakhir diperbarui');
  assert.equal(data.summary.total, 2);
  assert.equal(data.summary.accountDependent, 2);
  assert.equal(data.summary.unverified, 0);
  assert.equal(data.summary.verifiedFree, 0);

  for (const m of data.models) {
    assert.equal(m.freeStatus, 'ACCOUNT_DEPENDENT');
    assert.equal(m.selectable, false);
    assert.ok(m.freeReason && m.freeReason.length > 10, 'alasan penolakan wajib diisi');
    assert.ok(m.freeStatusLabel);
  }
  // Rujukan resmi untuk verifikasi manual.
  assert.ok(data.hint?.url?.startsWith('https://ai.google.dev/'));
});

test('endpoint katalog menandai model gratis sebagai selectable', async () => {
  await seedProvider('openrouter', 'kunci-uji-or');
  stubFetch({
    'openrouter.ai/api/v1/models': {
      body: {
        data: [
          {
            id: 'vendor/claim:free',
            name: 'Claim Free',
            pricing: { prompt: '0', completion: '0' },
          },
        ],
      },
    },
  });

  const res = await catalogRoute.GET(
    new Request('http://localhost/api/admin/ai-config/catalog?provider=openrouter')
  );
  const data = await res.json();
  assert.equal(data.models[0].freeStatus, 'VERIFIED_FREE');
  assert.equal(data.models[0].selectable, true);
  assert.equal(data.summary.verifiedFree, 1);
});

test('endpoint katalog menolak provider tak dikenal', async () => {
  const res = await catalogRoute.GET(
    new Request('http://localhost/api/admin/ai-config/catalog?provider=ngawur')
  );
  assert.equal(res.status, 400);
});

/* ==========================================================================
   8. Endpoint verifikasi manual
   ========================================================================== */

test('endpoint verifikasi manual menolak URL non-resmi & model asing', async () => {
  await seedProvider('gemini', 'kunci-uji-gemini');
  stubFetch({
    'generativelanguage.googleapis.com': {
      body: {
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      },
    },
  });

  const res = await verifyRoute.POST(
    new Request('http://localhost/api/admin/ai-config/verify-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manual: [
          {
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            evidenceUrl: 'https://contoh-bukan-resmi.example.com',
          },
        ],
      }),
    })
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.equal(data.failed, 1);
  assert.match(String(data.results[0].error), /domain resmi/);

  // Tidak ada baris yang ditulis.
  assert.equal(await prisma.aiModelPolicy.count(), 0);
});

test('endpoint verifikasi manual menerima bukti resmi model yang ada di katalog', async () => {
  await seedProvider('gemini', 'kunci-uji-gemini');
  stubFetch({
    'generativelanguage.googleapis.com': {
      body: {
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      },
    },
  });

  const res = await verifyRoute.POST(
    new Request('http://localhost/api/admin/ai-config/verify-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manual: [
          {
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
            evidenceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
            notes: 'Free tier AI Studio, penagihan belum diaktifkan.',
          },
        ],
      }),
    })
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(await policy.getModelStatus('gemini', 'gemini-2.5-flash'), 'ACCOUNT_DEPENDENT');
});

test('endpoint verifikasi manual menolak tanpa sesi Admin (401)', async () => {
  currentSession = null;
  const res = await verifyRoute.POST(
    new Request('http://localhost/api/admin/ai-config/verify-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual: [] }),
    })
  );
  assert.equal(res.status, 401);
});

/* ==========================================================================
   9. Diagnostik koneksi tersimpan
   ========================================================================== */

test('recordProviderValidation menyimpan kategori + detail aman', async () => {
  const row = await seedProvider('openrouter', 'kunci-uji-or');
  const { recordProviderValidation } = await import('../src/lib/aiProviderConfig');

  await recordProviderValidation(
    row.id,
    false,
    'AI_RATE_LIMIT',
    'Provider openrouter · model vendor/x · HTTP 429 · kategori AI_RATE_LIMIT'
  );

  const saved = await prisma.aiProvider.findUnique({ where: { id: row.id } });
  assert.equal(saved.lastError, 'AI_RATE_LIMIT');
  assert.match(String(saved.lastErrorDetail), /HTTP 429/);
  assert.ok(saved.lastValidation);

  // Sukses → detail dikosongkan.
  await recordProviderValidation(row.id, true, null);
  const ok = await prisma.aiProvider.findUnique({ where: { id: row.id } });
  assert.equal(ok.lastError, null);
  assert.equal(ok.lastErrorDetail, null);
});

/**
 * TAHAP 4.6 & 4.7 — VALIDASI ADAPTER PROVIDER AI & INTEGRASI PIPELINE.
 *
 * Semua OFFLINE:
 *  - `global.fetch` di-stub → tidak ada request ke provider sungguhan.
 *  - SDK Gemini tidak memanggil jaringan pada jalur uji ini (kunci kosong
 *    ditolak lebih dulu, dan jalur SDK diverifikasi lewat pemeriksaan kode).
 *
 * Cakupan:
 *  - Bentuk request tiap provider (OpenRouter, Groq, Gemini) — berbeda-beda.
 *  - Autentikasi tiap provider (Bearer vs SDK Gemini).
 *  - Klasifikasi error, timeout, validasi respons.
 *  - Pengamanan secret (kunci tidak pernah bocor ke error/log).
 *  - Semua pipeline P1–P6 membaca konfigurasi pusat (tanpa model hardcode).
 *  - Riwayat percakapan tetap in-memory (TTL & batas sesi tak berubah).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');

const FAKE_KEY = 'sk-uji-FAKE-KEY-000000000000';

let providers: any;
let realFetch: typeof globalThis.fetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string, init: any) => Response) {
  globalThis.fetch = (async (url: any, init: any) => handler(String(url), init ?? {})) as typeof fetch;
}

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===========================================================================
// T-4.6.1 : bentuk request tiap provider
// ===========================================================================

test('T-4.6.1a OpenRouter: endpoint, header Bearer + HTTP-Referer/X-Title, body OpenAI', async () => {
  providers = await import('../src/lib/aiProviders');
  const spec = providers.getProviderSpec('openrouter')!;
  assert.equal(spec.endpoint, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(spec.style, 'openai-compatible');

  let captured: any = null;
  stubFetch((url, init) => {
    captured = { url, headers: init.headers, body: JSON.parse(String(init.body)) };
    return jsonResponse({ choices: [{ message: { content: 'halo' } }] });
  });

  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'vendor/model',
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ],
    maxTokens: 321,
    temperature: 0.2,
  });

  assert.equal(res.ok, true);
  assert.equal(captured.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(captured.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.ok(captured.headers['HTTP-Referer'], 'OpenRouter memakai header HTTP-Referer');
  assert.ok(captured.headers['X-Title'], 'OpenRouter memakai header X-Title');
  assert.equal(captured.body.model, 'vendor/model');
  assert.equal(captured.body.max_tokens, 321);
  assert.equal(captured.body.temperature, 0.2);
  assert.equal(captured.body.messages.length, 2);
  assert.equal(captured.body.messages[0].role, 'system');
});

test('T-4.6.1b Groq: endpoint sendiri, header Bearer, TANPA header khusus OpenRouter', async () => {
  const spec = providers.getProviderSpec('groq')!;
  assert.equal(spec.endpoint, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(spec.style, 'openai-compatible');
  assert.equal(spec.verified, false, 'Groq belum diverifikasi terhadap API nyata');

  let captured: any = null;
  stubFetch((url, init) => {
    captured = { url, headers: init.headers, body: JSON.parse(String(init.body)) };
    return jsonResponse({ choices: [{ message: { content: 'halo' } }] });
  });

  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 64,
  });

  assert.equal(res.ok, true);
  assert.equal(captured.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(captured.headers.Authorization, `Bearer ${FAKE_KEY}`);
  // Header khusus OpenRouter TIDAK boleh dikirim ke Groq.
  assert.equal(captured.headers['HTTP-Referer'], undefined);
  assert.equal(captured.headers['X-Title'], undefined);
  // Bentuk body tetap OpenAI-compatible.
  assert.equal(captured.body.model, 'llama-3.3-70b-versatile');
  assert.equal(captured.body.max_tokens, 64);
  assert.deepEqual(captured.body.messages, [{ role: 'user', content: 'ping' }]);
});

test('T-4.6.1c Gemini: memakai SDK dengan kunci eksplisit, bukan process.env', async () => {
  const spec = providers.getProviderSpec('gemini')!;
  assert.equal(spec.style, 'gemini-sdk');
  assert.ok(spec.endpoint.startsWith('https://generativelanguage.googleapis.com/'));

  // Autentikasi Gemini memakai SDK → kunci diteruskan eksplisit.
  const src = read('src/lib/aiProviders.ts');
  assert.ok(
    /new GoogleGenerativeAI\(options\.apiKey\)/.test(src),
    'Gemini harus memakai kunci yang diteruskan eksplisit'
  );
  assert.equal(
    /process\.env\.GEMINI_API_KEY/.test(src),
    false,
    'adapter tidak boleh membaca kunci Gemini dari process.env'
  );

  // Kunci kosong → ditolak tanpa menyentuh jaringan.
  let called = false;
  stubFetch(() => {
    called = true;
    return jsonResponse({});
  });
  const res = await providers.callProvider(spec, {
    apiKey: '',
    model: 'gemini-1.5-flash',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'AI_NOT_CONFIGURED');
  assert.equal(called, false, 'tidak boleh ada request jaringan tanpa kunci');
});

test('T-4.6.1d model kosong → ditolak sebelum request (AI_NOT_CONFIGURED)', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  let called = false;
  stubFetch(() => {
    called = true;
    return jsonResponse({});
  });
  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: '',
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'AI_NOT_CONFIGURED');
  assert.equal(called, false);
});

// ===========================================================================
// T-4.6.2 : klasifikasi error, timeout, validasi respons
// ===========================================================================

test('T-4.6.2a status HTTP dipetakan ke errorKind yang benar', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  const cases: [number, string][] = [
    [401, 'AI_AUTH_FAILED'],
    [403, 'AI_AUTH_FAILED'],
    [402, 'AI_QUOTA'],
    [404, 'AI_MODEL_GONE'],
    [429, 'AI_RATE_LIMIT'],
    [500, 'AI_PROVIDER_ERROR'],
    [503, 'AI_PROVIDER_ERROR'],
  ];
  for (const [status, expected] of cases) {
    stubFetch(() => new Response('x', { status }));
    const res = await providers.callOpenAiCompatibleProvider(spec, {
      apiKey: FAKE_KEY,
      model: 'm',
      messages: [{ role: 'user', content: 'p' }],
    });
    assert.equal(res.ok, false);
    assert.equal(res.errorKind, expected, `status ${status} → ${expected}`);
    assert.equal(res.content, null, 'tidak boleh ada jawaban saat gagal');
  }
});

test('T-4.6.2b timeout → AI_TIMEOUT', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  stubFetch(
    (_url, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener?.('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      }) as any
  );
  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'm',
    messages: [{ role: 'user', content: 'p' }],
    timeoutMs: 30,
  });
  assert.equal(res.ok, false);
  assert.equal(res.errorKind, 'AI_TIMEOUT');
});

test('T-4.6.2c respons tidak valid (tanpa choices) → AI_PROVIDER_ERROR, tanpa mengarang', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  stubFetch(() => jsonResponse({ weird: true }));
  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'm',
    messages: [{ role: 'user', content: 'p' }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.content, null);
  assert.equal(res.errorKind, 'AI_PROVIDER_ERROR');
});

test('T-4.6.2d respons 200 tapi konten kosong → dianggap gagal, bukan jawaban kosong', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  stubFetch(() => jsonResponse({ choices: [{ message: { content: '   ' } }] }));
  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'm',
    messages: [{ role: 'user', content: 'p' }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.content, null);
});

// ===========================================================================
// T-4.6.3 : pengaman secret
// ===========================================================================

test('T-4.6.3a kunci API tidak pernah bocor ke pesan error / detail', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  stubFetch(() => new Response(`bad key ${FAKE_KEY} here`, { status: 400 }));
  const res = await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'm',
    messages: [{ role: 'user', content: 'p' }],
  });
  assert.equal(res.ok, false);
  assert.equal(String(res.error).includes(FAKE_KEY), false);
  assert.equal(JSON.stringify(res).includes(FAKE_KEY), false, 'objek hasil tidak boleh memuat kunci');
});

test('T-4.6.3b redactSecret mengganti kemunculan kunci', () => {
  const out = providers.redactSecret(`token=${FAKE_KEY} selesai`, FAKE_KEY);
  assert.equal(out.includes(FAKE_KEY), false);
  assert.ok(out.includes('[REDACTED]'));
});

test('T-4.6.3c isi request tidak pernah menyertakan kunci di body', async () => {
  const spec = providers.getProviderSpec('openrouter')!;
  let body = '';
  stubFetch((_url, init) => {
    body = String(init.body);
    return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
  });
  await providers.callOpenAiCompatibleProvider(spec, {
    apiKey: FAKE_KEY,
    model: 'm',
    messages: [{ role: 'user', content: 'rahasia' }],
  });
  assert.equal(body.includes(FAKE_KEY), false, 'kunci hanya boleh di header Authorization');
});

// ===========================================================================
// T-4.7.1 : semua pipeline membaca konfigurasi pusat
// ===========================================================================

test('T-4.7.1a pipeline P1–P6 membaca konfigurasi provider terpusat', () => {
  const centralized = [
    'src/lib/aiChat.ts',
    'src/lib/aiService.ts',
    'src/lib/duplicates.ts',
    'src/lib/gemini.ts',
    'src/lib/aiTools.ts',
  ];
  for (const file of centralized) {
    const src = read(file);
    assert.ok(
      /resolveAiProviderChain|resolveActiveAiProvider/.test(src),
      `${file} harus membaca konfigurasi provider terpusat`
    );
  }
  for (const file of ['src/app/api/ai/chat/route.ts', 'src/app/api/admin/ai/chat/route.ts']) {
    const src = read(file);
    assert.ok(/resolveActiveAiProvider/.test(src), `${file} harus status koneksi dari config DB`);
    assert.equal(
      /!!process\.env\.OPENROUTER_API_KEY/.test(src),
      false,
      `${file} tidak boleh memakai env sebagai penentu koneksi`
    );
  }
});

test('T-4.7.1b tidak ada model hardcode di pipeline (FALLBACK_MODELS pun)', () => {
  const forbidden = ['openai/gpt-4o-mini', 'gemini-3.8-flash'];
  for (const file of [
    'src/lib/aiChat.ts',
    'src/lib/aiService.ts',
    'src/lib/duplicates.ts',
    'src/lib/aiTools.ts',
  ]) {
    const src = read(file);
    for (const model of forbidden) {
      assert.equal(src.includes(model), false, `${file} tidak boleh memakai "${model}"`);
    }
  }
  const chat = read('src/lib/aiChat.ts');
  assert.equal(/const FALLBACK_MODELS\s*=/.test(chat), false, 'FALLBACK_MODELS harus hilang');
});

test('T-4.7.1c metadata transparansi ada di respons chat', () => {
  const src = read('src/lib/aiChat.ts');
  for (const field of ['usedProvider', 'usedModel', 'fallbackModels', 'providerChain', 'fallbackProvider']) {
    assert.ok(src.includes(field), `meta.${field} harus dilaporkan`);
  }
  // UI menampilkan badge fallback.
  const ui = read('src/components/ui/AdminAiAssistant.tsx');
  assert.ok(/Dijawab model cadangan/.test(ui), 'UI harus menampilkan indikator fallback');
});

// ===========================================================================
// T-4.7.2 : riwayat percakapan tetap in-memory (tidak dipindah ke DB)
// ===========================================================================

test('T-4.7.2a riwayat percakapan tetap in-memory & tidak disimpan permanen', () => {
  const src = read('src/lib/aiSessionStore.ts');
  assert.ok(!/prisma/i.test(src), 'aiSessionStore tidak boleh memakai Prisma (riwayat tetap in-memory)');
  assert.ok(/TTL|ttl/i.test(src), 'TTL sesi harus dipertahankan');
  assert.ok(/MAX_SESSION|MAX_SESSIONS|maxSessions/i.test(src), 'batas jumlah sesi harus dipertahankan');
  // Tidak boleh ada model/tabel baru untuk riwayat chat.
  const schema = read('prisma/schema.prisma');
  assert.equal(/model (ChatSession|ChatMessage|ChatHistory)\b/.test(schema), false);
});

test('T-4.7.2b store sesi tetap punya TTL 2 jam, 200 sesi, 16 giliran', () => {
  const src = read('src/lib/aiSessionStore.ts');
  assert.ok(/2\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src), 'TTL 2 jam harus dipertahankan');
  assert.ok(/200/.test(src), 'batas 200 sesi harus dipertahankan');
  assert.ok(/16/.test(src), 'batas 16 giliran harus dipertahankan');
});

// ===========================================================================
// T-4.7.3 : aturan kapan fallback boleh terjadi
// ===========================================================================

test('T-4.7.3a fallback hanya untuk kegagalan yang memang mengizinkan', () => {
  const spec = providers.getProviderSpec('openrouter')!;
  // 401/403 → berhenti total.
  assert.equal(providers.shouldTryFallback('AI_AUTH_FAILED'), false);
  // 402 → berhenti untuk provider itu (tapi boleh ganti provider).
  assert.equal(providers.shouldTryFallback('AI_QUOTA'), false);
  // sisanya boleh.
  for (const kind of ['AI_RATE_LIMIT', 'AI_MODEL_GONE', 'AI_TIMEOUT', 'AI_PROVIDER_ERROR']) {
    assert.equal(providers.shouldTryFallback(kind), true, `${kind} boleh fallback`);
  }
  // Provider belum dikonfigurasi → tidak ada percobaan diam-diam.
  assert.equal(providers.shouldTryFallback('AI_NOT_CONFIGURED'), false);
  void spec;
});

test('T-4.7.3b rantai model dibatasi 4 dan utama selalu dicoba pertama', () => {
  const aiChat = require('../src/lib/aiChat');
  const chain = aiChat.activeModelChain('utama', ['c1', 'c2', 'c3', 'c4', 'c5']);
  assert.equal(chain[0], 'utama', 'model utama selalu pertama');
  assert.equal(chain.length, 4, 'rantai dibatasi 4 model');
});

test('T-4.7.3c model utama tidak boleh jadi model cadangan', async () => {
  const aiProviderConfig = await import('../src/lib/aiProviderConfig');
  // Fungsi murni: validasi ditolak bila model utama muncul di daftar cadangan.
  const src = read('src/lib/aiProviderConfig.ts');
  assert.ok(
    /Model utama tidak boleh sekaligus menjadi model cadangan/.test(src),
    'validasi model utama vs cadangan harus ada'
  );
  void aiProviderConfig;
});

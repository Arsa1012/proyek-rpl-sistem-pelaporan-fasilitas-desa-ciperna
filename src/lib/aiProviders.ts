/**
 * ADAPTER PROVIDER AI — satu tempat untuk bentuk request & klasifikasi error.
 *
 * Tiga provider didukung:
 *  - OpenRouter  → OpenAI-compatible (`/api/v1/chat/completions`)
 *  - Groq        → OpenAI-compatible (`/openai/v1/chat/completions`)
 *  - Gemini      → SDK `@google/generative-ai` (key diteruskan eksplisit)
 *
 * Prinsip:
 *  1. Satu adapter untuk OpenRouter & Groq karena bentuk request-nya sama.
 *     Bentuk Groq HANYA diasumsikan "OpenAI-compatible" (tidak/belum
 *     diverifikasi terhadap API nyata) — lihat catatan di `AI_PROVIDER_SPECS`.
 *  2. Klasifikasi kegagalan mengikuti aturan §10.3 spesifikasi Tahap 2:
 *     401/403 → AI_AUTH_FAILED (BERHENTI, jangan fallback),
 *     402     → AI_QUOTA (berhenti untuk provider itu),
 *     404     → AI_MODEL_GONE (coba model berikutnya),
 *     429     → AI_RATE_LIMIT (coba berikutnya),
 *     timeout → AI_TIMEOUT (coba berikutnya).
 *  3. TIDAK ADA rahasia yang masuk log/pesan: body provider disanitasi dan
 *     kemunculan API Key dihapus dari teks apa pun sebelum dicatat.
 *  4. Error yang dilempar/dikembalikan hanya berisi kode aman + pesan
 *     generik, bukan body mentah provider.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

export type AiProviderId = 'openrouter' | 'gemini' | 'groq';

export type AiProviderStyle = 'openai-compatible' | 'gemini-sdk';

/** Klasifikasi kegagalan provider (dipakai UI + log). */
export type AiErrorKind =
  | 'AI_OK'
  | 'AI_NOT_CONFIGURED'
  | 'AI_AUTH_FAILED'
  | 'AI_QUOTA'
  | 'AI_RATE_LIMIT'
  | 'AI_MODEL_GONE'
  | 'AI_TIMEOUT'
  | 'AI_PROVIDER_ERROR';

export interface AiProviderSpec {
  id: AiProviderId;
  label: string;
  /** Base URL endpoint chat completions. */
  endpoint: string;
  /** Bentuk request: OpenAI-compatible atau SDK Gemini. */
  style: AiProviderStyle;
  /** Nama env untuk key (hanya bootstrap saat tabel kosong). */
  envKey?: string;
  /** Nama env untuk model (hanya bootstrap). */
  envModel?: string;
  /** Provider ini mendukung multimodal (gambar). */
  supportsImages: boolean;
  /** Header khusus OpenRouter (HTTP-Referer/X-Title). */
  extraHeaders?: Record<string, string>;
  /** Catatan untuk ditampilkan di UI. */
  note: string;
  /**
   * True bila bentuk request provider ini SUDAH diverifikasi terhadap API
   * nyata. Groq = false (butuh 1 request uji, lihat R-17 spesifikasi).
   */
  verified: boolean;
}

export const AI_PROVIDER_SPECS: AiProviderSpec[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    style: 'openai-compatible',
    envKey: 'OPENROUTER_API_KEY',
    envModel: 'OPENROUTER_MODEL',
    supportsImages: true,
    extraHeaders: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Sistem Pelaporan Desa Ciperna',
    },
    note: 'Akses banyak model (teks & gambar). Katalog model diambil dari OpenRouter.',
    verified: true,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    style: 'gemini-sdk',
    envKey: 'GEMINI_API_KEY',
    envModel: 'GEMINI_MODEL',
    supportsImages: true,
    note: 'Digunakan untuk analisis gambar laporan. Kunci dipakai lewat SDK (diteruskan eksplisit).',
    verified: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    style: 'openai-compatible',
    envKey: 'GROQ_API_KEY',
    envModel: 'GROQ_MODEL',
    supportsImages: false,
    note: 'Bentuk request OpenAI-compatible (teks saja). Endpoint & body belum diverifikasi terhadap API nyata.',
    verified: false,
  },
];

export function getProviderSpec(id: string | null | undefined): AiProviderSpec | undefined {
  if (!id) return undefined;
  return AI_PROVIDER_SPECS.find((s) => s.id === id);
}

/** Daftar id provider yang valid (untuk validasi input). */
export const AI_PROVIDER_IDS: AiProviderId[] = AI_PROVIDER_SPECS.map((s) => s.id);

/**
 * Petakan status HTTP → jenis kesalahan.
 *
 * 401/403 = kunci tidak valid (konfigurasi) → berhenti.
 * 402     = kuota/kredit habis → berhenti untuk provider ini.
 * 404     = model hilang → coba model berikutnya.
 * 429     = rate limit → coba berikutnya.
 * 413     = prompt kebesaran → ditangani pemanggil.
 */
export function classifyProviderStatus(status: number | null | undefined): AiErrorKind {
  if (!status) return 'AI_PROVIDER_ERROR';
  if (status === 401 || status === 403) return 'AI_AUTH_FAILED';
  if (status === 402) return 'AI_QUOTA';
  if (status === 404) return 'AI_MODEL_GONE';
  if (status === 429) return 'AI_RATE_LIMIT';
  return 'AI_PROVIDER_ERROR';
}

/**
 * True bila kegagalan ini BOLEH dicoba ke model/provider berikutnya.
 *
 * Kunci invalid (401/403) dan kuota habis (402) TIDAK boleh fallback —
 * penyebabnya konfigurasi/kuota, bukan model. Fallback di situation itu
 * hanya menyembunyikan masalah dan memboroskan kuota.
 */
export function shouldTryFallback(kind: AiErrorKind): boolean {
  if (kind === 'AI_AUTH_FAILED' || kind === 'AI_QUOTA') return false;
  if (kind === 'AI_NOT_CONFIGURED') return false;
  return true;
}

/** Pesan aman (tanpa rahasia) untuk UI/log. */
export function providerErrorMessage(kind: AiErrorKind): string {
  switch (kind) {
    case 'AI_NOT_CONFIGURED':
      return 'Provider AI belum dikonfigurasi.';
    case 'AI_AUTH_FAILED':
      return 'Kunci API provider AI tidak valid.';
    case 'AI_QUOTA':
      return 'Kredit/kuota provider AI tidak mencukupi.';
    case 'AI_RATE_LIMIT':
      return 'Provider AI sedang membatasi permintaan (rate limit).';
    case 'AI_MODEL_GONE':
      return 'Model tidak tersedia di provider.';
    case 'AI_TIMEOUT':
      return 'Provider AI kehabisan waktu.';
    default:
      return 'Provider AI gagal merespons.';
  }
}

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderCallOptions {
  apiKey: string;
  model: string;
  messages: ProviderChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ProviderCallResult {
  ok: boolean;
  status: number | null;
  model: string;
  content: string | null;
  errorKind: AiErrorKind;
  /** Pesan aman (tanpa body mentah & tanpa rahasia). */
  error: string | null;
  latencyMs: number;
}

/**
 * Buang kemunculan API Key dari teks apa pun sebelum masuk log.
 * Melindungi bila provider memantulkan key di dalam pesan error.
 */
export function redactSecret(text: string, secret: string | null | undefined): string {
  let out = text || '';
  const s = (secret || '').trim();
  if (s.length >= 6) {
    out = out.split(s).join('[REDACTED]');
  }
  return out.replace(/\s+/g, ' ').slice(0, 400);
}

/**
 * Ambil teks jawaban dari berbagai bentuk respons provider.
 *
 * MASALAH YANG DIPERBAIKI: sebelumnya hanya `choices[0].message.content`
 * bertipe string yang diterima. Sebagian model (mis. model reasoning /
 * preview) mengembalikan:
 *  - `message.content` berupa ARRAY of parts (`[{type:'text',text:'…'}]`),
 *  - teks di `message.reasoning_content` sementara `content` kosong,
 *  - bentuk lama `choices[0].text`.
 * Semua itu sebelumnya salah dikira "respons tidak valid" → `AI_PROVIDER_ERROR`
 * meskipun HTTP-nya 200 (terbukti pada log: `status=200 hasil=AI_PROVIDER_ERROR`).
 *
 * `shape` dipakai untuk pesan diagnostik yang aman (tanpa isi respons).
 */
export function extractTextContent(data: any): { text: string; shape: string } {
  const choice = data?.choices?.[0];
  const message = choice?.message;

  // 1) Bentuk umum: message.content berupa string.
  if (typeof message?.content === 'string' && message.content.trim()) {
    return { text: message.content, shape: 'message.content (string)' };
  }

  // 2) Bentuk multimodal: message.content berupa array of parts.
  if (Array.isArray(message?.content)) {
    const parts = message.content
      .map((p: any) =>
        typeof p === 'string'
          ? p
          : typeof p?.text === 'string'
            ? p.text
            : typeof p?.content === 'string'
              ? p.content
              : ''
      )
      .filter((t: string) => Boolean(t && t.trim()));
    if (parts.length > 0) {
      return { text: parts.join('\n'), shape: 'message.content (array of parts)' };
    }
    return { text: '', shape: 'message.content (array kosong)' };
  }

  // 3) Model reasoning: teks ada di reasoning_content.
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return { text: message.reasoning_content, shape: 'message.reasoning_content' };
  }

  // 4) Bentuk lama (completions).
  if (typeof choice?.text === 'string' && choice.text.trim()) {
    return { text: choice.text, shape: 'choices[0].text' };
  }

  // 5) Bentuk "output" (Responses API).
  const outputText = data?.output_text;
  if (typeof outputText === 'string' && outputText.trim()) {
    return { text: outputText, shape: 'output_text' };
  }

  return { text: '', shape: 'tidak dikenal' };
}

/**
 * Penjelasan yang aman & mudah dipahami untuk setiap kategori error.
 * Dipakai UI agar Admin tidak hanya melihat kode seperti `AI_PROVIDER_ERROR`.
 */
export const PROVIDER_ERROR_EXPLANATION: Record<string, string> = {
  AI_AUTH_FAILED:
    'Kunci API ditolak provider (HTTP 401/403). Kunci salah, kedaluwarsa, atau tidak punya akses ke model tersebut.',
  AI_QUOTA:
    'Kuota/kredit provider habis (HTTP 402). Paket perlu diisi ulang atau penggunaan dibatasi.',
  AI_RATE_LIMIT:
    'Provider membatasi permintaan (HTTP 429). Free tier sedang ramai — coba lagi nanti atau pakai model cadangan.',
  AI_MODEL_GONE:
    'Model tidak tersedia di provider (HTTP 404). Model mungkin sudah diganti, di-rename, atau tidak tersedia untuk kunci ini.',
  AI_TIMEOUT:
    'Provider tidak menjawab dalam batas waktu. Timeout 20–45 detik.',
  AI_NOT_CONFIGURED:
    'Provider belum dikonfigurasi lengkap (kunci/model belum ada, atau tidak ada model gratis terverifikasi yang boleh dipakai).',
  AI_PROVIDER_ERROR:
    'Provider menjawab, tetapi responsnya tidak dapat dibaca (HTTP 200 tanpa teks, atau badan respons tidak sesuai).',
};

/**
 * Penjelasan aman untuk satu kode error.
 * Kode yang tidak dikenal tetap ditampilkan apa adanya (tanpa isi mentah).
 */
export function explainProviderError(code: string | null | undefined): string {
  if (!code) return '';
  return (
    PROVIDER_ERROR_EXPLANATION[code] ||
    `Kategori error "${code}". Rincian teknis tidak ditampilkan demi keamanan.`
  );
}

/**
 * Panggil provider OpenAI-compatible (OpenRouter & Groq).
 *
 * Tidak pernah melempar error HTTP mentah: kegagalan dikembalikan sebagai
 * `ProviderCallResult` dengan `errorKind` yang sudah diklasifikasi.
 */
export async function callOpenAiCompatibleProvider(
  spec: AiProviderSpec,
  options: ProviderCallOptions
): Promise<ProviderCallResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 25000;
  if (!options.apiKey) {
    return {
      ok: false,
      status: null,
      model: options.model,
      content: null,
      errorKind: 'AI_NOT_CONFIGURED',
      error: providerErrorMessage('AI_NOT_CONFIGURED'),
      latencyMs: 0,
    };
  }
  if (!options.model) {
    return {
      ok: false,
      status: null,
      model: '',
      content: null,
      errorKind: 'AI_NOT_CONFIGURED',
      error: 'Model utama belum dipilih.',
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(spec.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
        ...(spec.extraHeaders || {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 700,
        temperature: options.temperature ?? 0.35,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const detail = redactSecret(body, options.apiKey);
      const kind = classifyProviderStatus(res.status);
      console.error(
        `[AI:${spec.id}] gagal status=${res.status} model=${options.model} ` +
          `kinds=${kind}${detail ? ` detail=${detail}` : ''}`
      );
      return {
        ok: false,
        status: res.status,
        model: options.model,
        content: null,
        errorKind: kind,
        error: providerErrorMessage(kind),
        latencyMs: Date.now() - startedAt,
      };
    }
    const data: any = await res.json();
    const extracted = extractTextContent(data);
    if (!extracted.text) {
      console.error(
        `[AI:${spec.id}] respons HTTP ${res.status} tidak memuat teks model=${options.model} ` +
          `bentuk=${extracted.shape}`
      );
      return {
        ok: false,
        status: res.status,
        model: options.model,
        content: null,
        errorKind: 'AI_PROVIDER_ERROR',
        error:
          `Respons provider (HTTP ${res.status}) tidak memuat teks yang bisa dibaca ` +
          `(bentuk: ${extracted.shape}).`,
        latencyMs: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      status: res.status,
      model: options.model,
      content: extracted.text,
      errorKind: 'AI_OK',
      error: null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error(`[AI:${spec.id}] timeout ${timeoutMs}ms model=${options.model}`);
      return {
        ok: false,
        status: null,
        model: options.model,
        content: null,
        errorKind: 'AI_TIMEOUT',
        error: providerErrorMessage('AI_TIMEOUT'),
        latencyMs: Date.now() - startedAt,
      };
    }
    const msg = redactSecret(String(e?.message || 'error'), options.apiKey);
    console.error(`[AI:${spec.id}] exception name=${e?.name || 'unknown'} message=${msg}`);
    return {
      ok: false,
      status: null,
      model: options.model,
      content: null,
      errorKind: 'AI_PROVIDER_ERROR',
      error: providerErrorMessage('AI_PROVIDER_ERROR'),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Panggil Gemini lewat SDK. Kunci diteruskan EKSPLISIT (tidak hanya
 * `process.env`) supaya key dari database bisa dipakai tanpa ubah.
 */
export async function callGeminiProvider(
  spec: AiProviderSpec,
  options: ProviderCallOptions
): Promise<ProviderCallResult> {
  const startedAt = Date.now();
  if (!options.apiKey) {
    return {
      ok: false,
      status: null,
      model: options.model,
      content: null,
      errorKind: 'AI_NOT_CONFIGURED',
      error: providerErrorMessage('AI_NOT_CONFIGURED'),
      latencyMs: 0,
    };
  }
  if (!options.model) {
    return {
      ok: false,
      status: null,
      model: '',
      content: null,
      errorKind: 'AI_NOT_CONFIGURED',
      error: 'Model utama belum dipilih.',
      latencyMs: 0,
    };
  }
  try {
    const genAI = new GoogleGenerativeAI(options.apiKey);
    const model = genAI.getGenerativeModel({ model: options.model });
    const system = options.messages.find((m) => m.role === 'system')?.content || '';
    const rest = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'assistant' ? 'Asisten' : 'Pengguna'}: ${m.content}`)
      .join('\n\n');
    const prompt = system ? `${system}\n\n${rest}` : rest;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) {
      return {
        ok: false,
        status: 200,
        model: options.model,
        content: null,
        errorKind: 'AI_PROVIDER_ERROR',
        error: providerErrorMessage('AI_PROVIDER_ERROR'),
        latencyMs: Date.now() - startedAt,
      };
    }
    return {
      ok: true,
      status: 200,
      model: options.model,
      content: text,
      errorKind: 'AI_OK',
      error: null,
      latencyMs: Date.now() - startedAt,
    };
  } catch (e: any) {
    const msg = redactSecret(String(e?.message || 'error'), options.apiKey);
    console.error(`[AI:${spec.id}] exception name=${e?.name || 'unknown'} message=${msg}`);
    const status = typeof e?.status === 'number' ? e.status : null;
    const kind = status ? classifyProviderStatus(status) : 'AI_PROVIDER_ERROR';
    return {
      ok: false,
      status,
      model: options.model,
      content: null,
      errorKind: kind,
      error: providerErrorMessage(kind),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Dispatch ke adapter yang sesuai gaya provider. */
export async function callProvider(
  spec: AiProviderSpec,
  options: ProviderCallOptions
): Promise<ProviderCallResult> {
  if (spec.style === 'gemini-sdk') {
    return callGeminiProvider(spec, options);
  }
  return callOpenAiCompatibleProvider(spec, options);
}

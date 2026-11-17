/**
 * Layanan analisis AI untuk laporan kerusakan.
 *
 * Prinsip:
 *  - Hanya memakai data yang benar-benar ada pada laporan (judul, deskripsi,
 *    lokasi, foto bila tersedia). Tidak mengarang fakta.
 *  - Setiap keluaran DIVALIDASI sebelum disimpan. Respons tidak valid â†’ error
 *    terkontrol, bukan hasil palsu.
 *  - Bila kredensial AI belum dikonfigurasi, analisis DIANGGAP GAGAL dengan
 *    alasan yang aman. Tidak ada "mock" yang menampilkan hasil fiktif.
 *  - Hasil dipisahkan dari data laporan asli (lihat lib/reportAnalysis.ts).
 */

// KONFIGURASI PROVIDER AI terpusat (tabel AiProvider, dikelola Admin).
import { resolveAiProviderChain, type ProviderAttempt } from './aiProviderConfig';
import { getProviderSpec } from './aiProviders';

export type Severity = 'RENDAH' | 'SEDANG' | 'TINGGI' | 'KRITIS';

export interface AIAnalysisResult {
  category: string;
  damageType: string;
  severity: Severity;
  confidence: number;
  summary: string;
  recommendation: string;
  aiResult: string;
  /** Alasan mengapa tingkat urgensi dipilih. */
  urgencyReason: string;
  /** Alasan klasifikasi (kategori/jenis/urgensi) berdasarkan data. */
  reasons: string[];
  /** Fakta yang benar-benar tertulis/terlihat pada laporan. */
  facts: string[];
  /** Informasi yang belum tersedia pada data. */
  missing: string[];
  /** Tindakan yang disarankan (bukan keputusan final). */
  suggestedAction: string;
  /** Model/provider yang benar-benar dipakai. */
  model: string;
  provider: string;
}

export type AnalysisErrorCode =
  | 'not_configured'
  | 'invalid_output'
  | 'upstream'
  | 'rate_limit'
  | 'timeout'
  | 'unknown';

export class AnalysisError extends Error {
  code: AnalysisErrorCode;
  constructor(code: AnalysisErrorCode, message?: string) {
    super(message || code);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

/** Pesan aman untuk ditampilkan ke pengguna (tanpa detail internal). */
export function mapAnalysisError(err: unknown): { code: AnalysisErrorCode; message: string } {
  const code: AnalysisErrorCode =
    err instanceof AnalysisError
      ? err.code
      : err instanceof Error && /abort|timeout/i.test(err.message)
        ? 'timeout'
        : 'unknown';

  switch (code) {
    case 'not_configured':
      return {
        code,
        message: 'Analisis AI belum dikonfigurasi di server (kredensial AI tidak tersedia). Laporan tetap tersimpan.',
      };
    case 'invalid_output':
      return {
        code,
        message: 'Hasil analisis AI tidak valid sehingga tidak disimpan. Silakan jalankan analisis ulang.',
      };
    case 'timeout':
      return {
        code,
        message: 'Layanan analisis AI terlalu lama merespons. Silakan coba lagi.',
      };
    case 'upstream':
      return {
        code,
        message: 'Layanan analisis AI sedang tidak tersedia. Silakan coba lagi nanti.',
      };
    case 'rate_limit':
      return {
        code,
        message:
          'Layanan analisis AI sedang dibatasi kuota (terlalu banyak permintaan). ' +
          'Tunggu beberapa menit, lalu jalankan analisis ulang.',
      };
    default:
      return {
        code,
        message: 'Analisis AI gagal. Laporan tetap tersimpan; silakan coba analisis ulang.',
      };
  }
}

const ALLOWED_CATEGORIES = [
  'Jalan',
  'Lampu Jalan',
  'Trotoar',
  'Drainase',
  'Taman',
  'Jembatan',
  'Fasilitas Umum Lainnya',
];

const SEVERITIES: Severity[] = ['RENDAH', 'SEDANG', 'TINGGI', 'KRITIS'];

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function strArray(v: unknown, maxItems = 8, maxLen = 500): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Validasi + normalisasi keluaran model. Melempar AnalysisError('invalid_output')
 * bila struktur wajib tidak terpenuhi. Dipakai juga oleh unit test.
 */
export function validateAnalysis(
  raw: any,
  meta: { model: string; provider: string }
): AIAnalysisResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AnalysisError('invalid_output', 'root bukan object');
  }

  const category = str(raw.category, 200);
  const damageType = str(raw.damageType, 200);
  const severity = str(raw.severity, 20).toUpperCase() as Severity;
  const summary = str(raw.summary, 3000);
  const recommendation = str(raw.recommendation, 3000);
  const aiResult = str(raw.aiResult, 200);
  const confidenceRaw = Number(raw.confidence);

  if (!category) throw new AnalysisError('invalid_output', 'category kosong');
  if (!damageType) throw new AnalysisError('invalid_output', 'damageType kosong');
  if (!SEVERITIES.includes(severity)) throw new AnalysisError('invalid_output', 'severity tidak valid');
  if (!summary) throw new AnalysisError('invalid_output', 'summary kosong');
  if (!recommendation) throw new AnalysisError('invalid_output', 'recommendation kosong');
  if (!aiResult) throw new AnalysisError('invalid_output', 'aiResult kosong');
  if (!Number.isFinite(confidenceRaw)) throw new AnalysisError('invalid_output', 'confidence tidak valid');

  const confidence = Math.max(0, Math.min(99, Math.round(confidenceRaw)));

  return {
    // Kategori di luar daftar tetap disimpan apa adanya (model bisa memberi
    // nama lebih spesifik), tetapi ditandai agar UI dapat menampilkannya.
    category: ALLOWED_CATEGORIES.includes(category) ? category : category,
    damageType,
    severity,
    confidence,
    summary,
    recommendation,
    aiResult,
    urgencyReason: str(raw.urgencyReason, 1500),
    reasons: strArray(raw.reasons),
    facts: strArray(raw.facts),
    missing: strArray(raw.missing),
    suggestedAction: str(raw.suggestedAction, 1500),
    model: meta.model,
    provider: meta.provider,
  };
}

function buildPrompt(description: string, title: string, location: string): string {
  return `Kamu adalah asisten analisis laporan kerusakan fasilitas umum DESA CIPERNA.
Analisis HANYA berdasarkan data laporan di bawah. Jangan mengarang lokasi, tingkat
bahaya, penyebab, ukuran, atau fakta apa pun yang tidak tertulis/terlihat.

Data laporan:
- Judul: ${title}
- Lokasi tertulis: ${location}
- Deskripsi: ${description}
${'(Foto, bila ada, dilampirkan. Jangan mengklaim telah memeriksa fisik di lapangan.)'}

Kembalikan HANYA JSON valid dengan struktur berikut:
{
  "category": "salah satu: ${ALLOWED_CATEGORIES.join(', ')}",
  "damageType": "jenis kerusakan spesifik, 3-5 kata",
  "severity": "RENDAH | SEDANG | TINGGI | KRITIS",
  "confidence": angka 0-99 (keyakinan analisis, bukan jaminan kebenaran),
  "summary": "ringkasan 2-3 kalimat, hanya berdasarkan data",
  "reasons": ["alasan klasifikasi kategori/urgensi berdasarkan data", "..."],
  "urgencyReason": "alasan spesifik mengapa urgensi dipilih",
  "facts": ["fakta yang benar-benar tertulis/terlihat", "..."],
  "missing": ["informasi yang belum tersedia dan dibutuhkan", "..."],
  "recommendation": "rekomendasi tindak lanjut, 1-2 kalimat",
  "suggestedAction": "langkah konkret berikutnya untuk Admin/Petugas (bukan keputusan final)",
  "aiResult": "label singkat kategori + jenis kerusakan"
}

Aturan tambahan:
- Jika data kurang, tulis kekurangannya di "missing" dan turunkan "confidence".
- Jika foto tidak ada, jangan menyimpulkan kondisi visual.
- Jangan menyatakan laporan sudah diverifikasi/diperiksa fisik.
- "reasons" harus merujuk pada kata/frasa pada data, bukan asumsi umum.`;
}

function parseJsonFromText(text: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw new AnalysisError('invalid_output', 'JSON tidak dapat diparse');
  }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 40000;
// Timeout panggilan Gemini SDK. SDK @google/generative-ai tidak mendukung
// AbortSignal pada generateContent, sehingga diguard dengan Promise.race:
// tanpa guard ini, hang jaringan membuat handler tidak pernah selesai dan
// laporan terjebak pada status ANALYZING selamanya.
const GEMINI_TIMEOUT_MS = Math.max(5000, Number(process.env.GEMINI_TIMEOUT_MS) || 45000);

/**
 * Analisis laporan memakai KONFIGURASI PROVIDER terpusat.
 *
 * Rantai percobaan:
 *   provider aktif → model utama → model cadangan → provider berikutnya.
 *
 * Tidak ada lagi model hardcode (nama model lama sudah dihapus) maupun
 * urutan "Gemini dulu lalu OpenRouter" yang tersembunyi: Admin yang
 * menentukan provider, model utama, dan urutan model cadangan di
 * /admin/ai-config. Bila tabel provider masih kosong, konfigurasi `.env`
 * dipakai sebagai bootstrap (instalasi baru).
 *
 * Melempar AnalysisError dengan kode aman bila gagal.
 */
export async function analyzeReport(
  imageBase64: string | null,
  mimeType: string | null,
  description: string,
  title: string,
  location: string
): Promise<AIAnalysisResult> {
  const chain = await resolveAiProviderChain();

  if (chain.attempts.length === 0) {
    console.error(
      '[aiService] Tidak ada provider AI yang bisa dipakai:',
      chain.problems[0] || 'konfigurasi provider tidak ditemukan'
    );
    throw new AnalysisError('not_configured');
  }

  let lastError: unknown = null;

  for (const attempt of chain.attempts) {
    // Provider tanpa dukungan gambar hanya boleh menganalisis teks.
    const canUseImage = Boolean(imageBase64 && mimeType);
    if (canUseImage && !providerSupportsImages(attempt.provider)) {
      console.error(
        `[aiService] Provider "${attempt.providerLabel}" tidak mendukung gambar; analisis teks saja.`
      );
    }

    const models = attempt.modelChain.length > 0 ? attempt.modelChain : attempt.primaryModel ? [attempt.primaryModel] : [];
    for (const modelName of models) {
      if (!modelName) continue;
      try {
        return await analyzeWithProvider(
          attempt,
          modelName,
          canUseImage ? imageBase64 : null,
          canUseImage ? mimeType : null,
          description,
          title,
          location
        );
      } catch (error) {
        lastError = error;
        console.error(
          `[aiService] ${attempt.providerLabel}/${modelName} gagal:`,
          error instanceof Error ? error.message : error
        );
        // Kunci invalid → berhenti di provider ini (jangan ulangi model lain).
        if (error instanceof AnalysisError && error.code === 'upstream' && isAuthError(error)) {
          break;
        }
        // Model berikutnya dicoba; provider berikutnya dicoba setelah model habis.
      }
    }
  }

  if (lastError instanceof AnalysisError) throw lastError;
  throw new AnalysisError('upstream');
}

/** Apakah provider mendukung analisis gambar? */
function providerSupportsImages(provider: string): boolean {
  const spec = getProviderSpec(provider);
  return spec?.supportsImages ?? false;
}

/** Deteksi error autentikasi (401/403) dari pesan analisis. */
function isAuthError(error: AnalysisError): boolean {
  return /401|403|unauthor|forbidden|api key|kunci/i.test(error.message || '');
}

async function analyzeWithProvider(
  attempt: ProviderAttempt,
  modelName: string,
  imageBase64: string | null,
  mimeType: string | null,
  description: string,
  title: string,
  location: string
): Promise<AIAnalysisResult> {
  if (attempt.provider === 'gemini') {
    return analyzeWithGemini(
      attempt.apiKey,
      modelName,
      imageBase64,
      mimeType,
      description,
      title,
      location
    );
  }
  return analyzeWithOpenAiCompatible(
    attempt,
    modelName,
    imageBase64,
    mimeType,
    description,
    title,
    location
  );
}

async function analyzeWithGemini(
  apiKey: string,
  modelName: string,
  imageBase64: string | null,
  mimeType: string | null,
  description: string,
  title: string,
  location: string
): Promise<AIAnalysisResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = buildPrompt(description, title, location);
  const parts: any[] = [prompt];
  if (imageBase64 && mimeType) {
    parts.push({
      inlineData: {
        mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        data: imageBase64,
      },
    });
  }

  const t0 = Date.now();
  let text: string;
  try {
    // Guard timeout: SDK @google/generative-ai tidak menerima AbortSignal pada
    // generateContent, jadi kita race dengan timer. Timer memakai aman-settle
    // (tidak pernah melempar di jalur sukses) agar tidak ada unhandled rejection.
    let timerFired = false;
    const timer = new Promise<never>((resolve) => {
      setTimeout(() => {
        timerFired = true;
        resolve(undefined as never);
      }, GEMINI_TIMEOUT_MS);
    });
    const responsePromise = model.generateContent(parts) as ReturnType<typeof model.generateContent>;
    const result = await Promise.race([
      responsePromise.then((r) => ({ kind: 'ok' as const, r })),
      timer.then(() => ({ kind: 'timeout' as const })),
    ]);
    if (result.kind === 'timeout' || timerFired) {
      console.error(`[aiService] Gemini timeout setelah ${GEMINI_TIMEOUT_MS} ms`);
      throw new AnalysisError('timeout');
    }
    text = String(result.r.response.text() || '').trim();
  } catch (e: any) {
    if (e instanceof AnalysisError) throw e;
    // 429 / RESOURCE_EXHAUSTED = kuota provider (bukan layanan mati).
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(String(e?.message || ''))) {
      console.error('[aiService] Gemini dibatasi kuota:', e?.message || e);
      throw new AnalysisError('rate_limit');
    }
    if (/abort|timeout/i.test(String(e?.message || ''))) {
      throw new AnalysisError('timeout');
    }
    console.error('[aiService] Gemini gagal:', e?.message || e);
    throw new AnalysisError('upstream');
  }

  let parsed: any;
  try {
    parsed = parseJsonFromText(text);
  } catch (e) {
    console.error(`[aiService] Output Gemini tidak valid (${Date.now() - t0} ms)`);
    throw e instanceof AnalysisError ? e : new AnalysisError('invalid_output');
  }

  return validateAnalysis(parsed, { model: modelName, provider: 'gemini' });
}
/**
 * Analisis lewat provider OpenAI-compatible (OpenRouter & Groq).
 *
 * Bentuk request identik untuk keduanya: `Authorization: Bearer <key>` +
 * body `model`/`messages`. Groq memakai bentuk ini berdasarkan asumsi
 * OpenAI-compatible (belum diverifikasi terhadap API nyata).
 */
async function analyzeWithOpenAiCompatible(
  attempt: ProviderAttempt,
  modelName: string,
  imageBase64: string | null,
  mimeType: string | null,
  description: string,
  title: string,
  location: string
): Promise<AIAnalysisResult> {
  const apiKey = attempt.apiKey;
  const spec = getProviderSpec(attempt.provider);
  const endpoint = spec?.endpoint || OPENROUTER_URL;
  const prompt = buildPrompt(description, title, location);

  const content: any[] = [{ type: 'text', text: prompt }];
  if (imageBase64 && mimeType && spec?.supportsImages) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${imageBase64}` },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  const t0 = Date.now();

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': 'Sistem Pelaporan Desa Ciperna',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
        max_tokens: 1400,
      }),
    });

    if (!res.ok) {
      console.error(`[aiService] ${attempt.provider} status ${res.status} (${Date.now() - t0} ms)`);
      // 429 = kuota provider terbatasi, bukan layanan mati — beri pesan berbeda.
      if (res.status === 429) throw new AnalysisError('rate_limit');
      // 401/403 = kunci tidak valid → masalah konfigurasi, bukan model.
      if (res.status === 401 || res.status === 403) {
        throw new AnalysisError('upstream', `Kunci API tidak valid (status ${res.status})`);
      }
      throw new AnalysisError('upstream');
    }

    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content || '';
    if (!text.trim()) throw new AnalysisError('invalid_output', 'respons kosong');

    let parsed: any;
    try {
      parsed = parseJsonFromText(text);
    } catch (e) {
      console.error(`[aiService] Output ${attempt.provider} tidak valid (${Date.now() - t0} ms)`);
      throw e instanceof AnalysisError ? e : new AnalysisError('invalid_output');
    }

    return validateAnalysis(parsed, { model: modelName, provider: attempt.provider });
  } catch (e: any) {
    if (e instanceof AnalysisError) throw e;
    if (e?.name === 'AbortError' || /abort|timeout/i.test(String(e?.message || ''))) {
      throw new AnalysisError('timeout');
    }
    console.error(`[aiService] ${attempt.provider} gagal:`, e?.message || e);
    throw new AnalysisError('upstream');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Apakah provider AI nyata sudah dikonfigurasi?
 *
 * Mengambil keputusan dari konfigurasi terpusat (tabel `AiProvider`) dengan
 * fallback ke `.env` HANYA bila tabel masih kosong (instalasi baru).
 */
export async function isRealAIConfigured(): Promise<boolean> {
  try {
    const chain = await resolveAiProviderChain();
    return chain.attempts.length > 0;
  } catch {
    return !!(process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY);
  }
}

/**
 * Nama provider + model untuk ditampilkan pada diagnostik/log (bukan rahasia).
 *
 * Membaca KONFIGURASI TERPUSAT (tabel `AiProvider`), bukan `.env`.
 * Fungsi sinkron tidak lagi dapat acces konfigurasi terpusat (butuh I/O),
 * jadi versi asinkron `getAIProviderInfo()` yang dipakai di pipeline.
 *
 * @deprecated gunakan `getAIProviderInfo()` (versi async, sumber konfigurasi terpusat).
 */
export async function getAIProviderName(): Promise<string> {
  const info = await getAIProviderInfo();
  if (!info.provider) return 'Tidak dikonfigurasi';
  return info.model ? `${info.label || info.provider} (${info.model})` : String(info.label || info.provider);
}

/** Info provider aktif dari konfigurasi terpusat (aman untuk log/diagnostik). */
export async function getAIProviderInfo(): Promise<{
  provider: string | null;
  model: string | null;
  source: string;
  label: string | null;
}> {
  try {
    const chain = await resolveAiProviderChain();
    const first = chain.attempts[0];
    return {
      provider: first?.provider ?? null,
      model: first?.primaryModel ?? null,
      source: chain.source,
      label: first?.providerLabel ?? null,
    };
  } catch {
    return { provider: null, model: null, source: 'error', label: null };
  }
}



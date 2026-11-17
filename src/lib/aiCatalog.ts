/**
 * PENGAMBILAN KATALOG RESMI MODEL AI.
 *
 * Terpisah dari route HTTP supaya:
 *  - logika pengambilan data bisa dipakai ulang (route katalog, route
 *    verifikasi manual, verifikasi kebijakan) tanpa duplikasi, dan
 *  - bisa diuji offline dengan `fetch` tiruan.
 *
 * ATURAN:
 *  - Hanya request GET metadata ke katalog resmi provider. TIDAK ada request
 *    generasi AI, jadi tidak ada biaya token.
 *  - API Key hanya dipakai pada endpoint katalog yang memang butuh
 *    autentikasi (Gemini: parameter `key`; Groq: header `Authorization`),
 *    sesuai konvensi provider — dan tidak pernah dicetak/disimpan.
 *  - Tidak pernah melempar; kegagalan → daftar kosong + `error` yang aman.
 *  - Tidak pernah mengembalikan isi respons mentah ke klien (hanya metadata
 *    yang relevan: id, nama, konteks, harga, metode generasi).
 */
import { prisma } from '@/lib/prisma';
import { decryptSecret, SecretCryptoError } from './secretCrypto';

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  contextLength: number | null;
  /** Harga dari katalog (null = katalog tidak mencantumkan harga). */
  pricingPrompt: string | null;
  pricingCompletion: string | null;
  /** true bila katalog mencantumkan harga. */
  pricingKnown: boolean;
  /** true bila model mendukung chat/generateContent. */
  supportsChat: boolean;
  /** Metode generasi yang didukung (Gemini). */
  generationMethods: string[];
}

export interface ProviderCatalogResult {
  models: ProviderCatalogEntry[];
  /** Alasan kegagalan yang aman (tanpa secret). null bila sukses. */
  error: string | null;
  fetchedAt: string;
}

export const CATALOG_FETCH_TIMEOUT_MS = 8000;

type Fetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<any>;

/** Baca harga dari objek katalog OpenRouter. */
export function readCatalogPricing(model: any): {
  prompt: string | null;
  completion: string | null;
  known: boolean;
} {
  const pricing = model?.pricing;
  const prompt = typeof pricing?.prompt === 'string' ? pricing.prompt : null;
  const completion = typeof pricing?.completion === 'string' ? pricing.completion : null;
  return { prompt, completion, known: prompt !== null || completion !== null };
}

/**
 * Ambil katalog model resmi satu provider.
 *
 * `fetcher` dapat ditukar (untuk tes offline).
 */
export async function fetchProviderCatalog(
  provider: string,
  fetcher: Fetcher = fetch as any
): Promise<ProviderCatalogResult> {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);

  try {
    if (provider === 'openrouter') {
      // Katalog OpenRouter bersifat publik (GET, tanpa key).
      const res = await fetcher('https://openrouter.ai/api/v1/models', {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res || !res.ok) {
        return {
          models: [],
          error: `Katalog resmi OpenRouter tidak dapat dibaca (HTTP ${res?.status ?? '-'}).`,
          fetchedAt,
        };
      }
      const data: any = await res.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      const models = list
        .map((m: any) => {
          const pricing = readCatalogPricing(m);
          const inputMods: string[] = Array.isArray(m?.architecture?.input_modalities)
            ? m.architecture.input_modalities.map((x: any) => String(x))
            : [];
          return {
            id: String(m?.id || ''),
            name: String(m?.name || m?.id || ''),
            contextLength:
              typeof m?.context_length === 'number' ? m.context_length : null,
            pricingPrompt: pricing.prompt,
            pricingCompletion: pricing.completion,
            pricingKnown: pricing.known,
            supportsChat: inputMods.length === 0 ? true : inputMods.includes('text'),
            generationMethods: [],
          } as ProviderCatalogEntry;
        })
        .filter((m: ProviderCatalogEntry) => Boolean(m.id))
        .slice(0, 500);
      return {
        models,
        error: models.length === 0 ? 'Katalog resmi OpenRouter tidak memuat model.' : null,
        fetchedAt,
      };
    }

    if (provider === 'groq') {
      const key = await getProviderKey('groq');
      if (!key.key) {
        return { models: [], error: key.error, fetchedAt };
      }
      const res = await fetcher('https://api.groq.com/openai/v1/models', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${key.key}` },
        signal: controller.signal,
      });
      if (!res || !res.ok) {
        return {
          models: [],
          error: `Katalog resmi Groq tidak dapat dibaca (HTTP ${res?.status ?? '-'}).`,
          fetchedAt,
        };
      }
      const data: any = await res.json();
      const list = Array.isArray(data?.data) ? data.data : [];
      const models = list
        .map((m: any) => ({
          id: String(m?.id || ''),
          name: String(m?.id || ''),
          contextLength: null,
          // Katalog Groq tidak mencantumkan harga.
          pricingPrompt: null,
          pricingCompletion: null,
          pricingKnown: false,
          supportsChat: true,
          generationMethods: [],
        }))
        .filter((m: ProviderCatalogEntry) => Boolean(m.id))
        .slice(0, 300);
      return {
        models,
        error: models.length === 0 ? 'Katalog resmi Groq tidak memuat model.' : null,
        fetchedAt,
      };
    }

    if (provider === 'gemini') {
      const key = await getProviderKey('gemini');
      if (!key.key) {
        return { models: [], error: key.error, fetchedAt };
      }
      const res = await fetcher(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key.key)}`,
        { headers: { Accept: 'application/json' }, signal: controller.signal }
      );
      if (!res || !res.ok) {
        return {
          models: [],
          error: `Katalog resmi Gemini tidak dapat dibaca (HTTP ${res?.status ?? '-'}).`,
          fetchedAt,
        };
      }
      const data: any = await res.json();
      const list = Array.isArray(data?.models) ? data.models : [];
      const models = list
        .filter((m: any) => typeof m?.name === 'string' && m.name.includes('models/'))
        .map((m: any) => {
          const methods: string[] = Array.isArray(m?.supportedGenerationMethods)
            ? m.supportedGenerationMethods.map((x: any) => String(x))
            : [];
          return {
            id: String(m.name).replace(/^models\//, ''),
            name: String(m?.displayName || m.name),
            contextLength:
              typeof m?.inputTokenLimit === 'number' ? m.inputTokenLimit : null,
            // Katalog Gemini TIDAK mencantumkan harga → status gratis tidak
            // dapat dibuktikan otomatis (bergantung tier akun).
            pricingPrompt: null,
            pricingCompletion: null,
            pricingKnown: false,
            // Hanya model yang mendukung generateContent yang cocok untuk chat.
            supportsChat: methods.length === 0 ? true : methods.includes('generateContent'),
            generationMethods: methods,
          } as ProviderCatalogEntry;
        })
        .slice(0, 300);
      return {
        models,
        error: models.length === 0 ? 'Katalog resmi Gemini tidak memuat model.' : null,
        fetchedAt,
      };
    }

    return { models: [], error: `Provider "${provider}" tidak dikenal.`, fetchedAt };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return {
        models: [],
        error: `Katalog resmi ${provider} tidak merespons dalam ${CATALOG_FETCH_TIMEOUT_MS / 1000} detik.`,
        fetchedAt,
      };
    }
    console.error(`[aiCatalog] provider=${provider} gagal: ${e?.message || 'error'}`);
    return {
      models: [],
      error: `Katalog resmi ${provider} gagal dibaca.`,
      fetchedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Daftar id model resmi provider (untuk penjaga verifikasi manual). */
export async function fetchProviderCatalogIds(provider: string): Promise<string[]> {
  const { models } = await fetchProviderCatalog(provider);
  return models.map((m) => m.id);
}

/**
 * Ambil API Key provider dari database (terenkripsi).
 * Kunci TIDAK pernah dikembalikan ke klien maupun dicetak.
 *
 * `error` berisi alasan aman bila kunci tidak bisa dipakai.
 */
export async function getProviderKey(
  provider: string
): Promise<{ key: string; error: string | null }> {
  try {
    const row = await prisma.aiProvider.findFirst({
      where: { provider },
      select: { apiKeyCipher: true },
    });
    if (!row?.apiKeyCipher) {
      return {
        key: '',
        error: `API Key ${provider} belum tersimpan sehingga katalog resmi tidak dapat dibaca.`,
      };
    }
    const key = decryptSecret(row.apiKeyCipher);
    if (!key) {
      return {
        key: '',
        error: `API Key ${provider} tersimpan kosong sehingga katalog resmi tidak dapat dibaca.`,
      };
    }
    return { key, error: null };
  } catch (e) {
    const code = e instanceof SecretCryptoError ? e.code : 'decrypt_failed';
    return {
      key: '',
      error:
        code === 'encryption_key_missing'
          ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server sehingga kunci provider tidak dapat dibaca.'
          : code === 'encryption_key_invalid'
            ? 'APP_ENCRYPTION_KEY tidak valid sehingga kunci provider tidak dapat dibaca.'
            : `Kunci ${provider} tidak dapat didekripsi (kunci server berubah atau data rusak).`,
    };
  }
}

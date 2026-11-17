/**
 * KEBIJAKAN MODEL GRATIS — bukti status gratis per model.
 *
 * TUJUAN
 *  - Menentukan status gratis sebuah model HANYA dari sumber resmi provider:
 *      (a) katalog resmi provider yang secara eksplisit menyatakan gratis
 *          (OpenRouter: id berakhiran `:free` DAN/ATAU `pricing` 0),
 *      (b) dokumentasi harga resmi / free tier resmi.
 *  - Model tanpa bukti → `UNVERIFIED` → **tidak boleh** dipakai sebagai model
 *    utama maupun sebagai fallback otomatis (fail-closed).
 *  - Model yang terbukti berbayar → `PAID` → **dilarang** dipakai.
 *
 * ATURAN KETAT
 *  1. TIDAK pernah mengarang status gratis. Tanpa bukti resmi → UNVERIFIED.
 *  2. TIDAK pernah mengarang `evidenceUrl` — hanya URL resmi provider.
 *  3. TIDAK pernah mengirim request inferensi (completion) untuk menebak
 *     status gratis. Hanya request METADATA katalog (GET, tanpa biaya token).
 *  4. TIDAK pernah menyimpan API Key, ciphertext, atau secret apa pun di tabel
 *     kebijakan maupun di log.
 *  5. Nama model TIDAK PERNAH dijadikan bukti gratis (mis. "Flash" ≠ gratis).
 *
 * TABEL: `AiModelPolicy` (additive) — berisi metadata publik saja.
 */
import { prisma } from '@/lib/prisma';
import { decryptSecret } from './secretCrypto';

export type FreeStatus = 'VERIFIED_FREE' | 'ACCOUNT_DEPENDENT' | 'UNVERIFIED' | 'PAID';

export const FREE_STATUS_VERIFIED_FREE: FreeStatus = 'VERIFIED_FREE';
export const FREE_STATUS_ACCOUNT_DEPENDENT: FreeStatus = 'ACCOUNT_DEPENDENT';
export const FREE_STATUS_UNVERIFIED: FreeStatus = 'UNVERIFIED';
export const FREE_STATUS_PAID: FreeStatus = 'PAID';

/**
 * Sumber bukti RESMI per provider.
 *
 * Hanya URL dokumentasi resmi provider — tidak ada URL karangan.
 * `catalog` = endpoint katalog resmi (GET metadata, tanpa biaya token).
 */
export const OFFICIAL_EVIDENCE: Record<
  string,
  { catalog: string | null; docs: string }
> = {
  openrouter: {
    catalog: 'https://openrouter.ai/api/v1/models',
    docs: 'https://openrouter.ai/models',
  },
  gemini: {
    catalog: 'https://generativelanguage.googleapis.com/v1beta/models',
    docs: 'https://ai.google.dev/pricing',
  },
  groq: {
    catalog: 'https://api.groq.com/openai/v1/models',
    docs: 'https://groq.com/pricing',
  },
};

export interface PolicyEntry {
  provider: string;
  modelId: string;
  freeStatus: FreeStatus;
  evidenceUrl: string | null;
  verifiedAt: string | null;
  notes: string | null;
  /**
   * 'catalog' = status berasal dari katalog resmi provider.
   * 'manual'  = status dikonfirmasi Admin dengan URL bukti domain resmi.
   */
  verificationSource: string | null;
}

/** Penjelasan singkat (dasar) untuk setiap status gratis. */
export const FREE_STATUS_EXPLANATION: Record<FreeStatus, string> = {
  VERIFIED_FREE:
    'Status gratis terbukti dari sumber resmi provider, sehingga model boleh dipakai sebagai model utama maupun cadangan.',
  ACCOUNT_DEPENDENT:
    'Gratis hanya bagi akun yang memenuhi syarat (mis. Free Tier tanpa penagihan). Model ini TIDAK masuk rantai fallback otomatis dan TIDAK boleh dipakai sebagai model utama secara otomatis.',
  UNVERIFIED:
    'Status gratis belum terbukti dari sumber resmi. Model ini TIDAK dipakai otomatis sampai diverifikasi.',
  PAID:
    'Model terbukti berbayar sehingga DILARANG dipakai oleh sistem ini.',
};

/** TTL registry: katalog policy dianggap basi setelah 24 jam. */
export const POLICY_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeStatus(value: string | null | undefined): FreeStatus {
  const v = (value || '').trim().toLowerCase();
  if (v === 'verified_free' || v === 'free' || v === '0') return FREE_STATUS_VERIFIED_FREE;
  if (v === 'account_dependent' || v === 'account-dependent') return FREE_STATUS_ACCOUNT_DEPENDENT;
  if (v === 'paid' || v === 'berbayar') return FREE_STATUS_PAID;
  return FREE_STATUS_UNVERIFIED;
}

/**
 * Baca `pricing` dari objek katalog OpenRouter.
 *
 * OpenRouter memakai string desimal, mis. `"0"` (gratis) atau `"0.0000006"`.
 * Field `pricing` TIDAK selalu ada → dikembalikan `null` (bukan "gratis").
 */
export function readPricing(model: any): { prompt: string | null; completion: string | null } {
  const pricing = model?.pricing;
  const prompt = typeof pricing?.prompt === 'string' ? pricing.prompt : null;
  const completion = typeof pricing?.completion === 'string' ? pricing.completion : null;
  return { prompt, completion };
}

/** Angka harga (>0 = berbayar). `null` bila tidak diketahui. */
export function priceValue(raw: string | null): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Putuskan status gratis dari bukti katalog.
 *
 * Aturan (OpenRouter):
 *  - id berakhiran `:free` → katalog resmi **eksplisit** menyatakan gratis.
 *  - `pricing.prompt === "0"` dan `pricing.completion === "0"` → gratis.
 *  - id `:free` tetapi `pricing` > 0 → **konflik** → UNVERIFIED (tidak diklaim gratis).
 *  - `pricing` > 0 → PAID.
 *  - `pricing` tidak tersedia & tidak ada sufiks `:free` → UNVERIFIED.
 */
export function classifyFreeStatus(input: {
  modelId: string;
  pricingPrompt?: string | null;
  pricingCompletion?: string | null;
}): { freeStatus: FreeStatus; notes: string } {
  const suffixFree = input.modelId.trim().toLowerCase().endsWith(':free');
  const p = priceValue(input.pricingPrompt ?? null);
  const c = priceValue(input.pricingCompletion ?? null);
  const priceKnown = p !== null || c !== null;
  const priceIsFree = priceKnown && (p ?? 0) === 0 && (c ?? 0) === 0;
  const priceIsPaid = priceKnown && !priceIsFree;

  if (suffixFree && priceIsPaid) {
    return {
      freeStatus: FREE_STATUS_UNVERIFIED,
      notes:
        'Bukti tidak konsisten: id berakhiran :free tetapi katalog mencantumkan harga non-zero. ' +
        'Status tidak diklaim gratis sampai diverifikasi ulang.',
    };
  }
  if (priceIsFree) {
    return {
      freeStatus: FREE_STATUS_VERIFIED_FREE,
      notes: 'Katalog resmi menyatakan harga 0 untuk prompt & completion.',
    };
  }
  if (suffixFree) {
    return {
      freeStatus: FREE_STATUS_VERIFIED_FREE,
      notes: 'Katalog resmi menandai model ini gratis lewat akhiran :free.',
    };
  }
  if (priceIsPaid) {
    return {
      freeStatus: FREE_STATUS_PAID,
      notes: 'Katalog resmi mencantumkan harga non-zero (model berbayar).',
    };
  }
  return {
    freeStatus: FREE_STATUS_UNVERIFIED,
    notes: 'Katalog resmi tidak mencantumkan harga dan model tidak ditandai gratis.',
  };
}

/**
 * Domain resmi yang SATU-SATUNYA boleh dipakai sebagai `evidenceUrl`.
 *
 * Tujuannya: mencegah bukti gratis yang dikarang. Verifikasi manual hanya
 * diterima bila URL-nya berada di domain resmi provider tersebut.
 */
export const OFFICIAL_EVIDENCE_DOMAINS: Record<string, string[]> = {
  openrouter: ['openrouter.ai', 'openrouter.com'],
  gemini: ['ai.google.dev'],
  groq: ['groq.com'],
};

/** Halaman dokumentasi resmi untuk verifikasi manual per provider. */
export const MANUAL_VERIFICATION_HINTS: Record<string, { url: string; note: string }> = {
  openrouter: {
    url: 'https://openrouter.ai/models',
    note:
      'Katalog resmi OpenRouter mencantumkan varian gratis (akhiran :free) dan harga 0. ' +
      'Pastikan model yang dipilih memang ditandai gratis di sana.',
  },
  gemini: {
    url: 'https://ai.google.dev/gemini-api/docs/pricing',
    note:
      'Harga resmi Gemini memisahkan "Free Tier" dan "Paid Tier". Free tier HANYA berlaku bila ' +
      'proyek memakai kunci dari Google AI Studio dan BELUM mengaktifkan penagihan ' +
      '(lihat https://ai.google.dev/gemini-api/docs/billing). Bila penagihan aktif, kuota ' +
      'ditagihkan dan model tidak lagi gratis.',
  },
  groq: {
    url: 'https://groq.com/pricing',
    note:
      'Halaman harga resmi Groq. Free tier dibatasi rate limit (req/menit) dan kuota harian; ' +
      'batasnya bergantung pada paket akun.',
  },
};

/**
 * Verifikasi MANUAL oleh Admin.
 *
 * Digunakan ketika status gratis TIDAK dapat dibuktikan otomatis (Gemini &
 * Groq: katalog resmi tidak mencantumkan harga, dan tier gratis mengikuti
 * status akun). Admin memeriksa dokumentasi resmi lalu mengonfirmasi.
 *
 * PENJAGA:
 *  - `evidenceUrl` WAJIB berada di domain resmi provider (allowlist).
 *    URL yang bukan domain resmi DITOLAK → bukti gratis tidak bisa dikarang.
 *  - `notes` menjelaskan ketentuan akun (mis. "free tier hanya bila penagihan
 *    belum diaktifkan").
 *  - Hanya model yang sudah ADA di katalog resmi yang boleh diverifikasi.
 *  - `status` menentukan hasil verifikasi: VERIFIED_FREE (untuk OpenRouter)
 *    atau ACCOUNT_DEPENDENT (untuk Gemini/Groq — gratis tergantung akun,
 *    tidak masuk fallback otomatis).
 *  - tidak mengubah status PAID menjadi gratis secara otomatis; PAID → harus
 *    diubah lewat katalog resmi (harga non-zero).
 */
export async function manuallyVerifyModel(input: {
  provider: string;
  modelId: string;
  evidenceUrl: string;
  notes?: string | null;
  /**
   * Hasil verifikasi: VERIFIED_FREE atau ACCOUNT_DEPENDENT.
   * Default VERIFIED_FREE.
   */
  status?: FreeStatus;
  /** Model harus ada di katalog resmi provider (hasil fetch katalog). */
  knownModelIds?: string[];
}): Promise<
  | { ok: true; status: FreeStatus; evidenceUrl: string }
  | { ok: false; error: string }
> {
  const provider = (input.provider || '').trim().toLowerCase();
  const modelId = (input.modelId || '').trim();
  if (!provider || !modelId) {
    return { ok: false, error: 'Provider dan model wajib diisi.' };
  }

  const statusToSet = input.status ?? FREE_STATUS_VERIFIED_FREE;
  if (statusToSet !== FREE_STATUS_VERIFIED_FREE && statusToSet !== FREE_STATUS_ACCOUNT_DEPENDENT) {
    return { ok: false, error: 'Status verifikasi tidak valid. Gunakan VERIFIED_FREE atau ACCOUNT_DEPENDENT.' };
  }

  // 1) Model harus dikenal (dari katalog resmi).
  if (input.knownModelIds && !input.knownModelIds.includes(modelId)) {
    return {
      ok: false,
      error:
        `Model "${modelId}" tidak ditemukan pada katalog resmi ${provider}. ` +
        'Muat ulang katalog lalu pilih model dari daftar yang tersedia.',
    };
  }

  // 2) URL bukti harus.domain resmi provider.
  const allowed = OFFICIAL_EVIDENCE_DOMAINS[provider] || [];
  let host = '';
  try {
    host = new URL(input.evidenceUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'URL bukti tidak valid.' };
  }
  const domainOk = allowed.some((d) => host === d || host.endsWith(`.${d}`));
  if (!domainOk) {
    return {
      ok: false,
      error:
        `URL bukti harus berada di domain resmi ${provider} (${allowed.join(', ')}). ` +
        'Bukti dari sumber lain tidak diterima.',
    };
  }

  const hint = MANUAL_VERIFICATION_HINTS[provider];
  const notes =
    (input.notes || '').trim() ||
    (hint ? hint.note : 'Diverifikasi manual oleh Admin berdasarkan dokumentasi resmi provider.');
  const now = new Date();

  await prisma.aiModelPolicy.upsert({
    where: { provider_modelId: { provider, modelId } },
    create: {
      provider,
      modelId,
      freeStatus: statusToSet,
      evidenceUrl: input.evidenceUrl,
      verifiedAt: now,
      notes,
      verificationSource: 'manual',
    },
    update: {
      freeStatus: statusToSet,
      evidenceUrl: input.evidenceUrl,
      verifiedAt: now,
      notes,
      verificationSource: 'manual',
    },
  });

  return { ok: true, status: statusToSet, evidenceUrl: input.evidenceUrl };
}

/**
 * Status gratis untuk provider yang katalognya tidak menyatakan harga
 * (Gemini, Groq). Tier gratis mengikuti status akun.
 *
 * - Gemini: dokumentasi resmi menyatakan "Free of charge" pada Free Tier,
 *   tetapi hanya bagi akun yang belum mengaktifkan penagihan → ACCOUNT_DEPENDENT.
 * - Groq: dokumentasi resmi tidak mencantumkan model dengan harga $0 → UNVERIFIED.
 *
 * Kedua status TIDAK boleh masuk rantai fallback otomatis (isAllowedStatus hanya
 * mengizinkan VERIFIED_FREE).
 */
export function classifyWithoutPriceEvidence(provider: string): {
  freeStatus: FreeStatus;
  notes: string;
} {
  const hint = MANUAL_VERIFICATION_HINTS[provider];
  if (provider === 'gemini') {
    return {
      freeStatus: FREE_STATUS_ACCOUNT_DEPENDENT,
      notes:
        'Katalog resmi Gemini tidak mencantumkan harga, tetapi dokumentasi harga resmi ' +
        'mengatakan "Free of charge" pada Free Tier. Status gratis bergantung pada tier akun ' +
        '(Free Tier tanpa penagihan diaktifkan) — ACCOUNT_DEPENDENT. Model ini TIDAK masuk ' +
        'rantai fallback otomatis.' +
        (hint ? ` Rujukan resmi: ${hint.url}` : '') +
        '.',
    };
  }
  return {
    freeStatus: FREE_STATUS_UNVERIFIED,
    notes:
      `Katalog resmi ${provider} tidak mencantumkan harga dan tidak ada dokumentasi free tier resmi, ` +
      'sehingga status gratis TIDAK dapat dibuktikan otomatis. Model ini TIDAK masuk ' +
      'rantai fallback otomatis.' +
      (hint ? ` Rujukan resmi: ${hint.url}` : '') +
      '.',
  };
}

/* ==========================================================================
   Pembacaan & penyimpanan registry
   ========================================================================== */

/** Semua entri kebijakan (terkecil lebih dulu). */
export async function listPolicies(): Promise<PolicyEntry[]> {
  const rows = await prisma.aiModelPolicy.findMany({ orderBy: [{ provider: 'asc' }, { modelId: 'asc' }] });
  return rows.map((r) => ({
    provider: r.provider,
    modelId: r.modelId,
    freeStatus: normalizeStatus(r.freeStatus),
    evidenceUrl: r.evidenceUrl,
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    notes: r.notes,
    verificationSource: r.verificationSource ?? null,
  }));
}

/**
 * Status gratis + sumber verifikasinya untuk satu model.
 * Model tanpa entri → UNVERIFIED (fail-closed) + sumber `null`.
 */
export async function getModelPolicy(
  provider: string,
  modelId: string
): Promise<{
  status: FreeStatus;
  evidenceUrl: string | null;
  verifiedAt: string | null;
  notes: string | null;
  verificationSource: string | null;
}> {
  const row = await prisma.aiModelPolicy.findUnique({
    where: { provider_modelId: { provider, modelId } },
    select: {
      freeStatus: true,
      evidenceUrl: true,
      verifiedAt: true,
      notes: true,
      verificationSource: true,
    },
  });
  if (!row) {
    return {
      status: FREE_STATUS_UNVERIFIED,
      evidenceUrl: null,
      verifiedAt: null,
      notes: null,
      verificationSource: null,
    };
  }
  return {
    status: normalizeStatus(row.freeStatus),
    evidenceUrl: row.evidenceUrl,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    notes: row.notes,
    verificationSource: row.verificationSource ?? null,
  };
}

/** Peta cepat `provider:modelId` → status. */
export async function getPolicyMap(): Promise<Map<string, FreeStatus>> {
  const rows = await prisma.aiModelPolicy.findMany({
    select: { provider: true, modelId: true, freeStatus: true },
  });
  const map = new Map<string, FreeStatus>();
  for (const r of rows) {
    map.set(`${r.provider}:${r.modelId}`, normalizeStatus(r.freeStatus));
  }
  return map;
}

/**
 * Status gratis satu model.
 *
 * Model yang tidak ada di registry → `UNVERIFIED` (fail-closed).
 */
export async function getModelStatus(provider: string, modelId: string): Promise<FreeStatus> {
  const row = await prisma.aiModelPolicy.findUnique({
    where: { provider_modelId: { provider, modelId } },
    select: { freeStatus: true },
  });
  if (!row) return FREE_STATUS_UNVERIFIED;
  return normalizeStatus(row.freeStatus);
}

/** Hanya `VERIFIED_FREE` yang boleh dipakai (utama maupun fallback). */
export function isAllowedStatus(status: FreeStatus): boolean {
  return status === FREE_STATUS_VERIFIED_FREE;
}

export interface ModelFilterResult {
  allowed: string[];
  blocked: { modelId: string; status: FreeStatus }[];
}

/**
 * Saring daftar model menjadi yang **boleh dipakai**.
 *
 * `blocked` dipakai untuk memberi alasan jelas ke Admin ("model ini tidak
 * dipakai karena status gratisnya belum terverifikasi").
 */
export function filterAllowedModels(
  provider: string,
  models: string[],
  policy: Map<string, FreeStatus>
): ModelFilterResult {
  const allowed: string[] = [];
  const blocked: { modelId: string; status: FreeStatus }[] = [];
  for (const modelId of models) {
    const status = policy.get(`${provider}:${modelId}`) ?? FREE_STATUS_UNVERIFIED;
    if (isAllowedStatus(status)) allowed.push(modelId);
    else blocked.push({ modelId, status });
  }
  return { allowed, blocked };
}

/* ==========================================================================
   Verifikasi dari katalog resmi (GET metadata, tanpa biaya token)
   ========================================================================== */

export interface VerifyCatalogResult {
  provider: string;
  ok: boolean;
  models: number;
  verifiedFree: number;
  unverified: number;
  paid: number;
  error?: string;
}

export interface VerifySummary {
  at: string;
  results: VerifyCatalogResult[];
  written: number;
  /** Entri verifikasi manual yang dipertahankan (tidak ditimpa katalog). */
  keptManual: number;
}

/** Ambil API Key provider dari DB (dekripsi di memori; tidak pernah dicetak). */
async function getProviderKey(provider: string): Promise<string> {
  try {
    const row = await prisma.aiProvider.findFirst({ where: { provider }, select: { apiKeyCipher: true } });
    if (!row?.apiKeyCipher) return '';
    return decryptSecret(row.apiKeyCipher) || '';
  } catch {
    return '';
  }
}

type FetchInit = { headers?: Record<string, string>; timeoutMs?: number };
type Fetcher = (url: string, init?: FetchInit) => Promise<any>;

/** Fetch JSON dengan timeout; tidak pernah melempar. */
async function fetchJson(url: string, init: FetchInit = {}): Promise<any> {
  const timeoutMs = init.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Simpan status gratis dengan KAIDAH PRESEDENSI.
 *
 *  1. Bila katalog resmi menyatakan model itu BERBAYAR → PAID selalu menang
 *     (fail-safe: model berbayar tidak boleh dipakai, bahkan jika Admin pernah
 *     memverifikasi manual).
 *  2. Bila entri yang ada berasal dari verifikasi MANUAL Admin → TIDAK
 *     ditimpa oleh verifikasi otomatis (verifikasi katalog berikutnya tidak
 *     boleh membatalkan bukti manual).
 *  3. Selain itu → tulis hasil verifikasi katalog.
 *
 * Return: 'written' (baris diperbarui) | 'kept-manual' (entri manual
 * dipertahankan).
 */
export async function upsertPolicyRow(input: {
  provider: string;
  modelId: string;
  freeStatus: FreeStatus;
  evidenceUrl: string;
  notes: string;
  verifiedAt: Date;
}): Promise<'written' | 'kept-manual'> {
  const existing = await prisma.aiModelPolicy.findUnique({
    where: { provider_modelId: { provider: input.provider, modelId: input.modelId } },
    select: { freeStatus: true, verificationSource: true },
  });

  const existingSource = existing?.verificationSource ?? null;
  const existingStatus = existing ? normalizeStatus(existing.freeStatus) : null;

  // Entri verifikasi MANUAL Admin tidak boleh ditimpa oleh verifikasi otomatis
  // katalog (kecuali katalog menyatakan model itu BERBAYAR → PAID selalu menang
  // sebagai fail-safe).
  if (
    existing &&
    existingSource === 'manual' &&
    input.freeStatus !== FREE_STATUS_PAID
  ) {
    return 'kept-manual';
  }

  await prisma.aiModelPolicy.upsert({
    where: { provider_modelId: { provider: input.provider, modelId: input.modelId } },
    create: {
      provider: input.provider,
      modelId: input.modelId,
      freeStatus: input.freeStatus,
      evidenceUrl: input.evidenceUrl,
      verifiedAt: input.verifiedAt,
      notes: input.notes,
      verificationSource: 'catalog',
    },
    update: {
      freeStatus: input.freeStatus,
      evidenceUrl: input.evidenceUrl,
      verifiedAt: input.verifiedAt,
      notes: input.notes,
      verificationSource: 'catalog',
    },
  });
  return 'written';
}

/**
 * Verifikasi status gratis SELURUH model dari katalog resmi.
 *
 * Tidak pernah mengirim request inferensi. Kunci (bila perlu) hanya dipakai
 * pada endpoint katalog resmi sesuai konvensi provider, dan tidak pernah
 * dicetak/disimpan.
 */
export async function verifyFromOfficialCatalogs(
  fetcher: Fetcher = fetchJson
): Promise<VerifySummary> {
  const results: VerifySummary['results'] = [];
  let written = 0;
  let keptManual = 0;
  const now = new Date();

  /* ------------------------------ OpenRouter ----------------------------- */
  try {
    const evidence = OFFICIAL_EVIDENCE.openrouter;
    const data = await fetcher(evidence.catalog as string);
    const list = Array.isArray(data?.data) ? data.data : [];
    let v = 0;
    let u = 0;
    let p = 0;
    for (const m of list) {
      const modelId = String(m?.id || '');
      if (!modelId) continue;
      const pricing = readPricing(m);
      const { freeStatus, notes } = classifyFreeStatus({
        modelId,
        pricingPrompt: pricing.prompt,
        pricingCompletion: pricing.completion,
      });
      const outcome = await upsertPolicyRow({
        provider: 'openrouter',
        modelId,
        freeStatus,
        evidenceUrl: evidence.docs,
        notes,
        verifiedAt: now,
      });
      if (outcome === 'kept-manual') keptManual++;
      else written++;
      if (freeStatus === FREE_STATUS_VERIFIED_FREE) v++;
      else if (freeStatus === FREE_STATUS_PAID) p++;
      else u++;
    }
    results.push({
      provider: 'openrouter',
      ok: list.length > 0,
      models: list.length,
      verifiedFree: v,
      unverified: u,
      paid: p,
      ...(list.length === 0 ? { error: 'Katalog resmi tidak dapat dibaca.' } : {}),
    });
  } catch (e) {
    results.push({
      provider: 'openrouter',
      ok: false,
      models: 0,
      verifiedFree: 0,
      unverified: 0,
      paid: 0,
      error: 'Verifikasi OpenRouter gagal.',
    });
  }

  /* --------------------------- Gemini & Groq ----------------------------- */
  for (const provider of ['gemini', 'groq'] as const) {
    try {
      const evidence = OFFICIAL_EVIDENCE[provider];
      const key = await getProviderKey(provider);
      let list: any[] = [];
      let ok = false;
      if (provider === 'gemini') {
        if (key) {
          const data = await fetcher(`${evidence.catalog}?key=${encodeURIComponent(key)}`, {
            timeoutMs: 15000,
          });
          list = Array.isArray(data?.models) ? data.models : [];
          ok = list.length > 0;
        }
      } else {
        if (key) {
          const data = await fetcher(evidence.catalog as string, {
            headers: { Authorization: `Bearer ${key}` },
          });
          list = Array.isArray(data?.data) ? data.data : [];
          ok = list.length > 0;
        }
      }
      const { freeStatus, notes } = classifyWithoutPriceEvidence(provider);
      let u = 0;
      for (const m of list) {
        const modelId =
          provider === 'gemini'
            ? String(m?.name || '').replace(/^models\//, '')
            : String(m?.id || '');
        if (!modelId) continue;
        const outcome = await upsertPolicyRow({
          provider,
          modelId,
          freeStatus,
          evidenceUrl: evidence.docs,
          notes,
          verifiedAt: now,
        });
        if (outcome === 'kept-manual') keptManual++;
        else written++;
        u++;
      }
      results.push({
        provider,
        ok,
        models: list.length,
        verifiedFree: 0,
        unverified: u,
        paid: 0,
        ...(ok
          ? {}
          : {
              error: key
                ? 'Katalog resmi tidak dapat dibaca.'
                : 'API Key provider belum tersimpan sehingga katalog resmi tidak dapat dibaca.',
            }),
      });
    } catch {
      results.push({
        provider,
        ok: false,
        models: 0,
        verifiedFree: 0,
        unverified: 0,
        paid: 0,
        error: 'Verifikasi gagal.',
      });
    }
  }

  return { at: now.toISOString(), results, written, keptManual };
}

/**
 * Pastikan registry kebijakan tidak basi.
 *
 * Best-effort: bila jaringan tidak tersedia, registry lama DIPAKAI (bukan
 * dihapus). Tidak pernah melempar.
 */
export async function ensurePolicyFresh(
  fetcher?: Fetcher,
  maxAgeMs: number = POLICY_TTL_MS
): Promise<VerifySummary | null> {
  try {
    const latest = await prisma.aiModelPolicy.findFirst({
      orderBy: { verifiedAt: 'desc' },
      select: { verifiedAt: true },
    });
    const fresh =
      latest?.verifiedAt && Date.now() - latest.verifiedAt.getTime() < maxAgeMs;
    if (fresh) return null;
    return await verifyFromOfficialCatalogs(fetcher);
  } catch {
    return null;
  }
}

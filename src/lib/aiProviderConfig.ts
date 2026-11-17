/**
 * KONFIGURASI PROVIDER AI (single source of truth).
 *
 * Mendukung tiga provider: OpenRouter, Google Gemini, Groq.
 *
 * Prinsip:
 *  1. Semua API Key tersimpan TERENKRIPSI (AES-256-GCM) pada
 *     `AiProvider.apiKeyCipher`. Tidak ada key plaintext di database.
 *  2. Setiap provider punya key sendiri dan key TIDAK hilang saat provider
 *     lain diaktifkan.
 *  3. Hanya SATU provider aktif. Dijamin partial UNIQUE INDEX + transaksi.
 *  4. Chain model: `primaryModel` -> `fallbackModels[0]` -> ... Fallback
 *     bersifat EKSPLISIT (diatur Admin) dan provider/model yang benar-benar
 *     dipakai dilaporkan lewat metadata.
 *  5. Bila database sudah punya konfigurasi, TIDAK ada fallback diam-diam
 *     ke `.env`. `.env` hanya dipakai sebagai bootstrap saat tabel masih
 *     kosong (instalasi baru).
 *  6. Ciphertext / API Key TIDAK PERNAH dikembalikan ke klien. Yang
 *     dikirim ke klien hanya `hasApiKey: boolean`.
 */
import { prisma } from '@/lib/prisma';
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  isEncryptionReady,
  SecretCryptoError,
} from './secretCrypto';
import {
  AI_PROVIDER_SPECS,
  getProviderSpec,
  type AiProviderId,
  type AiProviderSpec,
} from './aiProviders';
import {
  getPolicyMap,
  filterAllowedModels,
  isAllowedStatus,
  FREE_STATUS_UNVERIFIED,
  type FreeStatus,
} from './aiModelPolicy';

// Spec provider + adapter berada di `aiProviders.ts` (satu sumber kebenaran).
export { AI_PROVIDER_SPECS, getProviderSpec };
export type { AiProviderId, AiProviderSpec };

export interface AiProviderRow {
  id: string;
  provider: string;
  label: string;
  apiKeyCipher: string | null;
  isActive: boolean;
  primaryModel: string | null;
  fallbackModels: string | null;
  models: string | null;
  lastValidation: Date | null;
  lastError: string | null;
  lastErrorDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Bentuk aman untuk dikirim ke klien (TIDAK memuat apiKeyCipher). */
export interface SafeAiProvider {
  id: string;
  provider: string;
  label: string;
  isActive: boolean;
  primaryModel: string | null;
  fallbackModels: string[];
  models: string[];
  hasApiKey: boolean;
  lastValidation: string | null;
  lastError: string | null;
  /**
   * Penjelasan kegagalan yang aman & mudah dipahami (kategori error, HTTP
   * status, model & provider yang dicoba). Tanpa secret.
   */
  lastErrorDetail: string | null;
  endpoint: string;
  style: 'openai-compatible' | 'gemini-sdk';
  supportsImages: boolean;
  note: string;
  verified: boolean;
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  } catch {
    return [];
  }
}

export function toSafeProvider(row: AiProviderRow): SafeAiProvider {
  const spec = getProviderSpec(row.provider);
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    isActive: row.isActive,
    primaryModel: row.primaryModel,
    fallbackModels: parseJsonArray(row.fallbackModels),
    models: parseJsonArray(row.models),
    hasApiKey: Boolean(row.apiKeyCipher && row.apiKeyCipher.length > 0),
    lastValidation: row.lastValidation ? row.lastValidation.toISOString() : null,
    lastError: row.lastError,
    lastErrorDetail: row.lastErrorDetail ?? null,
    endpoint: spec?.endpoint ?? '',
    style: spec?.style ?? 'openai-compatible',
    supportsImages: spec?.supportsImages ?? false,
    note: spec?.note ?? '',
    verified: spec?.verified ?? false,
  };
}

/** Daftar semua provider tersimpan (bentuk aman). */
export async function listAiProviders(): Promise<SafeAiProvider[]> {
  const rows = await prisma.aiProvider.findMany({ orderBy: [{ isActive: 'desc' }, { provider: 'asc' }] });
  return rows.map(toSafeProvider);
}

/**
 * Dekripsi API Key sebuah provider.
 *
 * Mengembalikan string kosong bila belum diisi. Melempar `SecretCryptoError`
 * bila ciphertext rusak / kunci hilang.
 */
export function decryptProviderKey(row: AiProviderRow): string {
  if (!row.apiKeyCipher) return '';
  return decryptSecret(row.apiKeyCipher);
}

export type AiConfigSource = 'database' | 'env' | 'none' | 'error';

export interface ResolvedAiConfig {
  source: AiConfigSource;
  provider: AiProviderId | null;
  providerLabel: string | null;
  /** API Key aktif (plaintext) — HANYA di memori server. */
  apiKey: string;
  /** Model utama pilihan Admin. */
  primaryModel: string | null;
  /** Model cadangan sesuai urutan Admin. */
  fallbackModels: string[];
  /** Rantai percobaan lengkap (primary + fallback). */
  modelChain: string[];
  /** Status gratis model utama (VERIFIED_FREE / UNVERIFIED / PAID). */
  primaryModelStatus: FreeStatus;
  /** Model cadangan yang LOLOS kebijakan gratis terverifikasi. */
  allowedFallbackModels: string[];
  /** Model cadangan yang DITOLAK kebijakan (bukan karena model, tapi karena status gratis). */
  blockedFallbackModels: { modelId: string; status: FreeStatus }[];
  /** Pesan aman untuk UI/log. */
  problems: string[];
  lastValidation: Date | null;
  totalProviders: number;
  /** True bila sumbernya bootstrap `.env` (belum ada konfigurasi DB). */
  usedEnvFallback: boolean;
}

/**
 * Resolusi konfigurasi provider AI aktif.
 *
 * Dibaca SETIAP KALI dibutuhkan (tanpa cache) → perubahan provider aktif
 * oleh Admin langsung berlaku pada permintaan berikutnya.
 */
export async function resolveActiveAiProvider(): Promise<ResolvedAiConfig> {
  let rows: AiProviderRow[];
  try {
    rows = await prisma.aiProvider.findMany({ orderBy: { createdAt: 'desc' } });
  } catch (error) {
    console.error('[AiProviderConfig] Gagal membaca daftar provider:', error);
    return {
      source: 'error',
      provider: null,
      providerLabel: null,
      apiKey: '',
      primaryModel: null,
      fallbackModels: [],
      modelChain: [],
      primaryModelStatus: FREE_STATUS_UNVERIFIED,
      allowedFallbackModels: [],
      blockedFallbackModels: [],
      problems: [
        'Konfigurasi provider AI tidak dapat dibaca dari database. ' +
          'AI dinonaktifkan agar tidak memakai kunci/model yang tidak dipilih Admin.',
      ],
      lastValidation: null,
      totalProviders: 0,
      usedEnvFallback: false,
    };
  }

  // Instalasi baru: tabel masih kosong -> bootstrap dari .env.
  if (rows.length === 0) {
    const envProvider = detectEnvProvider();
    if (!envProvider) {
      return {
        source: 'none',
        provider: null,
        providerLabel: null,
        apiKey: '',
        primaryModel: null,
        fallbackModels: [],
        modelChain: [],
        primaryModelStatus: FREE_STATUS_UNVERIFIED,
        allowedFallbackModels: [],
        blockedFallbackModels: [],
        problems: [
          'Belum ada provider AI yang dikonfigurasi. ' +
            'Tambahkan provider di menu Admin → Konfigurasi Asisten AI.',
        ],
        lastValidation: null,
        totalProviders: 0,
        usedEnvFallback: false,
      };
    }
    // Model utama dari bootstrap ikut tunduk pada kebijakan gratis terverifikasi.
    const envPolicy = await getPolicyMap();
    const envModel = envProvider.primaryModel;
    const envStatus = envModel
      ? envPolicy.get(`${envProvider.provider}:${envModel}`) ?? FREE_STATUS_UNVERIFIED
      : FREE_STATUS_UNVERIFIED;
    const envAllowed = envModel && isAllowedStatus(envStatus) ? [envModel] : [];
    return {
      source: 'env',
      provider: envProvider.provider,
      providerLabel: envProvider.label,
      apiKey: envProvider.apiKey,
      primaryModel: envProvider.primaryModel,
      fallbackModels: [],
      modelChain: envAllowed,
      primaryModelStatus: envStatus,
      allowedFallbackModels: [],
      blockedFallbackModels: envModel && envStatus !== FREE_STATUS_UNVERIFIED
        ? [{ modelId: envModel, status: envStatus }]
        : [],
      problems: [
        'Belum ada provider AI di database; memakai konfigurasi .env sebagai bootstrap. ' +
          'Tambahkan provider di menu Admin untuk memakai konfigurasi sendiri.',
        ...(envModel && envStatus !== FREE_STATUS_UNVERIFIED
          ? [
              `Model "${envModel}" belum berstatus gratis terverifikasi sehingga TIDAK dipakai otomatis. ` +
                'Verifikasi model gratis dari katalog resmi.',
            ]
          : []),
      ],
      lastValidation: null,
      totalProviders: 0,
      usedEnvFallback: true,
    };
  }

  const actives = rows.filter((r) => r.isActive);
  const active = actives.length > 1 ? await enforceSingleActiveProvider(actives) : actives[0] ?? null;

  // Sudah ada provider di DB tapi tidak ada yang aktif -> JANGAN fallback .env.
  if (!active) {
    return {
      source: 'none',
      provider: null,
      providerLabel: null,
      apiKey: '',
      primaryModel: null,
      fallbackModels: [],
      modelChain: [],
      primaryModelStatus: FREE_STATUS_UNVERIFIED,
      allowedFallbackModels: [],
      blockedFallbackModels: [],
      problems: [
        `Tidak ada provider AI yang AKTIF (terdaftar ${rows.length} provider). ` +
          'Aktifkan satu provider di menu Admin → Konfigurasi Asisten AI.',
      ],
      lastValidation: null,
      totalProviders: rows.length,
      usedEnvFallback: false,
    };
  }

  const spec = getProviderSpec(active.provider);
  const problems: string[] = [];
  let apiKey = '';
  try {
    apiKey = decryptProviderKey(active);
  } catch (e) {
    const code = e instanceof SecretCryptoError ? e.code : 'decrypt_failed';
    problems.push(
      code === 'encryption_key_missing'
        ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server; API Key provider tidak dapat dibaca.'
        : `API Key provider "${active.label}" tidak dapat didekripsi (${code}).`
    );
  }
  if (!apiKey) {
    problems.push(`API Key untuk provider "${active.label}" belum diisi.`);
  }

  const fallbackModels = parseJsonArray(active.fallbackModels);
  const primaryModel = active.primaryModel;

  // KEBIJAKAN MODEL GRATIS: hanya model VERIFIED_FREE yang boleh dipakai.
  const policy = await getPolicyMap();
  const primaryStatus = primaryModel
    ? policy.get(`${active.provider}:${primaryModel}`) ?? FREE_STATUS_UNVERIFIED
    : FREE_STATUS_UNVERIFIED;
  const fallbackFilter = filterAllowedModels(active.provider, fallbackModels, policy);
  const modelChain = [
    ...(primaryModel && isAllowedStatus(primaryStatus) ? [primaryModel] : []),
    ...fallbackFilter.allowed,
  ];
  if (primaryModel && !isAllowedStatus(primaryStatus)) {
    problems.push(
      `Model utama "${primaryModel}" berstatus ${primaryStatus} sehingga TIDAK dipakai otomatis. ` +
        'Hanya model gratis terverifikasi yang boleh dipakai.'
    );
  }
  for (const b of fallbackFilter.blocked) {
    problems.push(
      `Model cadangan "${b.modelId}" berstatus ${b.status} sehingga dilewati.`
    );
  }

  if (!primaryModel) {
    problems.push(`Model utama untuk provider "${active.label}" belum dipilih.`);
  }
  if (!spec) {
    problems.push(`Provider "${active.provider}" tidak dikenali.`);
  }

  return {
    source: 'database',
    provider: (spec?.id ?? active.provider) as AiProviderId,
    providerLabel: active.label,
    apiKey,
    primaryModel,
    fallbackModels,
    modelChain,
    primaryModelStatus: primaryStatus,
    allowedFallbackModels: fallbackFilter.allowed,
    blockedFallbackModels: fallbackFilter.blocked,
    problems,
    lastValidation: active.lastValidation,
    totalProviders: rows.length,
    usedEnvFallback: false,
  };
}

/**
 * SATU percobaan ke sebuah provider: kunci (di memori server) + rantai model.
 */
export interface ProviderAttempt {
  provider: AiProviderId;
  providerLabel: string;
  apiKey: string;
  primaryModel: string | null;
  fallbackModels: string[];
  /** Rantai model yang dicoba berurutan: primary + fallback (hanya yang LOLOS kebijakan). */
  modelChain: string[];
  /** Model yang DITOLAK kebijakan gratis (tidak dicoba). */
  blockedModels: { modelId: string; status: FreeStatus }[];
  isActive: boolean;
}

export interface ResolvedProviderChain {
  source: AiConfigSource;
  /** Percobaan provider berurutan. `attempts[0]` = provider aktif. */
  attempts: ProviderAttempt[];
  problems: string[];
  usedEnvFallback: boolean;
  /**
   * Model yang ditolak kebijakan gratis di seluruh rantai (provider + model +
   * alasan), untuk ditampilkan ke Admin.
   */
  blockedModels: { provider: string; modelId: string; status: FreeStatus }[];
}

/**
 * Rantai provider untuk fallback lintas-provider.
 *
 * Aturan:
 *  1. `attempts[0]` selalu provider AKTIF (atau bootstrap `.env` bila tabel
 *     masih kosong).
 *  2. Provider lain (yang punya kunci + model utama) menyusul sebagai
 *     cadangan. Kunci provider lain TIDAK pernah hilang hanya karena provider
 *     lain diaktifkan.
 *  3. Bila tabel provider sudah berisi data, `.env` TIDAK dipakai sama sekali
 *     (tidak ada fallback diam-diam ke pilihan Admin yang lain).
 *  4. **KEBIJAKAN MODEL GRATIS:** hanya model berstatus `VERIFIED_FREE` yang
 *     boleh dicoba. `UNVERIFIED`/`PAID` DITOLAK (fail-closed) — tidak ada
 *     fallback diam-diam ke model berbayar.
 */
export async function resolveAiProviderChain(): Promise<ResolvedProviderChain> {
  const rows = await prisma.aiProvider.findMany({ orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }] });

  // Instalasi baru: tabel kosong -> bootstrap `.env` (satu-satunya percobaan).
  if (rows.length === 0) {
    const envProvider = detectEnvProvider();
    if (!envProvider) {
      return {
        source: 'none',
        attempts: [],
        problems: [
          'Belum ada provider AI yang dikonfigurasi. ' +
            'Tambahkan provider di menu Admin → Konfigurasi Asisten AI.',
        ],
        usedEnvFallback: false,
        blockedModels: [],
      };
    }
    const envPolicy = await getPolicyMap();
    const envModel = envProvider.primaryModel;
    const envStatus = envModel
      ? envPolicy.get(`${envProvider.provider}:${envModel}`) ?? FREE_STATUS_UNVERIFIED
      : FREE_STATUS_UNVERIFIED;
    const envAllowed = envModel && isAllowedStatus(envStatus) ? [envModel] : [];
    return {
      source: 'env',
      attempts: [
        {
          provider: envProvider.provider,
          providerLabel: envProvider.label,
          apiKey: envProvider.apiKey,
          primaryModel: envProvider.primaryModel,
          fallbackModels: [],
          modelChain: envAllowed,
          blockedModels:
            envModel && envStatus !== FREE_STATUS_UNVERIFIED
              ? [{ modelId: envModel, status: envStatus }]
              : [],
          isActive: true,
        },
      ],
      problems: [
        'Belum ada provider AI di database; memakai konfigurasi .env sebagai bootstrap. ' +
          'Tambahkan provider di menu Admin untuk memakai konfigurasi sendiri.',
        ...(envModel && envStatus !== FREE_STATUS_UNVERIFIED
          ? [
              `Model "${envModel}" belum berstatus gratis terverifikasi sehingga TIDAK dipakai otomatis.`,
            ]
          : []),
      ],
      usedEnvFallback: true,
      blockedModels:
        envModel && envStatus !== FREE_STATUS_UNVERIFIED
          ? [{ provider: envProvider.provider, modelId: envModel, status: envStatus }]
          : [],
    };
  }

  const actives = rows.filter((r) => r.isActive);
  const active = actives.length > 1 ? await enforceSingleActiveProvider(actives) : actives[0] ?? null;

  const attempts: ProviderAttempt[] = [];
  const problems: string[] = [];
  const blockedModels: ResolvedProviderChain['blockedModels'] = [];

  // Registry kebijakan gratis (hanya VERIFIED_FREE yang boleh dipakai).
  const policy = await getPolicyMap();

  const toAttempt = (row: AiProviderRow, isActive: boolean): ProviderAttempt | null => {
    const spec = getProviderSpec(row.provider);
    if (!spec) {
      problems.push(`Provider "${row.provider}" tidak dikenali — dilewati.`);
      return null;
    }
    let apiKey = '';
    try {
      apiKey = decryptProviderKey(row);
    } catch (e) {
      const code = e instanceof SecretCryptoError ? e.code : 'decrypt_failed';
      problems.push(
        code === 'encryption_key_missing'
          ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server; API Key provider tidak dapat dibaca.'
          : `API Key provider "${row.label}" tidak dapat didekripsi (${code}).`
      );
      return null;
    }
    if (!apiKey) return null;
    const fallbackModels = parseJsonArray(row.fallbackModels);
    const primaryModel = row.primaryModel;

    // Saring model According kebijakan gratis terverifikasi.
    const primaryStatus = primaryModel
      ? policy.get(`${spec.id}:${primaryModel}`) ?? FREE_STATUS_UNVERIFIED
      : FREE_STATUS_UNVERIFIED;
    const fallbackFilter = filterAllowedModels(spec.id, fallbackModels, policy);
    const blocked: { modelId: string; status: FreeStatus }[] = [
      ...(primaryModel && !isAllowedStatus(primaryStatus)
        ? [{ modelId: primaryModel, status: primaryStatus }]
        : []),
      ...fallbackFilter.blocked,
    ];
    for (const b of blocked) {
      blockedModels.push({ provider: spec.id, modelId: b.modelId, status: b.status });
    }
    const modelChain = [
      ...(primaryModel && isAllowedStatus(primaryStatus) ? [primaryModel] : []),
      ...fallbackFilter.allowed,
    ];

    return {
      provider: spec.id,
      providerLabel: row.label,
      apiKey,
      primaryModel,
      fallbackModels,
      modelChain,
      blockedModels: blocked,
      isActive,
    };
  };

  // 1) Provider aktif (bila ada & bisa dipakai).
  if (active) {
    const attempt = toAttempt(active, true);
    if (attempt) {
      attempts.push(attempt);
    } else {
      problems.push(
        `Provider aktif "${active.label}" belum bisa dipakai (kunci/model belum lengkap).`
      );
    }
  } else {
    problems.push(
      `Tidak ada provider AI yang AKTIF (terdaftar ${rows.length} provider). ` +
        'Aktifkan satu provider di menu Admin → Konfigurasi Asisten AI.'
    );
  }

  // 2) Provider lain sebagai cadangan (hanya yang punya kunci + model utama).
  for (const row of rows) {
    if (active && row.id === active.id) continue;
    const attempt = toAttempt(row, false);
    if (attempt && attempt.modelChain.length > 0) {
      attempts.push(attempt);
    }
  }

  // Ringkasan kebijakan: bila TIDAK ada satu pun model yang boleh dipakai,
  // pipeline tidak akan mencoba model berbayar maupun model tanpa bukti.
  const totalAllowed = attempts.reduce((n, a) => n + a.modelChain.length, 0);
  if (totalAllowed === 0 && attempts.length > 0) {
    problems.push(
      'Tidak ada model berstatus gratis terverifikasi yang boleh dipakai. ' +
        'Verifikasi model gratis dari katalog resmi, lalu pilih model yang statusnya terverifikasi.'
    );
  }

  return {
    source: 'database',
    attempts,
    problems,
    usedEnvFallback: false,
    blockedModels,
  };
}

/** Jaga invarian "hanya satu provider aktif". */
async function enforceSingleActiveProvider(
  actives: AiProviderRow[]
): Promise<AiProviderRow | null> {
  const sorted = [...actives].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = sorted[0];
  const others = sorted.slice(1).map((r) => r.id);
  if (others.length > 0) {
    try {
      await prisma.$transaction([
        prisma.aiProvider.updateMany({ where: { id: { in: others } }, data: { isActive: false } }),
      ]);
      console.warn(
        `[AiProviderConfig] Menormalkan provider aktif ganda: "${keep.label || keep.id}" dipertahankan, ` +
          `${others.length} provider lain dinonaktifkan.`
      );
    } catch (e) {
      console.error('[AiProviderConfig] Gagal menormalkan provider aktif ganda:', e);
    }
  }
  return keep;
}

/** Deteksi bootstrap `.env` (hanya dipakai saat tabel provider masih kosong). */
function detectEnvProvider(): {
  provider: AiProviderId;
  label: string;
  apiKey: string;
  primaryModel: string | null;
} | null {
  for (const spec of AI_PROVIDER_SPECS) {
    const key = spec.envKey ? process.env[spec.envKey] : undefined;
    if (!key || !key.trim()) continue;
    const model = spec.envModel ? process.env[spec.envModel] : undefined;
    return {
      provider: spec.id,
      label: `${spec.label} (dari .env)`,
      apiKey: key.trim(),
      primaryModel: model?.trim() || null,
    };
  }
  return null;
}

/**
 * Simpan API Key (terenkripsi) untuk sebuah provider.
 *
 * API key KOSONG berarti "pertahankan key lama" (Admin tidak perlu
 * mengetik ulang). API Key provider LAIN tidak pernah tersentuh.
 */
export async function saveProviderApiKey(
  id: string,
  apiKey: string
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) return { ok: false, error: 'Provider tidak ditemukan' };
  const clean = (apiKey || '').trim();
  if (!clean) {
    // Kosong -> pertahankan key lama.
    return { ok: true, provider: toSafeProvider(row) };
  }
  let cipher: string;
  try {
    cipher = encryptSecret(clean);
  } catch (e) {
    const code = e instanceof SecretCryptoError ? e.code : 'encrypt_failed';
    return {
      ok: false,
      error:
        code === 'encryption_key_missing'
          ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server; API Key belum dapat disimpan.'
          : 'Gagal mengenkripsi API Key.',
    };
  }
  const updated = await prisma.aiProvider.update({
    where: { id },
    data: { apiKeyCipher: cipher, lastError: null },
  });
  return { ok: true, provider: toSafeProvider(updated) };
}

/** Tambah provider baru (jika provider dengan jenis sama sudah ada, diperbarui). */
export async function upsertProvider(input: {
  provider: string;
  label?: string;
  apiKey?: string;
  primaryModel?: string;
  fallbackModels?: string[];
  models?: string[];
}): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const spec = getProviderSpec(input.provider);
  if (!spec) return { ok: false, error: `Provider tidak dikenal: ${input.provider}` };
  const label = (input.label || '').trim() || spec.label;

  const existing = await prisma.aiProvider.findFirst({ where: { provider: input.provider } });
  const data: {
    label?: string;
    apiKeyCipher?: string;
    primaryModel?: string | null;
    fallbackModels?: string;
    models?: string;
    lastError?: string | null;
  } = { label };
  if (input.primaryModel !== undefined) data.primaryModel = input.primaryModel.trim() || null;
  if (input.fallbackModels !== undefined) {
    data.fallbackModels = JSON.stringify(input.fallbackModels.filter((m) => m.trim().length > 0));
  }
  if (input.models !== undefined) {
    data.models = JSON.stringify(input.models.filter((m) => m.trim().length > 0));
  }
  if (input.apiKey !== undefined && input.apiKey.trim()) {
    try {
      data.apiKeyCipher = encryptSecret(input.apiKey.trim());
      data.lastError = null;
    } catch (e) {
      const code = e instanceof SecretCryptoError ? e.code : 'encrypt_failed';
      return {
        ok: false,
        error:
          code === 'encryption_key_missing'
            ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server; API Key belum dapat disimpan.'
            : 'Gagal mengenkripsi API Key.',
      };
    }
  }

  const row = existing
    ? await prisma.aiProvider.update({ where: { id: existing.id }, data })
    : await prisma.aiProvider.create({
        data: {
          provider: input.provider,
          label: data.label ?? spec.label,
          apiKeyCipher: data.apiKeyCipher ?? null,
          primaryModel: data.primaryModel ?? null,
          fallbackModels: data.fallbackModels ?? null,
          models: data.models ?? null,
          lastError: data.lastError ?? null,
          isActive: false,
        },
      });
  return { ok: true, provider: toSafeProvider(row) };
}

/** Ubah label provider (tanpa menyentuh kunci, model, atau status aktif). */
export async function setProviderLabel(
  id: string,
  label: string
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) return { ok: false, error: 'Provider tidak ditemukan' };
  const clean = (label || '').trim();
  if (!clean) return { ok: false, error: 'Label tidak boleh kosong' };
  const updated = await prisma.aiProvider.update({ where: { id }, data: { label: clean } });
  return { ok: true, provider: toSafeProvider(updated) };
}

/** Ubah model utama provider. */
export async function setProviderPrimaryModel(
  id: string,
  primaryModel: string
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) return { ok: false, error: 'Provider tidak ditemukan' };
  const updated = await prisma.aiProvider.update({
    where: { id },
    data: { primaryModel: primaryModel.trim() || null },
  });
  return { ok: true, provider: toSafeProvider(updated) };
}

/** Ubah daftar model cadangan (urutan = prioritas). */
export async function setProviderFallbackModels(
  id: string,
  fallbackModels: string[]
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const row = await prisma.aiProvider.findUnique({ where: { id } });
  if (!row) return { ok: false, error: 'Provider tidak ditemukan' };
  const cleaned = fallbackModels.map((m) => m.trim()).filter(Boolean);
  const primary = row.primaryModel?.trim();
  if (primary && cleaned.includes(primary)) {
    return { ok: false, error: 'Model utama tidak boleh sekaligus menjadi model cadangan' };
  }
  const updated = await prisma.aiProvider.update({
    where: { id },
    data: { fallbackModels: JSON.stringify(cleaned) },
  });
  return { ok: true, provider: toSafeProvider(updated) };
}

/** Aktifkan satu provider; nonaktifkan yang lain. ATOMIK. */
export async function activateProvider(
  id: string
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const target = await prisma.aiProvider.findUnique({ where: { id } });
  if (!target) return { ok: false, error: 'Provider tidak ditemukan' };
  if (!target.apiKeyCipher) {
    return { ok: false, error: 'API Key provider belum diisi' };
  }
  if (!target.primaryModel) {
    return { ok: false, error: 'Model utama provider belum dipilih' };
  }
  try {
    await prisma.$transaction([
      prisma.aiProvider.updateMany({ where: { isActive: true, NOT: { id } }, data: { isActive: false } }),
      prisma.aiProvider.update({ where: { id }, data: { isActive: true } }),
    ]);
  } catch (e) {
    console.error('[AiProviderConfig] Gagal mengaktifkan provider:', e);
    return { ok: false, error: 'Gagal mengaktifkan provider' };
  }
  const updated = await prisma.aiProvider.findUnique({ where: { id } });
  return { ok: true, provider: toSafeProvider(updated!) };
}

/** Nonaktifkan provider (key TIDAK dihapus, dapat diaktifkan kembali). */
export async function deactivateProvider(
  id: string
): Promise<{ ok: true; provider: SafeAiProvider } | { ok: false; error: string }> {
  const target = await prisma.aiProvider.findUnique({ where: { id } });
  if (!target) return { ok: false, error: 'Provider tidak ditemukan' };
  const updated = await prisma.aiProvider.update({ where: { id }, data: { isActive: false } });
  return { ok: true, provider: toSafeProvider(updated) };
}

/**
 * Catat hasil validasi (kode aman, tanpa pesan mentah dari provider).
 *
 * `detail` berisi penjelasan yang aman & mudah dipahami (kategori error,
 * HTTP status, model & provider yang dicoba). TIDAK boleh memuat API Key,
 * ciphertext, atau isi respons mentah provider.
 */
export async function recordProviderValidation(
  id: string,
  ok: boolean,
  errorCode: string | null,
  detail?: string | null
): Promise<void> {
  try {
    await prisma.aiProvider.update({
      where: { id },
      data: {
        lastValidation: new Date(),
        lastError: ok ? null : (errorCode || 'validation_failed'),
        lastErrorDetail: ok ? null : (detail || null),
      },
    });
  } catch (e) {
    console.error('[AiProviderConfig] Gagal mencatat hasil validasi:', e);
  }
}

/** Ringkasan status untuk halaman Diagnostik (aman, tanpa rahasia). */
export async function aiProviderStatus() {
  const resolved = await resolveActiveAiProvider();
  const rows = await prisma.aiProvider.findMany({ orderBy: [{ isActive: 'desc' }, { provider: 'asc' }] });
  return {
    source: resolved.source,
    activeProvider: resolved.provider,
    activeProviderLabel: resolved.providerLabel,
    primaryModel: resolved.primaryModel,
    fallbackModels: resolved.fallbackModels,
    problems: resolved.problems,
    usedEnvFallback: resolved.usedEnvFallback,
    encryptionReady: isEncryptionConfigured(),
    providers: rows.map((r) => ({
      provider: r.provider,
      label: r.label,
      isActive: r.isActive,
      hasApiKey: Boolean(r.apiKeyCipher),
      primaryModel: r.primaryModel,
      fallbackModels: parseJsonArray(r.fallbackModels),
      lastValidation: r.lastValidation ? r.lastValidation.toISOString() : null,
      lastError: r.lastError,
      lastErrorDetail: r.lastErrorDetail ?? null,
    })),
  };
}

/** True bila environment server punya kunci enkripsi yang valid. */
export function isEncryptionConfigured(): boolean {
  return isEncryptionReady();
}

/** True bila ciphertext provider sudah terenkripsi (untuk transisi Fonnte). */
export { isEncrypted };

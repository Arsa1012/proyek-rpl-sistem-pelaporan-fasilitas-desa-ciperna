import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import { prisma } from '@/lib/prisma';
import {
  listAiProviders,
  resolveActiveAiProvider,
  resolveAiProviderChain,
  upsertProvider,
  isEncryptionConfigured,
} from '@/lib/aiProviderConfig';
import { AI_PROVIDER_IDS, AI_PROVIDER_SPECS, getProviderSpec, explainProviderError } from '@/lib/aiProviders';
import {
  getPolicyMap,
  filterAllowedModels,
  isAllowedStatus,
  ensurePolicyFresh,
  FREE_STATUS_UNVERIFIED,
  type FreeStatus,
} from '@/lib/aiModelPolicy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/ai-config — daftar provider AI + status konfigurasi.
 *
 * KEAMANAN: response TIDAK PERNAH memuat `apiKeyCipher` maupun `apiKey`.
 * Yang dikirim hanya flag `hasApiKey: boolean`. Ciphertext hanya boleh
 * tinggal di server.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    // Segarkan registry kebijakan gratis dari katalog RESMI bila basi
    // (hanya GET metadata, tanpa request inferensi, tanpa biaya token).
    await ensurePolicyFresh();

    const providers = await listAiProviders();
    const resolved = await resolveActiveAiProvider();
    const chain = await resolveAiProviderChain();
    const policy = await getPolicyMap();
    // Kapan registry status gratis terakhir diperbarui (indikator UI).
    const latestPolicy = await prisma.aiModelPolicy.findFirst({
      orderBy: { verifiedAt: 'desc' },
      select: { verifiedAt: true },
    });

    // "Slot" = satu entri per JENIS provider (OpenRouter / Gemini / Groq).
    // Selalu ada 3 slot, baik pun provider-nya sudah pernah disimpan atau
    // belum. Ini yang membuat UI dapat menampilkan daftar provider lengkap
    // dan memungkinkan Admin mengisi provider yang belum pernah dipakai.
    const savedByProvider = new Map(providers.map((p) => [p.provider, p]));
    const slots = AI_PROVIDER_SPECS.map((spec) => {
      const saved = savedByProvider.get(spec.id);
      const hasApiKey = Boolean(saved?.hasApiKey);
      const hasModel = Boolean(saved?.primaryModel);
      const configured = hasApiKey && hasModel;

      // Status gratis model utama & cadangan (kebijakan terverifikasi).
      const primaryStatus: FreeStatus = saved?.primaryModel
        ? policy.get(`${spec.id}:${saved.primaryModel}`) ?? FREE_STATUS_UNVERIFIED
        : FREE_STATUS_UNVERIFIED;
      const fallbackFilter = filterAllowedModels(spec.id, saved?.fallbackModels ?? [], policy);
      const validFallbackCount = fallbackFilter.allowed.length;
      // Status gratis tiap model cadangan (untuk indikator di UI).
      const fallbackModelsStatus = (saved?.fallbackModels ?? []).map((m) => ({
        modelId: m,
        freeStatus:
          policy.get(`${spec.id}:${m}`) ?? FREE_STATUS_UNVERIFIED,
      }));

      // Status ringkas (mesin) + label bahasa Indonesia untuk UI.
      let status: string;
      let statusLabel: string;
      if (!configured) {
        status = 'belum_dikonfigurasi';
        statusLabel = hasApiKey
          ? 'API Key tersimpan, model utama belum dipilih'
          : 'Belum dikonfigurasi';
      } else if (saved?.lastError) {
        status = 'koneksi_gagal';
        statusLabel = 'Koneksi gagal pada pengujian terakhir';
      } else if (saved?.lastValidation) {
        status = 'koneksi_berhasil';
        statusLabel = 'Koneksi berhasil pada pengujian terakhir';
      } else {
        status = 'belum_diuji';
        statusLabel = 'Belum diuji';
      }
      if (saved?.isActive) {
        status = 'aktif';
        statusLabel = 'Provider aktif';
      } else if (configured) {
        status = 'cadangan';
        statusLabel = 'Provider cadangan (siap, tapi tidak aktif)';
      }

      return {
        // `id` = baris database; null berarti provider belum pernah disimpan.
        id: saved?.id ?? null,
        provider: spec.id,
        label: saved?.label ?? spec.label,
        specLabel: spec.label,
        endpoint: spec.endpoint,
        style: spec.style,
        supportsImages: spec.supportsImages,
        verified: spec.verified,
        note: spec.note,
        isActive: Boolean(saved?.isActive),
        hasApiKey,
        primaryModel: saved?.primaryModel ?? null,
        fallbackModels: saved?.fallbackModels ?? [],
        models: saved?.models ?? [],
        lastValidation: saved?.lastValidation ?? null,
        lastError: saved?.lastError ?? null,
        // Penjelasan kegagalan yang aman & mudah dipahami (bukan kode mentah).
        lastErrorDetail: saved?.lastErrorDetail ?? null,
        lastErrorExplanation: explainProviderError(saved?.lastError),
        configured,
        status,
        statusLabel,
        // --- Kebijakan model gratis (bukti resmi) ---
        primaryModelStatus: primaryStatus,
        primaryModelAllowed: isAllowedStatus(primaryStatus),
        validFallbackCount,
        fallbackModelsStatus,
        blockedFallbackModels: fallbackFilter.blocked,
      };
    });

    return NextResponse.json({
      providers,
      slots,
      active: resolved.provider
        ? {
            provider: resolved.provider,
            label: resolved.providerLabel,
            model: resolved.primaryModel,
            fallbackModels: resolved.fallbackModels,
            primaryModelStatus: resolved.primaryModelStatus,
            allowedFallbackModels: resolved.allowedFallbackModels,
          }
        : null,
      source: resolved.source,
      problems: resolved.problems,
      usedEnvFallback: resolved.usedEnvFallback,
      encryptionReady: isEncryptionConfigured(),
      lastValidation: resolved.lastValidation ? resolved.lastValidation.toISOString() : null,
      policyUpdatedAt: latestPolicy?.verifiedAt ? latestPolicy.verifiedAt.toISOString() : null,
      totalProviders: resolved.totalProviders,
      /**
       * Status runtime: provider & model yang BENAR-BENAR akan dipakai pipeline,
       * plus model yang ditolak kebijakan (agar Admin tahu alasannya).
       */
      runtime: {
        providerChain: chain.attempts.map((a) => a.provider),
        usableModels: chain.attempts.flatMap((a) =>
          a.modelChain.map((m) => ({ provider: a.provider, model: m }))
        ),
        blockedModels: chain.blockedModels,
        problems: chain.problems,
        source: chain.source,
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/ai-config]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * POST /api/admin/ai-config — tambah provider baru.
 *
 * Body: `{ provider, label?, apiKey?, primaryModel?, fallbackModels?, models? }`
 *
 *  - `provider` harus salah satu dari: openrouter | gemini | groq.
 *  - `apiKey` opsional. Bila diisi → dienkripsi (AES-256-GCM) sebelum disimpan.
 *  - Bila `APP_ENCRYPTION_KEY` belum ada di server → 400 dengan pesan jelas
 *    (TIDAK ada fallback ke penyimpanan plaintext).
 *  - Response TIDAK memuat nilai key.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson(request);
    const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';

    if (!provider) return badRequest('Provider wajib diisi');
    if (!AI_PROVIDER_IDS.includes(provider as (typeof AI_PROVIDER_IDS)[number])) {
      return badRequest(`Provider tidak dikenal. Pilihan: ${AI_PROVIDER_IDS.join(', ')}`);
    }

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey && !isEncryptionConfigured()) {
      return badRequest(
        'APP_ENCRYPTION_KEY belum dikonfigurasi di server, sehingga API Key tidak dapat disimpan terenkripsi. ' +
          'Hubungi pengelola server untuk mengatur kunci enkripsi terlebih dahulu.'
      );
    }

    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const primaryModel =
      typeof body.primaryModel === 'string' ? body.primaryModel.trim() : undefined;
    const fallbackModels = Array.isArray(body.fallbackModels)
      ? body.fallbackModels.filter((m): m is string => typeof m === 'string')
      : undefined;
    const models = Array.isArray(body.models)
      ? body.models.filter((m): m is string => typeof m === 'string')
      : undefined;

    const result = await upsertProvider({
      provider,
      label: label || undefined,
      apiKey: apiKey || undefined,
      primaryModel,
      fallbackModels,
      models,
    });
    if (!result.ok) return badRequest(result.error);

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_ADD',
      notes:
        `Provider AI "${result.provider.provider}" (${result.provider.label}) ditambahkan. ` +
        `Kunci diisi=${result.provider.hasApiKey}; model utama=${result.provider.primaryModel || '-'}. ` +
        'Nilai kunci tidak dicatat.',
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Provider AI berhasil ditambahkan.',
        provider: result.provider,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/admin/ai-config]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

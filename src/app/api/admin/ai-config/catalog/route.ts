import { NextResponse } from 'next/server';
import { requireAdmin, badRequest } from '@/lib/adminApi';
import { prisma } from '@/lib/prisma';
import { fetchProviderCatalog, type ProviderCatalogEntry } from '@/lib/aiCatalog';
import {
  classifyFreeStatus,
  classifyWithoutPriceEvidence,
  normalizeStatus,
  MANUAL_VERIFICATION_HINTS,
  type FreeStatus,
} from '@/lib/aiModelPolicy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/ai-config/catalog?provider=gemini
 *
 * Daftar model dari KATALOG RESMI provider. Setiap model membawa:
 *  - `freeStatus`      : VERIFIED_FREE | UNVERIFIED | PAID
 *  - `freeStatusLabel` : label bahasa Indonesia
 *  - `freeReason`      : alasan (mengapa ditolak / apa buktinya)
 *  - `pricingPrompt` / `pricingCompletion` : harga dari katalog (bila ada)
 *  - `pricingKnown`    : apakah katalog mencantumkan harga sama sekali
 *  - `supportsChat`    : model bisa dipakai untuk chat/generateContent
 *  - `evidenceUrl` / `verifiedAt` / `verificationSource` : bukti status gratis
 *
 * CATATAN PENTING: model yang TIDAK boleh dipakai **tetap ditampilkan**
 * (dengan alasannya), tidak disembunyikan. Model UNVERIFIED/PAID ditandai
 * `selectable: false` sehingga UI bisa menandainya tanpa menghapus pilihannya.
 *
 * - Cache in-memory 6 jam (katalog jarang berubah); `?refresh=1` memaksa
 *   ambil ulang.
 * - Timeout pendek (8 detik).
 * - Bila gagal: balas `models: []` + `error` singkat (halaman tetap jalan).
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const catalogCache = new Map<string, { at: number; models: ProviderCatalogEntry[] }>();

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const provider = (url.searchParams.get('provider') || 'openrouter').trim().toLowerCase();
    if (!['openrouter', 'gemini', 'groq'].includes(provider)) {
      return badRequest('Provider tidak dikenal. Pilihan: openrouter, gemini, groq.');
    }
    // Paksa muat ulang katalog bila diminta (?refresh=1).
    const force = url.searchParams.get('refresh') === '1';

    const cached = catalogCache.get(provider);
    if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      const withStatus = await attachPolicy(provider, cached.models);
      return NextResponse.json({
        provider,
        models: withStatus,
        summary: summarize(withStatus),
        cached: true,
        fetchedAt: new Date(cached.at).toISOString(),
        hint: MANUAL_VERIFICATION_HINTS[provider] || null,
      });
    }

    const result = await fetchProviderCatalog(provider);
    if (result.models.length === 0) {
      return NextResponse.json({
        provider,
        models: [],
        summary: summarize([]),
        cached: false,
        fetchedAt: result.fetchedAt,
        hint: MANUAL_VERIFICATION_HINTS[provider] || null,
        error:
          result.error ||
          'Daftar model tidak dapat dimuat dari katalog resmi provider. ' +
            'Model tetap dapat diketik manual pada formulir.',
      });
    }

    const at = Date.now();
    catalogCache.set(provider, { at, models: result.models });
    const withStatus = await attachPolicy(provider, result.models);
    return NextResponse.json({
      provider,
      models: withStatus,
      summary: summarize(withStatus),
      cached: false,
      fetchedAt: result.fetchedAt,
      hint: MANUAL_VERIFICATION_HINTS[provider] || null,
    });
  } catch (error) {
    console.error('[GET /api/admin/ai-config/catalog]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * Gabungkan data katalog dengan status gratis dari registry kebijakan.
 * Model yang tidak punya entri → UNVERIFIED (fail-closed) + alasan.
 */
async function attachPolicy(provider: string, models: ProviderCatalogEntry[]) {
  const rows = await prisma.aiModelPolicy.findMany({
    where: { provider },
    select: {
      modelId: true,
      freeStatus: true,
      evidenceUrl: true,
      verifiedAt: true,
      notes: true,
      verificationSource: true,
    },
  });
  const byModel = new Map(rows.map((r) => [r.modelId, r]));

  return models.map((m) => {
    const entry = byModel.get(m.id);
    const stored = entry ? normalizeStatus(entry.freeStatus) : null;

    // Status tersimpan menang; bila tidak ada, hitung dari harga katalog.
    let status: FreeStatus;
    let reason: string;
    if (stored) {
      status = stored;
      reason = entry?.notes || '';
    } else if (m.pricingKnown) {
      const cls = classifyFreeStatus({
        modelId: m.id,
        pricingPrompt: m.pricingPrompt,
        pricingCompletion: m.pricingCompletion,
      });
      status = cls.freeStatus;
      reason = cls.notes;
    } else {
      const cls = classifyWithoutPriceEvidence(provider);
      status = cls.freeStatus;
      reason = cls.notes;
    }

    return {
      id: m.id,
      name: m.name,
      contextLength: m.contextLength,
      pricingPrompt: m.pricingPrompt,
      pricingCompletion: m.pricingCompletion,
      pricingKnown: m.pricingKnown,
      supportsChat: m.supportsChat,
      generationMethods: m.generationMethods,
      freeStatus: status,
      freeStatusLabel: freeStatusLabel(status),
      freeReason: reason,
      selectable: status === 'VERIFIED_FREE',
      evidenceUrl: entry?.evidenceUrl ?? null,
      verifiedAt: entry?.verifiedAt ? entry.verifiedAt.toISOString() : null,
      verificationSource: entry?.verificationSource ?? null,
    };
  });
}

function summarize(models: { freeStatus: FreeStatus }[]) {
  let verifiedFree = 0;
  let unverified = 0;
  let paid = 0;
  let accountDependent = 0;
  for (const m of models) {
    if (m.freeStatus === 'VERIFIED_FREE') verifiedFree++;
    else if (m.freeStatus === 'PAID') paid++;
    else if (m.freeStatus === 'ACCOUNT_DEPENDENT') accountDependent++;
    else unverified++;
  }
  return { total: models.length, verifiedFree, unverified, paid, accountDependent };
}

function freeStatusLabel(status: FreeStatus): string {
  if (status === 'VERIFIED_FREE') return 'Gratis terverifikasi';
  if (status === 'PAID') return 'Berbayar';
  if (status === 'ACCOUNT_DEPENDENT') return 'Bergantung akun';
  return 'Belum terverifikasi';
}

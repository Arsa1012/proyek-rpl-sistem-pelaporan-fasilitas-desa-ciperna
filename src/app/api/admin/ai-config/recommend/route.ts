import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import {
  listPolicies,
  ensurePolicyFresh,
  FREE_STATUS_VERIFIED_FREE,
  FREE_STATUS_PAID,
  type FreeStatus,
} from '@/lib/aiModelPolicy';
import { getProviderSpec } from '@/lib/aiProviders';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/admin/ai-config/recommend — rekomendasi model GRATIS.
 *
 * ATURAN:
 *  - Hanya model berstatus `VERIFIED_FREE` (bukti resmi) yang direkomendasikan.
 *  - Model `UNVERIFIED`/`PAID` TIDAK PERNAH masuk rekomendasi.
 *  - Tidak mengaktifkan provider, tidak menyimpan API Key, tidak mengubah
 *    konfigurasi apa pun.(read-only)
 *  - Tidak mengirim request inferensi; hanya membaca registry kebijakan yang
 *    berasal dari katalog resmi provider.
 */
export interface RecommendedModel {
  provider: string;
  providerLabel: string;
  modelId: string;
  freeStatus: FreeStatus;
  freeStatusLabel: string;
  evidenceUrl: string | null;
  verifiedAt: string | null;
  notes: string | null;
  supportsImages: boolean;
  supportsMultiTurn: 'ya' | 'emulasi';
  supportsIndonesian: 'ya' | 'tidak_dijamin';
  reason: string;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    // Segarkan registry dari katalog resmi bila basi (GET metadata saja).
    await ensurePolicyFresh();

    const policies = await listPolicies();
    const verified = policies.filter((p) => p.freeStatus === FREE_STATUS_VERIFIED_FREE);

    const toModel = (p: (typeof policies)[number]): RecommendedModel => {
      const spec = getProviderSpec(p.provider);
      return {
        provider: p.provider,
        providerLabel: spec?.label ?? p.provider,
        modelId: p.modelId,
        freeStatus: p.freeStatus,
        freeStatusLabel:
          p.freeStatus === FREE_STATUS_VERIFIED_FREE
            ? 'Gratis terverifikasi'
            : p.freeStatus === FREE_STATUS_PAID
              ? 'Berbayar'
              : 'Belum terverifikasi',
        evidenceUrl: p.evidenceUrl,
        verifiedAt: p.verifiedAt,
        notes: p.notes,
        supportsImages: Boolean(spec?.supportsImages),
        supportsMultiTurn: p.provider === 'gemini' ? 'emulasi' : 'ya',
        supportsIndonesian: 'ya',
        reason:
          p.provider === 'gemini'
            ? 'Provider multimodal — mendukung analisis gambar laporan. ' +
              'Riwayat percakapan diratakan ke satu prompt (emulasi multi-turn).'
            : p.provider === 'groq'
              ? 'Provider teks saja (tanpa analisis gambar). Multi-turn native. ' +
                'Endpoint belum diverifikasi terhadap API nyata.'
              : 'Model gratis resmi OpenRouter. Multi-turn native, mendukung gambar, ' +
                'dan sistem chat memakai Authorization: Bearer.',
      };
    };

    // Prioritas: provider dengan multi-turn native & dukungan gambar dulu.
    const scored = verified
      .map((p) => {
        const spec = getProviderSpec(p.provider);
        let score = 0;
        if (p.provider !== 'gemini') score += 2; // multi-turn native
        if (spec?.supportsImages) score += 1; // multimodal
        if (spec?.verified) score += 1; // endpoint sudah diverifikasi
        return { p, score };
      })
      .sort((a, b) => b.score - a.score || a.p.modelId.localeCompare(b.p.modelId));

    const models = scored.map((s) => toModel(s.p));

    // Provider utama: model gratis terverifikasi pertama.
    // 3 cadangan berikutnya (boleh lebih sedikit bila kandidatnya kurang).
    const primary = models[0] ?? null;
    const fallbacks = models.slice(1, 4);

    const warnings: string[] = [];
    if (models.length === 0) {
      warnings.push(
        'Belum ada model gratis terverifikasi. Verifikasi dari katalog resmi provider ' +
          '(tombol "Verifikasi Ulang dari Katalog Resmi") lalu coba lagi.'
      );
    } else if (models.length < 4) {
      warnings.push(
        `Hanya ${models.length} model gratis terverifikasi yang tersedia — ` +
          'daftar cadangan diisi sesuai jumlah yang tersedia, tidak dipaksa menjadi tiga.'
      );
    }
    const paid = policies.filter((p) => p.freeStatus === FREE_STATUS_PAID).length;
    if (paid > 0) {
      warnings.push(`${paid} model terbukti berbayar dan sengaja TIDAK direkomendasikan.`);
    }

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_RECOMMEND_VIEW',
      notes:
        `Rekomendasi gratis dilihat: kandidat terverifikasi=${models.length}, ` +
        `dipilih=${primary ? `${primary.provider}/${primary.modelId}` : 'tidak ada'}. ` +
        'Nilai kunci tidak dicatat.',
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      primary,
      fallbacks,
      /** Semua kandidat terverifikasi (bukan hanya yang dipilih). */
      candidates: models,
      warnings,
      policyUpdatedAt: policies.reduce<string | null>(
        (acc, p) => (!acc || (p.verifiedAt && p.verifiedAt > acc) ? p.verifiedAt ?? acc : acc),
        null
      ),
      note:
        'Rekomendasi hanya memuat model dengan status gratis TERVERIFIKASI dari sumber resmi provider. ' +
        'Mengaktifkan rekomendasi TIDAK dilakukan otomatis — Admin harus menyetujui.',
    });
  } catch (error) {
    console.error('[GET /api/admin/ai-config/recommend]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

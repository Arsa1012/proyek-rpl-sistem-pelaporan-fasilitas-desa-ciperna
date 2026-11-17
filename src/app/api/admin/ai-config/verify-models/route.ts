import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import {
  verifyFromOfficialCatalogs,
  manuallyVerifyModel,
  MANUAL_VERIFICATION_HINTS,
} from '@/lib/aiModelPolicy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/admin/ai-config/verify-models — verifikasi status gratis model.
 *
 * Mode 1 (tanpa body / body kosong): verifikasi otomatis dari KATALOG RESMI
 * provider. Hanya request GET metadata — tidak ada request generasi, tidak ada
 * biaya token.
 *
 * Mode 2 (body `manual`): verifikasi MANUAL oleh Admin untuk model yang
 * status gratisnya TIDAK dapat dibuktikan otomatis (Gemini & Groq: katalog resmi
 * tidak mencantumkan harga; tier gratis mengikuti status akun).
 * - `evidenceUrl` WAJIB domain resmi provider (allowlist) → bukti tidak bisa
 *   dikarang.
 * - `modelIds` WAJIB model yang ada di katalog resmi provider.
 *
 * Yang TIDAK dilakukan:
 *  - Tidak mengirim request generasi AI.
 *  - Tidak mengubah konfigurasi provider (tidak mengaktifkan/menonaktifkan).
 *  - Tidak menyentuh API Key.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await readJson(request);
    const manual = Array.isArray((body as any).manual) ? (body as any).manual : [];

    if (manual.length > 0) {
      const results: { provider: string; modelId: string; ok: boolean; error?: string }[] = [];

      for (const item of manual) {
        const provider = String(item?.provider || '').trim().toLowerCase();
        const modelId = String(item?.modelId || '').trim();
        const evidenceUrl = String(item?.evidenceUrl || '').trim();
        const notes = typeof item?.notes === 'string' ? item.notes : null;

        // Model harus benar-benar ada di katalog resmi provider.
        const catalog = await listCatalogModelIds(provider);

        if (!catalog.ok) {
          results.push({
            provider,
            modelId,
            ok: false,
            error:
              `Katalog resmi ${provider || '(tidak dikenal)'} tidak dapat dimuat sehingga ` +
              'verifikasi manual ditolak. ' +
              (catalog.error || 'Pastikan API Key tersimpan dan jaringan tersedia.'),
          });
          continue;
        }

        const r = await manuallyVerifyModel({
          provider,
          modelId,
          evidenceUrl,
          notes,
          // Gemini/Groq: katalog tanpa harga → status gratis bergantung akun
          // (ACCOUNT_DEPENDENT). OpenRouter: katalog memiliki harga → VERIFIED_FREE.
          status:
            provider === 'gemini' || provider === 'groq'
              ? 'ACCOUNT_DEPENDENT'
              : 'VERIFIED_FREE',
          knownModelIds: catalog.ids,
        });
        results.push(
          r.ok
            ? { provider, modelId, ok: true }
            : { provider, modelId, ok: false, error: r.error }
        );
      }

      const gagal = results.filter((r) => !r.ok);
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'AI_CONFIG_MANUAL_VERIFY',
        notes:
          `Verifikasi manual model gratis: berhasil=${results.length - gagal.length}, ` +
          `gagal=${gagal.length}. Nilai kunci tidak dicatat.`,
      });

      return NextResponse.json({
        success: gagal.length === 0,
        results,
        failed: gagal.length,
        note:
          'Verifikasi manual hanya sah bila URL bukti berada di domain resmi provider ' +
          'dan model tersedia di katalog resmi.',
        hints: MANUAL_VERIFICATION_HINTS,
      });
    }

    const summary = await verifyFromOfficialCatalogs();

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_VERIFY_MODELS',
      notes:
        `Verifikasi status gratis dari katalog resmi: ${summary.results
          .map((r) => `${r.provider} ok=${r.ok ? 'ya' : 'tidak'} model=${r.models} gratis=${r.verifiedFree}`)
          .join(' | ')}. Nilai kunci tidak dicatat.`,
    });

    return NextResponse.json({
      success: true,
      at: summary.at,
      results: summary.results,
      written: summary.written,
      keptManual: summary.keptManual,
      hints: MANUAL_VERIFICATION_HINTS,
      note:
        'Status gratis diperbarui dari katalog resmi provider. ' +
        'Model tanpa bukti resmi tetap berstatus UNVERIFIED dan tidak dipakai otomatis.',
    });
  } catch (error) {
    console.error('[POST /api/admin/ai-config/verify-models]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * Daftar id model yang tersedia di katalog resmi provider.
 * Dipakai sebagai penjaga: model yang tidak ada di katalog resmi tidak boleh
 * diverifikasi manual.
 *
 * `ok: false` berarti katalog TIDAK bisa dimuat — saat itu verifikasi manual
 * ditolak (bukan "model tidak ditemukan"), supaya alasannya jujur.
 */
async function listCatalogModelIds(
  provider: string
): Promise<{ ok: boolean; ids: string[]; error: string | null }> {
  try {
    const { fetchProviderCatalog } = await import('@/lib/aiCatalog');
    const result = await fetchProviderCatalog(provider);
    if (result.models.length === 0) {
      return {
        ok: false,
        ids: [],
        error: result.error || 'Katalog resmi tidak memuat model.',
      };
    }
    return { ok: true, ids: result.models.map((m) => m.id), error: null };
  } catch {
    return { ok: false, ids: [], error: 'Katalog resmi tidak dapat diakses.' };
  }
}

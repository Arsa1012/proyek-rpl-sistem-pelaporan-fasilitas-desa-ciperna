import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, notFound, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import { prisma } from '@/lib/prisma';
import {
  saveProviderApiKey,
  setProviderLabel,
  setProviderPrimaryModel,
  setProviderFallbackModels,
  deactivateProvider,
  listAiProviders,
  isEncryptionConfigured,
} from '@/lib/aiProviderConfig';
import { getModelStatus, isAllowedStatus } from '@/lib/aiModelPolicy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PATCH /api/admin/ai-config/[id] — ubah label / API Key / model utama /
 * daftar model cadangan / status aktif.
 *
 * Body:
 *   `{ label?, apiKey?, primaryModel?, fallbackModels?, models?, isActive? }`
 *
 * PERILAKU KUNCI:
 *  - `apiKey` KOSONG (atau tidak dikirim) = **pertahankan kunci lama**.
 *    Admin tidak perlu mengetik ulang kunci saat mengganti model.
 *  - Kunci provider LAIN tidak pernah tersentuh.
 *  - `apiKey` yang diisi → dienkripsi (AES-256-GCM) sebelum disimpan.
 *  - Response TIDAK pernah memuat nilai kunci (hanya `hasApiKey`).
 */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const body = await readJson(request);

    const existing = await prisma.aiProvider.findUnique({ where: { id } });
    if (!existing) return notFound('Provider tidak ditemukan');

    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (apiKey && !isEncryptionConfigured()) {
      return badRequest(
        'APP_ENCRYPTION_KEY belum dikonfigurasi di server, sehingga API Key tidak dapat disimpan terenkripsi. ' +
          'Hubungi pengelola server untuk mengatur kunci enkripsi terlebih dahulu.'
      );
    }

    // --- Model utama --------------------------------------------------------
    if (typeof body.primaryModel === 'string') {
      const modelId = body.primaryModel.trim();
      if (modelId) {
        // KEBIJAKAN MODEL GRATIS: model utama WAJIB berstatus gratis
        // terverifikasi. Model UNVERIFIED/PAID tidak boleh disimpan.
        const status = await getModelStatus(existing.provider, modelId);
        if (!isAllowedStatus(status)) {
          return badRequest(
            `Model "${modelId}" berstatus ${status} sehingga tidak dapat dijadikan model utama. ` +
              'Hanya model gratis yang statusnya TERVERIFIKASI dari sumber resmi provider yang boleh dipakai. ' +
              'Verifikasi model gratis dari katalog resmi terlebih dahulu.'
          );
        }
      }
      const result = await setProviderPrimaryModel(id, body.primaryModel);
      if (!result.ok) return badRequest(result.error);
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'AI_CONFIG_SET_PRIMARY_MODEL',
        notes: `Model utama provider "${result.provider.label}" diubah menjadi ${result.provider.primaryModel || '-'}.`,
      });
    }

    // --- Daftar model cadangan (urutan = prioritas) --------------------------
    if (Array.isArray(body.fallbackModels)) {
      const cleaned = body.fallbackModels.filter((m): m is string => typeof m === 'string');
      // Fallback WAJIB gratis terverifikasi (aturan fail-closed).
      for (const modelId of cleaned) {
        const id = modelId.trim();
        if (!id) continue;
        const status = await getModelStatus(existing.provider, id);
        if (!isAllowedStatus(status)) {
          return badRequest(
            `Model cadangan "${id}" berstatus ${status} sehingga tidak dapat disimpan. ` +
              'Hanya model gratis yang statusnya TERVERIFIKASI dari sumber resmi provider yang boleh dipakai.'
          );
        }
      }
      const result = await setProviderFallbackModels(id, cleaned);
      if (!result.ok) return badRequest(result.error);
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'AI_CONFIG_SET_FALLBACK_MODELS',
        notes: `Model cadangan provider "${result.provider.label}" diatur (jumlah=${result.provider.fallbackModels.length}).`,
      });
    }

    // --- Label --------------------------------------------------------------
    if (typeof body.label === 'string' && body.label.trim()) {
      const result = await setProviderLabel(id, body.label);
      if (!result.ok) return badRequest(result.error);
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'AI_CONFIG_UPDATE_LABEL',
        notes: `Label provider AI diubah menjadi "${result.provider.label}".`,
      });
    }

    // --- API Key (kosong = pertahankan yang lama) ----------------------------
    if (typeof body.apiKey === 'string') {
      const result = await saveProviderApiKey(id, apiKey);
      if (!result.ok) return badRequest(result.error);
      if (apiKey) {
        await logAdminAction({
          adminId: auth.session.userId,
          action: 'AI_CONFIG_UPDATE_KEY',
          notes: `API Key provider "${result.provider.label}" diganti (nilai tidak dicatat).`,
        });
      }
    }

    // --- Status aktif (nonaktifkan provider ini) ----------------------------
    if (body.isActive === false) {
      const result = await deactivateProvider(id);
      if (!result.ok) return badRequest(result.error);
      await logAdminAction({
        adminId: auth.session.userId,
        action: 'AI_CONFIG_DEACTIVATE',
        notes: `Provider AI "${result.provider.label}" dinonaktifkan (kunci tetap terenkripsi & tersimpan).`,
      });
    }

    const final = await getSafeProvider(id);
    if (!final) return notFound('Provider tidak ditemukan');

    return NextResponse.json({
      success: true,
      message: apiKey
        ? 'Konfigurasi provider AI berhasil diperbarui (API Key diganti).'
        : 'Konfigurasi provider AI berhasil diperbarui.',
      apiKeyUpdated: Boolean(apiKey),
      provider: final,
    });
  } catch (error) {
    console.error('[PATCH /api/admin/ai-config/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/ai-config/[id] — soft-delete.
 *
 * TIDAK ADA hard delete: provider dinonaktifkan dan kunci TIDAK dihapus dari
 * database (tetap terenkripsi) sehingga dapat diaktifkan kembali tanpa
 * mengetik ulang kunci.
 */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;
    const body = await readJson(request);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    const existing = await prisma.aiProvider.findUnique({ where: { id } });
    if (!existing) return notFound('Provider tidak ditemukan');

    const result = await deactivateProvider(id);
    if (!result.ok) return badRequest(result.error);

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_DISABLE',
      notes:
        `Provider AI "${result.provider.label}" dinonaktifkan (soft-delete)` +
        `${reason ? ` alasan="${reason}"` : ''}. Kunci tetap terenkripsi di database.`,
    });

    return NextResponse.json({
      success: true,
      message:
        'Provider dinonaktifkan. Kunci API tetap tersimpan terenkripsi dan dapat diaktifkan kembali.',
      provider: result.provider,
    });
  } catch (error) {
    console.error('[DELETE /api/admin/ai-config/[id]]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// --- Helper lokal ---------------------------------------------------------------

async function getSafeProvider(id: string) {
  const rows = await listAiProviders();
  return rows.find((r) => r.id === id) || null;
}

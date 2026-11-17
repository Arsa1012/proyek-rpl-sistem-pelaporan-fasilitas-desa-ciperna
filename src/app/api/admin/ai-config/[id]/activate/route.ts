import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, notFound } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import { activateProvider } from '@/lib/aiProviderConfig';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /api/admin/ai-config/[id]/activate — aktifkan satu provider AI.
 *
 * TRANSAKSI ATOMIK: provider lain yang aktif dinonaktifkan, provider ini
 * diaktifkan (dijamin juga oleh partial UNIQUE INDEX di database).
 *
 * Syarat aktivasi:
 *  - API Key sudah diisi (terenkripsi di database).
 *  - Model utama sudah dipilih.
 *
 * Pengaruh: provider aktif dipakai SEMUA pipeline AI pada permintaan
 * BERIKUTNYA (resolusi per request, tanpa cache).
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;

    // Validasi KEBIJAKAN MODEL GRATIS sebelum mengaktifkan: provider yang
    // model utamanya belum terverifikasi gratis TIDAK boleh diaktifkan
    // (fail-closed — tidak ada diam-diam memakai model berbayar).
    const { prisma } = await import('@/lib/prisma');
    const { getModelStatus, isAllowedStatus } = await import('@/lib/aiModelPolicy');
    const row = await prisma.aiProvider.findUnique({
      where: { id },
      select: { provider: true, label: true, primaryModel: true, apiKeyCipher: true },
    });
    if (!row) return notFound('Provider tidak ditemukan');
    if (!row.apiKeyCipher) {
      return badRequest('API Key provider belum diisi. Isi API Key lalu simpan sebelum mengaktifkan.');
    }
    if (!row.primaryModel) {
      return badRequest('Model utama belum dipilih. Isi model utama lalu simpan sebelum mengaktifkan.');
    }
    const primaryStatus = await getModelStatus(row.provider, row.primaryModel);
    if (!isAllowedStatus(primaryStatus)) {
      return badRequest(
        `Model utama "${row.primaryModel}" berstatus ${primaryStatus} sehingga provider ini tidak dapat diaktifkan. ` +
          'Hanya model gratis yang statusnya TERVERIFIKASI dari sumber resmi provider yang boleh dipakai. ' +
          'Verifikasi model gratis dari katalog resmi terlebih dahulu.'
      );
    }

    const result = await activateProvider(id);
    if (!result.ok) {
      if (result.error === 'Provider tidak ditemukan') return notFound(result.error);
      return badRequest(result.error);
    }

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_ACTIVATE',
      notes:
        `Provider AI "${result.provider.label}" (${result.provider.provider}) diaktifkan. ` +
        `Model utama=${result.provider.primaryModel} (status gratis ${primaryStatus}). Nilai kunci tidak dicatat.`,
    });

    return NextResponse.json({
      success: true,
      message: 'Provider AI aktif. Perubahan berlaku pada permintaan berikutnya.',
      provider: result.provider,
    });
  } catch (error) {
    console.error('[POST /api/admin/ai-config/[id]/activate]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

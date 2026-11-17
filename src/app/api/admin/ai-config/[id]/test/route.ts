import { NextResponse } from 'next/server';
import { requireAdmin, badRequest, notFound, readJson } from '@/lib/adminApi';
import { logAdminAction } from '@/lib/auditLog';
import { prisma } from '@/lib/prisma';
import { decryptProviderKey, recordProviderValidation } from '@/lib/aiProviderConfig';
import { getProviderSpec, callProvider, explainProviderError } from '@/lib/aiProviders';
import { SecretCryptoError } from '@/lib/secretCrypto';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Rate limit sederhana: maksimal 5 tes per menit per Admin.
 * In-memory (reset bila server restart) — cukup untuk mencegah klik berulang
 * yang memboroskan kuota provider.
 */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const testHits = new Map<string, number[]>();

function rateLimited(adminId: string): boolean {
  const now = Date.now();
  const hits = (testHits.get(adminId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    testHits.set(adminId, hits);
    return true;
  }
  hits.push(now);
  testHits.set(adminId, hits);
  return false;
}

/**
 * POST /api/admin/ai-config/[id]/test — TES KONEKTIVITAS.
 *
 * Melakukan 1 request nyata ke provider memakai kunci yang SUDAH terdekripsi
 * di server. Kunci TIDAK PERNAH dikirim ke klien maupun ditulis ke log.
 *
 * Body: `{ model? }` (opsional — bila kosong memakai model utama provider).
 * Response: `{ ok, provider, model, status, latencyMs, error? }`.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { id } = params;

    if (rateLimited(auth.session.userId)) {
      return NextResponse.json(
        { error: 'Terlalu banyak tes koneksi. Maksimal 5 tes per menit. Coba lagi sebentar.' },
        { status: 429 }
      );
    }

    const row = await prisma.aiProvider.findUnique({ where: { id } });
    if (!row) return notFound('Provider tidak ditemukan');

    const spec = getProviderSpec(row.provider);
    if (!spec) return badRequest(`Provider tidak dikenal: ${row.provider}`);

    const body = await readJson(request);
    const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
    const model = requestedModel || row.primaryModel || '';
    if (!model) {
      return badRequest('Model utama belum dipilih. Isi model utama atau kirim parameter model.');
    }

    // KEBIJAKAN BIAYA: jangan pernah mengirim request ke model BERBAYAR.
    // Model UNVERIFIED hanya boleh diuji bila Admin mengonfirmasi secara
    // eksplisit (biayanya belum pasti nol).
    const allowUnverified = body.allowUnverified === true;
    const { getModelStatus, isAllowedStatus } = await import('@/lib/aiModelPolicy');
    const modelStatus = await getModelStatus(row.provider, model);
    if (!isAllowedStatus(modelStatus)) {
      if (modelStatus === 'PAID') {
        return badRequest(
          `Model "${model}" terbukti BERBAYAR sehingga tidak diuji. ` +
            'Hanya model gratis terverifikasi yang boleh diuji koneksi.'
        );
      }
      if (!allowUnverified) {
        return badRequest(
          `Model "${model}" berstatus belum terverifikasi sehingga status biayanya belum pasti nol. ` +
            'Verifikasi model gratis dari katalog resmi terlebih dahulu, ' +
            'atau kirim ulang dengan allowUnverified=true untuk menguji dengan sengaja.'
        );
      }
    }

    if (!row.apiKeyCipher) {
      await recordProviderValidation(
        id,
        false,
        'api_key_missing',
        `Provider ${row.provider}: API Key belum diisi sehingga koneksi tidak dapat diuji.`
      );
      return badRequest('API Key provider belum diisi.');
    }

    let apiKey: string;
    try {
      apiKey = decryptProviderKey(row);
    } catch (e) {
      const code = e instanceof SecretCryptoError ? e.code : 'decrypt_failed';
      await recordProviderValidation(
        id,
        false,
        code,
        `Provider ${row.provider}: kunci tidak dapat dibaca (${code}).`
      );
      return badRequest(
        code === 'encryption_key_missing'
          ? 'APP_ENCRYPTION_KEY belum dikonfigurasi di server sehingga kunci tidak dapat dibaca.'
          : 'API Key tidak dapat didekripsi (kunci server berubah atau data rusak).'
      );
    }
    if (!apiKey) {
      await recordProviderValidation(
        id,
        false,
        'api_key_missing',
        `Provider ${row.provider}: API Key tersimpan kosong.`
      );
      return badRequest('API Key provider kosong.');
    }

    const result = await callProvider(spec, {
      apiKey,
      model,
      messages: [
        { role: 'system', content: 'Kamu adalah sneaky test konektivitas. Jawab satu kata: OK' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 16,
      temperature: 0,
      timeoutMs: 20000,
    });

    // DIAGNONSTIK: kategori error, HTTP status, model & provider yang dicoba.
    // Teks aman saja (tanpa kunci, ciphertext, atau isi respons mentah).
    const detail = result.ok
      ? null
      : [
          `Provider ${row.provider}`,
          `model ${model}`,
          `HTTP ${result.status ?? '-'}`,
          `kategori ${result.errorKind}`,
          'fallback: tidak dijalankan (hanya model ini yang diuji)',
        ].join(' · ');
    await recordProviderValidation(
      id,
      result.ok,
      result.ok ? null : result.errorKind,
      detail
    );

    await logAdminAction({
      adminId: auth.session.userId,
      action: 'AI_CONFIG_TEST_CONNECTION',
      notes:
        `Tes koneksi provider "${row.label}" model=${model} ` +
        `hasil=${result.ok ? 'ok' : result.errorKind} status=${result.status ?? '-'} ` +
        `latency=${result.latencyMs}ms. Nilai kunci tidak dicatat.`,
    });

    return NextResponse.json({
      ok: result.ok,
      provider: row.provider,
      providerLabel: row.label,
      model: result.model,
      status: result.status,
      latencyMs: result.latencyMs,
      error: result.ok ? null : result.error,
      errorKind: result.ok ? 'AI_OK' : result.errorKind,
      // Penjelasan aman & mudah dipahami untuk Admin.
      errorExplanation: result.ok ? null : explainProviderError(result.errorKind),
      verifiedSpec: spec.verified,
    });
  } catch (error) {
    console.error('[POST /api/admin/ai-config/[id]/test]', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

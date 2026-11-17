import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { handleChatRequest, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS } from '@/lib/aiChat';
import { loadLiveChatContext } from '@/lib/aiContext';
import { resolveActiveAiProvider, resolveAiProviderChain } from '@/lib/aiProviderConfig';
import { ensurePolicyFresh } from '@/lib/aiModelPolicy';

export const dynamic = 'force-dynamic';

// GET /api/admin/ai/chat — status koneksi asisten (ADMIN only, tanpa secret)
// Sumber kebenaran = KONFIGURASI AI terpusat (tabel AiProvider), bukan `.env`.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }
  try {
    // Status mengikuti RANTAI yang benar-benar dipakai pipeline.
    const chain = await resolveAiProviderChain();
    const resolved = await resolveActiveAiProvider();
    const usable = chain.attempts.flatMap((a) =>
      a.modelChain.map((m) => ({ provider: a.provider, model: m }))
    );
    return NextResponse.json({
      connected: usable.length > 0,
      provider: resolved.providerLabel || resolved.provider || null,
      model: resolved.primaryModel,
      source: resolved.source,
      usableModels: usable,
      problems: chain.problems,
    });
  } catch {
    return NextResponse.json({ connected: false, provider: null, model: null, source: 'error' });
  }
}

// POST /api/admin/ai/chat — AI Assistant Admin berbasis data aktual (ADMIN only, READ-ONLY)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  if (session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Akses ditolak. Hanya Admin.' }, { status: 403 });
  }

  const rate = rateLimit(`admin-ai-chat:${session.userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak pesan. Coba lagi sebentar.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const hasMessage = typeof body?.message === 'string' && body.message.trim().length > 0;

  // Jaring pengaman: segarkan registry status gratis (katalog resmi, GET
  // metadata) sebelum pipeline memilih model.
  try {
    await ensurePolicyFresh();
  } catch {
    /* best-effort */
  }

  const liveContext = hasMessage ? await loadLiveChatContext('ADMIN', session.userId) : undefined;
  const { status, json } = await handleChatRequest('ADMIN', session.userId, body, 'Admin AI Chat', liveContext);
  return NextResponse.json(json, { status });
}

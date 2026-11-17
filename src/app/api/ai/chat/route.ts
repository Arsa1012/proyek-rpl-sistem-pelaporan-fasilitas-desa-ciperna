import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { handleChatRequest, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS } from '@/lib/aiChat';
import { loadLiveChatContext } from '@/lib/aiContext';
import { resolveActiveAiProvider, resolveAiProviderChain } from '@/lib/aiProviderConfig';
import { ensurePolicyFresh } from '@/lib/aiModelPolicy';
import type { ChatRole } from '@/lib/aiTools';

export const dynamic = 'force-dynamic';

// GET /api/ai/chat - status koneksi asisten untuk semua role yang login.
// Hanya mengembalikan status boolean; API key tidak pernah dikirim ke browser.
// Sumber kebenaran = KONFIGURASI AI terpusat (tabel AiProvider), bukan `.env`.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  try {
    // Status mengikuti RANTAI yang benar-benar dipakai pipeline (bukan hanya
    // provider aktif) sehingga tidak berbeda dengan kenyataan.
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

// POST /api/ai/chat - AI Assistant berbasis data database (READ-ONLY, semua role)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  // Role & userId SELALU dari session server — tidak dipercaya dari frontend
  const role = session.role as ChatRole;
  const userId = session.userId;

  const rate = rateLimit(`ai-chat:${userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak pesan. Coba lagi sebentar.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const hasMessage = typeof body?.message === 'string' && body.message.trim().length > 0;

  // Jaring pengaman: pastikan registry status gratis mutakhir (dari katalog
  // RESMI provider, hanya GET metadata) sebelum pipeline memilih model.
  // Tanpa ini, model tanpa bukti gratis tidak akan pernah dipakai.
  try {
    await ensurePolicyFresh();
  } catch {
    /* best-effort */
  }

  // Muat konteks live SEBELUM pipeline AI: statistik, profil desa, dan
  // laporan/tugas terbaru sesuai role. Query tetap terpusat di aiContext.ts.
  const liveContext = hasMessage ? await loadLiveChatContext(role, userId) : undefined;
  const { status, json } = await handleChatRequest(role, userId, body, 'AI Chat', liveContext);
  return NextResponse.json(json, { status });
}

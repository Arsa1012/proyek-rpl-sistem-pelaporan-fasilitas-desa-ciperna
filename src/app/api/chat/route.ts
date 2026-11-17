import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rateLimit';
import { handleChatRequest, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS } from '@/lib/aiChat';
import { loadLiveChatContext } from '@/lib/aiContext';
import type { ChatRole } from '@/lib/aiTools';

export const dynamic = 'force-dynamic';

/**
 * POST /api/chat — endpoint chatbot yang melayani SEMUA role.
 *
 * Dulu endpoint ini memakai lib/chatbot.ts yang HANYA berisi prompt statis
 * tanpa akses database, sehingga jawabannya bisa berbeda dari Asisten yang
 * dipakai UI (/api/ai/chat). Sekarang endpoint ini didelegasikan ke pipeline
 * yang SAMA (aiIntent -> aiToolRegistry -> LLM). Role SELALU diambil dari
 * session server, tidak dari body, sehingga Warga/Petugas/Admin mendapat
 * konteks dan batas akses yang sesuai.
 *
 * Sebelum pipeline AI berjalan, route ini memuat konteks live lewat
 * loadLiveChatContext(role, userId): profil desa, statistik laporan, statistik
 * akun (Admin/Petugas), serta laporan/tugas terbaru SESUAI ROLE. Query Prisma
 * tetap terpusat di lib/aiContext.ts (tidak diduplikasi di route), lalu konteks
 * diteruskan ke handleChatRequest agar tidak ada query ganda. Dengan begitu
 * /api/chat, /api/ai/chat, dan /api/admin/ai/chat memakai jalur data yang sama.
 *
 * Respons menyertakan `answer` (bentuk baru) dan `reply` (bentuk lama) agar
 * pemanggil lama tidak rusak.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  const role = session.role as ChatRole;

  const rate = rateLimit(`chat:${session.userId}`, CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Terlalu banyak pesan. Coba lagi sebentar.' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const hasMessage = typeof body?.message === 'string' && body.message.trim().length > 0;
  const liveContext = hasMessage ? await loadLiveChatContext(role, session.userId) : undefined;
  const { status, json } = await handleChatRequest(role, session.userId, body, 'API Chat', liveContext);
  return NextResponse.json(
    json?.success ? { ...json, reply: json.answer } : json,
    { status }
  );
}

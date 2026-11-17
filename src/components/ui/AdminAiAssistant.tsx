'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { describeFailure, failureFromUnknown, safeJson, type FailureInfo } from '@/lib/clientFeedback';
import { CHAT_HISTORY_TURNS } from '@/lib/aiTypes';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  meta?: AssistantMeta;
}

interface AssistantMeta {
  atWib?: string;
  tools?: string[];
  sources?: string[];
  period?: string | null;
  partial?: boolean;
  fallback?: boolean;
  latencyMs?: number;
  /** Provider yang benar-benar menjawab. */
  usedProvider?: string | null;
  /** Model yang benar-benar menjawab. */
  usedModel?: string | null;
  /** true bila jawaban datang dari model cadangan. */
  isFallback?: boolean;
  /** Alasan fallback (ringkas, tanpa secret). */
  fallbackReason?: string | null;
  /** Sumber jawaban: 'llm' (dari model) atau 'deterministic' (dari data lokal). */
  answerSource?: 'llm' | 'deterministic';
  /** Model yang GAGAL dan dicoba sebelum yang berhasil. */
  fallbackModels?: string[];
  /** Provider cadangan yang dipakai bila provider utama gagal. */
  fallbackProvider?: string | null;
  /** Urutan percobaan provider. */
  providerChain?: string[];
}

const QUICK_QUESTIONS = [
  '📊 Ringkasan Sistem',
  '📋 Laporan Terbaru',
  '⚠️ Laporan Severity Tinggi',
  '🔍 Laporan Duplikat',
  '👷 Penugasan Petugas',
  '⏳ Menunggu Verifikasi',
  '✅ Laporan Selesai',
  '🕒 Laporan Belum Selesai',
  '📣 Pengumuman Aktif',
  '💬 Notifikasi WA Gagal',
  '📈 Bulan Ini vs Bulan Lalu',
  '🔎 Cari Kata Kunci',
  '📊 Rekap per Status',
  '👥 Akun Nonaktif',
  '🗺️ Wilayah RT/RW',
  '📅 Laporan Agustus',
];

const QUICK_MAP: Record<string, string> = {
  '📊 Ringkasan Sistem': 'Bagaimana kondisi laporan desa saat ini?',
  '📋 Laporan Terbaru': 'Tampilkan laporan terbaru.',
  '⚠️ Laporan Severity Tinggi': 'Tampilkan laporan severity tinggi yang belum selesai.',
  '🔍 Laporan Duplikat': 'Apakah ada laporan duplikat?',
  '👷 Penugasan Petugas': 'Petugas mana yang memiliki tugas paling banyak?',
  '⏳ Menunggu Verifikasi': 'Berapa laporan yang menunggu verifikasi?',
  '✅ Laporan Selesai': 'Berapa laporan yang sudah selesai?',
  '🕒 Laporan Belum Selesai': 'Ada berapa laporan yang belum selesai?',
  '📣 Pengumuman Aktif': 'Pengumuman apa yang masih aktif?',
  '💬 Notifikasi WA Gagal': 'Berapa notifikasi WhatsApp yang gagal?',
  '📈 Bulan Ini vs Bulan Lalu': 'Laporan bulan ini lebih banyak dari bulan lalu?',
  '🔎 Cari Kata Kunci': 'Cari laporan dengan kata kunci lubang',
  '📊 Rekap per Status': 'Rekap laporan per status bulan ini',
  '👥 Akun Nonaktif': 'Siapa warga yang akunnya dinonaktifkan?',
  '🗺️ Wilayah RT/RW': 'Ringkas data wilayah RT/RW',
  '📅 Laporan Agustus': 'Berapa laporan bulan Agustus 2025?',
};

// Urutan penting: label sumber yang lebih spesifik diperiksa lebih dulu.
// Tanpa ini "Laporan (belum ditugaskan)" cocok dengan /tugas/ dan salah
// diarahkan ke menu Data Petugas, padahal datanya ada di menu Laporan.
const SOURCE_LINKS: { match: RegExp; href: string; label: string }[] = [
  { match: /^Data petugas/i, href: '/admin/petugas', label: 'Data Petugas' },
  { match: /^Data akun|^Data pelapor/i, href: '/admin/masyarakat', label: 'Data Warga' },
  { match: /^Laporan|^Statistik laporan/i, href: '/admin/laporan', label: 'Laporan' },
  { match: /^Pengumuman/i, href: '/admin/pengumuman', label: 'Pengumuman' },
  { match: /whatsapp/i, href: '/admin/pengumuman', label: 'Pengumuman & Status WA' },
  { match: /wilayah|rt\/rw/i, href: '/admin/wilayah', label: 'Wilayah RT/RW' },
  { match: /^Struktur pemerintahan|^Pemerintahan/i, href: '/admin/pemerintahan', label: 'Pemerintahan' },
  { match: /^Layanan desa/i, href: '/admin/layanan-desa', label: 'Layanan Desa' },
  { match: /^Profil desa \(lokasi\)/i, href: '/admin/map', label: 'Peta Desa' },
  { match: /^Profil desa/i, href: '/admin/profil-desa', label: 'Profil Desa' },
];

function sourceLinks(meta?: AssistantMeta): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  for (const s of meta?.sources || []) {
    for (const rule of SOURCE_LINKS) {
      if (rule.match.test(s)) {
        if (!out.some((x) => x.href === rule.href)) out.push({ href: rule.href, label: rule.label });
        break;
      }
    }
  }
  return out.slice(0, 3);
}

/** ID sesi lokal untuk riwayat percakapan server (TTL terbatas).
 * Di-reset saat percakapan baru agar konteks lama tidak terbawa. */
function newChatSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AdminAiAssistant({ userName }: { userName?: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState(newChatSessionId);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        (userName?.trim()
          ? `Halo, ${userName.trim()}! 👋\n\n`
          : 'Halo! 👋\n\n') +
        'Selamat datang di pusat kendali Sistem Pelaporan Desa Ciperna.\n\n' +
        'Saya siap membantu memeriksa laporan warga, verifikasi, penugasan petugas, statistik, data akun, wilayah, dan pengumuman berdasarkan data aktual. Silakan bertanya dengan bahasa sehari-hari.\n\n' +
        'Dashboard boleh ramai; kita bereskan satu per satu, tenang saja.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FailureInfo | null>(null);
  const [failedText, setFailedText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    fetch('/api/admin/ai/chat')
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    const force = last?.role === 'assistant';
    if (!nearBottomRef.current && !force) return;
    const frame = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, loading]);

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  async function send(text?: string, retry = false) {
    const content = (text ?? (retry ? failedText : input)).trim();
    if (!content || loading) return;

    const base: Message[] = retry ? messages : [...messages, { role: 'user', content }];
    if (!retry) {
      setMessages(base);
      setInput('');
    }
    setFailure(null);
    setFailedText('');
    setLoading(true);
    nearBottomRef.current = true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);

    try {
      const res = await fetch('/api/admin/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ message: content, history: base.slice(-(CHAT_HISTORY_TURNS + 1), -1), sessionId }),
      });
      const data = await safeJson<{ answer?: string; error?: string; meta?: AssistantMeta }>(res);
      if (!res.ok) {
        setFailure(describeFailure(res, data));
        setFailedText(content);
        return;
      }
      if (typeof data?.answer !== 'string' || !data.answer.trim()) {
        setFailure({
          kind: 'server',
          retryable: true,
          message: 'Jawaban asisten tidak valid. Silakan coba lagi.',
        });
        setFailedText(content);
        return;
      }
      setMessages([...base, { role: 'assistant', content: data.answer, meta: data.meta }]);
    } catch (err) {
      setFailure(failureFromUnknown(err));
      setFailedText(content);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  /** Mulai percakapan baru: buang riwayat agar konteks lama tidak terbawa. */
  function clearConversation() {
    setMessages([
      {
        role: 'assistant',
        content:
          (userName?.trim()
            ? `Halo, ${userName.trim()}! 👋\n\n`
            : 'Halo! 👋\n\n') +
          'Percakapan baru dimulai. Saya siap membantu Admin memeriksa laporan, status verifikasi, penugasan petugas, statistik, data akun, wilayah, dan pengumuman berdasarkan data aktual database. Saya hanya dapat membaca data, tidak dapat mengubahnya.',
      },
    ]);
    // Sesi bersih = riwayat server juga dianggap biru (seed baru).
    setSessionId(newChatSessionId());
    setFailure(null);
    setFailedText('');
    setInput('');
    nearBottomRef.current = true;
  }

  return (
    <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '1.75rem' }} aria-hidden="true">🤖</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>AI Assistant Admin</h3>
          <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              style={{
                width: '0.55rem', height: '0.55rem', borderRadius: '50%',
                background: connected === null ? 'var(--text-secondary)' : connected ? 'var(--success-color)' : 'var(--severity-medium)',
                display: 'inline-block',
              }}
            />
            {connected === null
              ? 'Memeriksa koneksi…'
              : connected
                ? 'Siap membantu dengan data aktual'
                : 'Mode ringkasan data (jawaban langsung dari database)'}
          </p>
        </div>
        <button
          type="button"
          onClick={clearConversation}
          disabled={loading}
          title="Mulai percakapan baru"
          aria-label="Mulai percakapan baru"
          style={{
            border: '1px solid var(--divider)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            borderRadius: '8px',
            padding: '0.35rem 0.6rem',
            fontSize: '0.75rem',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          🗑 Percakapan baru
        </button>
      </div>

      <div
        ref={bodyRef}
        onScroll={onBodyScroll}
        role="log"
        aria-live="polite"
        aria-label="Riwayat percakapan asisten admin"
        style={{ maxHeight: '420px', overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
      >
        {messages.map((m, i) => {
          const links = m.role === 'assistant' ? sourceLinks(m.meta) : [];
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div className={`chatbot-msg chatbot-msg-${m.role}`} style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {m.content}
              </div>
              {m.role === 'assistant' && m.meta && (m.meta.sources?.length || m.meta.atWib) && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.4rem 0.75rem', alignItems: 'center', minWidth: 0 }}>
                  {m.meta.atWib && <span>Data diperiksa pada {m.meta.atWib}</span>}
                  {m.meta.period && <span>Periode: {m.meta.period}</span>}
                  {m.meta.sources?.length ? <span>Sumber data: {m.meta.sources.join(', ')}</span> : null}
                  {m.meta.partial && <span style={{ color: 'var(--danger-text)' }}>Sebagian data belum berhasil dimuat</span>}
                  {/* Sumber jawaban: LLM vs deterministik (dilarang disamarkan). */}
                  {m.meta.answerSource === 'deterministic' ? (
                    <span
                      title={m.meta.fallbackReason || 'Jawaban disusun dari data lokal, bukan dari model AI.'}
                      style={{ color: '#92400e', fontWeight: 700 }}
                    >
                      Jawaban lokal (bukan dari model AI)
                    </span>
                  ) : m.meta.usedProvider ? (
                    <span
                      title={
                        m.meta.providerChain && m.meta.providerChain.length > 0
                          ? `Rantai percobaan: ${m.meta.providerChain.join(' → ')}`
                          : undefined
                      }
                      style={{ color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      AI: {m.meta.usedProvider} — {m.meta.usedModel || '-'}
                      {m.meta.isFallback ? ' (Fallback)' : ''}
                    </span>
                  ) : null}
                  {m.meta.fallbackModels && m.meta.fallbackModels.length > 0 && (
                    <span
                      title={
                        m.meta.providerChain && m.meta.providerChain.length > 0
                          ? `Rantai percobaan: ${m.meta.providerChain.join(' → ')}`
                          : undefined
                      }
                      style={{ color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      Dijawab model cadangan: {m.meta.usedModel || m.meta.fallbackModels[m.meta.fallbackModels.length - 1]}
                      {m.meta.fallbackProvider ? ` (provider ${m.meta.fallbackProvider})` : ''}
                    </span>
                  )}
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      style={{ color: 'var(--primary-color)', fontWeight: 600 }}
                    >
                      Lihat data sumber: {link.label} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="chatbot-msg chatbot-msg-assistant chatbot-typing" aria-label="Asisten sedang mengetik">
            <span /> <span /> <span />
          </div>
        )}
        {failure && (
          <div className="chatbot-error" role="alert">
            <span>⚠️ {failure.message}</span>
            {failure.retryable && failedText && (
              <button
                type="button"
                className="chatbot-retry"
                onClick={() => send(failedText, true)}
                disabled={loading}
              >
                Coba lagi
              </button>
            )}
          </div>
        )}
      </div>

      <div className="chatbot-quick">
        {QUICK_QUESTIONS.map((q) => (
          <button key={q} type="button" className="chatbot-chip" onClick={() => send(QUICK_MAP[q])} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      <form
        className="chatbot-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          className="chatbot-input"
          placeholder="Tanya tentang data sistem…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={1000}
          aria-label="Tanya asisten admin"
        />
        <button type="submit" className="btn btn-primary chatbot-send" disabled={loading || !input.trim()} aria-label="Kirim">
          {loading ? '...' : '➤'}
        </button>
      </form>
    </div>
  );
}

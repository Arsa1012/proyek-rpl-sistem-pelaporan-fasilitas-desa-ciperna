'use client';

import { useEffect, useRef, useState } from 'react';
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
}

const QUICK_MAIN_WARGA = [
  { label: '📝 Cara buat laporan', key: 'createReport', query: 'Bagaimana cara membuat laporan fasilitas umum?' },
  { label: '📋 Laporan saya', key: 'myReports', query: 'Laporan saya apa saja? Statusnya bagaimana?' },
  { label: '🏘️ Profil desa', key: 'villageProfile', query: 'Di mana lokasi Desa Ciperna?' },
] as const;

const QUICK_GROUPS_WARGA: { key: string; label: string; items: string[] }[] = [
  {
    key: 'laporan',
    label: '📋 Laporan',
    items: [
      '🔍 Laporan yang sedang saya kerjakan',
      '⏳ Berapa laporan menunggu verifikasi',
      '✅ Berapa laporan yang sudah selesai',
      '🕒 Berapa laporan yang belum selesai',
      '📈 Banyak laporan bulan ini dari bulan lalu',
      '📊 Rekap per status laporan',
    ],
  },
  {
    key: 'desa',
    label: '🏘️ Desa',
    items: [
      '📍 Lokasi desa dan peta',
      '📢 Pengumuman terbaru',
      '📞 Kontak perangkat desa',
      '🚏 Layanan desa yang tersedia',
    ],
  },
  {
    key: 'fitur',
    label: '🔧 Fitur',
    items: [
      '🔄 Cara mengubah password akun',
      '⚠️ Apa yang dilakukan jika akun nonaktif',
      '📋 Jadwal pengumuman desa',
      '🔙 Kembali ke beranda',
    ],
  },
];

const QUICK_MAP_WARGA: Record<string, string> = {
  '📝 Cara buat laporan': 'Bagaimana cara membuat laporan fasilitas umum?',
  '📋 Laporan saya': 'Laporan saya apa saja? Statusnya bagaimana?',
  '🏘️ Profil desa': 'Di mana lokasi Desa Ciperna?',
  '🔍 Laporan yang sedang saya kerjakan': 'Tampilkan laporan yang sedang saya kerjakan.',
  '⏳ Berapa laporan menunggu verifikasi': 'Berapa laporan yang menunggu verifikasi?',
  '✅ Berapa laporan yang sudah selesai': 'Berapa laporan yang sudah selesai?',
  '🕒 Berapa laporan yang belum selesai': 'Ada berapa laporan yang belum selesai?',
  '📈 Banyak laporan bulan ini dari bulan lalu': 'Laporan bulan ini lebih banyak dari bulan lalu?',
  '📊 Rekap per status laporan': 'Rekap laporan per status saat ini',
  '📍 Lokasi desa dan peta': 'Tampilkan lokasi dan peta Desa Ciperna.',
  '📢 Pengumuman terbaru': 'Ada pengumuman apa saja hari ini?',
  '📞 Kontak perangkat desa': 'Siapa perangkat desa yang terdaftar?',
  '🚏 Layanan desa yang tersedia': 'Layanan desa apa saja yang tersedia?',
  '🔄 Cara mengubah password akun': 'Bagaimana cara mengubah password akun saya?',
  '⚠️ Apa yang dilakukan jika akun nonaktif': 'Apa yang terjadi jika akun saya nonaktif?',
  '📋 Jadwal pengumuman desa': 'Kapan pengumuman desa selanjutnya?',
  '🔙 Kembali ke beranda': 'Buka beranda Desa Ciperna.',
};

const GREETINGS_WARGA = (userName?: string) => {
  const name = userName ? userName.trim() : '';
  if (name) {
    return (
      `Halo, ${name}! 👋\n\n` +
      `Saya Asisten Desa Ciperna. Bantu jawab pertanyaan Anda tentang laporan, profil desa, pengumuman, dan fitur website dengan data aktual. ` +
      'Silakan tanya apa saja, atau gunakan tombol di bawah.'
    );
  }
  return (
    'Halo! 👋\n\n' +
    'Saya Asisten Desa Ciperna. Bantu jawab pertanyaan Anda tentang laporan, profil desa, pengumuman, dan fitur website dengan data aktual. ' +
    'Silakan tanya apa saja, atau gunakan tombol di bawah.'
  );
};

/** ID sesi lokal untuk riwayat percakapan server (TTL terbatas).
 * Di-reset saat percakapan baru agar konteks lama tidak terbawa. */
function newChatSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function Chatbot({ role = 'CITIZEN', userName }: { role?: string; userName?: string }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: GREETINGS_WARGA(userName) },
  ]);
  const [sessionId, setSessionId] = useState(newChatSessionId);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FailureInfo | null>(null);
  const [failedText, setFailedText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  function toggleMinimize() {
    setMinimized((v) => !v);
  }

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['laporan', 'desa']));
  const [menuOpen, setMenuOpen] = useState(false);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleMenu() {
    setMenuOpen((v) => !v);
  }

  // Klik di luar panel (hanya jika ditargetkan atas/ismu panel) menutup panel.
  function handlePanelMouseDown(e: React.MouseEvent) {
    if (e.target === e.currentTarget) setOpen(false);
  }

  // Cek koneksi backend AI (tanpa mengirim pesan)
  useEffect(() => {
    fetch('/api/ai/chat')
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, []);

  // Autoscroll ke pesan terakhir, kecuali pengguna sedang membaca pesan lama.
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
  }, [messages, loading, open]);

  // Tutup percakapan, mengingat posisi baca pengguna terkait
  function clearConversation() {
    setMessages([{ role: 'assistant', content: GREETINGS_WARGA(userName) }]);
    // Sesi bersih = riwayat server juga dianggap biru (seed baru), sehingga
    // jawaban lanjutan tidak lagi merujuk laporan dari sesi sebelumnya.
    setSessionId(newChatSessionId());
    setFailure(null);
    setFailedText('');
    setInput('');
    nearBottomRef.current = true;
  }

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  async function send(text?: string, retry = false) {
    const content = (text ?? (retry ? failedText : input)).trim();
    if (!content || loading) return;

    // Saat retry, pesan pengguna sudah ada di daftar — jangan digandakan.
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
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: content,
          history: base.slice(-(CHAT_HISTORY_TURNS + 1), -1),
          sessionId,
        }),
      });
      const data = await safeJson<{ answer?: string; error?: string }>(res);
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
      setMessages([...base, { role: 'assistant', content: data.answer }]);
    } catch (err) {
      setFailure(failureFromUnknown(err));
      setFailedText(content);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <div
      className="chatbot-root"
      style={{ zIndex: 1100, right: '1.25rem', bottom: '1.25rem' }}
    >
      {open && (
        <div
          className="chatbot-panel glass"
          role="dialog"
          aria-label="Asisten AI Desa Ciperna"
          onMouseDown={handlePanelMouseDown}
        >
          {/* ===== Header: judul + status + kontrol ===== */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--divider)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              cursor: minimized ? 'pointer' : 'default',
              backgroundColor: '#0F766E',
            }}
            onClick={minimized ? toggleMinimize : undefined}
          >
            <span style={{ fontSize: '1.5rem' }} aria-hidden="true">
              🤖
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
                Asisten Desa Ciperna
              </h3>
              <p
                style={{
                  margin: '0.08rem 0 0',
                  fontSize: '0.7rem',
                  color: 'rgba(255,255,255,0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <span
                  style={{
                    width: '0.45rem',
                    height: '0.45rem',
                    borderRadius: '50%',
                    background: connected === null ? '#9ca3af' : connected ? '#10b981' : '#f59e0b',
                    display: 'inline-block',
                  }}
                />
                {connected === null
                  ? 'Memeriksa koneksi…'
                  : connected
                    ? 'Siap bantu data aktual'
                    : 'Mode ringkasan data (database)'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMinimize();
                }}
                disabled={loading}
                title={minimized ? 'Perluas panel' : 'Minimize panel'}
                aria-label={minimized ? 'Perluas panel' : 'Minimize panel'}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {minimized ? '▲' : '▼'}
              </button>
              <button
                type="button"
                onClick={clearConversation}
                disabled={loading}
                title="Mulai percakapan baru"
                aria-label="Mulai percakapan baru"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '8px',
                  padding: '0.3rem 0.5rem',
                  fontSize: '0.75rem',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                🗑
              </button>
            </div>
          </div>

          {/* ===== Body: area pesan utama (scrollable) ===== */}
          {!minimized && (
            <div
              ref={bodyRef}
              onScroll={onBodyScroll}
              role="log"
              aria-live="polite"
              aria-label="Riwayat percakapan asisten Desa Ciperna"
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                background: 'var(--surface-3)',
              }}
            >
              {messages.map((m, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div
                    className={`chatbot-msg chatbot-msg-${m.role}`}
                    style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div
                  className="chatbot-msg chatbot-msg-assistant chatbot-typing"
                  aria-label="Asisten sedang mengetik"
                >
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
          )}

          {/* ===== Quick buttons: 3 utama + menu pertanyaan (drop-down) ===== */}
          {!minimized && (
            <div className="chatbot-quick" style={{ padding: '0.4rem 0.75rem' }}>
              {/* 3 tombol utama selalu tampil */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                {QUICK_MAIN_WARGA.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    className="chatbot-chip"
                    onClick={() => send(q.query)}
                    disabled={loading}
                  >
                    {q.label}
                  </button>
                ))}
              </div>

              {/* Tombol "Menu pertanyaan" — menyembunyikan/ menampilkan kategori lain */}
              <div style={{ marginTop: '0.4rem' }}>
                <button
                  type="button"
                  onClick={toggleMenu}
                  style={{
                    width: '100%',
                    background: 'transparent',
                    border: '1px dashed var(--soft-primary-border)',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: 'var(--soft-primary-text, var(--primary-color))',
                    cursor: 'pointer',
                    padding: '0.35rem 0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.4rem',
                  }}
                >
                  ☰ Menu pertanyaan
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {menuOpen ? '▲' : '▼'}
                  </span>
                </button>
                {menuOpen && (
                  <div style={{ marginTop: '0.25rem' }}>
                    {QUICK_GROUPS_WARGA.map((group) => (
                      <div
                        key={group.key}
                        style={{
                          borderTop: '1px solid var(--divider)',
                          paddingTop: '0.3rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.2rem',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(group.key)}
                          style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            color: 'var(--soft-primary-text, var(--primary-color))',
                            cursor: 'pointer',
                            padding: '0.2rem 0.4rem',
                            textAlign: 'left',
                          }}
                        >
                          {group.label}
                        </button>
                        {expandedGroups.has(group.key) && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {group.items.map((q) => (
                              <button
                                key={q}
                                type="button"
                                className="chatbot-chip"
                                onClick={() => send(QUICK_MAP_WARGA[q])}
                                disabled={loading}
                                style={{ fontSize: '0.62rem', padding: '0.18rem 0.45rem' }}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== Footer: input + kirim (selalu tampil) ===== */}
          <form
            className="chatbot-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            style={{ padding: '0.7rem 1rem' }}
          >
            <input
              type="text"
              className="chatbot-input"
              placeholder="Ketik pertanyaan…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={1000}
              aria-label="Tanya asisten Desa Ciperna"
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn btn-primary chatbot-send"
              disabled={loading || !input.trim()}
              aria-label="Kirim"
              style={{ flexShrink: 0, width: '2.4rem', height: '2.4rem', padding: '0.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {loading ? '…' : '➤'}
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="chatbot-fab"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Tutup chatbot' : 'Buka chatbot'}
        aria-expanded={open}
      >
        {open ? '✕' : '💬'}
      </button>
    </div>
  );
}

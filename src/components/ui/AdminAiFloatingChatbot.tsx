'use client';

import { useEffect, useRef, useState } from 'react';
import { describeFailure, failureFromUnknown, safeJson, type FailureInfo } from '@/lib/clientFeedback';
import { CHAT_HISTORY_TURNS } from '@/lib/aiTypes';

// ===== Quick questions khusus Admin =====
// 3 shortcut utama yang selalu tampil di area percakapan.
// Klik lain tersembunyi di "Menu pertanyaan" (drop-down) agar pesan utama selalu terlihat.
const QUICK_MAIN = [
  { label: '📋 Laporan Terbaru', key: 'recentReports', query: 'Tampilkan laporan terbaru.' },
  { label: '📊 Ringkasan Sistem', key: 'systemSummary', query: 'Bagaimana kondisi laporan desa saat ini?' },
  { label: '⚠️ Laporan Severity Tinggi', key: 'highSeverity', query: 'Tampilkan laporan severity tinggi yang belum selesai.' },
] as const;

// Kategori lainnya: setiap kategori dapat dibuka/tutup (drop-down kategorikal).
const QUICK_GROUPS: { key: string; label: string; items: string[] }[] = [
  {
    key: 'laporan',
    label: '📋 Laporan',
    items: [
      '🔍 Laporan Duplikat',
      '⏳ Menunggu Verifikasi',
      '✅ Laporan Selesai',
      '🕒 Laporan Belum Selesai',
      '📈 Bulan Ini vs Bulan Lalu',
      '📊 Rekap per Status',
    ],
  },
  {
    key: 'petugas',
    label: '👷 Petugas',
    items: [
      '👷 Penugasan Petugas',
      '⏳ Menunggu verifikasi bukti',
      '📊 Rekap tugas petugas',
    ],
  },
  {
    key: 'statistik',
    label: '📈 Statistik',
    items: [
      '📊 Statistik per kategori',
      '📊 Statistik per tingkat keparahan',
      '⏱️ Rata-rata waktu penyelesaian',
    ],
  },
  {
    key: 'akun',
    label: '👥 Akun',
    items: [
      '👥 Akun warga (Admin)',
      '👷 Data petugas',
      '📅 Pendaftaran terbaru',
    ],
  },
  {
    key: 'wilayah',
    label: '🗺️ Wilayah',
    items: [
      '🗺️ Wilayah RT/RW',
      '📍 Lokasi laporan terbanyak',
      '🏘️ Profil desa (lokasi)',
    ],
  },
];

// Query map for all shortcuts (including main 3).
const QUICK_MAP: Record<string, string> = {
  '📋 Laporan Terbaru': 'Tampilkan laporan terbaru.',
  '📊 Ringkasan Sistem': 'Bagaimana kondisi laporan desa saat ini?',
  '⚠️ Laporan Severity Tinggi': 'Tampilkan laporan severity tinggi yang belum selesai.',
  '🔎 Cari Kata Kunci': 'Cari laporan dengan kata kunci lubang',
  '📣 Pengumuman Aktif': 'Pengumuman apa yang masih aktif?',
  '👥 Akun Nonaktif': 'Siapa warga yang akunnya dinonaktifkan?',
  '🔍 Laporan Duplikat': 'Apakah ada laporan duplikat?',
  '⏳ Menunggu Verifikasi': 'Berapa laporan yang menunggu verifikasi?',
  '✅ Laporan Selesai': 'Berapa laporan yang sudah selesai?',
  '🕒 Laporan Belum Selesai': 'Ada berapa laporan yang belum selesai?',
  '📈 Bulan Ini vs Bulan Lalu': 'Laporan bulan ini lebih banyak dari bulan lalu?',
  '📊 Rekap per Status': 'Rekap laporan per status bulan ini',
  '👷 Penugasan Petugas': 'Petugas mana yang memiliki tugas paling banyak?',
  '⏳ Menunggu verifikasi bukti': 'Berapa laporan yang menunggu verifikasi hasil?',
  '📊 Rekap tugas petugas': 'Ringkasan beban tugas petugas',
  '📊 Statistik per kategori': 'Jumlah laporan per kategori fasilitas',
  '📊 Statistik per tingkat keparahan': 'Jumlah laporan per tingkatan keparahan (RENDAH/SEDANG/TINGGI/KRITIS)',
  '⏱️ Rata-rata waktu penyelesaian': 'Berapa rata-rata hari laporan diselesaikan?',
  '👥 Akun warga (Admin)': 'Siapa saja warga yang sudah mendaftar?',
  '👷 Data petugas': 'Daftar petugas yang terdaftar di sistem.',
  '📅 Pendaftaran terbaru': 'Apakah ada warga yang baru mendaftar bulan ini?',
  '🗺️ Wilayah RT/RW': 'Ringkas data wilayah RT/RW',
  '📍 Lokasi laporan terbanyak': 'Wilayah mana yang memiliki laporan terbanyak?',
  '🏘️ Profil desa (lokasi)': 'Tampilkan lokasi dan peta Desa Ciperna.',
};

// ===== Sapaan Admin === 1–2 kalimat saja. Tidak mendominasi area chat. =====
const GREETINGS_ADMIN = (userName?: string) => {
  const name = userName ? userName.trim() : '';
  if (name) {
    return (
      `Halo, ${name}! 👋\n\n` +
      'Saya bantu dari data aktual desa (read-only): laporan, verifikasi, petugas, statistik, akun, wilayah, pengumuman. ' +
      'Silakan tanya apa saja, atau gunakan tombol di bawah.'
    );
  }
  return (
    'Halo! 👋\n\n' +
    'Saya bantu dari data aktual desa (read-only): laporan, verifikasi, petugas, statistik, akun, wilayah, pengumuman. ' +
    'Silakan tanya apa saja, atau gunakan tombol di bawah.'
  );
};

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
  /** Provider yang benar-benar menjawab (transparansi fallback). */
  usedProvider?: string | null;
  /** Model yang benar-benar menjawab. */
  usedModel?: string | null;
  /** true bila jawaban datang dari model cadangan. */
  isFallback?: boolean;
  /** Alasan fallback (ringkas, tanpa secret). */
  fallbackReason?: string | null;
  /** Sumber jawaban: 'llm' (dari model) atau 'deterministic' (dari data lokal). */
  answerSource?: 'llm' | 'deterministic';
  /** Model yang GAGAL dan dicoba sebelum model yang berhasil. */
  fallbackModels?: string[];
  /** Provider berbeda yang dipakai bila provider utama gagal. */
  fallbackProvider?: string | null;
  /** Urutan percobaan provider. */
  providerChain?: string[];
}

/** ID sesi lokal untuk riwayat percakapan server (TTL terbatas).
 * Di-reset saat percakapan baru agar konteks lama tidak terbawa. */
function newChatSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function AdminAiFloatingChatbot({ userName }: { userName?: string }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState(newChatSessionId);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: GREETINGS_ADMIN(userName) },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<FailureInfo | null>(null);
  const [failedText, setFailedText] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // Panel minimizable: riwayat tetap (state messages tidak diubah).
  // Saat minimized, tampilkan hanya header + footer (input), area pesan disembunyikan.
  function toggleMinimize() {
    setMinimized((v) => !v);
  }

  // Drop-down kategori: buka/mutup semua grup sekaligus.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['laporan', 'statistik']));
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

  // Cek koneksi backend AI Admin (tanpa mengirim pesan)
  useEffect(() => {
    fetch('/api/admin/ai/chat')
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false));
  }, []);

  // Autoscroll ke pesan terakhir (kecuali jika pengguna sedang membaca)
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

  function onBodyScroll() {
    const el = bodyRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  // Tutup percakapan, mengingat posisi baca pengguna terkait
  function clearConversation() {
    setMessages([{ role: 'assistant', content: GREETINGS_ADMIN(userName) }]);
    // Sesi bersih = riwayat server juga dianggap biru (seed baru).
    setSessionId(newChatSessionId());
    setFailure(null);
    setFailedText('');
    setInput('');
    nearBottomRef.current = true;
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

  return (
    <div
      className="chatbot-root"
      style={{ zIndex: 1100, right: '1.25rem', bottom: '1.25rem' }}
    >
      {open && (
        <div
          className="chatbot-panel glass"
          role="dialog"
          aria-label="Asisten AI Admin"
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
            <span style={{ fontSize: '1.5rem' }} aria-hidden="true">🤖</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
                AI Assistant Admin
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
              aria-label="Riwayat percakapan asisten admin"
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
                  {m.role === 'assistant' && m.meta && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        color: 'var(--text-secondary)',
                        fontWeight: 600,
                      }}
                      title={
                        m.meta.providerChain && m.meta.providerChain.length > 0
                          ? `Rantai percobaan: ${m.meta.providerChain.join(' → ')}`
                          : undefined
                      }
                    >
                      {m.meta.answerSource === 'deterministic' ? (
                        <span style={{ color: '#92400e', fontWeight: 700 }}>
                          Jawaban lokal (bukan dari model AI)
                        </span>
                      ) : m.meta.usedProvider ? (
                        <>
                          AI: {m.meta.usedProvider} — {m.meta.usedModel || '-'}
                          {m.meta.isFallback ? ' (Fallback)' : ''}
                        </>
                      ) : null}
                    </span>
                  )}
                  {m.role === 'assistant' &&
                    m.meta &&
                    m.meta.fallbackModels &&
                    m.meta.fallbackModels.length > 0 && (
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}
                        title={
                          m.meta.providerChain && m.meta.providerChain.length > 0
                            ? `Rantai percobaan: ${m.meta.providerChain.join(' → ')}`
                            : undefined
                        }
                      >
                        Dijawab model cadangan: {m.meta.usedModel || '-'}
                        {m.meta.fallbackProvider ? ` (provider ${m.meta.fallbackProvider})` : ''}
                      </span>
                    )}
                </div>
              ))}
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
          )}

          {/* ===== Quick buttons: 3 utama + menu pertanyaan (drop-down) ===== */}
          {!minimized && (
            <div className="chatbot-quick" style={{ padding: '0.4rem 0.75rem' }}>
              {/* 3 tombol utama selalu tampil */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                {QUICK_MAIN.map((q) => (
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
                    {QUICK_GROUPS.map((group) => (
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
                                onClick={() => send(QUICK_MAP[q])}
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
              aria-label="Tanya asisten admin"
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
        {open ? '✕' : '🤖'}
      </button>
    </div>
  );
}

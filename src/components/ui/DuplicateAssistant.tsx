'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface AssistantGroup {
  report: {
    id: string;
    title: string;
    location: string;
    category: string | null;
    status: string;
    duplicateStatus: string;
    createdAt: string;
    reporter: string;
  };
  main: {
    id: string;
    title: string;
    location: string;
    category: string | null;
    status: string;
    createdAt: string;
    reporter: string;
  } | null;
  confidence: number;
  band: string;
  reasons: string[];
  aiAssessed: boolean;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  groups?: AssistantGroup[];
}

const SUGGESTIONS = [
  'Cek apakah ada laporan yang sama',
  'Cek laporan duplikat hari ini',
  'Tampilkan laporan kemungkinan duplikat',
];

function shortId(id: string) {
  return id.slice(0, 8);
}

export function DuplicateAssistant() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      content:
        'Halo! Saya Asisten Duplikat. Saya memakai data nyata dari database. Coba: "Cek apakah ada laporan yang sama", "Cek laporan duplikat hari ini", atau "Cek laporan ID …".',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  function scrollDown() {
    setTimeout(() => {
      bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'user', content }]);
    setLoading(true);
    scrollDown();
    try {
      const res = await fetch('/api/admin/duplicate-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Asisten gagal merespons.');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, groups: data.groups || [] }]);
    } catch (err: any) {
      setError(err?.message || 'Gagal terhubung ke server.');
    } finally {
      setLoading(false);
      scrollDown();
    }
  }

  async function act(
    action: 'flag' | 'confirm' | 'reject' | 'cancel' | 'set-main',
    reportId: string,
    mainId?: string
  ) {
    const key = `${action}:${reportId}`;
    setBusyId(key);
    setError('');
    try {
      const url =
        action === 'flag'
          ? `/api/admin/duplicates/${reportId}/flag`
          : action === 'set-main'
            ? `/api/admin/duplicates/${reportId}/set-main`
            : `/api/admin/duplicates/${reportId}/${action}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mainId ? { mainReportId: mainId } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Aksi gagal.');
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `✓ Berhasil: ${actionLabel(action)} untuk laporan ${shortId(reportId)}.` },
      ]);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || 'Aksi gagal.');
    } finally {
      setBusyId(null);
      scrollDown();
    }
  }

  return (
    <div className="glass" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--divider)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>🤖 Asisten Duplikat</h3>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Tanya dengan bahasa natural — jawaban memakai data database nyata.
        </p>
      </div>

      <div ref={bodyRef} style={{ maxHeight: '460px', overflowY: 'auto', padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.map((m, i) => (
          <div key={i}>
            <div
              className={`chatbot-msg chatbot-msg-${m.role}`}
              style={{ maxWidth: '100%', whiteSpace: 'pre-wrap' }}
            >
              {m.content}
            </div>
            {m.groups?.map((g) => (
              <div
                key={g.report.id + (g.main?.id || '')}
                style={{
                  marginTop: '0.6rem',
                  padding: '0.85rem',
                  border: '1px solid rgba(15,118,110,0.2)',
                  borderRadius: '10px',
                  background: 'rgba(15,118,110,0.04)',
                  fontSize: '0.82rem',
                }}
              >
                <p style={{ margin: '0 0 0.3rem', fontWeight: 700 }}>
                  {shortId(g.report.id)} → {g.main ? shortId(g.main.id) : '-'}
                  <span
                    className="ai-severity-badge"
                    style={{ marginLeft: '0.5rem', background: 'rgba(16,185,129,0.16)' }}
                  >
                    {g.confidence}% • {g.band}
                  </span>
                  {g.aiAssessed && (
                    <span style={{ marginLeft: '0.4rem', fontSize: '0.72rem', color: 'var(--purple-text)' }}>🤖 AI</span>
                  )}
                </p>
                <p style={{ margin: '0 0 0.5rem', color: 'var(--text-secondary)' }}>
                  {g.report.title} — {g.report.location}
                </p>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <Link
                    href={`/admin/laporan/${g.report.id}`}
                    className="btn"
                    style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(15,118,110,0.1)', color: 'var(--primary-color)' }}
                  >
                    Lihat
                  </Link>
                  {g.main && (
                    <button
                      type="button"
                      className="btn"
                      disabled={!!busyId}
                      onClick={() => act('flag', g.report.id, g.main!.id)}
                      style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(245,158,11,0.12)', color: 'var(--warning-text)' }}
                    >
                      {busyId === `flag:${g.report.id}` ? '…' : 'Tandai Duplikat'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!!busyId}
                    onClick={() => act('confirm', g.report.id, g.main?.id)}
                    style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem' }}
                  >
                    {busyId === `confirm:${g.report.id}` ? '…' : 'Konfirmasi'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busyId}
                    onClick={() => act('reject', g.report.id)}
                    style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'var(--muted-bg)' }}
                  >
                    {busyId === `reject:${g.report.id}` ? '…' : 'Bukan Duplikat'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!busyId}
                    onClick={() => act('cancel', g.report.id)}
                    style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', background: 'rgba(239,68,68,0.08)', color: 'var(--danger-text)' }}
                  >
                    {busyId === `cancel:${g.report.id}` ? '…' : 'Batalkan'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {loading && (
          <div className="chatbot-msg chatbot-msg-assistant chatbot-typing">
            <span /> <span /> <span />
          </div>
        )}
        {error && <div className="chatbot-error">⚠️ {error}</div>}
      </div>

      <div className="chatbot-quick">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chatbot-chip" onClick={() => send(s)} disabled={loading}>
            {s}
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
          placeholder='Contoh: "Cek laporan duplikat hari ini"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          aria-label="Perintah untuk asisten"
        />
        <button type="submit" className="btn btn-primary chatbot-send" disabled={loading || !input.trim()} aria-label="Kirim">
          {loading ? '...' : '➤'}
        </button>
      </form>
    </div>
  );
}

function actionLabel(action: string) {
  switch (action) {
    case 'flag': return 'penandaan duplikat';
    case 'confirm': return 'konfirmasi duplikat';
    case 'reject': return 'penandaan bukan duplikat';
    case 'cancel': return 'pembatalan duplikat';
    case 'set-main': return 'pergantian laporan utama';
    default: return action;
  }
}

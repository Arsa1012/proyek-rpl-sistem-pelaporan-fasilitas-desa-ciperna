'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminAnalyzeButton({ reportId, hasResult = false }: { reportId: string; hasResult?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function handleAnalyze() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/reports/${reportId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal');
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError('Error jaringan');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span style={{ fontSize: '0.75rem', color: 'var(--success-text)', fontWeight: 600 }}>✓ Done</span>
    );
  }

  return (
    <div>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="btn"
        title={error || 'Analisis AI'}
        style={{
          padding: '0.25rem 0.6rem',
          fontSize: '0.75rem',
          background: loading ? 'rgba(124,58,237,0.3)' : 'rgba(124,58,237,0.15)',
          color: 'var(--purple-text)',
          whiteSpace: 'nowrap',
        }}
      >
        {loading ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span className="spinner" style={{ width: '12px', height: '12px', borderColor: 'rgba(124,58,237,0.3)', borderTopColor: '#7c3aed' }} />
            AI...
          </span>
        ) : (
          hasResult ? '↻ Analisis Ulang' : '🤖 Analisis'
        )}
      </button>
      {error && (
        <span title={error} style={{ fontSize: '0.7rem', color: 'var(--danger-text)', display: 'block' }}>⚠️</span>
      )}
    </div>
  );
}

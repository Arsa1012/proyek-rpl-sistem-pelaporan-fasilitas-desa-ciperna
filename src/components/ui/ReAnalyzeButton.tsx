'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AIAnalysis {
  category: string;
  damageType: string;
  severity: string;
  confidence: number;
  summary: string;
  recommendation: string;
  aiResult: string;
}

const severityConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  RENDAH: { label: 'Rendah',  color: 'var(--success-text)', bg: 'rgba(16,185,129,0.16)', icon: '🟢' },
  SEDANG: { label: 'Sedang',  color: 'var(--warning-text)', bg: 'rgba(245,158,11,0.18)', icon: '🟡' },
  TINGGI: { label: 'Tinggi',  color: 'var(--danger-text)', bg: 'rgba(239,68,68,0.16)', icon: '🔴' },
  KRITIS: { label: 'Kritis',  color: '#7c3aed', bg: 'rgba(124,58,237,0.16)', icon: '🚨' },
};

export function ReAnalyzeButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AIAnalysis | null>(null);
  const [showResult, setShowResult] = useState(false);

  async function handleAnalyze() {
    setLoading(true);
    setError('');
    setShowResult(false);

    try {
      const res = await fetch(`/api/reports/${reportId}/analyze`, {
        method: 'POST',
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Analisis AI gagal');
        return;
      }

      setResult(data.analysis);
      setShowResult(true);
      router.refresh();
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  }

  const sev = result?.severity ? severityConfig[result.severity] : null;

  return (
    <div>
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="btn"
        style={{
          background: loading
            ? 'rgba(37,99,235,0.4)'
            : 'linear-gradient(135deg, #2563eb, #7c3aed)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.875rem',
          padding: '0.6rem 1.25rem',
        }}
      >
        {loading ? (
          <>
            <span className="spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
            AI Sedang Menganalisis...
          </>
        ) : (
          <>🤖 Jalankan Ulang Analisis AI</>
        )}
      </button>

      {error && (
        <div className="error-banner" style={{ marginTop: '0.75rem' }}>
          ⚠️ {error}
        </div>
      )}

      {showResult && result && (
        <div className="ai-result-card" style={{ marginTop: '1rem' }}>
          <div className="ai-result-header">
            <div className="ai-badge-icon">✨</div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'white' }}>Hasil Analisis Terbaru</h3>
              <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85, color: 'white' }}>Baru saja diperbarui</p>
            </div>
          </div>
          <div className="ai-result-body">
            <div className="ai-info-grid">
              <div className="ai-info-item">
                <span className="ai-info-label">Kategori</span>
                <span className="ai-info-value">{result.category}</span>
              </div>
              <div className="ai-info-item">
                <span className="ai-info-label">Jenis Kerusakan</span>
                <span className="ai-info-value">{result.damageType}</span>
              </div>
              {sev && (
                <div className="ai-info-item">
                  <span className="ai-info-label">Tingkat Keparahan</span>
                  <span className="ai-severity-badge" style={{ background: sev.bg, color: sev.color }}>
                    {sev.icon} {sev.label}
                  </span>
                </div>
              )}
              <div className="ai-info-item">
                <span className="ai-info-label">Kepercayaan AI</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                  <div className="confidence-bar-bg" style={{ flex: 1 }}>
                    <div className="confidence-bar-fill" style={{ width: `${result.confidence}%` }} />
                  </div>
                  <span className="ai-info-value">{result.confidence}%</span>
                </div>
              </div>
            </div>
            <div className="ai-summary-box">
              <p className="ai-summary-label">📋 Ringkasan</p>
              <p className="ai-summary-text">{result.summary}</p>
            </div>
            <div className="ai-recommendation-box">
              <p className="ai-summary-label">💡 Rekomendasi</p>
              <p className="ai-summary-text">{result.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

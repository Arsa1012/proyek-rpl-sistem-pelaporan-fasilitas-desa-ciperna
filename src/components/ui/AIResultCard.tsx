interface AnalysisDetail {
  summary: string | null;
  urgencyReason: string | null;
  reasons: string | null;
  facts: string | null;
  missing: string | null;
  recommendation: string | null;
  suggestedAction: string | null;
  model: string | null;
  provider: string | null;
  createdAt: Date | string;
}

interface AIResultCardProps {
  report: {
    id: string;
    aiResult: string | null;
    aiConfidence: number | null;
    category: string | null;
    damageType: string | null;
    severity: string | null;
    aiStatus?: string | null;
    aiError?: string | null;
    aiAnalyzedAt?: Date | string | null;
    aiModel?: string | null;
  };
  /** Analisis terakhir yang BERHASIL (dari tabel riwayat ReportAnalysis). */
  analysis?: AnalysisDetail | null;
}

const severityConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  RENDAH: { label: 'Rendah',  color: 'var(--success-text)', bg: 'rgba(16,185,129,0.16)', icon: '🟢' },
  SEDANG: { label: 'Sedang',  color: 'var(--warning-text)', bg: 'rgba(245,158,11,0.18)', icon: '🟡' },
  TINGGI: { label: 'Tinggi',  color: 'var(--danger-text)', bg: 'rgba(239,68,68,0.16)', icon: '🔴' },
  KRITIS: { label: 'Kritis',  color: '#7c3aed', bg: 'rgba(124,58,237,0.16)', icon: '🚨' },
};

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function ListBox({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="ai-summary-box">
      <p className="ai-summary-label">{title}</p>
      <ul className="ai-summary-text" style={{ margin: 0, paddingLeft: '1.1rem' }}>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}

export function AIResultCard({ report, analysis }: AIResultCardProps) {
  const status = report.aiStatus || (report.aiResult ? 'SUCCESS' : 'PENDING');

  if (status === 'ANALYZING') {
    return (
      <div className="glass ai-card-empty">
        <div className="ai-card-empty-icon">🔄</div>
        <div>
          <p style={{ fontWeight: 600, margin: '0 0 0.25rem', color: 'var(--text-primary)' }}>
            Analisis AI sedang berjalan
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Hasil akan muncul setelah proses selesai. Tidak ada hasil sementara yang ditampilkan.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'FAILED') {
    return (
      <div className="glass ai-card-empty" style={{ borderLeft: '4px solid var(--danger-text)' }}>
        <div className="ai-card-empty-icon">⚠️</div>
        <div>
          <p style={{ fontWeight: 600, margin: '0 0 0.25rem', color: 'var(--danger-text)' }}>
            Analisis AI gagal
          </p>
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
            {report.aiError || 'Analisis AI tidak berhasil. Tidak ada hasil yang ditampilkan.'}
          </p>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Status operasional laporan tidak berubah. Gunakan tombol “Jalankan Ulang Analisis AI” di bawah.
          </p>
        </div>
      </div>
    );
  }

  if (
    (status !== 'SUCCESS' && status !== 'NEEDS_REVIEW') ||
    (!report.aiResult && !report.category)
  ) {
    return (
      <div className="glass ai-card-empty">
        <div className="ai-card-empty-icon">🤖</div>
        <div>
          <p style={{ fontWeight: 600, margin: '0 0 0.25rem', color: 'var(--text-primary)' }}>
            Belum Dianalisis AI
          </p>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Klik tombol “Jalankan Ulang Analisis AI” di bawah untuk menganalisis laporan ini.
          </p>
        </div>
      </div>
    );
  }

  const sev = report.severity ? severityConfig[report.severity] : null;
  const confidence = report.aiConfidence ?? 0;
  const reasons = parseList(analysis?.reasons);
  const facts = parseList(analysis?.facts);
  const missing = parseList(analysis?.missing);
  const analyzedAt = analysis?.createdAt || report.aiAnalyzedAt;
  const modelLabel = analysis?.model || report.aiModel;

  return (
    <div className="ai-result-card">
      <div className="ai-result-header">
        <div className="ai-badge-icon">🤖</div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'white' }}>Hasil Analisis AI</h3>
          <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85, color: 'white' }}>
            {modelLabel ? `Model: ${modelLabel}` : 'Hasil analisis tersimpan'}
            {analyzedAt ? ` • ${new Date(analyzedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
          </p>
        </div>
        {sev && (
          <span
            className="ai-severity-badge ai-severity-badge--on-gradient"
            style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.3)' }}
          >
            {sev.icon} {sev.label}
          </span>
        )}
      </div>

      <div className="ai-result-body">
        {status === 'NEEDS_REVIEW' && (
          <div className="ai-summary-box" style={{ borderLeft: '4px solid var(--warning-text)' }}>
            <p className="ai-summary-label" style={{ color: 'var(--warning-text)' }}>🔎 Perlu Ditinjau Admin</p>
            <p className="ai-summary-text">
              Keyakinan analisis rendah, sehingga hasil ini belum dapat dianggap final.
              Admin perlu memeriksa bukti/foto dan menetapkan kategori/urgensi secara manual.
            </p>
          </div>
        )}
        <div className="ai-info-grid">
          {report.category && (
            <div className="ai-info-item">
              <span className="ai-info-label">🏷️ Kategori Fasilitas</span>
              <span className="ai-info-value">{report.category}</span>
            </div>
          )}
          {report.damageType && (
            <div className="ai-info-item">
              <span className="ai-info-label">🔍 Jenis Kerusakan</span>
              <span className="ai-info-value">{report.damageType}</span>
            </div>
          )}
          {sev && (
            <div className="ai-info-item">
              <span className="ai-info-label">⚡ Tingkat Keparahan</span>
              <span className="ai-severity-badge" style={{ background: sev.bg, color: sev.color }}>
                {sev.icon} {sev.label}
              </span>
            </div>
          )}
          <div className="ai-info-item">
            <span className="ai-info-label">📊 Tingkat Kepercayaan AI</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
              <div className="confidence-bar-bg" style={{ flex: 1 }}>
                <div className="confidence-bar-fill" style={{ width: `${confidence}%` }} />
              </div>
              <span className="ai-info-value" style={{ minWidth: '40px' }}>{Math.round(confidence)}%</span>
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0.5rem' }}>
          Confidence adalah penilaian mandiri model, bukan jaminan kebenaran. Keputusan akhir tetap pada Admin.
        </p>

        {analysis?.summary && (
          <div className="ai-summary-box">
            <p className="ai-summary-label">📋 Ringkasan Analisis</p>
            <p className="ai-summary-text">{analysis.summary}</p>
          </div>
        )}

        {analysis?.urgencyReason && (
          <div className="ai-summary-box">
            <p className="ai-summary-label">⚡ Alasan Tingkat Urgensi</p>
            <p className="ai-summary-text">{analysis.urgencyReason}</p>
          </div>
        )}

        <ListBox title="🧠 Alasan Klasifikasi" items={reasons} />
        <ListBox title="📌 Fakta dari Laporan" items={facts} />
        <ListBox title="❓ Informasi Belum Tersedia" items={missing} />

        {analysis?.recommendation && (
          <div className="ai-recommendation-box">
            <p className="ai-summary-label">💡 Rekomendasi Tindakan</p>
            <p className="ai-summary-text">{analysis.recommendation}</p>
          </div>
        )}

        {analysis?.suggestedAction && (
          <div className="ai-recommendation-box">
            <p className="ai-summary-label">✅ Tindakan Disarankan (bukan keputusan final)</p>
            <p className="ai-summary-text">{analysis.suggestedAction}</p>
          </div>
        )}

        {!analysis && report.aiResult && (
          <div className="ai-summary-box">
            <p className="ai-summary-label">🏷️ Label AI</p>
            <p className="ai-summary-text" style={{ fontWeight: 600 }}>{report.aiResult}</p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Rincian alasan belum tersimpan untuk analisis lama. Jalankan analisis ulang untuk mendapatkan rincian lengkap.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

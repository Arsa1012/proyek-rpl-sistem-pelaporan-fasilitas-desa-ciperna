'use client';

interface StatusHistoryItem {
  id: string;
  status: string;
  notes?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  createdAt: string | Date;
}

interface ReportTimelineProps {
  currentStatus: string;
  rejectionReason?: string | null;
  histories: StatusHistoryItem[];
  title?: string;
}

const NORMAL_STEPS = [
  { key: 'SUBMITTED', label: 'Laporan Diajukan', icon: '📋' },
  { key: 'VERIFIED', label: 'Diverifikasi Admin', icon: '✅' },
  { key: 'ASSIGNED', label: 'Ditugaskan ke Petugas', icon: '👷' },
  { key: 'IN_PROGRESS', label: 'Dalam Penanganan', icon: '🔧' },
  { key: 'REVIEW', label: 'Menunggu Verifikasi Bukti', icon: '🔍' },
  { key: 'COMPLETED', label: 'Selesai', icon: '🎉' },
];

export function ReportTimeline({
  currentStatus,
  rejectionReason,
  histories = [],
  title = '🗓️ Timeline Status Laporan',
}: ReportTimelineProps) {
  const isRejected = currentStatus === 'REJECTED';

  // Format tanggal ke format lokal Indonesia (selalu WIB Asia/Jakarta)
  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }) + ' WIB';
  };

  // ─────────────────────────────────────────────
  // TAMPILAN JIKA LAPORAN DITOLAK (REJECTED)
  // ─────────────────────────────────────────────
  if (isRejected) {
    const submitHistory = histories.find((h) => h.status === 'SUBMITTED');
    const rejectHistory = histories.find((h) => h.status === 'REJECTED');

    return (
      <div className="glass" style={{ padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>{title}</span>
        </h3>

        <div className="status-timeline">
          {/* Step 1: Laporan Diajukan */}
          <div className="timeline-step done">
            <div className="timeline-dot">✓</div>
            <div className="timeline-content">
              <p className="timeline-label">Laporan Diajukan</p>
              {submitHistory && (
                <>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    ⏱️ {formatDate(submitHistory.createdAt)}
                  </p>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    {submitHistory.notes || 'Laporan berhasil dibuat dan diajukan ke sistem.'}
                  </p>
                  {submitHistory.actorName && (
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      👤 Oleh: {submitHistory.actorName}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="timeline-line done" />
          </div>

          {/* Step 2: Ditolak */}
          <div className="timeline-step active">
            <div
              className="timeline-dot"
              style={{
                background: 'var(--danger-color, #ef4444)',
                color: '#fff',
                borderColor: 'transparent',
                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)',
              }}
            >
              ✕
            </div>
            <div className="timeline-content">
              <p className="timeline-label" style={{ color: 'var(--danger-text)' }}>
                Laporan Ditolak
              </p>
              {rejectHistory && (
                <>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    ⏱️ {formatDate(rejectHistory.createdAt)}
                  </p>
                  {rejectHistory.actorName && (
                    <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      👤 Oleh: {rejectHistory.actorName}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="timeline-line" style={{ background: 'rgba(239,68,68,0.35)' }} />
          </div>

          {/* Step 3: Alasan Penolakan */}
          <div className="timeline-step">
            <div
              className="timeline-dot"
              style={{
                background: 'rgba(239,68,68,0.12)',
                color: 'var(--danger-text)',
                borderColor: 'rgba(239,68,68,0.35)',
              }}
            >
              ⚠️
            </div>
            <div className="timeline-content">
              <p className="timeline-label" style={{ color: 'var(--danger-text)', fontWeight: 600 }}>
                Alasan Penolakan
              </p>
              <div
                style={{
                  marginTop: '0.4rem',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--danger-text)', lineHeight: 1.5 }}>
                  {rejectionReason || rejectHistory?.notes || 'Tidak memenuhi kriteria kelayakan laporan.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // TAMPILAN ALUR NORMAL
  // ─────────────────────────────────────────────
  const statusOrder = ['SUBMITTED', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'];
  const currentIdx = statusOrder.indexOf(currentStatus);

  return (
    <div className="glass" style={{ padding: '1.5rem' }}>
      <h3 style={{ margin: '0 0 1.25rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>{title}</span>
      </h3>

      <div className="status-timeline">
        {NORMAL_STEPS.map((step, idx) => {
          // Cari riwayat untuk status ini (ambil yang paling mutakhir jika ada banyak)
          const historyMatches = histories.filter((h) => h.status === step.key);
          const history = historyMatches[historyMatches.length - 1];

          // Penentuan status step
          const isDone = Boolean(history) || idx < currentIdx;
          const isActive = currentStatus === step.key;

          return (
            <div
              key={step.key}
              className={`timeline-step ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}
            >
              <div className="timeline-dot">
                {isDone ? '✓' : step.icon}
              </div>

              <div className="timeline-content">
                <p className="timeline-label">{step.label}</p>

                {history ? (
                  <div style={{ marginTop: '0.2rem' }}>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      ⏱️ {formatDate(history.createdAt)}
                    </p>
                    {history.notes && (
                      <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {history.notes}
                      </p>
                    )}
                    {history.actorName && (
                      <p style={{ margin: '0.15rem 0 0', fontSize: '0.725rem', color: 'var(--text-secondary)' }}>
                        👤 {history.actorName}
                      </p>
                    )}
                  </div>
                ) : isActive ? (
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--primary-color)', fontStyle: 'italic' }}>
                    Sedang dalam tahapan ini...
                  </p>
                ) : (
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'rgba(0,0,0,0.3)' }}>
                    Menunggu proses sebelumnya
                  </p>
                )}
              </div>

              {idx < NORMAL_STEPS.length - 1 && (
                <div className={`timeline-line ${isDone && idx < currentIdx ? 'done' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

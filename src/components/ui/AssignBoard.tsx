'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { AssignOfficerPanel } from '@/components/ui/AssignOfficerPanel';
import { CancelAssignmentModal } from '@/components/ui/CancelAssignmentModal';

export interface WaitingReport {
  id: string;
  title: string;
  description: string;
  location: string;
  severity: string | null;
  category: string | null;
  user: { id: string; name: string };
}

export interface ActiveAssignment {
  id: string;
  assignedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  report: {
    id: string;
    title: string;
    location: string;
    status: string;
    severity: string | null;
  };
  officer: { id: string; name: string; email: string };
}

interface AssignBoardProps {
  waitingReports: WaitingReport[];
  activeAssignments: ActiveAssignment[];
  finishedAssignments: ActiveAssignment[];
}

type Filter = 'all' | 'waiting' | 'active' | 'review' | 'done';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'waiting', label: 'Menunggu Penugasan' },
  { value: 'active', label: 'Sedang Ditangani' },
  { value: 'review', label: 'Menunggu Verifikasi' },
  { value: 'done', label: 'Selesai' },
];

interface CancelTarget {
  assignmentId: string;
  reportId: string;
  reportTitle: string;
  officerName: string;
}

export function AssignBoard({ waitingReports, activeAssignments, finishedAssignments }: AssignBoardProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [toast, setToast] = useState('');

  const showWaiting = filter === 'all' || filter === 'waiting';
  const showActive = filter === 'all' || filter === 'active';
  const showReview = filter === 'all' || filter === 'review';
  const showDone = filter === 'all' || filter === 'done';

  const reviewList = finishedAssignments.filter((a) => !a.completedAt && a.report.status === 'REVIEW');
  const doneList = finishedAssignments.filter((a) => !!a.completedAt);

  function handleSuccess(message: string) {
    setToast(message);
    router.refresh();
    setTimeout(() => setToast(''), 5000);
  }

  return (
    <div>
      {toast && (
        <div
          role="status"
          style={{
            padding: '0.875rem 1.25rem',
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.4)',
            borderRadius: '10px',
            color: 'var(--success-text)',
            fontSize: '0.875rem',
            fontWeight: 500,
            marginBottom: '1.25rem',
          }}
        >
          ✓ {toast}
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className="btn"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.85rem',
              background: filter === f.value ? 'var(--chip-active-bg)' : 'var(--muted-bg)',
              color: filter === f.value ? 'var(--chip-active-text)' : 'var(--text-secondary)',
              fontWeight: filter === f.value ? 600 : 400,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 1. LAPORAN MENUNGGU PENUGASAN */}
      {showWaiting && (
        <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
            📋 Laporan Menunggu Penugasan ({waitingReports.length})
          </h3>
          {waitingReports.length > 0 ? (
            <div className="assign-grid">
              {waitingReports.map((report) => (
                <div key={report.id} className="assign-card">
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontFamily: 'monospace' }}>
                    #{report.id.slice(0, 8)}
                  </p>
                  <p style={{ fontWeight: 600, margin: '0 0 0.25rem' }}>{report.title}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem' }}>
                    📍 {report.location}
                  </p>
                  {report.severity && (
                    <p style={{ fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
                      Severity: <strong>{report.severity}</strong>
                    </p>
                  )}
                  <AssignOfficerPanel reportId={report.id} reportTitle={report.title} />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
              Tidak ada laporan yang menunggu penugasan.
            </p>
          )}
        </div>
      )}

      {/* 2. PENUGASAN AKTIF */}
      {showActive && (
        <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
            🔧 Penugasan Aktif ({activeAssignments.length})
          </h3>
          {activeAssignments.length > 0 ? (
            <div className="assign-grid">
              {activeAssignments.map((a) => (
                <div key={a.id} className="assign-card">
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '0 0 0.25rem', fontFamily: 'monospace' }}>
                    #{a.report.id.slice(0, 8)}
                  </p>
                  <p style={{ fontWeight: 600, margin: '0 0 0.25rem' }}>{a.report.title}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
                    📍 {a.report.location}
                  </p>
                  <div className="officer-card" style={{ marginBottom: '0.75rem' }}>
                    <div className="officer-avatar">{a.officer.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <p style={{ fontWeight: 600, margin: 0, fontSize: '0.875rem' }}>👷 {a.officer.name}</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>{a.officer.email}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Status:</span>
                    <Badge status={a.report.status} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Link
                      href={`/admin/laporan/${a.report.id}`}
                      className="btn"
                      style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', background: 'rgba(15,118,110,0.1)', color: 'var(--primary-color)', flex: 1, justifyContent: 'center' }}
                    >
                      Lihat Detail
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() =>
                        setCancelTarget({
                          assignmentId: a.id,
                          reportId: a.report.id,
                          reportTitle: a.report.title,
                          officerName: a.officer.name,
                        })
                      }
                      style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem', flex: 1, justifyContent: 'center' }}
                    >
                      Batalkan Penugasan
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
              Belum ada laporan yang sedang ditugaskan.
            </p>
          )}
        </div>
      )}

      {/* 3. MENUNGGU VERIFIKASI */}
      {showReview && reviewList.length > 0 && (
        <div className="glass" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
            🔍 Menunggu Verifikasi Admin ({reviewList.length})
          </h3>
          <div className="assign-grid">
            {reviewList.map((a) => (
              <div key={a.id} className="assign-card">
                <p style={{ fontWeight: 600, margin: '0 0 0.25rem' }}>{a.report.title}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
                  👷 {a.officer.name} • 📍 {a.report.location}
                </p>
                <Badge status={a.report.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. SELESAI */}
      {showDone && (
        <div className="glass" style={{ padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>
            ✅ Selesai ({doneList.length})
          </h3>
          {doneList.length > 0 ? (
            <div className="assign-grid">
              {doneList.map((a) => (
                <div key={a.id} className="assign-card">
                  <p style={{ fontWeight: 600, margin: '0 0 0.25rem' }}>{a.report.title}</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>
                    👷 {a.officer.name} • 📍 {a.report.location}
                  </p>
                  <Badge status={a.report.status} />
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1.5rem' }}>
              Belum ada penugasan yang selesai.
            </p>
          )}
        </div>
      )}

      {cancelTarget && (
        <CancelAssignmentModal
          assignmentId={cancelTarget.assignmentId}
          reportId={cancelTarget.reportId}
          reportTitle={cancelTarget.reportTitle}
          officerName={cancelTarget.officerName}
          onClose={() => setCancelTarget(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  );
}

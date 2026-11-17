import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { DuplicateAssistant } from '@/components/ui/DuplicateAssistant';
import { DuplicateActions } from '@/components/ui/DuplicateActions';
import { RevalidateDuplicatesButton } from '@/components/ui/RevalidateDuplicatesButton';

export const metadata = {
  title: 'Deteksi Duplikat — Admin Desa Ciperna',
};

export default async function AdminDuplikatPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  const [possible, duplicateCount] = await Promise.all([
    prisma.report.findMany({
      where: { duplicateStatus: 'POSSIBLE_DUPLICATE' },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.report.count({ where: { duplicateStatus: 'DUPLICATE' } }),
  ]);

  const mainIds = Array.from(new Set(possible.map((r) => r.duplicateOfReportId).filter(Boolean))) as string[];
  const mains = mainIds.length
    ? await prisma.report.findMany({
        where: { id: { in: mainIds } },
        include: { user: { select: { id: true, name: true } } },
      })
    : [];
  const mainMap = new Map(mains.map((m) => [m.id, m]));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Deteksi Laporan Duplikat</h2>
          <p>Tinjau kandidat duplikat dari sistem/AI. Keputusan akhir selalu di tangan Admin. Tidak ada laporan yang dihapus.</p>
        </div>
        <RevalidateDuplicatesButton />
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        <div className="glass card" style={{ borderLeft: '4px solid var(--severity-medium)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Menunggu Review</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--warning-text)' }}>{possible.length}</div>
        </div>
        <div className="glass card" style={{ borderLeft: '4px solid var(--severity-low)' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.5rem' }}>Terkonfirmasi Duplikat</p>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success-text)' }}>{duplicateCount}</div>
        </div>
      </div>

      {/* AI Assistant */}
      <div style={{ marginBottom: '1.5rem' }}>
        <DuplicateAssistant />
      </div>

      {/* Daftar kandidat */}
      <div className="glass" style={{ padding: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: '1rem' }}>🔗 Kandidat Duplikat ({possible.length})</h3>
        {possible.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✅</p>
            <p>Tidak ada kandidat duplikat yang menunggu review.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {possible.map((r) => {
              const main = r.duplicateOfReportId ? mainMap.get(r.duplicateOfReportId) : null;
              return (
                <div
                  key={r.id}
                  style={{
                    padding: '1rem 1.25rem',
                    border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: '12px',
                    background: 'rgba(245,158,11,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                    <div>
                      <p style={{ fontWeight: 700, margin: 0 }}>
                        #{r.id.slice(0, 8)} — {r.title}
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                        {r.user.name} • {r.location} • {new Date(r.createdAt).toLocaleDateString('id-ID')}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge status={r.status} />
                      {r.duplicateBand && (
                        <span className="ai-severity-badge" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning-text)', fontSize: '0.72rem' }}>
                          {r.duplicateBand}
                        </span>
                      )}
                      {r.duplicateConfidence != null && (
                        <span className="ai-severity-badge" style={{ background: 'rgba(245,158,11,0.18)' }}>
                          {Math.round(r.duplicateConfidence)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {main && (
                    <p style={{ fontSize: '0.82rem', margin: '0 0 0.5rem', color: 'var(--text-secondary)' }}>
                      Kandidat utama: <strong>#{main.id.slice(0, 8)} — {main.title}</strong> ({main.location}, {new Date(main.createdAt).toLocaleDateString('id-ID')})
                    </p>
                  )}
                  {r.duplicateReason && (
                    <p style={{ fontSize: '0.8rem', margin: '0 0 0.75rem', color: 'var(--text-secondary)' }}>
                      Alasan: {r.duplicateReason}
                    </p>
                  )}
                  <DuplicateActions
                    reportId={r.id}
                    duplicateStatus={r.duplicateStatus}
                    currentMainId={r.duplicateOfReportId}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/Badge';
import { ReviewButtons } from '@/components/ui/ReviewButtons';
import { ResendCompletionButton } from '@/components/ui/ResendCompletionButton';
import { reportStatusLabel } from '@/lib/status';

function wib(date: Date | string | null | undefined): string {
  if (!date) return '-';
  return (
    new Date(date).toLocaleString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }) + ' WIB'
  );
}

/**
 * Panel "Verifikasi Bukti Penyelesaian" untuk halaman detail laporan Admin.
 *
 * Server component mandiri: mengambil data sendiri agar dapat dipakai di
 * beberapa halaman detail (admin/laporan/[id] dan admin/reports/[id]) tanpa
 * duplikasi logika. Tidak menampilkan data sensitif apa pun (hanya nomor
 * penerima yang disamarkan pada status notifikasi).
 */
export async function AdminEvidenceVerification({ reportId }: { reportId: string }) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      user: { select: { name: true } },
      assignments: {
        include: { officer: { select: { id: true, name: true } } },
        orderBy: { assignedAt: 'desc' },
      },
      evidences: {
        orderBy: { createdAt: 'desc' },
        include: { assignment: { include: { officer: { select: { name: true } } } } },
      },
      histories: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!report) return null;

  const pendingAssignment = report.assignments.find(
    (a) => !a.cancelledAt && a.reviewStatus === 'PENDING'
  );
  const latestAssignment = report.assignments.find((a) => !a.cancelledAt) || report.assignments[0];
  const focus = pendingAssignment || latestAssignment;
  const reviewStatusForBadge = focus?.reviewStatus ?? null;
  const canReview = report.status === 'REVIEW' && Boolean(pendingAssignment);

  // Tidak menampilkan panel bila belum ada bukti sama sekali dan tidak menunggu review.
  if (report.evidences.length === 0 && report.status !== 'REVIEW') return null;

  const waDedupeKey =
    focus?.notifyMode === 'TEXT_PHOTO' ? `approved-photo:${reportId}` : `approved:${reportId}`;
  const waLog = await prisma.whatsAppLog.findUnique({
    where: { dedupeKey: waDedupeKey },
    select: { status: true, toMasked: true, error: true, providerMessageId: true, updatedAt: true, kind: true },
  });

  const notif = (() => {
    if (!waLog) {
      return report.status === 'COMPLETED'
        ? { tone: 'warn', text: '⏳ Notifikasi penyelesaian belum tercatat (mungkin gagal/tertunda).' }
        : { tone: 'wait', text: '⏳ Notifikasi penyelesaian dikirim setelah bukti disetujui.' };
    }
    const mediaLabel = waLog.kind === 'CITIZEN_APPROVED_PHOTO' ? ' (teks + foto bukti)' : ' (teks saja)';
    if (waLog.status === 'SENT') {
      return { tone: 'ok', text: `✓ Notifikasi penyelesaian${mediaLabel} BERHASIL terkirim ke ${waLog.toMasked}.` };
    }
    if (waLog.status === 'FAILED') {
      return {
        tone: 'err',
        text: `⚠ Notifikasi penyelesaian${mediaLabel} GAGAL terkirim (${waLog.error || 'alasan tidak diketahui'}). Status laporan tetap Selesai — Anda dapat mencoba kirim ulang.`,
      };
    }
    return { tone: 'wait', text: `⏳ Notifikasi penyelesaian${mediaLabel} berstatus ${waLog.status}.` };
  })();

  const notifColor =
    notif.tone === 'ok' ? 'var(--success-text)' : notif.tone === 'err' ? 'var(--danger-text)' : 'var(--warning-text)';

  const verificationHistories = report.histories.filter((h) =>
    ['REVIEW', 'COMPLETED', 'IN_PROGRESS', 'ASSIGNED'].includes(h.status)
  );

  return (
    <div className="glass" style={{ padding: '1.5rem', borderLeft: '4px solid var(--warning-color)' }}>
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>🔍</span>
        <span>Verifikasi Bukti Penyelesaian</span>
      </h3>
      <p style={{ margin: '0 0 1rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
        ID Laporan: #{report.id.slice(0, 8)} • Status saat ini:{' '}
        <Badge status={report.status} reviewStatus={reviewStatusForBadge} />
      </p>

      {/* Ringkasan laporan & pelapor */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
        <div>
          <p style={labelStyle}>PELAPOR</p>
          <p style={valueStyle}>{report.user.name}</p>
        </div>
        <div>
          <p style={labelStyle}>LOKASI</p>
          <p style={valueStyle}>📍 {report.location}</p>
        </div>
        <div>
          <p style={labelStyle}>PETUGAS LAPANGAN</p>
          <p style={valueStyle}>{focus ? focus.officer.name : 'Belum ditugaskan'}</p>
          {focus && <p style={subStyle}>Ditugaskan: {wib(focus.assignedAt)}</p>}
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <p style={labelStyle}>DESKRIPSI LAPORAN</p>
        <p style={{ ...valueStyle, fontWeight: 400, lineHeight: 1.55 }}>{report.description}</p>
      </div>

      {/* Foto awal + bukti penyelesaian */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1rem' }}>
        {report.photo && (
          <figure style={{ margin: 0 }}>
            <a href={report.photo} target="_blank" rel="noopener noreferrer" title="Buka foto laporan">
              <img src={report.photo} alt="Foto awal laporan" style={thumbStyle} />
            </a>
            <figcaption style={subStyle}>Foto awal laporan (Pelapor)</figcaption>
          </figure>
        )}
        {report.evidences.slice(0, 3).map((ev) => (
          <figure key={ev.id} style={{ margin: 0 }}>
            <a href={ev.photo} target="_blank" rel="noopener noreferrer" title="Buka foto bukti ukuran penuh">
              <img src={ev.photo} alt="Bukti penyelesaian dari petugas" style={thumbStyle} />
            </a>
            <figcaption style={subStyle}>
              Bukti oleh {ev.assignment?.officer?.name || focus?.officer.name || 'Petugas'} • {wib(ev.createdAt)}
            </figcaption>
          </figure>
        ))}
      </div>

      {/* Catatan hasil pekerjaan petugas */}
      <div style={{ marginBottom: '1rem' }}>
        <p style={labelStyle}>CATATAN HASIL PEKERJAAN (PETUGAS)</p>
        {report.evidences.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.55 }}>
            {report.evidences.map((ev) => (
              <li key={ev.id}>
                <span style={{ fontWeight: 600 }}>
                  {ev.assignment?.officer?.name || focus?.officer.name || 'Petugas Lapangan'}
                </span>
                {' — '}
                {ev.description || 'Pekerjaan perbaikan telah selesai dilaksanakan.'}
                <span style={{ color: 'var(--text-secondary)' }}> ({wib(ev.createdAt)})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ ...valueStyle, fontWeight: 400, color: 'var(--text-secondary)' }}>
            Belum ada catatan/bukti yang diunggah petugas.
          </p>
        )}
      </div>

      {/* Catatan Admin saat menyetujui (bila ada) */}
      {focus?.reviewStatus === 'APPROVED' && focus.reviewNotes ? (
        <div style={{ marginBottom: '1rem' }}>
          <p style={labelStyle}>CATATAN ADMIN SAAT PERSETUJUAN</p>
          <p style={{ ...valueStyle, fontWeight: 400, lineHeight: 1.55 }}>{focus.reviewNotes}</p>
        </div>
      ) : null}

      {/* Riwayat perubahan status & verifikasi */}
      <div style={{ marginBottom: '1rem' }}>
        <p style={labelStyle}>RIWAYAT STATUS &amp; VERIFIKASI</p>
        {verificationHistories.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', lineHeight: 1.6 }}>
            {verificationHistories.map((h) => (
              <li key={h.id}>
                <strong>{reportStatusLabel(h.status)}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {' '}• {wib(h.createdAt)} • {h.actorName || h.actorRole || 'Sistem'}
                </span>
                {h.notes ? <span style={{ color: 'var(--text-secondary)' }}> — {h.notes}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ ...subStyle }}>Belum ada riwayat verifikasi.</p>
        )}
      </div>

      {/* Status notifikasi ke pelapor */}
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', fontWeight: 600, color: notifColor }}>{notif.text}</p>

      {/* Retry aman (hanya untuk laporan selesai, idempoten di server) */}
      {report.status === 'COMPLETED' && (
        <div style={{ marginBottom: '1rem' }}>
          <ResendCompletionButton reportId={report.id} />
        </div>
      )}

      {/* Tindakan Admin */}
      {canReview && pendingAssignment ? (
        <ReviewButtons
          assignmentId={pendingAssignment.id}
          reportTitle={report.title}
          evidencePhoto={report.evidences[0]?.photo || null}
        />
      ) : report.status === 'COMPLETED' ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--success-text)', fontWeight: 600 }}>
          ✓ Bukti telah diverifikasi Admin. Laporan sudah dinyatakan selesai.
        </p>
      ) : report.status === 'REVIEW' ? (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--warning-text)', fontWeight: 600 }}>
          ⚠ Bukti menunggu verifikasi, tetapi penugasan yang sesuai tidak ditemukan. Periksa data penugasan.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          Tidak ada bukti yang menunggu verifikasi saat ini.
        </p>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  margin: '0 0 0.2rem',
  letterSpacing: '0.03em',
};
const valueStyle: React.CSSProperties = {
  fontSize: '0.88rem',
  fontWeight: 600,
  margin: 0,
};
const subStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--text-secondary)',
  margin: '0.25rem 0 0',
};
const thumbStyle: React.CSSProperties = {
  width: '100%',
  height: '150px',
  objectFit: 'cover',
  borderRadius: '8px',
  display: 'block',
};

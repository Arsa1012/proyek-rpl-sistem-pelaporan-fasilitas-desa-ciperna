/**
 * Kandidat laporan: pilih & klarifikasi rujukan.
 *
 * Dipisah dari aiIntent.ts supaya lapisan smart-retrieval (aiRetrieval.ts)
 * dapat memakai helper ini tanpa mengimpor modul layanan AI — menjaga aturan
 * arsitektur "hanya endpoint chat yang boleh memakai layanan AI" tetap utuh.
 */

export interface ReportCandidate {
  id: string;
  title?: string;
}

/** Label kandidat laporan untuk klarifikasi yang aman (tanpa data pribadi). */
export function formatCandidateClarification(
  candidates: ReportCandidate[],
  subject = 'laporan'
): string {
  const lines = candidates
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.title || 'Laporan tanpa judul'} (ID: ${c.id})`)
    .join('\n');
  return (
    `Ada ${candidates.length} ${subject} yang cocok dengan pembahasan sebelumnya. ` +
    `Supaya tidak salah data, pilih salah satu:\n${lines}\n\n` +
    `Sebutkan nomor atau ID laporan yang dimaksud (contoh: "nomor 2" atau "ID ${candidates[0]?.id || 'xxxxxxxx'}").`
  );
}

/**
 * Pilih kandidat dari rujukan ordinal ("nomor 2", "yang pertama", "yang
 * terbaru"). Mengembalikan undefined bila tidak ada rujukan yang jelas.
 */
export function pickReportCandidate(
  t: string,
  candidates: ReportCandidate[]
): ReportCandidate | undefined {
  if (!candidates.length) return undefined;
  const ordinal = t.match(/\b(?:nomor|no\.?|yang|pilihan)\s*(\d{1,2})\b/);
  if (ordinal) {
    const idx = Number(ordinal[1]) - 1;
    if (idx >= 0 && idx < candidates.length) return candidates[idx];
  }
  if (/\b(?:pertama|paling atas|awal)\b/.test(t)) return candidates[0];
  if (/\b(?:kedua|dua)\b/.test(t) && candidates[1]) return candidates[1];
  if (/\b(?:ketiga|tiga)\b/.test(t) && candidates[2]) return candidates[2];
  if (/\b(?:terbaru|paling baru|terakhir|paling akhir)\b/.test(t)) return candidates[0];
  if (/\b(?:terlama|paling lama|paling awal)\b/.test(t)) return candidates[candidates.length - 1];
  return undefined;
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import AiConfigManager from '@/components/ui/admin/AiConfigManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Konfigurasi Asisten AI — Admin',
  description:
    'Kelola provider AI (OpenRouter / Gemini / Groq), API Key terenkripsi, model utama, dan model cadangan.',
};

/**
 * HALAMAN KONFIGURASI ASISTEN AI (Admin).
 *
 * Semua pipeline AI memakai konfigurasi yang dikelola di sini:
 *  - satu provider AKTIF (OpenRouter / Gemini / Groq),
 *  - API Key tiap provider tersimpan terenkripsi di server (AES-256-GCM),
 *  - model utama + daftar model cadangan (urutan = prioritas),
 *  - fallback transparan: provider/model yang dipakai dilaporkan ke UI.
 *
 * Nilai API Key TIDAK pernah dikirim ke browser — UI hanya melihat status
 * "Kunci ✔/✖".
 */
export default async function AdminAiConfigPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Konfigurasi Asisten AI</h2>
          <p>
            Pilih provider AI yang dipakai seluruh pipeline (asisten chat, analisis laporan, dan
            deteksi duplikat). API Key tiap provider disimpan terenkripsi di server dan tidak
            pernah dikirim ke browser. Provider aktif dipakai pada permintaan berikutnya.
          </p>
        </div>
      </div>

      <AiConfigManager />
    </div>
  );
}

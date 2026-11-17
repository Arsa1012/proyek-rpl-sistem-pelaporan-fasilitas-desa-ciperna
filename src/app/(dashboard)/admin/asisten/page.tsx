import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Asisten AI — Admin Desa Ciperna',
};

/**
 * Halaman detail "Asisten AI Admin".
 *
 * Menurut desain implementasi, perangkat utama percakapan Admin adalah
 * tombol mengambang (AdminAiFloatingChatbot) yang tersedia di seluruh halaman
 * Admin. Halaman ini dipertahankan sebagai HALAMAN DETAIL / informasi, bukan
 * sebagai laci chat terpisah, supaya tidak ada dua panel chatbot yang
 * berdampingan pada satu halaman.
 */
export default async function AdminAsistenPage() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') redirect('/login');

  return (
    <div className="assistant-layout">
      <div className="page-header">
        <div>
          <h2>Asisten AI Admin</h2>
          <p>
            Asisten AI menjawab pertanyaan Admin berdasarkan data aktual Desa Ciperna
            (laporan, penugasan, statistik, akun, wilayah, pengumuman). Semua aksi
            menggunakan endpoint <code style={{ padding: '0.15rem 0.4rem', borderRadius: 4, background: 'var(--muted-bg)' }}>/api/admin/ai/chat</code> yang dilindungi otorisasi ADMIN + query read-only.
          </p>
        </div>
        <div className="ai-notice" style={{ marginBottom: 0 }}>
          <span aria-hidden="true">💡</span>
          <p>
            Tombol chatbot mengambang sudah tersedia di seluruh halaman Admin.
            Buka chat dari tombol <strong>🤖</strong> di sudut kanan atas tanpa
            harus buka menu &apos;Asisten AI&apos;.
          </p>
        </div>
      </div>

      {/* Detail tambahan — chat utama di seluruh admin diatur oleh layout admin. */}
      <div style={{ padding: '1rem 0 2rem' }}>
        <div className="card" style={{ maxWidth: 760 }}>
          <h3 style={{ marginTop: 0 }}>Cara menggunakan Asisten AI</h3>
          <ol style={{ paddingLeft: '1.4rem', color: 'var(--text-secondary)' }}>
            <li>Pastikan Anda berada di dalam sesi Admin.</li>
            <li>Klik tombol <strong>🤖</strong> di kanan bawah layar.</li>
            <li>Pada halaman <strong>Asisten AI</strong>, panel ini adalah chat utama.</li>
            <li>Gunakan daftar cepat (quick question) atau ketik pertanyaan langsung.</li>
            <li>Untuk aksi yang mengubah data (verifikasi, penugasan, reset), gunakan menu yang sesuai di sidebar.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

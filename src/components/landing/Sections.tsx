import Link from 'next/link';
import { IconBot, IconRoad, IconLamp, IconWater, IconSchool, IconPhone, IconInstagram } from './icons';
import { dashboardHome } from '@/lib/roles';

export function ChatbotPreview({ session }: { session?: { role: string } | null }) {
  // Tamu diarahkan masuk dulu; pengguna yang sudah masuk langsung ke
  // halaman tempat chatbot tersedia (CipernaBot khusus masyarakat).
  const chatHref = !session
    ? '/login'
    : session.role === 'CITIZEN'
      ? '/masyarakat/dashboard'
      : session.role === 'ADMIN'
        ? '/admin/asisten'
        : dashboardHome(session.role);

  return (
    <section className="landing-section reveal" aria-labelledby="bot-title">
      <div className="section-head">
        <span className="section-eyebrow">Asisten Virtual</span>
        <h2 id="bot-title">Temui CipernaBot</h2>
        <p>Kesulitan membuat laporan? CipernaBot siap membantu menjawab pertanyaan masyarakat.</p>
      </div>
      <div className="bot-preview-wrap">
        <div className="bot-preview glass" aria-label="Contoh percakapan CipernaBot">
          <div className="bot-preview-head">
            <span className="chatbot-avatar" aria-hidden="true"><IconBot size={20} /></span>
            <div>
              <p className="chatbot-title">CipernaBot</p>
              <p className="chatbot-status"><span className="chatbot-dot" /> Online</p>
            </div>
          </div>
          <div className="chatbot-body">
            <div className="chatbot-msg chatbot-msg-assistant">
              Halo! Saya CipernaBot. Ada yang bisa saya bantu?
            </div>
            <div className="chatbot-msg chatbot-msg-user">
              Bagaimana cara melaporkan jalan rusak?
            </div>
            <div className="chatbot-msg chatbot-msg-assistant">
              Buka menu Buat Laporan, isi judul, deskripsi, kategori, foto, dan lokasi — lalu kirim. Statusnya bisa dipantau di Lacak Status.
            </div>
          </div>
          <div style={{ padding: '0 1rem 1rem' }}>
            <Link href={chatHref} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              Mulai Chat
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const FACILITIES = [
  { icon: <IconRoad />, title: 'Jalan', desc: 'Jalan desa dan akses warga' },
  { icon: <IconLamp />, title: 'Penerangan', desc: 'Lampu jalan dan listrik umum' },
  { icon: <IconWater />, title: 'Saluran Air', desc: 'Drainase dan saluran desa' },
  { icon: <IconSchool />, title: 'Fasilitas Umum', desc: 'Taman, jembatan, dan lainnya' },
];

export function Facilities() {
  return (
    <section id="fasilitas" className="landing-section reveal" aria-labelledby="fasilitas-title">
      <div className="section-head">
        <span className="section-eyebrow">Cakupan</span>
        <h2 id="fasilitas-title">Fasilitas Umum Desa</h2>
        <p>Jenis fasilitas yang dapat dilaporkan masyarakat.</p>
      </div>
      <div className="service-grid">
        {FACILITIES.map((f) => (
          <div key={f.title} className="service-card glass">
            <span className="service-icon">{f.icon}</span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const WA_CHAT_URL =
  'https://wa.me/6282118727522?text=' +
  encodeURIComponent('Halo Admin Desa Ciperna, saya ingin bertanya terkait Sistem Pelaporan Fasilitas Umum.');
const INSTAGRAM_URL = 'https://www.instagram.com/syajehh/';

export function ContactAdmin() {
  return (
    <section id="kontak" className="landing-section reveal" aria-labelledby="kontak-title">
      <div className="section-head">
        <span className="section-eyebrow">Kontak Resmi</span>
        <h2 id="kontak-title">Hubungi Admin</h2>
        <p>Butuh bantuan laporan atau informasi? Hubungi admin Desa Ciperna melalui kanal resmi berikut.</p>
      </div>
      <div className="contact-grid">
        <a
          href={WA_CHAT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary contact-btn"
          aria-label="Hubungi Admin via WhatsApp (membuka chat baru)"
        >
          <IconPhone size={20} />
          <span>Hubungi Admin via WhatsApp</span>
        </a>
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-instagram contact-btn"
          aria-label="Instagram Office Admin (membuka profil baru)"
        >
          <IconInstagram size={20} />
          <span>Instagram Office Admin</span>
        </a>
      </div>
      <p className="contact-note">Tombol di atas membuka chat/profil resmi. Notifikasi otomatis WhatsApp memerlukan konfigurasi Cloud API terpisah.</p>
    </section>
  );
}

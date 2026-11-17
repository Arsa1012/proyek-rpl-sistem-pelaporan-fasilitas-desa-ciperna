/**
 * Transisi halus saat berpindah halaman di area dashboard.
 *
 * Hanya memakai animasi `opacity` (bukan transform) agar elemen
 * `position: fixed` di dalam halaman (modal, drawer, chatbot) tetap
 * diposisikan terhadap viewport, bukan terhadap pembungkus ini.
 * Animasi dimatikan otomatis lewat `prefers-reduced-motion` di globals.css.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-transition">{children}</div>;
}

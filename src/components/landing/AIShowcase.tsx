import { IconCheck, IconSpark } from './icons';

const POINTS = [
  'Mengidentifikasi kategori fasilitas',
  'Menganalisis jenis kerusakan',
  'Menentukan tingkat keparahan',
  'Memberikan confidence score',
  'Membantu Admin memeriksa laporan',
];

export function AIShowcase() {
  return (
    <section className="landing-section reveal" aria-labelledby="ai-title">
      <div className="section-head">
        <span className="section-eyebrow">Teknologi</span>
        <h2 id="ai-title">Didukung Teknologi AI</h2>
        <p>AI membantu menganalisis laporan agar penanganan lebih cepat dan tepat.</p>
      </div>
      <div className="ai-showcase">
        <div className="ai-showcase-text">
          <h3>
            <IconSpark size={22} /> Analisis otomatis setiap laporan
          </h3>
          <ul>
            {POINTS.map((p) => (
              <li key={p}>
                <span className="hero-check"><IconCheck size={14} /></span> {p}
              </li>
            ))}
          </ul>
          <p className="ai-note">
            Keputusan akhir selalu berada di tangan Admin. AI bersifat rekomendasi.
          </p>
        </div>
        <div className="ai-mockup" aria-label="Contoh hasil analisis AI">
          <div className="ai-mockup-head">
            <span aria-hidden="true">🤖</span> AI Analysis
            <span className="ai-mockup-live">Contoh</span>
          </div>
          <dl>
            <div><dt>Kategori</dt><dd>Jalan</dd></div>
            <div><dt>Kerusakan</dt><dd>Lubang</dd></div>
            <div><dt>Severity</dt><dd><span className="ai-severity-badge" style={{ background: 'rgba(245,158,11,0.18)' }}>SEDANG</span></dd></div>
            <div>
              <dt>Confidence</dt>
              <dd>
                <span className="confidence-bar-bg" style={{ width: '120px', display: 'inline-block', verticalAlign: 'middle' }}>
                  <span className="confidence-bar-fill" style={{ width: '89%', display: 'block' }} />
                </span>{' '}
                <strong>89%</strong>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { getTileLayerConfig } from '@/lib/mapProvider';
import { REPORT_STATUS_LABELS } from '@/lib/status';

// Tipe data report untuk peta
export interface MapReport {
  id: string;
  title: string;
  status: string;
  category: string | null;
  severity: string | null;
  location: string;
  latitude: number;
  longitude: number;
  createdAt: string;
}

interface ReportMapProps {
  reports: MapReport[];
  /** Default center: Indonesia */
  defaultCenter?: [number, number];
  defaultZoom?: number;
  height?: string;
}

// ===== Warna per status =====
const STATUS_COLOR: Record<string, string> = {
  SUBMITTED: '#2563eb',
  VERIFIED: '#f59e0b',
  REJECTED: '#ef4444',
  ASSIGNED: '#8b5cf6',
  IN_PROGRESS: '#06b6d4',
  COMPLETED: '#10b981',
};

const STATUS_LABEL: Record<string, string> = { ...REPORT_STATUS_LABELS };

const SEVERITY_COLOR: Record<string, string> = {
  RENDAH: '#10b981',
  SEDANG: '#f59e0b',
  TINGGI: '#ef4444',
  KRITIS: '#7c3aed',
};

// ===== Buat SVG marker icon =====
function createMarkerSVG(color: string, severityColor?: string): string {
  const ring = severityColor ? severityColor : 'white';
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
      <filter id="shadow" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.3"/>
      </filter>
      <path d="M16 0C9.373 0 4 5.373 4 12c0 9 12 28 12 28s12-19 12-28C28 5.373 22.627 0 16 0z" 
            fill="${color}" filter="url(#shadow)"/>
      <circle cx="16" cy="12" r="6" fill="white" opacity="0.9"/>
      <circle cx="16" cy="12" r="4" fill="${color}"/>
      ${severityColor ? `<circle cx="24" cy="4" r="4" fill="${ring}" stroke="white" stroke-width="1.5"/>` : ''}
    </svg>
  `;
}

export default function ReportMap({
  reports,
  defaultCenter = [-2.5, 118.0],
  defaultZoom = 5,
  height = '560px',
}: ReportMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<MapReport | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Init Leaflet map — hanya di browser (dynamic import)
  useEffect(() => {
    const container = mapRef.current;
    if (!container || mapInstanceRef.current) return;

    let disposed = false;

    (async () => {
      try {
        // Dynamic import agar tidak crash di SSR
        const L = (await import('leaflet')).default;
        if (disposed || !container || mapInstanceRef.current) return;

        // Efek async bisa selesai setelah cleanup (React StrictMode) atau
        // setelah map lain dibuat. Jangan inisialisasi kontainer dua kali.
        if ((container as HTMLElement & { _leaflet_id?: number })._leaflet_id) {
          throw new Error('Kontainer peta sudah diinisialisasi oleh instance lain.');
        }

        // Fix missing marker icons di Next.js/webpack
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        });

        const tileConfig = getTileLayerConfig();

        const map = L.map(container, {
          center: defaultCenter,
          zoom: defaultZoom,
          zoomControl: true,
          attributionControl: true,
        });

        L.tileLayer(tileConfig.url, {
          attribution: tileConfig.attribution,
          maxZoom: tileConfig.maxZoom,
          subdomains: tileConfig.subdomains || 'abc',
        }).addTo(map);

        mapInstanceRef.current = { map, L };
        setMapError(null);
        setMapReady(true);
      } catch (error) {
        if (disposed) return;
        console.error('[ReportMap] Gagal menginisialisasi peta:', error);
        setMapError(error instanceof Error ? error.message : 'Peta gagal dimuat.');
      }
    })();

    return () => {
      disposed = true;
      if (mapInstanceRef.current?.map) {
        mapInstanceRef.current.map.remove();
        mapInstanceRef.current = null;
      }
      markersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers saat reports berubah
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const { map, L } = mapInstanceRef.current;

    // Hapus semua marker lama
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (reports.length === 0) return;

    const bounds: [number, number][] = [];

    reports.forEach((report) => {
      const statusColor = STATUS_COLOR[report.status] || '#64748b';
      const sevColor = report.severity ? SEVERITY_COLOR[report.severity] : undefined;

      const svgIcon = L.divIcon({
        html: createMarkerSVG(statusColor, sevColor),
        className: '',
        iconSize: [32, 40],
        iconAnchor: [16, 40],
        popupAnchor: [0, -42],
      });

      const dateStr = new Date(report.createdAt).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });

      const popupHtml = `
        <div class="report-popup">
          <div class="report-popup-title">
            ${report.title.length > 50 ? report.title.slice(0, 50) + '…' : report.title}
          </div>
          <div class="report-popup-tags">
            <span style="background: ${statusColor}22; color: ${statusColor}; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 700;">
              ${STATUS_LABEL[report.status] || report.status}
            </span>
            ${report.severity ? `<span style="background: ${SEVERITY_COLOR[report.severity!] || '#999'}22; color: ${SEVERITY_COLOR[report.severity!] || '#999'}; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 700;">⚠ ${report.severity}</span>` : ''}
          </div>
          ${report.category ? `<div class="report-popup-meta">🏷 ${report.category}</div>` : ''}
          <div class="report-popup-meta">📍 ${report.location.length > 40 ? report.location.slice(0, 40) + '…' : report.location}</div>
          <div class="report-popup-date">📅 ${dateStr}</div>
          <a class="report-popup-link" href="/admin/laporan/${report.id}">
            Lihat Detail →
          </a>
        </div>
      `;

      const marker = L.marker([report.latitude, report.longitude], { icon: svgIcon })
        .addTo(map)
        .bindPopup(popupHtml, {
          maxWidth: 280,
          className: 'report-map-popup',
        });

      marker.on('click', () => setSelectedReport(report));

      markersRef.current.push(marker);
      bounds.push([report.latitude, report.longitude]);
    });

    // Fit bounds kalau ada data
    if (bounds.length > 0 && bounds.length < 500) {
      try {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } catch (error) {
        console.warn('[ReportMap] Gagal menyesuaikan tampilan peta:', error);
      }
    }
  }, [reports, mapReady]);

  const reportsWithCoords = reports.length;

  return (
    <div style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', height }}>
      {/* Map container */}
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Overlay: loading / error */}
      {!mapReady && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--surface-3)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '1rem',
            textAlign: 'center',
            zIndex: 1000,
          }}
        >
          {mapError ? (
            <>
              <span role="alert" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                ⚠️ Peta gagal dimuat
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '38ch' }}>
                {mapError}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.location.reload()}
              >
                Muat ulang halaman
              </button>
            </>
          ) : (
            <>
              <div
                className="spinner"
                style={{
                  width: 32,
                  height: 32,
                  borderWidth: 3,
                  borderColor: 'var(--soft-primary-border)',
                  borderTopColor: 'var(--primary-color)',
                }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Memuat peta…</span>
            </>
          )}
        </div>
      )}

      {/* Overlay: badge jumlah titik */}
      {mapReady && (
        <div
          style={{
            position: 'absolute',
            top: '0.75rem',
            right: '0.75rem',
            background: 'var(--surface-solid)',
            backdropFilter: 'blur(8px)',
            borderRadius: '10px',
            padding: '0.4rem 0.85rem',
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'var(--text-primary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          📍 {reportsWithCoords} titik laporan
        </div>
      )}

      {/* Overlay: empty state */}
      {mapReady && reports.length === 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--surface-solid)',
            backdropFilter: 'blur(8px)',
            borderRadius: '12px',
            padding: '0.75rem 1.5rem',
            fontSize: '0.83rem',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            zIndex: 999,
            whiteSpace: 'nowrap',
          }}
        >
          Tidak ada laporan dengan koordinat GPS pada filter ini
        </div>
      )}
    </div>
  );
}

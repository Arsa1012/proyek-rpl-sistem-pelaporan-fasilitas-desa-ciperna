/**
 * Map Provider Abstraction
 * 
 * Memungkinkan penggantian tile provider tanpa mengubah komponen map.
 * Konfigurasi diambil dari environment variable MAP_PROVIDER.
 * 
 * Providers yang didukung:
 * - openstreetmap (default, gratis, tanpa API key)
 * - mapbox         (butuh NEXT_PUBLIC_MAPBOX_TOKEN)
 * - cartodb        (gratis, tanpa API key, tampilan lebih bersih)
 */

export type MapProvider = 'openstreetmap' | 'mapbox' | 'cartodb';

export interface TileLayerConfig {
  url: string;
  attribution: string;
  maxZoom: number;
  /** Opsional: sub-domains untuk load balancing */
  subdomains?: string;
}

function getProvider(): MapProvider {
  const env = process.env.NEXT_PUBLIC_MAP_PROVIDER as MapProvider | undefined;
  if (env && ['openstreetmap', 'mapbox', 'cartodb'].includes(env)) {
    return env;
  }
  return 'openstreetmap';
}

const TILE_CONFIGS: Record<MapProvider, (opts?: Record<string, string>) => TileLayerConfig> = {
  openstreetmap: () => ({
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    subdomains: 'abc',
  }),

  cartodb: () => ({
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
    subdomains: 'abcd',
  }),

  mapbox: () => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
    return {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${token}`,
      attribution:
        '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a> © <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 22,
    };
  },
};

/**
 * Kembalikan konfigurasi tile layer berdasarkan provider aktif.
 * Dipanggil di sisi client (komponen React).
 */
export function getTileLayerConfig(): TileLayerConfig {
  const provider = getProvider();
  return TILE_CONFIGS[provider]();
}

export { getProvider };

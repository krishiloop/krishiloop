/**
 * NASA GIBS (Global Imagery Browse Services, NASA EOSDIS), no key. Layer names and dates were checked with real requests
 * on 20 Nov 2026 (WMTS capabilities: true colour has daily images to 20 Nov, the NDVI 8-day layer to 19 Nov; tile 6/28/48
 * over Bangladesh answered 200 for both). The date used is two days before today (UTC), so the image always exists.
 */
export type GibsId = 'truecolor' | 'ndvi';

export interface GibsLayer {
  id: GibsId;
  layer: string;
  ext: 'jpg' | 'png';
  /** shown in the credit line */
  product: string;
  /** the finest zoom GIBS has tiles for (GoogleMapsCompatible_Level9); the map stretches beyond it */
  maxNativeZoom: number;
}

export const GIBS: Record<GibsId, GibsLayer> = {
  truecolor: { id: 'truecolor', layer: 'MODIS_Terra_CorrectedReflectance_TrueColor', ext: 'jpg', product: 'MODIS Terra', maxNativeZoom: 9 },
  ndvi: { id: 'ndvi', layer: 'MODIS_Terra_NDVI_8Day', ext: 'png', product: 'MODIS Terra NDVI, 8-day', maxNativeZoom: 9 },
};

/** "2026-11-18": a day GIBS has an image for (two days back, UTC). */
export function gibsDate(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  return d.toISOString().slice(0, 10);
}

export function gibsTileUrl(l: GibsLayer, date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l.layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.${l.ext}`;
}

/** A picture of one box (WMS GetMap, plate carree). bbox = [west, south, east, north]. */
export function gibsImageUrl(l: GibsLayer, date: string, bbox: [number, number, number, number], width: number, height: number): string {
  const [w, s, e, n] = bbox;
  // WMS 1.1.1, EPSG:4326: BBOX is lon,lat order
  return (
    'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1' +
    `&LAYERS=${l.layer}&STYLES=&SRS=EPSG:4326&BBOX=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/${l.ext === 'jpg' ? 'jpeg' : 'png'}&TIME=${date}`
  );
}

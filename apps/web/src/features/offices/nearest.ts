/** Distances, the nearest sort and the links of "Nearest agriculture office". Pure functions, no network. */

export interface Officer {
  name_bn: string;
  designation_bn: string | null;
  designation_en: string;
  /** the work mobile exactly as the government page lists it (digits only), or null */
  mobile: string | null;
}

export interface Office {
  id: string;
  name_en: string;
  name_bn: string | null;
  upazila_en: string;
  upazila_bn: string | null;
  district_en: string | null;
  district_bn: string | null;
  lat: number;
  lon: number;
  /** osm_point: a mapped office. upazila_centre: the middle of the upazila (approximate). */
  geo: 'osm_point' | 'upazila_centre';
  geo_source: string;
  phone: string | null;
  email: string | null;
  officer: Officer | null;
  source_url: string | null;
  source_read: string | null;
}

export interface OfficeData {
  meta: { built: string; count: number; with_phone: number; with_officer: number; sources: { name: string; url: string; use: string }[]; note: string };
  national: { name_en: string; name_bn: string; phone: string; source: string; source_url: string };
  offices: Office[];
}

export interface Ranked {
  office: Office;
  km: number;
}

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dphi = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The `n` closest offices, nearest first, each with its distance in km. Ties keep their listed order. */
export function nearest(offices: readonly Office[], lat: number, lon: number, n = 5): Ranked[] {
  return offices
    .map((office, i) => ({ office, km: haversineKm(lat, lon, office.lat, office.lon), i }))
    .sort((a, b) => a.km - b.km || a.i - b.i)
    .slice(0, n)
    .map(({ office, km }) => ({ office, km }));
}

/** Directions in the phone's map app (Google Maps opens on phones). */
export const directionsUrl = (lat: number, lon: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;

/** The same place on OpenStreetMap, the fallback link. */
export const osmUrl = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;

/** A `tel:` link from a phone number as published (spaces and dashes removed). */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Farther than this from every office means we have no list for the place (for example the Kenya sample farm). */
export const NO_LIST_KM = 300;

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { type Ranked } from './nearest';

/**
 * The map (Leaflet 1.9.4, BSD-2) with OpenStreetMap tiles. It lives in its own chunk: nothing here loads until the
 * sheet shows it. Markers are plain CSS dots (no image files), each with a title for screen readers.
 */
export default function OfficeMap({ origin, ranked, youLabel, errorText }: { origin: { lat: number; lon: number }; ranked: Ranked[]; youLabel: string; errorText: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let dead = false;
    void import('leaflet')
      .then((mod) => {
        const L = mod.default ?? mod;
        if (dead || !el.current) return;
        map = L.map(el.current, { scrollWheelZoom: false, zoomControl: true });
        map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>'); // the credit, without Leaflet's flag icon
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
        const dot = (cls: string, text: string) => L.divIcon({ className: '', html: `<span class="near-pin ${cls}">${text}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        const pts: [number, number][] = [[origin.lat, origin.lon]];
        L.marker([origin.lat, origin.lon], { icon: dot('near-pin-you', ''), title: youLabel, alt: youLabel }).addTo(map);
        ranked.forEach(({ office: o }, i) => {
          pts.push([o.lat, o.lon]);
          L.marker([o.lat, o.lon], { icon: dot('', String(i + 1)), title: o.name_en, alt: o.name_en }).addTo(map!);
        });
        map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 13 });
      })
      .catch(() => setFailed(true));
    return () => {
      dead = true;
      map?.remove();
    };
  }, [origin.lat, origin.lon, ranked, youLabel]);

  if (failed) return <p className="near-maptext">{errorText}</p>;
  return <div ref={el} className="near-leaflet" data-testid="near-leaflet" />;
}

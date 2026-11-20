import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { motionReduced } from '../../lib/motionPref';
import { type Office } from './nearest';

type LeafletNS = typeof import('leaflet');
type Pt = { lat: number; lon: number };

/** Bangladesh, the first view before anything is chosen. */
const BD: [[number, number], [number, number]] = [
  [20.6, 88.0],
  [26.7, 92.7],
];
/** Map colours (canvas dots cannot read CSS variables): forest dots on cream, a terracotta line, a lotus "you". */
const DOT = { color: '#faf6ee', weight: 1, fillColor: '#1f3d2c', fillOpacity: 0.9, radius: 5 };
const LINE = { color: '#8a3a1c', weight: 3, dashArray: '6 8', opacity: 0.9 };

/**
 * The map of every upazila agriculture office (Leaflet 1.9.4, BSD-2, with OpenStreetMap tiles). Its own chunk:
 * nothing loads until the finder shows it. The 544 offices are canvas dots (light on a phone); the chosen office and
 * "you" are DOM pins with a title for screen readers. Choosing an office (here or in the list) flies the map to it
 * and draws a dashed straight line from the farmer when we know where the farmer is.
 */
export default function OfficeMap({
  offices,
  origin,
  selected,
  onSelect,
  labelOf,
  youLabel,
  errorText,
}: {
  offices: readonly Office[];
  origin: Pt | null;
  selected: Office | null;
  onSelect: (id: string) => void;
  labelOf: (o: Office) => string;
  youLabel: string;
  errorText: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [L, setL] = useState<LeafletNS | null>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const pick = useRef(onSelect);
  pick.current = onSelect;
  const label = useRef(labelOf);
  label.current = labelOf;

  // the map, once
  useEffect(() => {
    let dead = false;
    void import('leaflet')
      .then((mod) => {
        const lf = (mod.default ?? mod) as LeafletNS;
        if (dead || !el.current) return;
        const m = lf.map(el.current, { scrollWheelZoom: false, zoomControl: true, preferCanvas: true });
        m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>'); // the credit, without Leaflet's flag icon
        lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
        m.fitBounds(BD);
        map.current = m;
        setL(lf);
      })
      .catch(() => setFailed(true));
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // every office as a dot; a tap opens it
  useEffect(() => {
    const m = map.current;
    if (!L || !m) return;
    const group = L.layerGroup();
    for (const o of offices) {
      L.circleMarker([o.lat, o.lon], DOT)
        .bindTooltip(label.current(o), { direction: 'top', offset: [0, -6] })
        .on('click', () => pick.current(o.id))
        .addTo(group);
    }
    group.addTo(m);
    return () => {
      group.remove();
    };
  }, [L, offices]);

  // the farmer, the chosen office, the line between them, and the view
  useEffect(() => {
    const m = map.current;
    if (!L || !m) return;
    const pin = (cls: string, size: number) => L.divIcon({ className: '', html: `<span class="near-pin ${cls}"></span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const group = L.layerGroup();
    if (origin) L.marker([origin.lat, origin.lon], { icon: pin('near-pin-you', 22), title: youLabel, alt: youLabel, keyboard: false, zIndexOffset: 500 }).addTo(group);
    if (selected) {
      if (origin) L.polyline([[origin.lat, origin.lon], [selected.lat, selected.lon]], { ...LINE, interactive: false }).addTo(group);
      L.marker([selected.lat, selected.lon], { icon: pin('near-pin-on', 34), title: label.current(selected), alt: label.current(selected), keyboard: false, zIndexOffset: 1000 }).addTo(group);
    }
    group.addTo(m);
    const animate = !motionReduced();
    const pts: [number, number][] = [];
    if (selected) pts.push([selected.lat, selected.lon]);
    if (origin) pts.push([origin.lat, origin.lon]);
    if (pts.length === 2) {
      const b = L.latLngBounds(pts);
      if (animate) m.flyToBounds(b, { padding: [36, 36], maxZoom: 12, duration: 0.9 });
      else m.fitBounds(b, { padding: [36, 36], maxZoom: 12 });
    } else if (pts.length === 1) {
      const zoom = selected ? 11 : 9;
      if (animate) m.flyTo(pts[0]!, zoom, { duration: 0.9 });
      else m.setView(pts[0]!, zoom);
    }
    return () => {
      group.remove();
    };
  }, [L, origin?.lat, origin?.lon, selected, youLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <p className="near-maptext">{errorText}</p>;
  return <div ref={el} className="near-leaflet" data-testid="near-leaflet" data-selected={selected?.id ?? ''} />;
}

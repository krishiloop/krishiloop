"""Area outlines for the outbreak radar: build them once, small, from public boundary files; look up a point's area.

Sources (geoBoundaries gbOpen, release 9469f09, the "_simplified" GeoJSON files):
- Bangladesh districts (ADM2, 64): Bangladesh Bureau of Statistics (BBS) and OCHA ROAP, via HDX; licence CC BY 3.0 IGO.
- Kenya counties (ADM1, 47): RCMRD GeoPortal / Africa GeoPortal; licence Public Domain.

Build (the source files are downloaded by hand, never at run time):
    python services/engine/radar_geo.py BD <bgd_adm2_simplified.geojson> KE <ken_adm1_simplified.geojson>
writes
- services/engine/radar_areas.json                         lon/lat outlines for the server's point-in-area lookup;
- apps/web/src/features/officer/radar/geo/<bd|ke>.json     projected SVG paths, loaded lazily by the radar map.
Both come from the same simplified rings, so the server and the map always agree on which area a point is in.
"""
from __future__ import annotations

import json
import math
import re
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AREAS_JSON = Path(__file__).resolve().parent / "radar_areas.json"
WEB_GEO = ROOT / "apps" / "web" / "src" / "features" / "officer" / "radar" / "geo"

COUNTRIES = {
    "BD": {"level": "district", "tolerance": 0.012, "min_island_deg2": 0.0006,
           "source": "geoBoundaries gbOpen BGD ADM2 (Bangladesh Bureau of Statistics; OCHA ROAP)",
           "licence": "CC BY 3.0 IGO", "url": "https://www.geoboundaries.org/countryDownloads.html"},
    "KE": {"level": "county", "tolerance": 0.025, "min_island_deg2": 0.002,
           "source": "geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal; Africa GeoPortal)",
           "licence": "Public Domain", "url": "https://www.geoboundaries.org/countryDownloads.html"},
}
WIDTH = 1000          # SVG width in user units; the height follows the country's shape


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("'", "")).strip("-")


def area_code(country: str, name: str) -> str:
    return f"{country}-{slug(name)}"


# ------------------------------------------------------------------ geometry helpers (no dependencies)
def _ring_area(ring: list[list[float]]) -> float:
    return abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]))) / 2


def _dp(points: list[list[float]], tol: float) -> list[list[float]]:
    """Douglas-Peucker on an open polyline (iterative, so long rings do not hit the recursion limit)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring: list[list[float]], tol: float) -> list[list[float]]:
    pts = ring[:-1] if ring and ring[0] == ring[-1] else ring
    if len(pts) < 4:
        return pts
    # split at the point farthest from the first, so a closed ring keeps its extent
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    out = _dp(pts[: far + 1], tol)[:-1] + _dp(pts[far:] + [pts[0]], tol)[:-1]
    return out if len(out) >= 3 else pts


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


# ------------------------------------------------------------------ build
def build_country(country: str, geojson: dict) -> tuple[list[dict], dict]:
    cfg = COUNTRIES[country]
    areas = []
    for ft in geojson["features"]:
        name = ft["properties"]["shapeName"]
        g = ft["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        outers = [p[0] for p in polys]                     # holes are dropped: none matter at this scale
        biggest = max(outers, key=_ring_area)
        rings = [simplify_ring(r, cfg["tolerance"]) for r in outers
                 if r is biggest or _ring_area(r) >= cfg["min_island_deg2"]]
        rings = [[[round(x, 4), round(y, 4)] for x, y in r] for r in rings if len(r) >= 3]
        areas.append({"code": area_code(country, name), "name": name, "rings": rings})
    areas.sort(key=lambda a: a["code"])
    # equirectangular projection centred on the country, cos(latitude) keeps the shape
    xs = [x for a in areas for r in a["rings"] for x, _ in r]
    ys = [y for a in areas for r in a["rings"] for _, y in r]
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    w = (max(xs) - min(xs)) * k
    scale = WIDTH / w
    height = round((max(ys) - min(ys)) * scale)
    proj = {"lon_min": min(xs), "lat_max": max(ys), "k": k, "scale": scale}

    def px(x: float, y: float) -> tuple[int, int]:
        return round((x - proj["lon_min"]) * k * scale), round((proj["lat_max"] - y) * scale)

    web_areas = []
    for a in areas:
        parts = []
        for r in a["rings"]:
            pts = [px(x, y) for x, y in r]
            dedup = [pts[0]] + [p for p, q in zip(pts[1:], pts) if p != q]
            seg = [f"M{dedup[0][0]} {dedup[0][1]}"] + [f"l{x1 - x0} {y1 - y0}" for (x0, y0), (x1, y1) in zip(dedup, dedup[1:])]
            parts.append("".join(seg) + "z")
        big = max(a["rings"], key=_ring_area)
        cx = sum(x for x, _ in big) / len(big)
        cy = sum(y for _, y in big) / len(big)
        lx, ly = px(cx, cy)
        web_areas.append({"code": a["code"], "name": a["name"], "d": "".join(parts), "label": [lx, ly]})
    web = {"country": country, "level": cfg["level"], "viewBox": [0, 0, WIDTH, height],
           "projection": {k2: round(v, 6) for k2, v in proj.items()},
           "source": cfg["source"], "licence": cfg["licence"], "url": cfg["url"],
           "note": "Simplified for a small map (Douglas-Peucker); borders are approximate.", "areas": web_areas}
    return areas, web


def main(argv: list[str]) -> None:
    pairs = dict(zip(argv[0::2], argv[1::2]))
    server = {"note": "Outlines simplified from geoBoundaries (see services/engine/radar_geo.py); for area lookup only.",
              "countries": {}}
    WEB_GEO.mkdir(parents=True, exist_ok=True)
    for country, path in pairs.items():
        areas, web = build_country(country, json.loads(Path(path).read_text(encoding="utf-8")))
        cfg = COUNTRIES[country]
        server["countries"][country] = {"level": cfg["level"], "source": cfg["source"], "licence": cfg["licence"],
                                        "areas": areas}
        (WEB_GEO / f"{country.lower()}.json").write_text(json.dumps(web, ensure_ascii=False, separators=(",", ":")),
                                                         encoding="utf-8")
    AREAS_JSON.write_text(json.dumps(server, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ------------------------------------------------------------------ lookup (used by services/engine/radar.py)
@lru_cache(maxsize=1)
def _areas() -> dict:
    return json.loads(AREAS_JSON.read_text(encoding="utf-8"))["countries"]


def area_of(lat: float, lon: float, country: str | None = None) -> dict | None:
    """{code, name, country, level} of the area that contains the point, or None (outside every outline we hold)."""
    for c, data in _areas().items():
        if country and c != country:
            continue
        for a in data["areas"]:
            if any(point_in_ring(lon, lat, r) for r in a["rings"]):
                return {"code": a["code"], "name": a["name"], "country": c, "level": data["level"]}
    return None


def area_names() -> dict[str, dict]:
    return {a["code"]: {"name": a["name"], "country": c, "level": d["level"]}
            for c, d in _areas().items() for a in d["areas"]}


if __name__ == "__main__":
    main(sys.argv[1:])

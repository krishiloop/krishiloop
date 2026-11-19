"""Build the "Nearest agriculture office" data (Bangladesh): apps/web/src/data/offices/bd.json.

Run once on a build machine; the website never calls these sources. Sources, in the order they are used:

1. geoBoundaries gbOpen ADM3 (upazila outlines, CC BY 3.0 IGO) and ADM2 (districts): one APPROXIMATE point per upazila,
   the centre of its outline. This is where every office starts.
2. The Bangladesh national portal's Department of Agricultural Extension (DAE) pages, one per upazila:
   https://dae.<upazila>.<district>.gov.bd/pages/officers . The office phone and the head officer (the "Upazila
   Agriculture Officer": name, designation, the work mobile and the office phone) are copied as the government page
   publishes them. An email is kept only when it is a *.gov.bd address. Nothing else is taken from those pages
   (no other staff, no photos, no social media). When the page is not found, the office has no contact and no officer.
3. OpenStreetMap through the Overpass API (optional, `--osm`): a mapped agriculture office point inside an upazila
   replaces the upazila centre ("osm_point"). OSM is ODbL: the page shows "(c) OpenStreetMap contributors".

The national Krishi Call Centre 16123 is added as a fixed row (fact register D5, Dhaka Tribune, 6 Oct 2016).

Usage (repo root):
    python tools/build_offices.py [--cache DIR] [--osm] [--no-portal] [--date 2026-11-20] [--out PATH]
Nothing is invented: a field with no source is null.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import datetime as dt
import html
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterable

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "src" / "data" / "offices" / "bd.json"
GB = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGD"
ADM3_URL = f"{GB}/ADM3/geoBoundaries-BGD-ADM3_simplified.geojson"
ADM2_URL = f"{GB}/ADM2/geoBoundaries-BGD-ADM2_simplified.geojson"
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "krishiloop-office-builder/1.0 (open data build script)"
BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

Fetcher = Callable[[str, bytes | None], bytes]


# ----------------------------------------------------------------------------------------------- network
def fetch(url: str, data: bytes | None = None, tries: int = 3, timeout: int = 40) -> bytes:
    last: Exception | None = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:  # includes HTTPError
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 404, 410):
                break
            if "getaddrinfo" in str(e) and i >= 1:
                break  # the host most likely does not exist (a portal the upazila does not have): one retry, then stop
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed: {url}: {last}")


def cached(cache: Path, name: str, url: str, fetcher: Fetcher) -> bytes:
    p = cache / name
    if p.exists():
        return p.read_bytes()
    b = fetcher(url, None)
    cache.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b)
    return b


# ----------------------------------------------------------------------------------------------- geometry
def _rings(geom: dict[str, Any]) -> list[list[list[float]]]:
    """Outer rings of a Polygon or MultiPolygon."""
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [p[0] for p in geom["coordinates"]]


def ring_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """(lon, lat, signed area) of one ring (planar; fine at upazila size)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    a *= 0.5
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (6 * a), cy / (6 * a), a


def point_in_ring(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def in_geom(lon: float, lat: float, geom: dict[str, Any]) -> bool:
    return any(point_in_ring(lon, lat, r) for r in _rings(geom))


def centre_of(geom: dict[str, Any]) -> tuple[float, float]:
    """The centroid of the largest part; when it falls outside the shape, the centre of the bounding box of that part."""
    best = max(_rings(geom), key=lambda r: abs(ring_centroid(r)[2]))
    lon, lat, _ = ring_centroid(best)
    if not point_in_ring(lon, lat, best):
        xs = [p[0] for p in best]
        ys = [p[1] for p in best]
        lon, lat = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return lon, lat


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def nearest(offices: Iterable[dict[str, Any]], lat: float, lon: float, n: int = 3) -> list[tuple[float, dict[str, Any]]]:
    """The n nearest offices, closest first, with the distance in km (same maths as the web app's nearest())."""
    ranked = sorted(((haversine_km(lat, lon, o["lat"], o["lon"]), o) for o in offices), key=lambda x: x[0])
    return ranked[:n]


# ----------------------------------------------------------------------------------------------- portal pages
def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


# geoBoundaries (2015 BBS spellings) -> the spelling the national portal uses in its host names
DISTRICT_HOST = {
    "netrakona": "netrokona", "chittagong": "chattogram", "bogra": "bogura", "brahamanbaria": "brahmanbaria",
    "maulvibazar": "moulvibazar", "barisal": "barishal", "comilla": "cumilla", "jessore": "jashore",
    "jhalokati": "jhalakathi", "nawabganj": "chapainawabganj", "chapainawabganj": "chapainawabganj",
    "coxsbazar": "coxsbazar", "bagerhat": "bagerhat", "habiganj": "habiganj", "kishoreganj": "kishoreganj",
}


def slug_candidates(upazila: str) -> list[str]:
    base = slug(upazila)
    out = [base]
    if base.endswith("sadar"):
        out.append(base[: -len("sadar")])
    seen: list[str] = []
    for s in out:
        if s and s not in seen:
            seen.append(s)
    return seen


def _text(s: str) -> str:
    s = re.sub(r"<wbr\s*/?>", "", s)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def _row(block: str, label: str) -> str:
    m = re.search(r"<td>\s*" + re.escape(label) + r"\s*</td>\s*<td[^>]*>(.*?)</td>", block, re.S)
    return _text(m.group(1)) if m else ""


def _digits(s: str) -> str:
    return re.sub(r"[^0-9+]", "", s.translate(BN_DIGITS))


def parse_officers(page: str) -> dict[str, Any] | None:
    """The head officer's card of a DAE upazila officers page, or None. Copies only the first "Upazila Agriculture Officer"."""
    cards = re.findall(r"<tr>\s*<td>\s*নাম\s*</td>.*?ভিকার্ড", page, re.S)
    for c in cards:
        desig = _row(c, "পদবি")
        if "উপজেলা কৃষি অফিসার" not in desig and "উপজেলা কৃষি কর্মকর্তা" not in desig:
            continue
        office_line = _row(c, "অফিস")
        name = _row(c, "নাম")
        email = _row(c, "ইমেইল").replace(" ", "")
        mobile = _digits(_row(c, "মোবাইল"))
        office_phone = _digits(_row(c, "ফোন (অফিস)"))
        return {
            "name_bn": name or None,
            "designation_bn": desig,
            "mobile": mobile if re.fullmatch(r"01\d{9}", mobile) else None,
            "office_phone": office_phone or None,
            "email": email if re.fullmatch(r"[\w.+-]+@[\w-]+(\.[\w-]+)*\.gov\.bd", email, re.I) else None,
            "office_line_bn": office_line or None,
        }
    return None


def decode_rt(page: str) -> str:
    """Some designations are base64 in <rt-renderer encoded-content>; unused (the visible text is the same), kept for tests."""
    m = re.search(r'encoded-content="([^"]+)"', page)
    return base64.b64decode(m.group(1)).decode("utf8") if m else ""


def bn_places(office_line: str | None) -> tuple[str | None, str | None]:
    """'কৃষি সম্প্রসারণ অধিদপ্তর, ত্রিশাল, ময়মনসিংহ' -> ('ত্রিশাল', 'ময়মনসিংহ')."""
    if not office_line:
        return None, None
    parts = [p.strip() for p in office_line.split(",")]
    if len(parts) >= 3:
        return parts[-2], parts[-1]
    return None, None


def scrape_office(district: str, upazila: str, fetcher: Fetcher) -> dict[str, Any] | None:
    ds = slug(district)
    hosts = list(dict.fromkeys([DISTRICT_HOST.get(ds, ds), ds]))  # the portal's spelling first, then geoBoundaries' own
    for u in slug_candidates(upazila):
        for h in hosts:
            url = f"https://dae.{u}.{h}.gov.bd/pages/officers"
            try:
                page = fetcher(url, None).decode("utf8", "replace")
            except Exception:
                continue
            got = parse_officers(page)
            if got:
                got["url"] = url
                return got
    return None


# ----------------------------------------------------------------------------------------------- OSM
def osm_query(bbox: tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    b = f"({s},{w},{n},{e})"
    return (
        "[out:json][timeout:60];("
        f'nwr["office"]["name"~"Agricultur|Krishi|কৃষি"]{b};'
        f'nwr["name:bn"~"কৃষি অফিস|কৃষি সম্প্রসারণ"]{b};'
        ");out center tags 300;"
    )


def osm_points(fetcher: Fetcher, tiles: Iterable[tuple[float, float, float, float]]) -> list[dict[str, Any]]:
    pts: list[dict[str, Any]] = []
    for t in tiles:
        try:
            raw = fetcher(OVERPASS, urllib.parse.urlencode({"data": osm_query(t)}).encode())
            els = json.loads(raw).get("elements", [])
        except Exception as e:  # a slow tile is skipped and reported, never fatal
            print(f"  osm tile {t} skipped: {e}")
            continue
        for el in els:
            tags = el.get("tags", {})
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lon = el.get("lon") or (el.get("center") or {}).get("lon")
            nm = tags.get("name") or tags.get("name:bn") or ""
            if lat is None or lon is None:
                continue
            if not re.search(r"upazila|উপজেলা|upozila|sub.?district", nm + tags.get("name:en", ""), re.I) or not re.search(
                r"agri|krishi|কৃষি", nm + tags.get("name:en", "") + tags.get("name:bn", ""), re.I
            ):
                continue
            pts.append({"lat": lat, "lon": lon, "name": nm, "id": f"{el['type']}/{el['id']}", "phone": tags.get("phone") or tags.get("contact:phone")})
    return pts


def tiles(step: float = 1.0) -> list[tuple[float, float, float, float]]:
    out = []
    lat = 20.5
    while lat < 26.7:
        lon = 88.0
        while lon < 92.7:
            out.append((round(lat, 2), round(lon, 2), round(lat + step, 2), round(lon + step, 2)))
            lon += step
        lat += step
    return out


# ----------------------------------------------------------------------------------------------- build
def build(adm3: dict[str, Any], adm2: dict[str, Any], today: str, fetcher: Fetcher, portal: bool = True, osm: list[dict[str, Any]] | None = None, workers: int = 8) -> dict[str, Any]:
    districts = [(f["properties"]["shapeName"], f["geometry"]) for f in adm2["features"]]
    base: list[dict[str, Any]] = []
    for f in adm3["features"]:
        lon, lat = centre_of(f["geometry"])
        dname = next((n for n, g in districts if in_geom(lon, lat, g)), None)
        base.append({"upazila": f["properties"]["shapeName"], "district": dname, "lat": lat, "lon": lon, "geom": f["geometry"]})

    scraped: dict[int, dict[str, Any] | None] = {}
    if portal:
        with cf.ThreadPoolExecutor(workers) as ex:
            futs = {ex.submit(scrape_office, b["district"], b["upazila"], fetcher): i for i, b in enumerate(base) if b["district"]}
            for fu in cf.as_completed(futs):
                scraped[futs[fu]] = fu.result()

    offices: list[dict[str, Any]] = []
    for i, b in enumerate(base):
        s = scraped.get(i)
        lat, lon, how, osm_id = b["lat"], b["lon"], "upazila_centre", None
        for p in osm or []:
            if in_geom(p["lon"], p["lat"], b["geom"]):
                lat, lon, how, osm_id = p["lat"], p["lon"], "osm_point", p["id"]
                break
        up_bn, dist_bn = bn_places(s["office_line_bn"]) if s else (None, None)
        officer = None
        if s and s["name_bn"]:
            officer = {"name_bn": s["name_bn"], "designation_bn": s["designation_bn"], "designation_en": "Upazila Agriculture Officer", "mobile": s["mobile"]}
        offices.append(
            {
                "id": f"bd-{slug(b['district'] or 'x')}-{slug(b['upazila'])}",
                "name_en": f"Upazila Agriculture Office, {b['upazila']}",
                "name_bn": f"উপজেলা কৃষি অফিস, {up_bn}" if up_bn else None,
                "upazila_en": b["upazila"],
                "upazila_bn": up_bn,
                "district_en": b["district"],
                "district_bn": dist_bn,
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "geo": how,
                "geo_source": f"OpenStreetMap {osm_id}" if osm_id else "geoBoundaries gbOpen ADM3 (centre of the upazila outline)",
                "phone": s["office_phone"] if s else None,
                "email": s["email"] if s else None,
                "officer": officer,
                "source_url": s["url"] if s else None,
                "source_read": today if s else None,
            }
        )
    offices.sort(key=lambda o: (o["district_en"] or "", o["upazila_en"]))
    return {
        "meta": {
            "built": today,
            "country": "BD",
            "count": len(offices),
            "with_phone": sum(1 for o in offices if o["phone"]),
            "with_officer": sum(1 for o in offices if o["officer"]),
            "with_osm_point": sum(1 for o in offices if o["geo"] == "osm_point"),
            "sources": [
                {"name": "geoBoundaries gbOpen BGD ADM3 and ADM2 (release 9469f09), CC BY 3.0 IGO", "url": "https://www.geoboundaries.org/", "use": "approximate upazila centres and district names"},
                {"name": "Bangladesh National Portal, DAE upazila pages (dae.<upazila>.<district>.gov.bd/pages/officers)", "url": "https://dae.gov.bd/", "use": "office phone, head officer, a *.gov.bd email"},
                {"name": "OpenStreetMap contributors (ODbL), via Overpass", "url": "https://www.openstreetmap.org/copyright", "use": "mapped office points where one exists"},
            ],
            "note": "Points marked upazila_centre are approximate: the middle of the upazila, not the office door. Contacts are copied from government pages as published; a missing contact is null.",
        },
        "national": {
            "name_en": "Krishi Call Centre",
            "name_bn": "কৃষি কল সেন্টার",
            "phone": "16123",
            "source": "DAE Agriculture Call Centre short code 16123 (Dhaka Tribune, 6 Oct 2016; fact register D5)",
            "source_url": "https://www.dhakatribune.com/feature/6771/agro-aid-through-the-wire",
        },
        "offices": offices,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=str(Path("D:/AI_congress/cache/offices")))
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--date", default=dt.date.today().isoformat())
    ap.add_argument("--osm", action="store_true")
    ap.add_argument("--no-portal", action="store_true")
    a = ap.parse_args(argv)
    cache = Path(a.cache)
    adm3 = json.loads(cached(cache, "adm3.geojson", ADM3_URL, lambda u, d: fetch(u, d, timeout=180)))
    adm2 = json.loads(cached(cache, "adm2.geojson", ADM2_URL, lambda u, d: fetch(u, d, timeout=180)))
    pts = osm_points(fetch, tiles()) if a.osm else None
    data = build(adm3, adm2, a.date, fetch, portal=not a.no_portal, osm=pts)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf8")
    m = data["meta"]
    print(f"{m['count']} offices, {m['with_phone']} with a phone, {m['with_officer']} with an officer, {m['with_osm_point']} OSM points -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Build the Disease map's static data (builder M): area outlines and GBIF recorded sightings, OFFLINE, once.

The website never calls GBIF or geoBoundaries. This script runs on a build machine and writes small JSON files that
the /map page loads lazily:

    apps/web/src/data/map/geo-in.json              India states and union territories (geoBoundaries ADM1), SVG paths
    apps/web/src/data/map/geo-bd-div.json          Bangladesh divisions (geoBoundaries ADM1), SVG paths + their districts
    apps/web/src/data/map/sightings.json           GBIF occurrence counts per area, per year, per pest (what the page reads)
    apps/web/src/data/map/sightings_provenance.json  the queries, taxon keys, licences, and every GADM-to-area match
                                                    (documentation; the page does not import it)

Bangladesh districts and Kenya counties are NOT rebuilt here: the map reuses the outbreak radar's outlines
(apps/web/src/features/officer/radar/geo/{bd,ke}.json, built by services/engine/radar_geo.py), so the farmer reports
and the recorded sightings always use the same area codes.

Usage (from the repo root):
    python tools/build_map_data.py geo  --ind <IND-ADM1_simplified.geojson> --bgd1 <BGD-ADM1_simplified.geojson>
    python tools/build_map_data.py gbif [--date 2026-11-19]
The geo inputs are geoBoundaries gbOpen release 9469f09 "_simplified" files (download them by hand or with
`python tools/build_map_data.py fetch-geo <dir>`). The gbif step calls api.gbif.org (no key, no account).

Counts: GBIF's facet API on GADM ids (occurrence/search?country=..&taxonKey=..&facet=gadmLevel1Gid&limit=0), then one
year facet per area that has records. GADM ids are named with GBIF's own geocode API (geocode/gadm/{gid}/subdivisions)
and matched to our outline names by normalised name, then a short alias list (written below), then a close fuzzy match
(difflib >= 0.85, recorded as fuzzy). Everything unmatched is listed in the provenance file, never dropped silently.
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import json
import math
import sys
import time
import unicodedata
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.engine.radar_geo import _ring_area, point_in_ring, simplify_ring, slug  # noqa: E402

OUT = ROOT / "apps" / "web" / "src" / "data" / "map"
RADAR_GEO = ROOT / "apps" / "web" / "src" / "features" / "officer" / "radar" / "geo"
RADAR_AREAS = ROOT / "services" / "engine" / "radar_areas.json"
API = "https://api.gbif.org/v1"
GB_RELEASE = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen"
WIDTH = 1000

# ------------------------------------------------------------------ what we look for
# id: the page's key; names: tried in order with GBIF's species-match API (the first exact match wins; a synonym
# resolves to its accepted name, whose taxonKey also returns records filed under the synonym); problems: the outbreak
# radar's problem codes for the same pest (services/engine/radar.py), so farmer reports and sightings line up.
TAXA = [
    {"id": "faw", "names": ["Spodoptera frugiperda"], "problems": ["fall_armyworm"]},
    {"id": "blast", "names": ["Pyricularia oryzae", "Magnaporthe oryzae"], "problems": ["blast", "rice_blast", "neck_blast"]},
    {"id": "late_blight", "names": ["Phytophthora infestans"], "problems": ["late_blight"]},
    {"id": "bph", "names": ["Nilaparvata lugens"], "problems": ["brown_planthopper"]},
    {"id": "locust", "names": ["Schistocerca gregaria"], "problems": ["desert_locust", "locust"]},
    {"id": "blb", "names": ["Xanthomonas oryzae"], "problems": ["bacterial_leaf_blight", "bacterial_blight"]},
    {"id": "brown_spot", "names": ["Bipolaris oryzae", "Cochliobolus miyabeanus"], "problems": ["brown_spot"]},
]

COUNTRIES = {
    # iso2: (iso3, levels we count, the level the page shows first)
    "BD": {"iso3": "BGD", "levels": {"division": 1, "district": 2}},
    # GADM files Indian-administered Jammu and Kashmir under its disputed-area code Z01 (not under IND), so its
    # level-1 unit is added to India's list; GADM has no separate Ladakh unit, so Ladakh cannot be counted apart.
    "IN": {"iso3": "IND", "levels": {"state": 1}, "extra_gadm": ["Z01"]},
    "KE": {"iso3": "KEN", "levels": {"county": 1}},
}

# GADM name (normalised) -> our outline name (normalised), only where the spelling differs beyond accents and
# punctuation. Every entry is a real alternative spelling of the same unit, checked by hand on 19 Nov 2026.
ALIASES: dict[str, dict[str, str]] = {
    "BD": {
        "rajshani": "rajshahi",            # geoBoundaries BGD ADM1 spells the division "Rajshani" (a typo; NAME_FIX shows Rajshahi)
        "brahmanbaria": "brahamanbaria",
        "chapainawabganj": "nawabganj",
        "chapainababganj": "nawabganj",
        "moulvibazar": "maulvibazar",
        "netrokona": "netrakona",
        "jhalokathi": "jhalokati",
        "chattogram": "chittagong",
        "cumilla": "comilla",
        "bogura": "bogra",
        "jashore": "jessore",
        "barishal": "barisal",
        "coxsbazar": "coxsbazar",
    },
    "IN": {
        "nctofdelhi": "delhi",
        "andamanandnicobar": "andamanandnicobarislands",
        "orissa": "odisha",
        "uttaranchal": "uttarakhand",
        "pondicherry": "puducherry",
        "dadraandnagarhaveli": "dadraandnagarhavelianddamananddiu",
        "damananddiu": "dadraandnagarhavelianddamananddiu",
        "dadraandnagarhavelianddamananddiu": "dadraandnagarhavelianddamananddiu",
    },
    "KE": {
        "tharakanithi": "tharaka",
        "elgeyomarakwet": "elgeyomarakwet",
        "keiyomarakwet": "elgeyomarakwet",
    },
}
# display fixes for typos in the boundary source (the code keeps the source spelling so it never changes silently)
NAME_FIX = {"Rajshani": "Rajshahi"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower().replace("&", "and")
    return "".join(ch for ch in s if ch.isalnum())


def ascii_name(s: str) -> str:
    """'Arunāchal Pradesh' -> 'Arunachal Pradesh' (the common English spelling)."""
    s = unicodedata.normalize("NFKD", s)
    return NAME_FIX.get(s, "".join(ch for ch in s if not unicodedata.combining(ch)))


def match_names(gadm: list[dict], ours: list[dict], aliases: dict[str, str]) -> dict:
    """GADM units [{id, name, variants}] -> our areas [{code, name}].

    Returns {"map": {gid: code}, "how": {gid: "exact"|"variant"|"alias"|"fuzzy:0.91"}, "unmatched_gadm": [...],
    "unmatched_ours": [...]}. A code is used once at most (two GADM units never fold into one of ours by accident)."""
    by_norm = {norm(a["name"]): a["code"] for a in ours}
    used: set[str] = set()
    out: dict[str, str] = {}
    how: dict[str, str] = {}
    pending = []
    for g in gadm:
        n = norm(g["name"])
        code = by_norm.get(n)
        kind = "exact"
        if code is None:
            for v in g.get("variants") or []:
                if norm(v) in by_norm:
                    code, kind = by_norm[norm(v)], "variant"
                    break
        if code is None and n in aliases and aliases[n] in by_norm:
            # an alias may fold two GADM units into one of ours: only for units that were merged in real life
            # (Dadra and Nagar Haveli + Daman and Diu became one union territory in 2020)
            out[g["id"]], how[g["id"]] = by_norm[aliases[n]], "alias"
            used.add(by_norm[aliases[n]])
            continue
        if code is None or code in used:
            pending.append(g)
            continue
        out[g["id"]], how[g["id"]] = code, kind
        used.add(code)
    for g in pending:
        free = {k: v for k, v in by_norm.items() if v not in used}
        best = difflib.get_close_matches(norm(g["name"]), list(free), n=1, cutoff=0.85)
        if best:
            score = difflib.SequenceMatcher(None, norm(g["name"]), best[0]).ratio()
            out[g["id"]], how[g["id"]] = free[best[0]], f"fuzzy:{score:.2f}"
            used.add(free[best[0]])
    return {
        "map": out,
        "how": how,
        "unmatched_gadm": [{"id": g["id"], "name": g["name"]} for g in gadm if g["id"] not in out],
        "unmatched_ours": [{"code": a["code"], "name": a["name"]} for a in ours if a["code"] not in used],
    }


# ------------------------------------------------------------------ boundaries
def project(areas: list[dict]) -> tuple[dict, Callable[[float, float], tuple[int, int]], int]:
    """Equirectangular, centred on the country, cos(latitude) keeps the shape (same as radar_geo.build_country)."""
    xs = [x for a in areas for r in a["rings"] for x, _ in r]
    ys = [y for a in areas for r in a["rings"] for _, y in r]
    k = math.cos(math.radians((min(ys) + max(ys)) / 2))
    scale = WIDTH / ((max(xs) - min(xs)) * k)
    proj = {"lon_min": round(min(xs), 6), "lat_max": round(max(ys), 6), "k": round(k, 6), "scale": round(scale, 6)}

    def px(x: float, y: float) -> tuple[int, int]:
        return round((x - proj["lon_min"]) * proj["k"] * proj["scale"]), round((proj["lat_max"] - y) * proj["scale"])

    return proj, px, round((max(ys) - min(ys)) * scale)


def to_path(rings: list[list[list[float]]], px) -> str:
    parts = []
    for r in rings:
        pts = [px(x, y) for x, y in r]
        dedup = [pts[0]] + [p for p, q in zip(pts[1:], pts) if p != q]
        if len(dedup) < 3:
            continue
        seg = [f"M{dedup[0][0]} {dedup[0][1]}"] + [f"l{x1 - x0} {y1 - y0}" for (x0, y0), (x1, y1) in zip(dedup, dedup[1:])]
        parts.append("".join(seg) + "z")
    return "".join(parts)


def label_point(rings: list[list[list[float]]]) -> tuple[float, float]:
    """Area-weighted centroid of the biggest ring (falls back to the vertex mean for a degenerate ring)."""
    big = max(rings, key=_ring_area)
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(big, big[1:] + big[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-12:
        return sum(x for x, _ in big) / len(big), sum(y for _, y in big) / len(big)
    return cx / (3 * a), cy / (3 * a)


def build_geo(country: str, level: str, geojson: dict, *, tolerance: float, min_island: float, code_prefix: str,
              meta: dict) -> tuple[dict, list[dict]]:
    """A GeoFile for the web (same shape as the radar's) plus the lon/lat rings (for tests and the district lookup)."""
    areas = []
    for ft in geojson["features"]:
        name = ascii_name(ft["properties"]["shapeName"])
        g = ft["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        outers = [p[0] for p in polys]
        biggest = max(outers, key=_ring_area)
        rings = [simplify_ring(r, tolerance) for r in outers if r is biggest or _ring_area(r) >= min_island]
        rings = [[[round(x, 4), round(y, 4)] for x, y in r] for r in rings if len(r) >= 3]
        areas.append({"code": f"{code_prefix}{slug(name)}", "name": name, "source_name": ft["properties"]["shapeName"],
                      "rings": rings})
    areas.sort(key=lambda a: a["code"])
    proj, px, height = project(areas)
    web_areas = []
    for a in areas:
        lx, ly = label_point(a["rings"])
        web_areas.append({"code": a["code"], "name": a["name"], "d": to_path(a["rings"], px), "label": list(px(lx, ly))})
    web = {"country": country, "level": level, "viewBox": [0, 0, WIDTH, height], "projection": proj, **meta,
           "note": "Simplified for a small map (Douglas-Peucker); borders are approximate.", "areas": web_areas}
    return web, areas


def districts_by_division(div_areas: list[dict]) -> dict[str, list[str]]:
    """Each radar district (radar_areas.json) goes to the division that holds its centroid; nearest label if none."""
    districts = json.loads(RADAR_AREAS.read_text(encoding="utf-8"))["countries"]["BD"]["areas"]
    out: dict[str, list[str]] = {d["code"]: [] for d in div_areas}
    for dist in districts:
        lon, lat = label_point(dist["rings"])
        hit = next((d["code"] for d in div_areas if any(point_in_ring(lon, lat, r) for r in d["rings"])), None)
        if hit is None:
            hit = min(div_areas, key=lambda d: sum((lon - x) ** 2 + (lat - y) ** 2 for x, y in [label_point(d["rings"])]))["code"]
        out[hit].append(dist["code"])
    return {k: sorted(v) for k, v in out.items()}


IND_META = {
    "source": "geoBoundaries gbOpen IND ADM1 (DataMeet India community; Election Commission of India; boundaries as of 2011, 36 units)",
    "licence": "CC BY 2.5 IN", "url": "https://www.geoboundaries.org/countryDownloads.html",
    # geoBoundaries states no India-specific dispute note; its general disclaimer is quoted in the provenance file.
    "caveat": "geoBoundaries makes no warranty that these lines are accurate. Some borders of India are disputed; this "
              "map draws the source file as it is and takes no position.",
}
BGD1_META = {
    "source": "geoBoundaries gbOpen BGD ADM1 (geoBoundaries; Wikimedia Commons)", "licence": "CC0 1.0",
    "url": "https://www.geoboundaries.org/countryDownloads.html",
}


def cmd_geo(ind_path: str, bgd1_path: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ind, _ = build_geo("IN", "state", json.loads(Path(ind_path).read_text(encoding="utf-8")), tolerance=0.02,
                       min_island=0.02, code_prefix="IN-", meta=IND_META)
    (OUT / "geo-in.json").write_text(json.dumps(ind, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    bd1, rings = build_geo("BD", "division", json.loads(Path(bgd1_path).read_text(encoding="utf-8")), tolerance=0.012,
                           min_island=0.0006, code_prefix="BD-div-", meta=BGD1_META)
    kids = districts_by_division(rings)
    for a in bd1["areas"]:
        a["districts"] = kids[a["code"]]
    (OUT / "geo-bd-div.json").write_text(json.dumps(bd1, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"geo-in.json: {len(ind['areas'])} areas; geo-bd-div.json: {len(bd1['areas'])} areas, "
          f"{sum(len(v) for v in kids.values())} districts placed")


def cmd_fetch_geo(dest: str) -> None:
    import requests  # only the build machine needs it

    d = Path(dest)
    d.mkdir(parents=True, exist_ok=True)
    for iso3 in ("IND", "BGD"):
        url = f"{GB_RELEASE}/{iso3}/ADM1/geoBoundaries-{iso3}-ADM1_simplified.geojson"
        r = requests.get(url, timeout=120, headers={"User-Agent": "krishiloop-map-build/1.0"})
        r.raise_for_status()
        (d / f"{iso3}-ADM1_simplified.geojson").write_bytes(r.content)
        print("saved", d / f"{iso3}-ADM1_simplified.geojson")


# ------------------------------------------------------------------ GBIF
HttpGet = Callable[[str, dict], object]


def http_get_default() -> HttpGet:
    import requests

    s = requests.Session()
    s.headers["User-Agent"] = "krishiloop-map-build/1.0"

    def get(path: str, params: dict) -> object:
        for attempt in range(4):
            try:
                r = s.get(f"{API}/{path}", params=params, timeout=60)
                if r.status_code == 200:
                    time.sleep(0.05)  # polite: one query at a time
                    return r.json()
                if r.status_code < 500 and r.status_code != 429:
                    r.raise_for_status()
            except requests.RequestException:
                if attempt == 3:
                    raise
            time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"GBIF did not answer: {path} {params}")

    return get


def resolve_taxa(get: HttpGet) -> list[dict]:
    out = []
    for t in TAXA:
        found = None
        for name in t["names"]:
            m = get("species/match", {"name": name, "strict": "true"})
            assert isinstance(m, dict)
            if m.get("matchType") in ("EXACT", "FUZZY") and m.get("usageKey"):
                key = m.get("acceptedUsageKey") or m["usageKey"]
                found = {"id": t["id"], "sci": name, "key": key, "matched": m.get("scientificName"),
                         "status": m.get("status"), "matchType": m.get("matchType"), "kingdom": m.get("kingdom"),
                         "problems": t["problems"]}
                break
        out.append(found or {"id": t["id"], "sci": t["names"][0], "key": None, "matchType": "NONE", "problems": t["problems"]})
    return out


def facet(resp: dict, field: str) -> dict[str, int]:
    for f in resp.get("facets") or []:
        if f["field"].replace("_", "").lower() == field.replace("_", "").lower():
            return {c["name"]: int(c["count"]) for c in f["counts"]}
    return {}


def gadm_units(get: HttpGet, iso3: str, level: int, extra: tuple[str, ...] = ()) -> list[dict]:
    """GADM level-1 (or level-2) units of a country, as GBIF names them."""
    def sub(gid: str) -> list[dict]:
        r = get(f"geocode/gadm/{gid}/subdivisions", {})
        return [{"id": u["id"], "name": u["name"], "variants": u.get("variantName") or [], "parent": gid}
                for u in (r if isinstance(r, list) else [])]

    l1 = sub(iso3) + [u for x in extra for u in sub(x)]
    if level == 1:
        return l1
    return [u for p in l1 for u in sub(p["id"])]


def our_areas(country: str, level: str) -> list[dict]:
    if country == "BD" and level == "district":
        f = RADAR_GEO / "bd.json"
    elif country == "KE":
        f = RADAR_GEO / "ke.json"
    elif country == "BD":
        f = OUT / "geo-bd-div.json"
    else:
        f = OUT / "geo-in.json"
    g = json.loads(f.read_text(encoding="utf-8"))
    return [{"code": a["code"], "name": a["name"]} for a in g["areas"]]


def build_sightings(http_get: HttpGet, today: str, areas_of: Callable[[str, str], list[dict]] = our_areas) -> tuple[dict, dict]:
    n_queries = 0

    def get(path: str, params: dict) -> object:
        nonlocal n_queries
        n_queries += 1
        return http_get(path, params)

    taxa = resolve_taxa(get)
    data: dict = {"v": 1, "queried": today, "api": f"{API}/occurrence/search", "taxa": [], "countries": {}}
    prov: dict = {"queried": today, "api": API, "taxa": taxa, "queries": 0, "countries": {}}
    for t in taxa:
        data["taxa"].append({k: t[k] for k in ("id", "sci", "key") if k in t})
    for c, cfg in COUNTRIES.items():
        cdata: dict = {"levels": {}, "taxa": {}}
        cprov: dict = {"levels": {}}
        for level, gl in cfg["levels"].items():
            units = gadm_units(get, cfg["iso3"], gl, tuple(cfg.get("extra_gadm", ())))
            ours = areas_of(c, level)
            m = match_names(units, ours, ALIASES.get(c, {}))
            cprov["levels"][level] = {"gadm_level": gl, "gadm_units": len(units), "our_areas": len(ours),
                                      "matched": len(m["map"]),
                                      "how": {u["name"]: f"{m['how'][u['id']]} -> {m['map'][u['id']]}" for u in units if u["id"] in m["map"]},
                                      "unmatched_gadm": m["unmatched_gadm"], "unmatched_ours": m["unmatched_ours"]}
            cdata["levels"][level] = {"_map": m["map"]}
        for t in taxa:
            if not t.get("key"):
                continue
            params = {"country": c, "taxonKey": t["key"], "limit": 0, "facetLimit": 300,
                      "facet": ["year", "license", "basisOfRecord"] + [f"gadmLevel{gl}Gid" for gl in cfg["levels"].values()]}
            r = get("occurrence/search", params)
            assert isinstance(r, dict)
            years = facet(r, "year")
            yr = sorted(int(y) for y in years) if years else []
            tdata: dict = {"total": int(r.get("count") or 0), "years": [yr[0], yr[-1]] if yr else None,
                           "dated": sum(years.values()), "licences": facet(r, "license"),
                           "basis": facet(r, "basisOfRecord"), "levels": {}}
            for level, gl in cfg["levels"].items():
                counts = facet(r, f"gadmLevel{gl}Gid")
                gmap = cdata["levels"][level]["_map"]
                areas: dict = {}
                unplaced = 0
                for gid, n in counts.items():
                    code = gmap.get(gid)
                    if code is None:
                        unplaced += n
                        continue
                    yr_r = get("occurrence/search", {"country": c, "taxonKey": t["key"], "gadmGid": gid, "limit": 0,
                                                     "facet": "year", "facetLimit": 300})
                    assert isinstance(yr_r, dict)
                    ys = {int(y): v for y, v in facet(yr_r, "year").items()}
                    prev = areas.get(code)
                    if prev:  # never happens with a one-to-one match; kept so a merge would add, not overwrite
                        prev["n"] += n
                        for y, v in ys.items():
                            prev["y"][y] = prev["y"].get(y, 0) + v
                    else:
                        areas[code] = {"n": n, "y": ys}
                tdata["levels"][level] = {
                    "placed": sum(a["n"] for a in areas.values()),
                    "unplaced": unplaced,  # records with a GADM id that matched none of our outlines
                    "areas": {k: {"n": v["n"], "y": [[y, v["y"][y]] for y in sorted(v["y"])]} for k, v in sorted(areas.items())},
                }
            cdata["taxa"][t["id"]] = tdata
        for level in cdata["levels"]:
            cdata["levels"][level] = {"areas": len(areas_of(c, level))}
        data["countries"][c] = cdata
        prov["countries"][c] = cprov
    prov["queries"] = n_queries
    prov["citation"] = citation(today)
    data["citation"] = citation(today)
    return data, prov


def citation(today: str) -> str:
    d = dt.date.fromisoformat(today)
    return (f"GBIF.org ({d.day} {d.strftime('%B %Y')}) GBIF occurrence search, facet counts via api.gbif.org/v1/occurrence/search. "
            "Records are shared by many publishers under CC0 1.0, CC BY 4.0 or CC BY-NC 4.0 (the mix per pest and "
            "country is listed with each count). A formal GBIF download with a DOI has not been made.")


def choose_bd_level(data: dict, min_districts: int = 10) -> str:
    """Districts when GBIF places records in at least `min_districts` different districts (all pests together);
    otherwise divisions. Written into the data so the page and the report say the same thing."""
    seen = set()
    for t in data["countries"]["BD"]["taxa"].values():
        seen |= set((t["levels"].get("district") or {}).get("areas", {}))
    return "district" if len(seen) >= min_districts else "division"


def cmd_gbif(today: str) -> None:
    data, prov = build_sightings(http_get_default(), today)
    data["countries"]["BD"]["default_level"] = choose_bd_level(data)
    prov["countries"]["BD"]["default_level"] = data["countries"]["BD"]["default_level"]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sightings.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    prov["geoBoundaries_disclaimer"] = (
        "geoBoundaries (CITATION-AND-USE-geoBoundaries.txt, release 9469f09): \"we make no representations or "
        "warranties ... as to the validity, accuracy, completeness, or fitness for a particular purpose\". Its India "
        "metadata states no separate note on disputed borders.")
    (OUT / "sightings_provenance.json").write_text(json.dumps(prov, ensure_ascii=False, indent=1), encoding="utf-8")
    for c, cd in data["countries"].items():
        tot = sum(t["total"] for t in cd["taxa"].values())
        lv = next(iter(cd["levels"]))
        placed = sum(t["levels"][lv]["placed"] for t in cd["taxa"].values())
        print(f"{c}: {tot} records for {len(cd['taxa'])} pests; {placed} placed in a {lv}")
    print(f"BD shows {data['countries']['BD']['default_level']}s first; {prov['queries']} GBIF queries")


# ------------------------------------------------------------------ "what to watch": our sourced rules per pest
# Which active rules speak to which pest, set by hand from each rule's own title and facts (checked 19 Nov 2026).
# Only these two packs exist: Bangladesh rice (pack-bd-rice) and Kenya potato late blight (pack-potato-late-blight).
WATCH = {
    "BD": {"pack": "pack-bd-rice", "crop": "rice", "pests": {
        "bph": ["R-BDR-001", "R-BDR-002", "R-BDR-003", "R-BDR-005", "R-BDR-006"],
        "blast": ["R-BDR-007", "R-BDR-008", "R-BDR-012"],
        "blb": ["R-BDR-004", "R-BDR-009", "R-BDR-010"],
    }},
    "KE": {"pack": "pack-potato-late-blight", "crop": "potato", "pests": {
        "late_blight": ["R-PLB-001", "R-PLB-002", "R-PLB-003", "R-PLB-004", "R-PLB-005", "R-PLB-006", "R-PLB-007",
                        "R-PLB-008", "R-PLB-009", "R-PLB-010", "R-PLB-011"],
    }},
}


def build_watch(rules_dir: Path = ROOT / "rules" / "registry", manifest: Path = ROOT / "corpus" / "manifest.yaml") -> dict:
    """Rule titles (en, bn) and their source documents, read from the YAML packs, so the map never words a rule itself.
    A rule that is missing or not active fails the build."""
    import yaml

    docs = {d["doc_id"]: d for d in yaml.safe_load(manifest.read_text(encoding="utf-8"))["documents"]}
    out: dict = {}
    for country, cfg in WATCH.items():
        pests: dict = {}
        for pest, ids in cfg["pests"].items():
            rules = []
            for rid in ids:
                r = yaml.safe_load((rules_dir / cfg["pack"] / f"{rid}.yaml").read_text(encoding="utf-8"))
                if r.get("status") != "active":
                    raise SystemExit(f"{rid} is not active")
                src = (r.get("sources") or [{}])[0]
                doc = docs.get(src.get("doc_id"), {})
                rules.append({"id": rid, "v": r.get("version"),
                              "title": {"en": " ".join(r["action"]["title"]["en"].split()),
                                        "bn": " ".join(r["action"]["title"]["bn"].split())},
                              "doc": src.get("doc_id"), "page": src.get("page"),
                              # no em dash in UI copy: "BRRI — Rice Knowledge Bank" is shown as "BRRI, Rice Knowledge Bank"
                              "publisher": (doc.get("publisher") or "").replace(" — ", ", ") or None,
                              "url": doc.get("url")})
            pests[pest] = rules
        out[country] = {"pack": cfg["pack"], "crop": cfg["crop"], "pests": pests}
    return out


def cmd_watch() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    w = build_watch()
    (OUT / "watch.json").write_text(json.dumps(w, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("watch.json:", {c: {p: len(r) for p, r in v["pests"].items()} for c, v in w.items()})


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("geo")
    g.add_argument("--ind", required=True)
    g.add_argument("--bgd1", required=True)
    f = sub.add_parser("fetch-geo")
    f.add_argument("dest")
    sub.add_parser("watch")
    b = sub.add_parser("gbif")
    b.add_argument("--date", default=dt.date.today().isoformat())
    a = ap.parse_args(argv)
    if a.cmd == "geo":
        cmd_geo(a.ind, a.bgd1)
    elif a.cmd == "watch":
        cmd_watch()
    elif a.cmd == "fetch-geo":
        cmd_fetch_geo(a.dest)
    else:
        cmd_gbif(a.date)


if __name__ == "__main__":
    main(sys.argv[1:])

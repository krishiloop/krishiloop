"""Satellite rainfall for Bangladesh from NASA GPM IMERG (build time, needs EARTHDATA_TOKEN in the environment).

What it does
  1. Lists the daily IMERG Late Run files (GPM_3IMERGDL, version 07, 0.1 degree) on NASA GES DISC OPeNDAP and takes the
     last 7 consecutive days that exist.
  2. For each day asks OPeNDAP for a small box over Bangladesh (.ascii subset of `precipitation`, about 3,000 numbers; the
     whole global file is never downloaded). `precipitation` is the daily mean rate in mm/day, so one day's value is that
     day's rain in mm. Fill value -9999.9 means no data and is skipped, never turned into a number.
  3. Adds the 7 days up per 0.1 degree cell, then gives each district the MEAN of the cell centres that fall inside its outline
     (cell-centre point-in-polygon, each cell counts once; not area-weighted). The outlines are the ones the /map page draws
     (apps/web/src/features/officer/radar/geo/bd.json, geoBoundaries ADM2, simplified). A district with no cell centre inside
     (none expected at 64 districts) takes the cell that holds its label point, and the file says so in `method`.
  4. Writes apps/web/src/data/nasa/imerg_bd.json: {source, product, version, run, days, made, method, districts: {name: mm}}.

Run (the key stays in this process; nothing is printed or written):
  bash -c 'set -a && . /d/AI_congress/secrets/.env && set +a && .venv/Scripts/python.exe -X utf8 tools/nasa_imerg.py'

Citation: "GPM IMERG Late Run V07, NASA GES DISC" (Huffman et al.). NASA data are free to use.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
GEO = ROOT / "apps/web/src/features/officer/radar/geo/bd.json"
OUT = ROOT / "apps/web/src/data/nasa/imerg_bd.json"
# gpm1 and gpm2 serve the same files; gpm1 sometimes times out, so each request tries gpm2 first, then gpm1
HOSTS = ("gpm2", "gpm1")
PATH = "/opendap/GPM_L3/GPM_3IMERGDL.07"
DAYS = 7
FILL = -9999.9
# Bangladesh box with a margin (lon, lat), in degrees
BOX = (87.9, 92.8, 20.5, 26.8)
STEP = 0.1


def lon_index(lon: float) -> int:
    """Grid column of the cell whose centre is nearest `lon` (centres are -179.95 + 0.1 i)."""
    return round((lon + 179.95) / STEP)


def lat_index(lat: float) -> int:
    """Grid row of the cell whose centre is nearest `lat` (centres are -89.95 + 0.1 j)."""
    return round((lat + 89.95) / STEP)


def centre_lon(i: int) -> float:
    return -179.95 + STEP * i


def centre_lat(j: int) -> float:
    return -89.95 + STEP * j


# ------------------------------------------------------------------ outlines
def district_rings(geo: dict) -> dict[str, dict]:
    """name -> {'rings': [[(lon, lat), ...], ...], 'label': (lon, lat)} from the map's SVG outlines (M, l, z only)."""
    p = geo["projection"]

    def ll(x: float, y: float) -> tuple[float, float]:
        return (p["lon_min"] + x / (p["k"] * p["scale"]), p["lat_max"] - y / p["scale"])

    out: dict[str, dict] = {}
    for a in geo["areas"]:
        rings = []
        for sub in re.split(r"(?=M)", a["d"]):
            nums = re.findall(r"-?\d+(?:\.\d+)?", sub)
            if len(nums) < 6:
                continue
            x, y = float(nums[0]), float(nums[1])
            pts = [ll(x, y)]
            for i in range(2, len(nums) - 1, 2):
                x += float(nums[i])
                y += float(nums[i + 1])
                pts.append(ll(x, y))
            rings.append(pts)
        out[a["name"]] = {"rings": rings, "label": ll(*a["label"])}
    return out


def inside(lon: float, lat: float, rings: list[list[tuple[float, float]]]) -> bool:
    """Even-odd rule over all rings of one district."""
    hit = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                hit = not hit
            j = i
    return hit


def district_means(grid: dict[tuple[int, int], float | None], districts: dict[str, dict]) -> tuple[dict[str, float | None], list[str]]:
    """grid: (lon index, lat index) -> 7-day total in mm (None = no data). Returns name -> mean of the cell centres inside, and
    the names that had no cell centre inside (they take the cell holding their label point)."""
    res: dict[str, float | None] = {}
    fallback: list[str] = []
    for name, d in districts.items():
        vals = []
        for (i, j), v in grid.items():
            if v is not None and inside(centre_lon(i), centre_lat(j), d["rings"]):
                vals.append(v)
        if not vals:
            # no centre inside: the cell that holds the label point
            li, lj = lon_index(d["label"][0]), lat_index(d["label"][1])
            v = grid.get((li, lj))
            if v is not None:
                fallback.append(name)
            res[name] = round(v, 1) if v is not None else None
            continue
        res[name] = round(sum(vals) / len(vals), 1)
    return res, fallback


# ------------------------------------------------------------------ OPeNDAP
def parse_ascii(text: str) -> dict[tuple[int, int], float | None]:
    """Cells of `precipitation` from a DAP2 .ascii reply. GES DISC writes the latitudes once
    (`precipitation.lat, 20.65, 20.75, ...`) and then one row per longitude
    (`precipitation.precipitation[precipitation.time=17118][precipitation.lon=88.05], v, v, ...`), values running over lat.
    Cells are keyed by grid index, from the coordinates in the reply itself."""
    lats: list[float] = []
    cells: dict[tuple[int, int], float | None] = {}
    for line in text.splitlines():
        m = re.match(r"^\s*precipitation\.lat,\s*(.*)$", line)
        if m:
            lats = [float(v) for v in m.group(1).split(",") if v.strip()]
            continue
        m = re.match(r"^\s*precipitation\.precipitation\[[^\]]*\]\[precipitation\.lon=(-?[\d.]+)\],\s*(.*)$", line)
        if m and lats:
            i = lon_index(float(m.group(1)))
            vals = [float(v) for v in m.group(2).split(",") if v.strip()]
            for lat, v in zip(lats, vals):
                cells[(i, lat_index(lat))] = None if v <= FILL + 0.5 else v
    return cells


def get(session: requests.Session, tail: str, tries: int = 3) -> requests.Response:
    """GET PATH + tail from the first host that answers; a 401/403/404 is final (and its body is shown, without the token)."""
    last = None
    for k in range(tries):
        for host in HOSTS:
            url = f"https://{host}.gesdisc.eosdis.nasa.gov{PATH}{tail}"
            try:
                r = session.get(url, timeout=(15, 120))
            except requests.RequestException as e:
                last = f"{host}: {type(e).__name__}"
                continue
            if r.status_code == 200:
                return r
            last = f"{host}: HTTP {r.status_code}: {r.text[:300].strip()}"
            if r.status_code in (401, 403, 404):
                raise SystemExit(f"IMERG request failed ({tail.split('?')[0].rsplit('/', 1)[-1]}): {last}")
        time.sleep(5 * (k + 1))
    raise SystemExit(f"IMERG request failed ({tail.split('?')[0].rsplit('/', 1)[-1]}): {last}")


def latest_days(session: requests.Session, n: int) -> list[tuple[str, str]]:
    """[(YYYY-MM-DD, relative path)] for the last n consecutive days that have a file."""
    now = datetime.now(timezone.utc)
    found: dict[str, str] = {}
    months = [(now.year, now.month), (now.year - (now.month == 1), 12 if now.month == 1 else now.month - 1)]
    for y, mo in months:
        html = get(session, f"/{y}/{mo:02d}/").text
        for name in sorted(set(re.findall(r"3B-DAY-L\.MS\.MRG\.3IMERG\.(\d{8})-S000000-E235959\.V(07[A-Z])\.nc4", html))):
            d, ver = name
            found[f"{d[:4]}-{d[4:6]}-{d[6:]}"] = f"{y}/{mo:02d}/3B-DAY-L.MS.MRG.3IMERG.{d}-S000000-E235959.V{ver}.nc4"
    if not found:
        raise SystemExit("no IMERG daily Late files found in the listing")
    dates = sorted(found)
    # newest day first, then back while the days are consecutive
    take = [dates[-1]]
    while len(take) < n and len(dates) > 1:
        prev = datetime.fromisoformat(take[-1]).date().toordinal() - 1
        want = datetime.fromordinal(prev).date().isoformat()
        if want not in found:
            break
        take.append(want)
    take.sort()
    return [(d, found[d]) for d in take]


def main() -> None:
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise SystemExit("EARTHDATA_TOKEN is not set (load it from the secrets file into the environment)")
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"
    days = latest_days(s, DAYS)
    i0, i1 = lon_index(BOX[0]), lon_index(BOX[1])
    j0, j1 = lat_index(BOX[2]), lat_index(BOX[3])
    total: dict[tuple[int, int], float | None] = {}
    version = ""
    for date, path in days:
        r = get(s, f"/{path}.ascii?precipitation[0][{i0}:{i1}][{j0}:{j1}]")
        cells = parse_ascii(r.text)
        if not cells:
            raise SystemExit(f"could not read any cells for {date}")
        version = re.search(r"\.V(07[A-Z])\.", path).group(1)
        missing = sum(1 for v in cells.values() if v is None)
        print(f"{date}: {len(cells)} cells, {missing} with no data, file V{version}")
        for k, v in cells.items():
            if k not in total:
                total[k] = 0.0 if v is not None else None
            elif v is None:
                total[k] = None  # a day is missing: never add up a partial week
            elif total[k] is not None:
                total[k] += v
    geo = json.loads(GEO.read_text(encoding="utf-8"))
    res, fb = district_means(total, district_rings(geo))
    method = (
        "Daily IMERG Late Run precipitation (mm/day, 0.1 degree) for each of the 7 days, added per cell (a cell with any missing day is left out); "
        "each district is the mean of the cell centres inside its outline (point-in-polygon, not area-weighted; outlines: geoBoundaries ADM2, simplified, as drawn on /map)."
    )
    if fb:
        method += " No cell centre fell inside: " + ", ".join(fb) + " (the cell holding the label point was used)."
    doc = {
        "source": "GPM IMERG Late Run V07, NASA GES DISC (OPeNDAP, EARTHDATA token at build time)",
        "product": "GPM_3IMERGDL v07, IMERG Late Run daily, 0.1 degree, precipitation in mm/day",
        "version": version,
        "run": "Late",
        "days": [d for d, _ in days],
        "made": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "method": method,
        "districts": dict(sorted(res.items())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    vals = [v for v in res.values() if v is not None]
    print(f"wrote {OUT.relative_to(ROOT)}: {len(res)} districts ({len(vals)} with data), {days[0][0]} to {days[-1][0]}, range {min(vals)}-{max(vals)} mm")


if __name__ == "__main__":
    sys.exit(main())

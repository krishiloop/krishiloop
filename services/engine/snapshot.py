"""Field snapshots from open data (Open-Meteo forecast; GloFAS via Open-Meteo flood API).

Every value keeps its source and timestamps. If the live call fails, the last saved snapshot is
returned with mode='snapshot' so the UI can show "Data as of <created_at>".
Open-Meteo's free API is for non-commercial use (licence note in research/data_sources_verified.md).
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP_DIR = ROOT / "data" / "snapshots"
FORECAST = "https://api.open-meteo.com/v1/forecast"
FLOOD = "https://flood-api.open-meteo.com/v1/flood"
NETWORK_ERRORS = (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError)
WINDOW_DAYS = 7      # facts look at the next 7 days
MIN_DAYS = 4         # fewer usable forecast days than this -> the fact is unknown (the planner abstains)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _get(url: str, params: dict) -> dict:
    with urllib.request.urlopen(f"{url}?{urllib.parse.urlencode(params)}", timeout=20) as r:
        return json.loads(r.read())


def build(field: dict, cache_dir: Path | None = None) -> dict:
    """field: {field_id, lat, lon, country, precision, label?, crop, stage, variety?, planting_date?, flood?}

    cache_dir: where the last live snapshot is kept for the offline fallback (default: the planner's SNAP_DIR)."""
    cache_dir = cache_dir or SNAP_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache = cache_dir / f"{field['field_id']}.json"
    try:
        f = _get(FORECAST, {"latitude": field["lat"], "longitude": field["lon"], "timezone": "auto", "forecast_days": 7,
                            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean"})
        d = f["daily"]
        days = [{"date": d["time"][i], "tmax_c": d["temperature_2m_max"][i], "tmin_c": d["temperature_2m_min"][i],
                 "precip_mm": d["precipitation_sum"][i], "rh_mean_pct": d["relative_humidity_2m_mean"][i]}
                for i in range(len(d["time"]))]
        days = [{k: v for k, v in day.items() if v is not None} for day in days]
        snap = {
            "snapshot_id": f"snap-{field['field_id']}-{datetime.now(timezone.utc):%Y%m%dT%H%M}",
            "field_id": field["field_id"], "mode": "live",
            "location": {k: field[k] for k in ("lat", "lon", "precision", "country", "label") if k in field},
            "crop": field["crop"], "stage": field["stage"],
            "forecast": {"source": "open-meteo:forecast", "issued_at": _now(), "days": days},
            "s2": None, "flood": None, "created_at": _now(),
        }
        for k in ("variety", "planting_date"):
            if field.get(k):
                snap[k] = field[k]
        if field.get("flood"):
            try:
                fl = _get(FLOOD, {"latitude": field["lat"], "longitude": field["lon"], "daily": "river_discharge", "forecast_days": 7})
                q = fl["daily"]["river_discharge"]
                trend = "rising" if q[-1] > q[0] * 1.1 else "falling" if q[-1] < q[0] * 0.9 else "stable"
                snap["flood"] = {"source": "glofas:open-meteo-flood", "issued_at": _now(), "trend": trend,
                                 "discharge": [{"date": t, "m3s": v} for t, v in zip(fl["daily"]["time"], q) if v is not None]}
            except Exception:
                snap["flood"] = None
        tmp = cache.with_name(cache.name + ".tmp")
        tmp.write_text(json.dumps(snap, indent=2), encoding="utf-8")
        os.replace(tmp, cache)
        return snap
    except NETWORK_ERRORS:  # only network failures fall back; code bugs must surface
        if cache.exists():
            snap = json.loads(cache.read_text(encoding="utf-8"))
            snap["mode"] = "snapshot"
            return snap
        raise


def age_hours(snap: dict, now: datetime | None = None) -> float:
    created = datetime.fromisoformat(snap["created_at"].replace("Z", "+00:00"))
    return ((now or datetime.now(timezone.utc)) - created).total_seconds() / 3600


def _range(value) -> tuple[float, float]:
    """'10-25', '-2-12' or [lo, hi] -> (lo, hi). Negative bounds are allowed (cold climates)."""
    if isinstance(value, (list, tuple)):
        return float(value[0]), float(value[1])
    m = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*(?:-|to|\.\.)\s*(-?\d+(?:\.\d+)?)\s*", str(value))
    if not m:
        raise ValueError(f"bad range {value!r}")
    return float(m.group(1)), float(m.group(2))


def weather_facts(snap: dict, params: dict, today: date | None = None) -> dict:
    """Derive rule facts from the forecast using reviewer-set parameters (shown as such in receipts).

    Days before `today` are ignored. If fewer than MIN_DAYS usable days remain, or any day in the window
    lacks a needed variable, the fact is None: unknown, never "no risk". The planner then abstains.
    """
    today = today or date.today()
    days = [d for d in ((snap.get("forecast") or {}).get("days") or []) if d.get("date", "") >= today.isoformat()]
    days = days[:WINDOW_DAYS]
    if len(days) < MIN_DAYS:
        return {"forecast_humid_mild_days": None, "forecast_heavy_rain_days": None}
    rh_min = float(params.get("humid_rh_pct_min", 90))
    lo, hi = _range(params.get("mild_temp_c_range", "10-25"))
    heavy = float(params.get("heavy_rain_mm", 10))
    humid_mild = None
    if all(d.get(k) is not None for d in days for k in ("rh_mean_pct", "tmin_c", "tmax_c")):
        humid_mild = sum(1 for d in days if d["rh_mean_pct"] >= rh_min and lo <= d["tmin_c"] and d["tmax_c"] <= hi)
    heavy_days = sum(1 for d in days if d["precip_mm"] >= heavy) if all(d.get("precip_mm") is not None for d in days) else None
    return {"forecast_humid_mild_days": humid_mild, "forecast_heavy_rain_days": heavy_days}

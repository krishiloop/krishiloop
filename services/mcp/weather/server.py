"""KrishiLoop weather MCP server: the forecast facts the planner reads, for any lat/lon. Never a plan or advice.

Wraps services/engine/snapshot.py: the same Open-Meteo call, the same derived facts (weather_facts) and the same
reviewer-set pack parameters the planner uses, so a client sees what the planner would see. Advice comes only from
the deterministic planner, with a signed receipt (services/engine/planner.py).

The only file it writes is its own forecast cache (data/mcp_cache/weather/), kept for the offline fallback
(data_mode 'snapshot'); the planner's snapshots in data/snapshots/ are never touched.

Run:  python -m services.mcp.weather [--transport stdio|http] [--port 8101]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

if __package__ in (None, ""):  # run as a script (python services/mcp/weather/server.py): make `services` importable
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from datetime import date
from typing import Annotated, Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from services.engine import snapshot as snap_mod
from services.engine.planner import FACT_PARAMS, FACT_VARIABLES, MAX_SNAPSHOT_AGE_H
from services.engine.rules import REGISTRY, load_pack, pack_parameter_defs, pack_parameters
from services.mcp.common import READ_LOCAL, READ_WEB, serve

CACHE_DIR = snap_mod.ROOT / "data" / "mcp_cache" / "weather"
COORD_DECIMALS = 2   # about 1 km: the precision sent to Open-Meteo and kept in the cache
PACK_ID = re.compile(r"^pack-[a-z0-9-]{1,60}$")
NOT_ADVICE = ("Weather facts only, not advice. KrishiLoop advice comes only from its deterministic planner, with a "
              "signed receipt. A null fact is unknown, never 'no risk': the planner then abstains and asks an officer.")
MEANING = {
    "forecast_humid_mild_days": "days in the window with mean relative humidity >= humid_rh_pct_min and the whole day "
                                "(minimum and maximum temperature) inside mild_temp_c_range",
    "forecast_heavy_rain_days": "days in the window with precipitation >= heavy_rain_mm",
}

server = MCPServer(
    "krishiloop-weather", title="KrishiLoop weather facts", version="0.1.0",
    instructions="Read-only. Forecast-derived facts (humid-and-mild days, heavy-rain days) for a location, computed "
                 "exactly as KrishiLoop's deterministic planner computes them, with the rule pack's reviewer-set "
                 "parameters and their notes. This server never returns a plan or advice.")


def _check_pack(pack_id: str) -> str:
    packs = sorted(p.name for p in REGISTRY.iterdir() if p.is_dir())
    if not PACK_ID.fullmatch(pack_id) or pack_id not in packs:
        raise ToolError(f"unknown pack {pack_id!r}; known packs: {', '.join(packs)}")
    return pack_id


def _leaves(cond: dict):
    if "all" in cond or "any" in cond:
        for c in cond.get("all", []) + cond.get("any", []):
            yield from _leaves(c)
    elif cond:
        yield cond


def _fact_basis(pack_id: str) -> dict[str, dict]:
    """For each derived fact: what it counts, the parameters that shape it, and the rule conditions that read it."""
    defs = pack_parameter_defs(pack_id)
    out = {}
    for fact, names in FACT_PARAMS.items():
        params = [defs.get(n) or {"name": n, "note": "not set in this pack: the engine default in "
                                                     "services/engine/snapshot.py applies"} for n in names]
        conditions = []
        for rule in load_pack(pack_id):
            for leaf in _leaves(rule.get("when") or {}):
                if leaf.get("fact") != fact:
                    continue
                c = {"rule_id": rule["rule_id"], "version": rule["version"], "op": leaf["op"], "value": leaf["value"]}
                if isinstance(leaf["value"], str) and leaf["value"].startswith("param:"):
                    p = next(p for p in rule.get("reviewer_parameters", []) if p["name"] == leaf["value"][6:])
                    c.update(value=p["value"], parameter=p)
                conditions.append(c)
        out[fact] = {"meaning": MEANING[fact], "variables": list(FACT_VARIABLES[fact]), "parameters": params,
                     "read_by_rule_conditions": conditions}
    return out


@server.tool(annotations=READ_LOCAL, structured_output=True)
def weather_parameters(
    pack_id: Annotated[str, Field(description="Rule pack id, as listed by the rules server's list_packs "
                                              "(e.g. pack-potato-late-blight)")],
) -> dict[str, Any]:
    """The weather facts a rule pack's planner derives, the reviewer-set parameters behind them (with who set each
    and why) and the rule conditions that read them. Offline: no forecast is fetched."""
    _check_pack(pack_id)
    return {"note": NOT_ADVICE, "pack_id": pack_id,
            "window": {"days": snap_mod.WINDOW_DAYS, "min_usable_days": snap_mod.MIN_DAYS},
            "facts": _fact_basis(pack_id)}


@server.tool(annotations=READ_WEB, structured_output=True)
def forecast_snapshot(
    lat: Annotated[float, Field(ge=-90, le=90, description="Latitude in degrees (rounded to 0.01 before use)")],
    lon: Annotated[float, Field(ge=-180, le=180, description="Longitude in degrees (rounded to 0.01 before use)")],
    pack_id: Annotated[str, Field(description="Rule pack whose parameters derive the facts "
                                              "(e.g. pack-potato-late-blight)")],
    include_flood: Annotated[bool, Field(description="Also fetch the GloFAS river-discharge trend")] = False,
) -> dict[str, Any]:
    """A 7-day Open-Meteo forecast snapshot for a location and the disease-risk facts KrishiLoop's planner derives
    from it with the pack's parameters. data_mode is 'live', or 'snapshot' when Open-Meteo did not answer and the
    last cached forecast for this location is returned (see data_as_of). Never a plan or advice."""
    _check_pack(pack_id)
    rlat, rlon = round(lat, COORD_DECIMALS), round(lon, COORD_DECIMALS)
    field = {"field_id": f"mcp_{rlat:.2f}_{rlon:.2f}", "lat": rlat, "lon": rlon, "precision": "rounded_0.01deg",
             "crop": "any", "stage": "any", "flood": include_flood}
    try:
        snap = snap_mod.build(field, cache_dir=CACHE_DIR)
    except snap_mod.NETWORK_ERRORS as e:
        raise ToolError(f"forecast unavailable: Open-Meteo did not answer ({type(e).__name__}) and no earlier "
                        "forecast is cached for this location") from None
    except (KeyError, IndexError, TypeError) as e:
        raise ToolError(f"forecast unavailable: unexpected Open-Meteo response ({type(e).__name__})") from None
    today = date.today()
    facts = snap_mod.weather_facts(snap, pack_parameters(pack_id), today)
    basis = _fact_basis(pack_id)
    fc = snap.get("forecast") or {}
    age = snap_mod.age_hours(snap)
    out = {
        "note": NOT_ADVICE, "pack_id": pack_id,
        "location": {"lat": rlat, "lon": rlon, "precision": "rounded to 0.01 degree (about 1 km) before it is sent"},
        "data_mode": snap.get("mode", "live"), "data_as_of": snap["created_at"], "age_hours": round(age, 1),
        # the planner refuses a cached forecast older than this for "this week" (it abstains with data_stale)
        "stale_for_planner": snap.get("mode") != "live" and age > MAX_SNAPSHOT_AGE_H,
        "source": {"forecast": fc.get("source"), "issued_at": fc.get("issued_at"),
                   "terms": "Open-Meteo free API (non-commercial use)"},
        "window": {"from": today.isoformat(), "days": snap_mod.WINDOW_DAYS, "min_usable_days": snap_mod.MIN_DAYS},
        "facts": {f: {"value": facts.get(f), "unit": "days", **basis[f]} for f in FACT_PARAMS},
        "days": fc.get("days") or [],
    }
    if include_flood:
        out["flood"] = snap.get("flood")
    return out


def main(argv: list[str] | None = None) -> None:
    serve(server, 8101, argv)


if __name__ == "__main__":
    main()
